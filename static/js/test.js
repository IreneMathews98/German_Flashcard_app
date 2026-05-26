const TYPE_LABELS = {
  noun: 'Nomen', verb: 'Verb', reflexive_verb: 'Reflexives Verb',
  adjective: 'Adjektiv', adverb: 'Adverb', preposition: 'Präposition',
  verb_mit_präposition: 'Verb + Präp.', adjektiv_mit_präposition: 'Adj. + Präp.',
  nomen_mit_präposition: 'Nomen + Präp.', nomen_verb_verbindung: 'NVV',
  common_phrase: 'Redewendung', unknown: '',
};

const TYPE_COLORS = {
  noun: '#2563eb', verb: '#dc2626', reflexive_verb: '#d97706',
  adjective: '#16a34a', adverb: '#7c3aed', preposition: '#0891b2',
  verb_mit_präposition: '#dc2626', adjektiv_mit_präposition: '#16a34a',
  nomen_mit_präposition: '#2563eb', nomen_verb_verbindung: '#b45309',
  common_phrase: '#6b7280', unknown: '#6b7280',
};

let questions = [], currentQ = 0, correctCount = 0, wrongCount = 0;
let currentSet = null;  // set name used for the active test session

const _cfg       = document.getElementById('set-config');
const _allSets   = JSON.parse(_cfg?.dataset.sets || '[]');
const _totalCount = parseInt(_cfg?.dataset.total || '0');

// Build name → count lookup; '' means all sets
const SET_COUNT = { '': _totalCount };
_allSets.forEach(s => { SET_COUNT[s.name] = s.count; });

// ── Set selector dynamic updates ──────────────────────────────
const _selector = document.getElementById('set-selector');
if (_selector) {
  _selector.addEventListener('change', _onSetChange);
}

function _onSetChange() {
  const count = SET_COUNT[_selector?.value ?? ''] ?? _totalCount;
  document.getElementById('word-count-display').textContent = count;
  const qInput  = document.getElementById('q-count');
  const newMax  = Math.min(count, 20);
  const newMin  = Math.min(4, count);
  qInput.max    = newMax;
  qInput.min    = newMin;
  if (parseInt(qInput.value) > newMax) qInput.value = newMax;
  if (parseInt(qInput.value) < newMin) qInput.value = newMin;
  document.getElementById('q-count-label').textContent = qInput.value;
}

// ── Setup ─────────────────────────────────────────────────────
document.querySelectorAll('.test-type-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.test-type-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    opt.querySelector('input').checked = true;
  });
});

const qCountInput = document.getElementById('q-count');
const qCountLabel = document.getElementById('q-count-label');
if (qCountInput) {
  qCountLabel.textContent = qCountInput.value;
  qCountInput.addEventListener('input', () => qCountLabel.textContent = qCountInput.value);
}

