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
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
HF_MODEL          = os.getenv("HF_MODEL", "google/flan-t5-base")
OLLAMA_MODEL      = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_URL        = os.getenv("OLLAMA_URL", "http://localhost:11434")

# Auto-select backend: Claude if API key is present, otherwise honour LLM_BACKEND env var
_explicit = os.getenv("LLM_BACKEND", "").lower()
if _explicit:
    LLM_BACKEND = _explicit
elif ANTHROPIC_API_KEY:
    LLM_BACKEND = "claude"
else:
    LLM_BACKEND = "transformers"

# ── spaCy POS → word_type mapping (from notebook) ────────────
# Keys are our standard word_type values used throughout the app.
WORD_EXP = {
    "noun": [
        "NN", "NN NN", "NN NN NN",
        "ART NN", "ART NN NN",
        "ADJ NN", "ADJ ADJ NN", "ADJ NN NN",
        "NUM NN",
    ],
    "reflexive_verb": [
        "REFART VB", "REFART NN", "REFART ADJ",
        "REFART VB VB", "REFART VB PP",
    ],
    "verb": [
        "VB", "VB VB",
        "ART VB", "ART VB VB",
        "COMP VB",
    ],
    "adjective": ["ADJ", "ADJ ADJ"],
    "adverb":    ["ADV", "ADV ADV", "NEG"],
    "verb_mit_präposition": [
        "VB PP", "PP VB", "REFART VB PP", "REFART VB VB",
        "REFART PP VB", "PP REFART VB",
        "ART VB PP", "VB PP NN", "VB NN PP",
    ],
    "nomen_mit_präposition": [
        "NN PP", "ART NN PP", "NN NN PP", "ART NN NN PP",
        "PP NN", "PP ART NN", "PP ART NN NN", "PP NN NN",
        "ADJ NN PP", "PP ADJ NN",
    ],
    "nomen_verb_verbindung": [
        "NN VB", "ART NN VB", "NN NN VB", "ART NN NN VB",
        "PP ART NN VB", "PP NN VB", "PP ART NN NN VB", "PP NN NN VB",
        "ADJ NN VB",
    ],
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

def _clean_word_for_tagging(word: str) -> str:
    """Strip alternatives/parentheticals so spaCy sees only the core German word."""
    word = re.sub(r'\([^)]*\)', '', word)   # remove (hints)
    word = re.sub(r'\.{2,}', '', word)      # remove ellipsis
    for sep in (',', ';'):                  # take first alternative
        word = word.split(sep)[0]
    return word.strip()


def _pos_fallback(pos_meaning: str) -> str:
    """Best-guess classification when no WORD_EXP pattern matches."""
    if not pos_meaning:
        return "common_phrase"
    counts: dict[str, int] = {}
    for s in pos_meaning.split():
        counts[s] = counts.get(s, 0) + 1
    vb  = counts.get("VB", 0) + counts.get("REFART", 0)
    nn  = counts.get("NN", 0)
    adj = counts.get("ADJ", 0)
    adv = counts.get("ADV", 0)
    if vb > 0 and vb >= nn:
        return "verb"
    if nn > 0:
        return "noun"
    if adj > 0:
        return "adjective"
    if adv > 0:
        return "adverb"
    return "common_phrase"


def _spacy_classify(word: str) -> str:
    nlp, pos_df = _get_nlp()
    clean = _clean_word_for_tagging(word)
    doc   = nlp(clean)

    # Build full_tag string
    full_tag = " ".join(token.tag_ for token in doc).strip()

    # Map each tag to its Symbol using POS_dict.csv
    symbols = []
    for tag in full_tag.split():
        match = pos_df.loc[pos_df["TAG"] == tag, "Symbol"].values
        if len(match) > 0:
            symbols.append(match[0])
    pos_meaning = " ".join(symbols).strip()

    # Exact pattern match first
    for word_type, patterns in WORD_EXP.items():
        if pos_meaning in patterns:
            return word_type

    # Fall back to dominant-POS heuristic
    return _pos_fallback(pos_meaning)


def _is_phrase(word: dict) -> bool:
    """Return True for entries that are phrases/templates — skip sentence generation."""
    if word.get("word_type") == "common_phrase":
        return True
    german = word.get("german_word", "")
    # Full-sentence templates contain ellipsis or end with sentence punctuation
    if re.search(r'\.{2,}|[.!?]$', german.strip()):
        return True
    # Long multi-word strings (5+ words) are phrases, not vocabulary items
    if len(german.split()) >= 5:
        return True
    return False


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

_TRANSLATE_PROMPT = "translate German to English: {sentence}"

_SENTENCE_PROMPT = """\
Write one short, natural German sentence that shows how to USE the word in context, then give the English translation.
Format: German sentence | English translation

Word: laufen (to run)
Sentence: Er läuft jeden Morgen im Park. | He runs in the park every morning.

Word: Angst (fear)
Sentence: Sie hat Angst vor Spinnen. | She is afraid of spiders.

Word: absagen (to cancel)
Sentence: Ich muss das Treffen leider absagen. | I unfortunately have to cancel the meeting.

Word: pünktlich (punctual)
Sentence: Der Zug ist heute pünktlich angekommen. | The train arrived on time today.

Word: {word} ({meaning})
Sentence:"""


# ── Claude enrichment ─────────────────────────────────────────

_CLAUDE_PROMPT = """\
You are a German language teacher. Given a German vocabulary word, do the following:
1. If the word is a noun, state its article (der / die / das).
2. Write ONE short, natural German sentence that clearly shows how to use the word in everyday context.
3. Translate that sentence into English.

Reply in EXACTLY this format (omit the Artikel line for non-nouns):
Artikel: der
Sentence: Der Hund bellt laut. | The dog barks loudly.

Word: {word} ({meaning})
Word type: {word_type}"""


async def _claude_enrich(words: list) -> list:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    results = []
    for word in words:
        word_type = word.get("word_type", "unknown")
        artikel   = ""
        sentence  = ""
        try:
            msg = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=120,
                messages=[{"role": "user", "content": _CLAUDE_PROMPT.format(
                    word=word["german_word"],
                    meaning=word["meaning"],
                    word_type=word_type.replace("_", " "),
                )}],
            )
            out = msg.content[0].text.strip()
            for line in out.splitlines():
                line = line.strip()
                if line.lower().startswith("artikel:"):
                    art = line.split(":", 1)[1].strip().lower()
                    if art in ("der", "die", "das"):
                        artikel = art
                elif line.lower().startswith("sentence:"):
                    raw = line.split(":", 1)[1].strip()
                    if "|" in raw:
                        de, en = raw.split("|", 1)
                        sentence = f"{de.strip()} | {en.strip()}"
                    else:
                        sentence = raw
        except Exception as e:
            print(f"[claude] error for '{word['german_word']}': {e}", flush=True)
        results.append({
            "german_word": word["german_word"],
            "meaning":     word["meaning"],
            "word_type":   word_type,
            "artikel":     artikel,
            "sentence":    sentence,
        })
    return results


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
    if LLM_BACKEND == "claude":
        return await _claude_enrich(classified)
    elif LLM_BACKEND == "ollama":
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


