# FluentFling 🇩🇪

A local web app for learning German vocabulary with AI-generated example sentences, flashcards, and tests.

<h1 align="center">FluentFling</h1> 
<p align="center"><em>Connect. Converse. Fly.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python" />
  <img src="https://img.shields.io/badge/FastAPI-0.136-009688?style=flat-square&logo=fastapi" />
  <img src="https://img.shields.io/badge/AI-Powered-7c3aed?style=flat-square&logo=openai" />
  <img src="https://img.shields.io/badge/Language-German-black?style=flat-square" />
</p>

---

**FluentFling** is a personal German vocabulary learning app that turns your own word lists into smart, AI-powered flashcards and quizzes — all running locally on your machine.

Import a spreadsheet of German words, let the AI fill in word types, articles, and example sentences, then study with 3D flip-cards and test yourself with multiple-choice, fill-in-the-blank, or typing challenges.

---

## Features

- **Flashcards** — flip cards showing the German word (with article for nouns), meaning, and an example sentence with English translation
- **Test mode** — multiple choice, fill-in-the-blank, and typing tests
- **Set management** — view, rename, add, and delete words in any vocabulary set
- **Import vocabulary** — upload `.txt`, `.csv`, or `.xlsx` files
- **Starter packs** — built-in A1, A2, B1, B2 word lists
- **AI enrichment** — automatically classifies word type (noun, verb, adjective…), finds the article for nouns, generates a natural German example sentence, and translates it to English
- **Word type filter** — filter flashcards and tests by noun, verb, adjective, or other

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + Uvicorn |
| Templates | Jinja2 + Bootstrap 5 |
| NLP (word type) | spaCy `de_core_news_sm` |
| AI sentences | Anthropic Claude API *(recommended)* |
| AI fallback | Ollama or HuggingFace Transformers |
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

Copy `.env.example` to `.env` and add your Anthropic API key:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com).

> **No API key?** The app still works — word type classification (spaCy) runs locally. Sentence generation will be skipped unless you configure an Ollama server instead (`LLM_BACKEND=ollama`).

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
Needs at least two columns. Recognised column names (case-insensitive):

| German column | English column |
|---|---|
| `german_word`, `german`, `deutsch`, `word`, `question` | `meaning`, `english`, `translation`, `answer` |

If a `word_type`, `artikel`, or `sentence` column is present it will be preserved.

---

## AI Enrichment

After import, click **✨ Generate Sentences** on any set card. The app will:

1. Use spaCy to classify each word (noun, verb, adjective, etc.)
2. Call the LLM to find the article for nouns
3. Generate a natural German example sentence
4. Translate it to English

Phrases and full-sentence template entries are automatically skipped.

### LLM backends

| Backend | How to enable | Notes |
|---|---|---|
| **Claude** *(default)* | Set `ANTHROPIC_API_KEY` in `.env` | Best quality, fast |
| **Ollama** | `LLM_BACKEND=ollama` | Runs fully locally |
| **Transformers** | `LLM_BACKEND=transformers` | Slow, lower quality |

---

## Project Structure

```
German_Flashcard_app/
├── main.py              # FastAPI routes
├── database.py          # JSON-based vocabulary store
├── word_processor.py    # spaCy classification + LLM enrichment
├── file_handler.py      # File parsing (txt, csv, xlsx)
├── vocabulary/          # Saved vocabulary sets (JSON)
├── templates/
│   ├── base.html        # Shared layout + navbar
│   ├── home.html        # Set overview
│   ├── set.html         # Set detail — word table + add/rename
│   ├── flashcards.html  # Flashcard study mode
│   ├── test.html        # Quiz mode
│   └── upload.html      # File import
├── static/
│   ├── css/style.css
│   ├── js/
│   └── images/
├── .env                 # Your secrets (git-ignored)
└── .env.example         # Config template
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude backend (auto-selected when set) |
| `LLM_BACKEND` | `auto` | Override backend: `claude`, `ollama`, or `transformers` |
| `OLLAMA_MODEL` | `llama3.2` | Ollama model name |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `HF_MODEL` | `google/flan-t5-base` | HuggingFace model (transformers backend only) |
