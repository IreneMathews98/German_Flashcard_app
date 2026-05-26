import asyncio
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────
LLM_BACKEND  = os.getenv("LLM_BACKEND", "transformers").lower()
HF_MODEL     = os.getenv("HF_MODEL", "google/flan-t5-base")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")

# ── spaCy POS → word_type mapping (from notebook) ────────────
# Keys are our standard word_type values used throughout the app.
WORD_EXP = {
    "noun":                  ["NN", "NN NN"],
    "reflexive_verb":        ["REFART VB", "REFART NN", "REFART ADJ"],
    "verb":                  ["VB"],
    "adjective":             ["ADJ"],
    "adverb":                ["ADV", "ADV ADV"],
    "verb_mit_präposition":  ["VB PP", "PP VB", "REFART VB PP", "REFART VB VB",
                              "REFART PP VB", "PP REFART VB"],
    "nomen_mit_präposition": ["NN PP", "ART NN PP", "NN NN PP", "ART NN NN PP",
                              "PP NN", "PP ART NN", "PP ART NN NN", "PP NN NN"],
    "nomen_verb_verbindung": ["NN VB", "ART NN VB", "NN NN VB", "ART NN NN VB",
                              "PP ART NN VB", "PP NN VB", "PP ART NN NN VB", "PP NN NN VB"],
}

# ── Lazy singletons ───────────────────────────────────────────
_nlp       = None
_pos_df    = None
_hf        = None   # dict: tokenizer, model, device
_lock_nlp  = threading.Lock()
_lock_pipe = threading.Lock()
_executor  = ThreadPoolExecutor(max_workers=2)

_POS_CSV = Path(__file__).parent / "POS_dict.csv"


def _get_nlp():
    global _nlp, _pos_df
    if _nlp is None:
        with _lock_nlp:
            if _nlp is None:
                import spacy
                print("[word_processor] Loading spaCy de_core_news_sm…")
                _nlp = spacy.load("de_core_news_sm")
                _pos_df = pd.read_csv(str(_POS_CSV))
                print("[word_processor] spaCy ready.")
    return _nlp, _pos_df


def _get_hf():
    global _hf
    if _hf is None:
        with _lock_pipe:
            if _hf is None:
                from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                print(f"[word_processor] Loading {HF_MODEL} on {device.upper()}…")
                tokenizer = AutoTokenizer.from_pretrained(HF_MODEL)
                model = AutoModelForSeq2SeqLM.from_pretrained(HF_MODEL).to(device)
                model.eval()
                _hf = {"tokenizer": tokenizer, "model": model, "device": device}
                print("[word_processor] HF model ready.")
    return _hf


# ── spaCy classification (mirrors notebook logic exactly) ─────

def _spacy_classify(word: str) -> str:
    nlp, pos_df = _get_nlp()
    doc = nlp(word)

    # Build full_tag string
    full_tag = " ".join(token.tag_ for token in doc).strip()

    # Map each tag to its Symbol using POS_dict.csv
    symbols = []
    for tag in full_tag.split():
        match = pos_df.loc[pos_df["TAG"] == tag, "Symbol"].values
        if len(match) > 0:
            symbols.append(match[0])
    pos_meaning = " ".join(symbols).strip()

    # Match to word_type
    for word_type, patterns in WORD_EXP.items():
        if pos_meaning in patterns:
            return word_type

    return "common_phrase"


# ── HF prompts ────────────────────────────────────────────────

_ARTIKEL_PROMPT = """\
Find the German article (der/die/das) for each noun.
Noun: Hund → der
Noun: Katze → die
Noun: Kind → das
Noun: Verlegenheit → die
Noun: Tyrann → der
Noun: Webseite → die
Noun: Kollege → der
Noun: Forschung → die
Noun: {word} →"""

_SENTENCE_PROMPT = """\
Task: Write one German sentence using the vocabulary word, then give the English translation.
Format: German sentence | English translation

Word: laufen (to run)
Sentence: Er läuft jeden Morgen im Park. | He runs in the park every morning.

Word: Angst (fear)
Sentence: Sie hat Angst vor Spinnen. | She is afraid of spiders.

Word: sich unterhalten (to chat)
Sentence: Wir unterhalten uns gerne über Musik. | We like to chat about music.

Word: {word} ({meaning})
Sentence:"""


# ── Public API ────────────────────────────────────────────────

