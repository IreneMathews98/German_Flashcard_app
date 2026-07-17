# FluentFling 🇩🇪

<p align="center"><em>Connect. Converse. Fly.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python" />
  <img src="https://img.shields.io/badge/FastAPI-latest-009688?style=flat-square&logo=fastapi" />
  <img src="https://img.shields.io/badge/spaCy-de__core__news__sm-7c3aed?style=flat-square" />
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20Ollama%20%7C%20HF-black?style=flat-square" />
  <img src="https://img.shields.io/badge/Language-German-gold?style=flat-square" />
</p>

---

**FluentFling** is a personal German vocabulary learning app that turns your own word lists into AI-powered flashcards and quizzes — running entirely on your machine.

Import a spreadsheet or text file, let the AI classify word types, find articles, and generate bilingual example sentences, then study with animated flip-cards or test yourself with quizzes.

---

## Features

### Study
- **Study mode** — 3D flip-cards showing the German word (with article for nouns), word-type badge, then English meaning + example sentence on the back
- **Revise mode** — reversed cards: English meaning shown first, flip to reveal the German word + example sentence — great for productive recall
- **Word-type filter** — filter cards by Noun, Verb, Adjective, Other, or Bookmarked
- **Shuffle** — randomise the current filtered deck
- **Easy / Hard** — Easy moves the card to done; Hard re-inserts it ~5 cards ahead
- **Bookmarks** — bookmark words from flashcard mode *or* directly from the View Set table; bookmarks persist in the browser across sessions
- **Keyboard shortcuts** — `Space` flip · `E` easy · `H` hard · `B` bookmark · `←` previous

### Vocabulary management
- **Import** — upload `.txt`, `.csv`, or `.xlsx` files; set name is editable before saving
- **Starter packs** — built-in A1, A2, B1, B2 word lists ready to load
- **View Set** — searchable, sortable word table (click any column header to sort A→Z / Z→A)
- **Add / Edit words** — unified popup modal with German word, meaning, article, type, and example sentence fields
- **Delete words** — per-word deletion directly in the table
- **Rename / Delete sets** — from the home page or the set detail view

### AI enrichment
- **Word-type classification** — spaCy `de_core_news_sm` assigns one of 10 canonical types locally (no API key needed)
- **Article detection** — spaCy morphological gender (`Masc → der`, `Fem → die`, `Neut → das`) with LLM fallback for unknowns
- **Example sentences** — LLM generates a natural German sentence + English translation for every word
- **Generate Sentences button** — enrich any set in the background, with a live progress bar

### Word types (10 canonical types)
| Type | Description |
|---|---|
| `noun` | Nouns |
| `verb` | Verbs (including separable, reflexive) |
| `adjective` | Adjectives |
| `adverb` | Adverbs |
| `phrase` | Fixed phrases, idioms, expressions |
| `nomen_verb_verbindung` | Noun-verb collocations (NVV) |
| `conjunction` | Conjunctions, connectors, prepositions |
| `verb_mit_präposition` | Verb + preposition combinations |
| `nomen_mit_präposition` | Noun + preposition combinations |
| `adj_mit_präposition` | Adjective + preposition combinations |

### Test mode
- **Multiple choice** — pick the correct English meaning
- **Fill in the blank** — complete the example sentence
- **Typing** — type the German word from the English prompt
- **Matching** — connect German words to their meanings

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + Uvicorn |
| Templates | Jinja2 + Bootstrap 5 |
| NLP (word type + article) | spaCy `de_core_news_sm` |
| AI sentences | Anthropic Claude *(recommended)* |
| AI fallback | Ollama · HuggingFace Transformers |
| Storage | JSON files in `vocabulary/` |

---

## Setup

### 1. Clone and create a virtual environment

```bash
git clone <repo-url>
cd German_Flashcard_app
python -m venv my-env

# Windows
my-env\Scripts\activate

# macOS / Linux
source my-env/bin/activate
```

### 2. Install dependencies

