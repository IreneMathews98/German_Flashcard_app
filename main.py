import json
import random
import re
import uuid
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from database import VocabularyStore
from file_handler import parse_uploaded_file
from word_processor import process_words, process_batch, generate_sentences_batch

load_dotenv()

APP_DIR   = Path(__file__).parent
VOCAB_DIR = APP_DIR / 'vocabulary'

app = FastAPI(title="Deutsch Lernen")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")
db = VocabularyStore(vocab_dir=VOCAB_DIR, app_dir=APP_DIR)

jobs: dict = {}


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "home.html", {
        "user_sets": db.list_sets(),
    })


@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request):
    existing_sets = [s['name'] for s in db.list_sets()]
    return templates.TemplateResponse(request, "upload.html", {
        "existing_sets": existing_sets,
    })


@app.get("/flashcards", response_class=HTMLResponse)
async def flashcards_page(request: Request, set: Optional[str] = Query(None)):
    set_name = set or ""
    word_count = db.word_count(set_name or None)
    return templates.TemplateResponse(request, "flashcards.html", {
        "set_name":   set_name,
        "word_count": word_count,
    })


@app.get("/test", response_class=HTMLResponse)
async def test_page(request: Request, set: Optional[str] = Query(None)):
    set_name = set or ""
    all_sets    = db.list_sets()
    total_count = db.word_count(None)
    word_count  = db.word_count(set_name or None) if set_name else total_count
    return templates.TemplateResponse(request, "test.html", {
        "set_name":    set_name,
        "word_count":  word_count,
        "all_sets":    all_sets,
        "total_count": total_count,
    })


# ── File upload ───────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    content = await file.read()
    try:
        words = parse_uploaded_file(content, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return JSONResponse({"words": words, "count": len(words)})


# ── AI processing (background job) ───────────────────────────────────────────

@app.post("/api/process")
async def start_processing(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    words    = data.get("words", [])
    set_name = data.get("set_name", "My Vocabulary").strip() or "My Vocabulary"
    if not words:
        raise HTTPException(status_code=400, detail="No words provided")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0.0, "done": False,
                    "count": 0, "error": None, "set_name": set_name}
    background_tasks.add_task(_run_job, job_id, words, set_name)
    return JSONResponse({"job_id": job_id})


@app.get("/api/process/{job_id}/status")
async def job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return JSONResponse(jobs[job_id])


async def _run_job(job_id: str, words: list, set_name: str):
    batch_size = 5
    total = len(words)

    # ── Save raw words immediately so the file exists even if AI fails ──
    raw = [{'german_word': w.get('german_word', ''),
            'meaning':     w.get('meaning', ''),
            'word_type':   w.get('word_type', ''),
            'artikel':     w.get('artikel', ''),
            'sentence':    w.get('sentence', '')} for w in words]
    try:
        save_path = db._path(set_name)
        print(f"[job {job_id}] Saving {len(raw)} raw words to {save_path}", flush=True)
        db.save_set(set_name, raw)
        print(f"[job {job_id}] Raw save OK: {save_path}", flush=True)
    except Exception as e:
        print(f"[job {job_id}] SAVE FAILED: {e}", flush=True)
        jobs[job_id].update({"status": "error", "done": True, "error": f"Save failed: {e}"})
        return

    needs = [w for w in words if not (w.get('word_type') and w.get('sentence'))]
    done  = [r for r in raw if r.get('word_type') and r.get('sentence')]
    processed = []

    try:
        for i in range(0, len(needs), batch_size):
            result = await process_batch(needs[i:i + batch_size])
            processed.extend(result)
            jobs[job_id]["progress"] = (len(done) + len(processed)) / total
        print(f"[job {job_id}] AI done, saving enriched words…", flush=True)
        count = db.save_set(set_name, done + processed)
        print(f"[job {job_id}] Enriched save OK: {count} words", flush=True)
        jobs[job_id].update({"status": "done", "done": True, "progress": 1.0, "count": count})
    except Exception as e:
        print(f"[job {job_id}] AI/save error: {e}", flush=True)
        # AI failed — raw words are already saved; report error but keep the file
        jobs[job_id].update({"status": "error", "done": True, "error": str(e)})


# ── Generate sentences for existing vocabulary ────────────────────────────────

@app.post("/api/generate-sentences")
async def start_sentence_generation(request: Request, background_tasks: BackgroundTasks,
                                     set: Optional[str] = Query(None)):
    set_name = set or None
    words = db.get_words(set_name)
    to_process = [w for w in words if not w.get("sentence")]
    if not to_process:
        return JSONResponse({"job_id": None, "message": "All words already have sentences.", "total": 0})

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0.0, "done": False,
                    "count": 0, "total": len(to_process)}
    background_tasks.add_task(_run_sentence_job, job_id, to_process, set_name)
    return JSONResponse({"job_id": job_id, "total": len(to_process)})


