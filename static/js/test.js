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
    // find_german reuses the typing API (same data shape)
    const apiType = testType === 'find_german' ? 'typing' : testType;
    const res = await fetch(`/api/test/questions?test_type=${apiType}&count=${count}${setParam}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail || 'Failed to load questions');
      return;
    }
    questions = await res.json();
    if (!questions.length) { alert('No questions available for this test type.'); return; }

    if (testType === 'matching') {
      startMatchingGame(questions);
    } else if (testType === 'find_german') {
      startFlashcardGame(questions);
    } else {
      currentQ = 0; correctCount = 0; wrongCount = 0;
      updateScoreBadges();
      showScreen('quiz-screen');
      renderQuestion();
    }
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

// ── Matching game ─────────────────────────────────────────────
const MATCH_PAIR_COLORS = ['#7c3aed','#0891b2','#f97316','#16a34a','#2563eb','#d97706','#a855f7','#0d9488','#dc2626','#65a30d'];

let matchPairs = [];
let selectedEl = null, selectedSide = null;
let matchedCount = 0, matchCorrect = 0, matchWrong = 0;
const hadWrongAttempt = new Set();
let _sentenceTimer = null;

function startMatchingGame(pairs) {
  matchPairs = pairs;
  selectedEl = null; selectedSide = null;
  matchedCount = 0; matchCorrect = 0; matchWrong = 0;
  hadWrongAttempt.clear();

  const rights = pairs.map((p, i) => ({ meaning: p.meaning, id: i }));
  rights.sort(() => Math.random() - 0.5);

  document.getElementById('match-left').innerHTML = pairs.map((p, i) => `
    <button type="button" class="match-item match-item-left" data-id="${i}" data-meaning="${escHtml(p.meaning)}">${escHtml(p.german)}</button>
  `).join('');
  document.getElementById('match-right').innerHTML = rights.map(p => `
    <button type="button" class="match-item match-item-right" data-id="${p.id}" data-meaning="${escHtml(p.meaning)}">${escHtml(p.meaning)}</button>
  `).join('');

  document.querySelectorAll('#match-left .match-item').forEach(el =>
    el.addEventListener('click', () => onMatchItemClick(el, 'left')));
  document.querySelectorAll('#match-right .match-item').forEach(el =>
    el.addEventListener('click', () => onMatchItemClick(el, 'right')));

  document.getElementById('match-score-correct').textContent = '✓ 0';
  document.getElementById('match-score-wrong').textContent = '✗ 0';
  updateMatchProgress();
  showScreen('matching-screen');
}

function onMatchItemClick(el, side) {
  if (el.classList.contains('matched') || el.classList.contains('wrong-flash')) return;

  if (!selectedEl) {
    el.classList.add('selected');
    selectedEl = el; selectedSide = side;
  } else if (selectedSide === side) {
    selectedEl.classList.remove('selected');
    el.classList.add('selected');
    selectedEl = el;
  } else {
    const leftEl  = side === 'right' ? selectedEl : el;
    const rightEl = side === 'right' ? el : selectedEl;
    selectedEl.classList.remove('selected');
    el.classList.remove('selected');
    selectedEl = null; selectedSide = null;
    checkMatchAttempt(leftEl, rightEl);
  }
}

function checkMatchAttempt(leftEl, rightEl) {
  const isCorrect = leftEl.dataset.meaning === rightEl.dataset.meaning;
  const leftId    = parseInt(leftEl.dataset.id);

  if (isCorrect) {
    const color = MATCH_PAIR_COLORS[leftId % MATCH_PAIR_COLORS.length];
    leftEl.style.setProperty('--bg', color);
    rightEl.style.setProperty('--bg', color);
    leftEl.style.color  = 'white';
    rightEl.style.color = 'white';
    leftEl.classList.add('matched', 'snap-left');
    rightEl.classList.add('matched', 'snap-right');
    matchedCount++;
    if (hadWrongAttempt.has(leftId)) matchWrong++; else matchCorrect++;
    document.getElementById('match-score-correct').textContent = `✓ ${matchedCount}`;

    const sentence = matchPairs[leftId]?.sentence;
    if (sentence) showMatchSentence(sentence);

    if (typeof confetti === 'function') {
      confetti({ particleCount: 40, spread: 50, origin: { y: 0.6 }, colors: [color, '#fff'] });
    }
    updateMatchProgress();
    if (matchedCount === matchPairs.length) {
      correctCount = matchCorrect;
      wrongCount   = matchWrong;
      questions    = new Array(matchPairs.length);
      setTimeout(showResults, 900);
    }
  } else {
    hadWrongAttempt.add(leftId);
    matchWrong++;
    document.getElementById('match-score-wrong').textContent = `✗ ${matchWrong}`;
    leftEl.classList.add('wrong-flash');
    rightEl.classList.add('wrong-flash');
    setTimeout(() => {
      leftEl.classList.remove('wrong-flash');
      rightEl.classList.remove('wrong-flash');
    }, 650);
  }
}

function showMatchSentence(sentence) {
  const box  = document.getElementById('match-sentence');
  const text = document.getElementById('match-sentence-text');
  text.textContent = sentence;
  box.classList.remove('d-none', 'match-sentence-out');
  clearTimeout(_sentenceTimer);
  _sentenceTimer = setTimeout(() => {
    box.classList.add('match-sentence-out');
    setTimeout(() => box.classList.add('d-none'), 450);
  }, 3500);
}

function updateMatchProgress() {
  document.getElementById('match-counter').textContent = `${matchedCount} / ${matchPairs.length} matched`;
  const pct = matchPairs.length ? (matchedCount / matchPairs.length) * 100 : 0;
  document.getElementById('match-progress').style.width = `${pct}%`;
}

// ── Flashcard game (Find the German word) ─────────────────────
let fcQuestions = [], fcCurrent = 0, fcCorrect = 0, fcWrong = 0, fcIsFlipped = false;

function startFlashcardGame(qs) {
  fcQuestions = qs;
  fcCurrent = 0; fcCorrect = 0; fcWrong = 0;
  correctCount = 0; wrongCount = 0;

  document.getElementById('fc-score-correct').textContent = '✓ 0';
  document.getElementById('fc-score-wrong').textContent   = '✗ 0';

  document.getElementById('fc-btn-correct').onclick = () => fcAnswer(true);
  document.getElementById('fc-btn-wrong').onclick   = () => fcAnswer(false);
  document.getElementById('fc-scene').onclick = flipFcCard;

  showScreen('flashcard-screen');
  renderFlashcard();
}

function renderFlashcard() {
  const q = fcQuestions[fcCurrent];
  if (!q) { questions = fcQuestions; showResults(); return; }

  fcIsFlipped = false;
  document.getElementById('fc-card').classList.remove('is-flipped');
  document.getElementById('fc-buttons').classList.add('d-none');

  document.getElementById('fc-counter').textContent =
    `Card ${fcCurrent + 1} / ${fcQuestions.length}`;
  document.getElementById('fc-progress').style.width =
    `${(fcCurrent / fcQuestions.length) * 100}%`;

  const badge = document.getElementById('fc-type-badge');
  const type  = q.word_type || '';
  badge.textContent       = TYPE_LABELS[type] || '';
  badge.style.background  = TYPE_COLORS[type] || '#6b7280';
  badge.style.display     = (TYPE_LABELS[type] && type) ? 'inline-block' : 'none';

  document.getElementById('fc-meaning').textContent  = q.question;
  document.getElementById('fc-sentence').textContent = q.sentence || '';
  document.getElementById('fc-german').textContent   = q.display_correct || q.correct;
}

function flipFcCard() {
  fcIsFlipped = !fcIsFlipped;
  document.getElementById('fc-card').classList.toggle('is-flipped', fcIsFlipped);
  document.getElementById('fc-buttons').classList.toggle('d-none', !fcIsFlipped);
}

function fcAnswer(gotRight) {
  if (gotRight) { fcCorrect++; correctCount++; } else { fcWrong++; wrongCount++; }
  document.getElementById('fc-score-correct').textContent = `✓ ${fcCorrect}`;
  document.getElementById('fc-score-wrong').textContent   = `✗ ${fcWrong}`;
  fcCurrent++;
  setTimeout(renderFlashcard, 180);
}

// ── Helpers ───────────────────────────────────────────────────
function showScreen(id) {
  ['setup-screen', 'quiz-screen', 'matching-screen', 'flashcard-screen', 'results-screen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('d-none', s !== id);
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
