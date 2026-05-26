<p align="center">
  <img src="static/images/logo.png" alt="FluentFling Logo" width="340"/>
</p>

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

- **Import your own vocabulary** — upload `.xlsx`, `.csv`, or `.txt` files and give each set a name
- **AI enrichment** — automatically classifies word type (noun, verb, adjective, …), adds *der/die/das* articles, and generates bilingual example sentences
- **3D Flashcards** — flip cards with a smooth 3D animation; navigate with Easy / Hard / Previous or keyboard shortcuts
- **Spaced repetition** — "Hard" cards re-appear 5–9 positions later in the queue; "Easy" cards are retired
- **Three test modes** — Multiple Choice, Fill in the Blank, and Type the Word
- **Confetti** — correct answers and high scores trigger a confetti burst 🎉
- **Multiple vocabulary sets** — all sets shown on the home page; study or test one set or all combined
- **Sentence generation** — generate missing sentences for any set with one click

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) |
| Templates | Jinja2 + Bootstrap 5 |
| AI (word processing) | HuggingFace Transformers (`google/flan-t5-base`) |
| NLP | spaCy `de_core_news_sm` |
| Storage | JSON files (no database required) |
| Frontend | Vanilla JS + CSS animations |

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/your-username/fluentfling.git
cd fluentfling
```

### 2. Create a virtual environment

```bash
python -m venv my-env
# Windows
my-env\Scripts\activate
# macOS / Linux
source my-env/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
python -m spacy download de_core_news_sm
```

### 4. (Optional) Configure AI backend

Copy `.env.example` to `.env` and set your preferred AI backend:

```bash
cp .env.example .env
```

The app works out-of-the-box with the bundled HuggingFace model. If you have [Ollama](https://ollama.com/) running locally, set `OLLAMA_MODEL` in `.env` to use it instead (faster on most machines).

### 5. Run the app

```bash
uvicorn main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

---

## How to Use

### Import a vocabulary set

1. Click **+ Import New Set** on the home page
2. Give your set a name (e.g. *"Beruf Vocab – May"*)
3. Upload a file — the app expects at least a `german_word` column and a `meaning` column
4. Click **Process with AI** — word types, articles, and sentences are filled in automatically
5. Your set appears on the home page once processing is complete

### Flashcard study

- Click the card to flip it and see the meaning + example sentence
- Press **Easy ✓** to move on, **Hard ↺** to repeat the card later
- Use **⟳ Shuffle** to randomise the remaining deck
- Filter by word type (Nouns / Verbs / Adjectives / Other)

**Keyboard shortcuts:** `Space` flip · `E` easy · `H` hard · `←` previous

### Test yourself

- Choose a vocabulary set (or test all sets combined)
- Pick a test type and number of questions
- Get instant feedback — correct answers trigger confetti 🎉

---

## File Format

Your import file should include these columns (extra columns are ignored):

| Column | Required | Example |
|--------|----------|---------|
| `german_word` | ✅ | `die Arbeit` |
| `meaning` | ✅ | `work, job` |
| `word_type` | optional | `noun` |
| `artikel` | optional | `die` |
| `sentence` | optional | `Die Arbeit macht Spaß.\|Work is fun.` |

Sentences use the `|` separator between the German and English halves.

---

## Starter Kits

The repo includes ready-made vocabulary sets for German levels:

| File | Level |
|------|-------|
| `A1 Starter kit.xlsx` | Beginner A1 |
| `A2 Starter kit.xlsx` | Elementary A2 |
| `B1 Starter kit.xlsx` | Intermediate B1 |
| `B2 Starter kit.xlsx` | Upper-Intermediate B2 |

Load them from the home page with one click.

---

## Project Structure

```
fluentfling/
├── main.py              # FastAPI routes and background jobs
├── database.py          # JSON vocabulary store
├── word_processor.py    # AI enrichment (word type, artikel, sentences)
├── file_handler.py      # File parsing (xlsx, csv, txt)
├── templates/           # Jinja2 HTML templates
│   ├── base.html
│   ├── home.html
│   ├── flashcards.html
│   ├── test.html
│   └── upload.html
├── static/
│   ├── css/style.css
│   ├── js/
│   │   ├── flashcard.js
│   │   ├── test.js
│   │   └── upload.js
│   └── images/logo.png
├── vocabulary/          # Saved vocabulary sets (auto-created)
├── requirements.txt
└── .env.example
```

---

## License

MIT — free to use, fork, and learn from.

---

<p align="center">Made with 💜 for language learners everywhere</p>