@app.get("/api/generate-sentences/{job_id}/status")
async def sentence_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return JSONResponse(jobs[job_id])


async def _run_sentence_job(job_id: str, words: list, set_name: str = None):
    batch_size = 5
    total = len(words)
    all_updated = []
    try:
        for i in range(0, total, batch_size):
            result = await generate_sentences_batch(words[i:i + batch_size])
            all_updated.extend(result)
            jobs[job_id]["progress"] = min(i + batch_size, total) / total

        # Group updates by set and write each file
        by_set: dict = {}
        for w in all_updated:
            sn = w.get('set_name') or set_name or 'My Vocabulary'
            by_set.setdefault(sn, []).append(w)
        total_changed = 0
        for sn, updates in by_set.items():
            total_changed += db.update_sentences(sn, updates)

        jobs[job_id].update({"status": "done", "done": True, "progress": 1.0, "count": total_changed})
    except Exception as e:
        jobs[job_id].update({"status": "error", "done": True, "error": str(e)})


# ── Vocabulary API ────────────────────────────────────────────────────────────

@app.get("/api/words")
async def get_words(set: Optional[str] = Query(None)):
    return JSONResponse(db.get_words(set or None))


@app.delete("/api/words/{word_id}")
async def delete_word(word_id: int, set: Optional[str] = Query(None)):
    if not set:
        raise HTTPException(status_code=400, detail="set query parameter required")
    db.delete_word(set, word_id)
    return JSONResponse({"success": True})


@app.get("/api/stats")
async def get_stats(set: Optional[str] = Query(None)):
    set_name = set or None
    return JSONResponse({
        "total":             db.word_count(set_name),
        "missing_sentences": db.missing_sentences_count(set_name),
    })


# ── Set management ────────────────────────────────────────────────────────────

@app.delete("/api/sets/{set_name}")
async def delete_set(set_name: str):
    db.delete_set(set_name)
    return JSONResponse({"success": True})


# ── Starter packs ─────────────────────────────────────────────────────────────

@app.post("/api/starter-packs/{pack_name}/load")
async def load_starter_pack(pack_name: str):
    try:
        count = db.load_starter_pack(pack_name)
        return JSONResponse({"success": True, "count": count, "set_name": pack_name})
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Test API ──────────────────────────────────────────────────────────────────

@app.get("/api/test/questions")
async def get_test_questions(test_type: str = "multiple_choice", count: int = 10,
                              set: Optional[str] = Query(None)):
    words = db.get_words(set or None)
    if len(words) < 4:
        raise HTTPException(status_code=400, detail="Need at least 4 words to generate a test.")
    return JSONResponse(_build_questions(words, test_type, min(count, len(words))))


def _build_questions(words: list, test_type: str, count: int) -> list:
    selected = random.sample(words, count)
    questions = []
    for word in selected:
        german  = word['german_word']
        display = f"{word['artikel']} {german}".strip() if word.get('artikel') else german

        if test_type == "multiple_choice":
            others = [w for w in words if w['german_word'] != german]
            distractors = random.sample(others, min(3, len(others)))
            options = [word['meaning']] + [w['meaning'] for w in distractors]
            random.shuffle(options)
            questions.append({'type': 'multiple_choice', 'question': display,
                               'word_type': word.get('word_type', ''),
                               'correct': word['meaning'], 'options': options})

        elif test_type == "fill_blank":
            sentence = word.get('sentence', '')
            if '|' in sentence:
                g, e = sentence.split('|', 1)
                blanked = re.compile(re.escape(german), re.IGNORECASE).sub('_____', g.strip(), count=1)
                if '_____' in blanked:
                    questions.append({'type': 'fill_blank', 'sentence': blanked,
                                       'hint': e.strip(), 'meaning': word['meaning'], 'correct': german})

        elif test_type == "typing":
            questions.append({'type': 'typing', 'question': word['meaning'],
                               'word_type': word.get('word_type', ''), 'correct': german,
                               'display_correct': display,
                               'sentence': word.get('sentence','').split('|')[0].strip()})
    return questions