def _hf_build_sentence(raw: str) -> str:
    """Return 'German | English', translating if the English part is missing."""
    if not raw or len(raw) < 5:
        return ""
    if "|" in raw:
        de, en = raw.split("|", 1)
        de, en = de.strip(), en.strip()
        if not en:
            try:
                en = _hf_generate(_TRANSLATE_PROMPT.format(sentence=de), max_new_tokens=80)
            except Exception:
                pass
        return f"{de} | {en}"
    # No pipe at all — the whole output is the German sentence; translate it
    de = raw.strip()
    en = ""
    try:
        en = _hf_generate(_TRANSLATE_PROMPT.format(sentence=de), max_new_tokens=80)
    except Exception:
        pass
    return f"{de} | {en}"


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
    if not _is_phrase(word):
        try:
            out = _hf_generate(_SENTENCE_PROMPT.format(
                word=word["german_word"],
                meaning=word["meaning"],
            )).strip()
            sentence = _hf_build_sentence(out)
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

            if not _is_phrase(word):
                try:
                    r = await client.post(f"{OLLAMA_URL}/api/chat", json={
                        "model": OLLAMA_MODEL,
                        "messages": [{"role": "user", "content": _SENTENCE_PROMPT.format(
                            word=word["german_word"],
                            meaning=word["meaning"],
                        )}],
                        "stream": False,
                    })
                    out = r.json()["message"]["content"].strip()
                    if out and len(out) > 5:
                        de, en = (out.split("|", 1) + [""])[:2]
                        de, en = de.strip(), en.strip()
                        if not en:
                            tr = await client.post(f"{OLLAMA_URL}/api/chat", json={
                                "model": OLLAMA_MODEL,
                                "messages": [{"role": "user",
                                              "content": f"Translate to English, reply with only the translation:\n{de}"}],
                                "stream": False,
                            })
                            en = tr.json()["message"]["content"].strip()
                        sentence = f"{de} | {en}"
                except Exception:
                    pass

            results.append({"german_word": word["german_word"], "meaning": word["meaning"],
                            "word_type": word_type, "artikel": artikel, "sentence": sentence})
    return results


async def generate_sentences_batch(words: list) -> list:
    """Generate/update sentences for words that already have word_type set.
    Skips spaCy re-classification; only runs LLM for artikel + sentence."""
    loop = asyncio.get_event_loop()
    if LLM_BACKEND == "claude":
        return await _claude_enrich(words)
    elif LLM_BACKEND == "ollama":
        return await _ollama_enrich(words)
    else:
        tasks = [loop.run_in_executor(_executor, _hf_enrich, w) for w in words]
        return list(await asyncio.gather(*tasks))


def _keep(w: dict) -> dict:
    return {k: w.get(k, "") for k in ("german_word", "meaning", "word_type", "artikel", "sentence")}