async function startTest() {
  const testType = document.querySelector('input[name="test-type"]:checked')?.value || 'multiple_choice';
  const count    = parseInt(document.getElementById('q-count')?.value || '10');
  const selected = _selector?.value ?? '';

  currentSet = selected || null;

  try {
    const setParam = currentSet ? `&set=${encodeURIComponent(currentSet)}` : '';
    const res = await fetch(`/api/test/questions?test_type=${testType}&count=${count}${setParam}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || 'Failed to load questions');
      return;
    }
    questions = await res.json();
    if (!questions.length) { alert('No questions available for this test type.'); return; }

    currentQ = 0; correctCount = 0; wrongCount = 0;
    updateScoreBadges();
    showScreen('quiz-screen');
    renderQuestion();
  } catch (e) {
    alert('Error loading test: ' + e.message);
  }
}

function showSetup() { showScreen('setup-screen'); }

// ── Quiz rendering ────────────────────────────────────────────
function renderQuestion() {
  const q = questions[currentQ];
  if (!q) { showResults(); return; }

  // Header
  document.getElementById('q-counter').textContent = `Question ${currentQ + 1} / ${questions.length}`;
  document.getElementById('quiz-progress').style.width = `${((currentQ) / questions.length) * 100}%`;

  // Type badge
  const badge = document.getElementById('q-type-badge');
  const type = q.word_type || '';
  badge.textContent = TYPE_LABELS[type] || '';
  badge.style.background = TYPE_COLORS[type] || '#6b7280';
  badge.style.display = (TYPE_LABELS[type] && type) ? 'inline-block' : 'none';

  // Question text
  document.getElementById('q-question').textContent = q.question;
  document.getElementById('q-subtext').textContent = q.type === 'fill_blank' ? `Hint: ${q.hint}` : '';

  // Hide feedback
  document.getElementById('feedback-area').classList.add('d-none');

  if (q.type === 'multiple_choice') {
    renderMultipleChoice(q);
  } else {
    renderTextInput(q);
  }
}

function renderMultipleChoice(q) {
  document.getElementById('mc-options').classList.remove('d-none');
  document.getElementById('text-input-area').classList.add('d-none');

  const list = document.getElementById('mc-options-list');
  list.innerHTML = q.options.map((opt, i) => `
    <div class="mc-option" data-idx="${i}">${escHtml(opt)}</div>
  `).join('');

  list.querySelectorAll('.mc-option').forEach((el, i) => {
    el.addEventListener('click', () => checkMC(el, q.options[i], q.correct));
  });
}

function renderTextInput(q) {
  document.getElementById('mc-options').classList.add('d-none');
  document.getElementById('text-input-area').classList.remove('d-none');

  const input = document.getElementById('text-answer');
  input.value = '';
  input.focus();

  const hintEl = document.getElementById('input-hint');
  if (q.type === 'fill_blank') {
    hintEl.textContent = q.sentence;  // show blanked sentence in subtext already
  } else {
    hintEl.textContent = '';
  }
}

// ── Answer checking ───────────────────────────────────────────
function checkMC(el, chosen, correct) {
  // Disable all options
  document.querySelectorAll('.mc-option').forEach(o => o.style.pointerEvents = 'none');

  const isCorrect = chosen === correct;
  el.classList.add(isCorrect ? 'correct' : 'wrong');

  if (!isCorrect) {
    document.querySelectorAll('.mc-option').forEach(o => {
      if (o.textContent.trim() === correct) o.classList.add('correct');
    });
  }

  updateScore(isCorrect);
  showFeedback(isCorrect, correct);
}

function submitText() {
  const q = questions[currentQ];
  const input = document.getElementById('text-answer');
  const answer = input.value.trim();
  if (!answer) return;

  input.disabled = true;

  const isCorrect = answer.toLowerCase() === q.correct.toLowerCase();
  updateScore(isCorrect);
  showFeedback(isCorrect, q.display_correct || q.correct, q.sentence || '');
}

function updateScore(isCorrect) {
  if (isCorrect) correctCount++; else wrongCount++;
  updateScoreBadges();
}

function updateScoreBadges() {
  document.getElementById('score-correct').textContent = `✓ ${correctCount}`;
  document.getElementById('score-wrong').textContent = `✗ ${wrongCount}`;
}

function showFeedback(isCorrect, correctAnswer, sentence) {
  const box = document.getElementById('feedback-box');
  const label = document.getElementById('feedback-label');
  const detail = document.getElementById('feedback-detail');

  box.className = `alert ${isCorrect ? 'alert-success' : 'alert-danger'}`;
  label.textContent = isCorrect ? '✓ Correct! ' : '✗ Wrong. ';
  detail.textContent = isCorrect ? '' : `Correct answer: ${correctAnswer}`;
  if (sentence && !isCorrect) {
    detail.textContent += sentence ? `  •  ${sentence}` : '';
  }

  document.getElementById('feedback-area').classList.remove('d-none');

  if (isCorrect && typeof confetti === 'function') {
    confetti({
      particleCount: 60,
      spread: 55,
      origin: { y: 0.65 },
      colors: ['#7c3aed', '#0891b2', '#f97316', '#f5c842', '#a855f7'],
    });
  }
}

function nextQuestion() {
  const input = document.getElementById('text-answer');
  input.disabled = false;
  input.value = '';

  currentQ++;
  if (currentQ >= questions.length) {
    showResults();
  } else {
    renderQuestion();
  }
}

// ── Results ───────────────────────────────────────────────────
function showResults() {
  const total = questions.length;
  const pct = total ? Math.round((correctCount / total) * 100) : 0;

  document.getElementById('final-score').textContent = `${pct}%`;
  document.getElementById('stat-correct').textContent = correctCount;
  document.getElementById('stat-wrong').textContent = wrongCount;
  document.getElementById('stat-total').textContent = total;

  // Conic gradient for score ring
  document.getElementById('score-ring').style.setProperty('--pct', `${pct}%`);

  let emoji = '😕', title = 'Keep practising!';
  if (pct >= 90) { emoji = '🏆'; title = 'Ausgezeichnet!'; }
  else if (pct >= 70) { emoji = '⭐'; title = 'Gut gemacht!'; }
  else if (pct >= 50) { emoji = '👍'; title = 'Not bad!'; }

  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-subtitle').textContent = `You scored ${correctCount} out of ${total} questions.`;

  if (pct >= 70 && typeof confetti === 'function') {
    setTimeout(() => {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 },
                 colors: ['#7c3aed', '#0891b2', '#f97316', '#f5c842', '#a855f7'] });
    }, 300);
  }

  const studyLink = document.getElementById('study-link');
  if (studyLink) {
    studyLink.href = currentSet
      ? `/flashcards?set=${encodeURIComponent(currentSet)}`
      : '/flashcards';
  }

  showScreen('results-screen');
}

// ── Helpers ───────────────────────────────────────────────────
function showScreen(id) {
  ['setup-screen', 'quiz-screen', 'results-screen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('d-none', s !== id);
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