```bash
pip install fastapi uvicorn python-dotenv pandas openpyxl spacy anthropic httpx
python -m spacy download de_core_news_sm
```

### 3. Configure environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Add your Anthropic API key for best results:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

> **No API key?** The app still works — spaCy runs locally for word-type classification and article detection. Sentence generation is skipped unless you set up Ollama instead.

### 4. Run

```bash
uvicorn main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

---

## Importing Vocabulary

### Text file (`.txt`)
One word per line, German and English separated by ` - `:
```
abholen - to pick up
pünktlich - punctual
sich unterhalten - to chat
```

### CSV / Excel
Needs at least two columns. Recognised names (case-insensitive):

| German column | English column |
|---|---|
| `german_word`, `german`, `deutsch`, `word`, `question` | `meaning`, `english`, `translation`, `answer` |

Existing `word_type`, `artikel`, and `sentence` columns are preserved if present.

---

## AI Enrichment

After import, click **✨ Generate Sentences** on any set card. The pipeline:

1. spaCy classifies each word into one of the 10 canonical types
2. spaCy morphology identifies the article for nouns (der / die / das)
3. LLM generates a natural German example sentence
4. LLM translates it to English

Full phrases and multi-word entries are automatically skipped.

### LLM backends

| Backend | How to enable | Notes |
|---|---|---|
| **Claude** *(auto-selected)* | Set `ANTHROPIC_API_KEY` in `.env` | Best quality |
| **Ollama** | `LLM_BACKEND=ollama` in `.env` | Fully local |
| **Transformers** | `LLM_BACKEND=transformers` in `.env` | Slow, lower quality |

---

## Pipeline Notebook

`German_Flashcard_Pipeline.ipynb` is a step-by-step Jupyter notebook that walks through the full enrichment pipeline independently of the web app — useful for batch-processing large files or experimenting with prompts:

1. Import vocabulary (`.txt` / `.csv` / `.xlsx`)
2. Detect language (langdetect)
3. Clean words
4. POS-tag with spaCy
5. Map tags → symbols
6. Classify word type
7. Identify article (spaCy morphology + optional LLM)
8. Generate example sentences (Claude / Ollama / HF API / local Transformers)
9. Save to `vocabulary/`

---

## Project Structure

```
German_Flashcard_app/
├── main.py                        # FastAPI routes + background jobs
├── database.py                    # JSON-based vocabulary store
├── word_processor.py              # spaCy classification + LLM enrichment
├── file_handler.py                # File parsing (txt, csv, xlsx)
├── LANGUAGE_MAP.py                # ISO language code → name lookup
├── POS_dict.csv                   # spaCy tag → symbol mapping
├── German_Flashcard_Pipeline.ipynb  # Standalone enrichment notebook
├── vocabulary/                    # Saved vocabulary sets (JSON)
│   ├── A1 Starter kit.json
│   ├── A2 Starter kit.json
│   ├── B1 Starter kit.json
│   ├── B2 Starter kit.json
│   └── ...
├── templates/
│   ├── base.html                  # Shared layout + navbar
│   ├── home.html                  # Set overview + Study / Revise buttons
│   ├── set.html                   # Set detail — sortable table, bookmark, add/edit
│   ├── flashcards.html            # Flashcard study & revise mode
│   ├── bookmarks.html             # Saved bookmarks
│   ├── test.html                  # Quiz mode
│   └── upload.html                # File import
├── static/
│   ├── css/style.css
│   ├── js/
│   │   ├── flashcard.js           # Flashcard logic (study + revise modes)
│   │   ├── test.js
│   │   └── upload.js
│   └── images/
├── .env                           # Your secrets (git-ignored)
└── .env.example                   # Config template
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude backend (auto-selected when set) |
| `LLM_BACKEND` | `auto` | Override: `claude`, `ollama`, or `transformers` |
| `OLLAMA_MODEL` | `llama3.2` | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `HF_MODEL` | `google/flan-t5-base` | HuggingFace model (transformers backend) |
| `HF_TOKEN` | — | HuggingFace token (HF Inference API backend) |