async def process_words(words: list) -> list:
    already_done, needs_processing = [], []
    for w in words:
        if w.get("word_type") and w.get("sentence"):
            already_done.append(_keep(w))
        else:
            needs_processing.append(w)

    processed = []
    for i in range(0, len(needs_processing), 5):
        result = await process_batch(needs_processing[i:i + 5])
        processed.extend(result)

    return already_done + processed


async def process_batch(words: list) -> list:
    loop = asyncio.get_event_loop()

    # Step 1 — spaCy word-type classification (sync, fast)
    classified = await loop.run_in_executor(_executor, _classify_batch, words)

    # Step 2 — LLM: artikel (nouns only) + sentence
    if LLM_BACKEND == "ollama":
        return await _ollama_enrich(classified)
    else:
        tasks = [loop.run_in_executor(_executor, _hf_enrich, w) for w in classified]
        return list(await asyncio.gather(*tasks))


def _classify_batch(words: list) -> list:
    # Preserve word_type if already set (e.g. from existing DB record)
    return [
        {**w, "word_type": w.get("word_type") or _spacy_classify(w["german_word"])}
        for w in words
    ]


# ── HF enrichment ─────────────────────────────────────────────

def _hf_generate(prompt: str, max_new_tokens: int = 120) -> str:
    import torch
    hf = _get_hf()
    tok, model, device = hf["tokenizer"], hf["model"], hf["device"]
    inputs = tok(prompt, return_tensors="pt", truncation=True, max_length=512).to(device)
    with torch.no_grad():
        output_ids = model.generate(**inputs, max_new_tokens=max_new_tokens)
    return tok.decode(output_ids[0], skip_special_tokens=True).strip()


def _hf_enrich(word: dict) -> dict:
    word_type = word.get("word_type", "unknown")

    artikel = ""
    if word_type == "noun":
        try:
            out = _hf_generate(_ARTIKEL_PROMPT.format(word=word["german_word"]), max_new_tokens=5).lower()
            if out in ("der", "die", "das"):
                artikel = out
        except Exception:
            pass

    sentence = ""
    try:
        out = _hf_generate(_SENTENCE_PROMPT.format(
            word=word["german_word"],
            word_type=word_type.replace("_", " "),
            meaning=word["meaning"],
        ))
        if "|" in out:
            sentence = out
    except Exception:
        pass

    return {
        "german_word": word["german_word"],
        "meaning":     word["meaning"],
        "word_type":   word_type,
        "artikel":     artikel,
        "sentence":    sentence,
    }


# ── Ollama enrichment ─────────────────────────────────────────

async def _ollama_enrich(words: list) -> list:
    import httpx
    results = []
    async with httpx.AsyncClient(timeout=180) as client:
        for word in words:
            word_type = word.get("word_type", "unknown")
            artikel = ""
            sentence = ""

            if word_type == "noun":
                try:
                    r = await client.post(f"{OLLAMA_URL}/api/chat", json={
                        "model": OLLAMA_MODEL,
                        "messages": [{"role": "user",
                                      "content": _ARTIKEL_PROMPT.format(word=word["german_word"])}],
                        "stream": False,
                    })
                    out = r.json()["message"]["content"].strip().lower()
                    if out in ("der", "die", "das"):
                        artikel = out
                except Exception:
                    pass

            try:
                r = await client.post(f"{OLLAMA_URL}/api/chat", json={
                    "model": OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": _SENTENCE_PROMPT.format(
                        word=word["german_word"],
                        word_type=word_type.replace("_", " "),
                        meaning=word["meaning"],
                    )}],
                    "stream": False,
                })
                out = r.json()["message"]["content"].strip()
                if "|" in out:
                    sentence = out
            except Exception:
                pass

            results.append({"german_word": word["german_word"], "meaning": word["meaning"],
                            "word_type": word_type, "artikel": artikel, "sentence": sentence})
    return results


async def generate_sentences_batch(words: list) -> list:
    """Generate/update sentences for words that already have word_type set.
    Skips spaCy re-classification; only runs LLM for artikel + sentence."""
    loop = asyncio.get_event_loop()
    if LLM_BACKEND == "ollama":
        return await _ollama_enrich(words)
    else:
        tasks = [loop.run_in_executor(_executor, _hf_enrich, w) for w in words]
        return list(await asyncio.gather(*tasks))


def _keep(w: dict) -> dict:
    return {k: w.get(k, "") for k in ("german_word", "meaning", "word_type", "artikel", "sentence")}
