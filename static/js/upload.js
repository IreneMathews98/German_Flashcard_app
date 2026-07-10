let parsedWords = [];
let confirmedSetName = '';

// ── DOM refs ──────────────────────────────────────────────────
const nameInput       = document.getElementById('set-name');
const filenamePreview = document.getElementById('filename-preview');
const nameError       = document.getElementById('name-error');
const confirmBtn      = document.getElementById('confirm-name-btn');
const confirmAppendBtn = document.getElementById('confirm-append-btn');
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');

// ── Step 1: mode toggle (new vs append) ───────────────────────
document.querySelectorAll('input[name="upload-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isAppend = radio.value === 'append' && radio.checked;
    document.getElementById('new-set-area')?.classList.toggle('d-none', isAppend);
    document.getElementById('append-set-area')?.classList.toggle('d-none', !isAppend);
    document.querySelectorAll('.mode-pill').forEach(p => p.classList.remove('active'));
    radio.closest('.mode-pill')?.classList.add('active');
  });
});

// ── Step 1a: confirm new set name ─────────────────────────────
if (nameInput && filenamePreview) {
  nameInput.addEventListener('input', () => {
    const name = nameInput.value.trim();
    filenamePreview.textContent = name ? `${name}.xlsx` : 'YourName.xlsx';
    nameError?.classList.add('d-none');
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); });
}

if (confirmBtn) {
  confirmBtn.addEventListener('click', confirmName);
}

function confirmName() {
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    nameError?.classList.remove('d-none');
    nameInput?.focus();
    return;
  }
  nameError?.classList.add('d-none');
  _proceedWithName(name);
}

// ── Step 1b: confirm append to existing set ───────────────────
if (confirmAppendBtn) {
  confirmAppendBtn.addEventListener('click', () => {
    const select = document.getElementById('existing-set-select');
    const name = select?.value?.trim();
    if (!name) return;
    _proceedWithName(name);
  });
}

function _proceedWithName(name) {
  confirmedSetName = name;
  const badge = document.getElementById('set-name-badge');
  if (badge) badge.textContent = name;
  document.getElementById('name-section')?.classList.add('d-none');
  document.getElementById('upload-section')?.classList.remove('d-none');
}

// ── Step 2: drag & drop / file select ────────────────────────
if (dropZone) {
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') fileInput?.click();
  });
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });
}

document.getElementById('choose-file-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  fileInput?.click();
});

async function handleFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Upload failed');
    parsedWords = data.words;
    renderPreview(parsedWords);
    showSection('preview-section');
  } catch (err) {
    showError(err.message);
  }
}

function renderPreview(words) {
  document.getElementById('word-count-badge').textContent = `${words.length} word${words.length !== 1 ? 's' : ''}`;
  document.getElementById('preview-table-body').innerHTML = words.map((w, i) => `
    <tr>
      <td class="text-muted">${i + 1}</td>
      <td><strong>${esc(w.german_word)}</strong></td>
      <td>${esc(w.meaning)}</td>
      <td><span class="text-muted small">${esc(w.type_hint || '—')}</span></td>
    </tr>`).join('');
}

// ── Step 3: process with AI ───────────────────────────────────
document.getElementById('process-btn')?.addEventListener('click', startProcessing);
document.getElementById('change-file-btn')?.addEventListener('click', resetUpload);
document.getElementById('reset-all-btn')?.addEventListener('click', resetAll);
document.getElementById('try-again-btn')?.addEventListener('click', resetUpload);

async function startProcessing() {
  if (!parsedWords.length) return;
  showSection('processing-section');
  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: parsedWords, set_name: confirmedSetName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to start processing');
    await pollJob(data.job_id, parsedWords.length);
  } catch (err) {
    showError(err.message);
  }
}

async function pollJob(jobId, total) {
  const batches = Math.ceil(total / 5);
  const bar  = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');
  const msg  = document.getElementById('processing-msg');
  if (msg) msg.textContent = `Processing ${total} word${total !== 1 ? 's' : ''} — spaCy classifying, AI generating sentences…`;

  while (true) {
    await sleep(1800);
    const job = await (await fetch(`/api/process/${jobId}/status`)).json();
    const pct = Math.round(job.progress * 100);
    if (bar)  bar.style.width  = `${pct}%`;
    if (text) text.textContent = `${Math.round(job.progress * batches)} / ${batches} batches`;
    if (job.done) {
      if (job.status === 'error') throw new Error(job.error || 'Processing failed');
      showDone(job.count, job.set_name || confirmedSetName);
      return;
    }
  }
}

function showDone(count, setName) {
  const msg  = document.getElementById('done-msg');
  const link = document.getElementById('done-study-link');
  if (msg)  msg.textContent = `${count} words saved to "${setName}".`;
  if (link) link.href = `/flashcards?set=${encodeURIComponent(setName)}`;
  showSection('done-section');
}

// ── Helpers ───────────────────────────────────────────────────
function resetUpload() {
  parsedWords = [];
  if (fileInput) fileInput.value = '';
  showSection('upload-section');
}

function resetAll() {
  parsedWords = [];
  confirmedSetName = '';
  if (fileInput)      fileInput.value = '';
  if (nameInput)      nameInput.value = '';
  if (filenamePreview) filenamePreview.textContent = 'YourName.xlsx';
  nameError?.classList.add('d-none');
  document.getElementById('name-section')?.classList.remove('d-none');
  document.getElementById('upload-section')?.classList.add('d-none');
  ['preview-section', 'processing-section', 'done-section', 'error-section']
    .forEach(id => document.getElementById(id)?.classList.add('d-none'));
}

function showSection(id) {
  ['upload-section', 'preview-section', 'processing-section', 'done-section', 'error-section']
    .forEach(s => document.getElementById(s)?.classList.add('d-none'));
  document.getElementById(id)?.classList.remove('d-none');
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) el.textContent = `Error: ${msg}`;
  showSection('error-section');
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
