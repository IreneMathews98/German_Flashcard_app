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

const TYPE_GROUPS = {
  noun:      ['noun', 'nomen_mit_präposition'],
  verb:      ['verb', 'reflexive_verb', 'verb_mit_präposition', 'nomen_verb_verbindung'],
  adjective: ['adjective', 'adjektiv_mit_präposition'],
  other:     ['adverb', 'preposition', 'common_phrase', 'unknown'],
};

let allWords = [];
let queue    = [];
let history  = [];
let isFlipped = false;
let activeFilter = 'all';
let _transitioning = false;

const SET_NAME = document.getElementById('set-config')?.dataset.set || null;

// ── Load ──────────────────────────────────────────────────────
async function loadWords() {
  try {
    const url = SET_NAME ? `/api/words?set=${encodeURIComponent(SET_NAME)}` : '/api/words';
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    allWords = await res.json();
    if (!allWords.length) {
      document.getElementById('front-word').textContent = 'No words found';
      return;
    }
    applyFilter(activeFilter);
  } catch (err) {
    document.getElementById('front-word').textContent = `Load error: ${err.message}`;
  }
}

// ── Filter ────────────────────────────────────────────────────
function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.type-filter').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.type === filter)
  );

  let filtered;
  if (filter === 'all') {
    filtered = [...allWords];
  } else if (TYPE_GROUPS[filter]) {
    filtered = allWords.filter(w => TYPE_GROUPS[filter].includes(w.word_type));
  } else {
    filtered = [...allWords];
  }

  if (!filtered.length) {
    document.getElementById('front-word').textContent = 'No cards in this filter';
    document.getElementById('card-counter').textContent = '0 / 0';
    return;
  }

  queue   = _shuffle([...filtered]);
  history = [];
  _renderCard(); // no animation on initial load
}

// ── Transition helper ─────────────────────────────────────────
function showCurrent() {
  if (_transitioning) return;
  const wrapper = document.getElementById('flashcard-wrapper');
  if (!wrapper) { _renderCard(); return; }

  _transitioning = true;
  wrapper.classList.add('card-exit');

  setTimeout(() => {
    _renderCard();
    wrapper.classList.remove('card-exit');
    _transitioning = false;
  }, 230);
}

// ── Render current card ───────────────────────────────────────
function _renderCard() {
  const cardEl = document.getElementById('flashcard');
  cardEl.classList.remove('flipped');
  isFlipped = false;

  updateCounter();

  if (!queue.length) {
    const badge = document.getElementById('front-type-badge');
    badge.style.display = 'none';
    document.getElementById('front-artikel').textContent = '';
    document.getElementById('front-word').textContent    = '🎉 All done!';
    document.getElementById('back-meaning').textContent  = '';
    document.getElementById('back-sentence').textContent = '';
    return;
  }

  const w     = queue[0];
  const type  = w.word_type || 'unknown';
  const label = TYPE_LABELS[type] || '';
  const color = TYPE_COLORS[type] || '#6b7280';

  const badge = document.getElementById('front-type-badge');
  badge.textContent      = label;
  badge.style.background = color;
  badge.style.display    = label ? 'inline-block' : 'none';

  document.getElementById('front-artikel').textContent = w.artikel || '';
  document.getElementById('front-word').textContent    = w.german_word;
  document.getElementById('back-meaning').textContent  = w.meaning;

  const sentenceEl = document.getElementById('back-sentence');
  if (w.sentence) {
    const [ger, eng] = w.sentence.split('|').map(s => s.trim());
    let html = `<span class="sentence-de">${escHtml(ger)}</span>`;
    if (eng) html += `<span class="sentence-en">${escHtml(eng)}</span>`;
    sentenceEl.innerHTML = html;
  } else {
    sentenceEl.innerHTML = '';
  }
}

function updateCounter() {
  const total = history.length + queue.length;
  const done  = history.length;
  document.getElementById('card-counter').textContent   = `${done} / ${total}`;
  document.getElementById('card-progress').style.width  = total ? `${(done / total) * 100}%` : '0%';
}

// ── Flip ──────────────────────────────────────────────────────
function flipCard() {
  if (!queue.length) return;
  document.getElementById('flashcard').classList.toggle('flipped');
  isFlipped = !isFlipped;
}

// ── Easy / Hard / Previous ────────────────────────────────────
function onEasy() {
  if (!queue.length || _transitioning) return;
  history.push(queue.shift());
  showCurrent();
}

function onHard() {
  if (!queue.length || _transitioning) return;
  const word = queue.shift();
  history.push(word);
  const pos = Math.min(Math.floor(Math.random() * 5) + 4, queue.length);
  queue.splice(pos, 0, { ...word });
  showCurrent();
}

function onPrevious() {
  if (!history.length || _transitioning) return;
  queue.unshift(history.pop());
  showCurrent();
}

function shuffleSet() {
  if (queue.length < 2) return;
  const rest = queue.slice(1);
  queue = [queue[0], ..._shuffle(rest)];
}

// ── Helpers ───────────────────────────────────────────────────
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Event wiring ──────────────────────────────────────────────
document.getElementById('flashcard-wrapper')?.addEventListener('click', flipCard);
document.getElementById('easy-btn')?.addEventListener('click', onEasy);
document.getElementById('hard-btn')?.addEventListener('click', onHard);
document.getElementById('prev-btn')?.addEventListener('click', onPrevious);
document.getElementById('shuffle-btn')?.addEventListener('click', shuffleSet);

document.querySelectorAll('.type-filter').forEach(btn =>
  btn.addEventListener('click', () => applyFilter(btn.dataset.type))
);

document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if      (e.key === ' ')                   { e.preventDefault(); flipCard(); }
  else if (e.key === 'ArrowLeft')           onPrevious();
  else if (e.key === 'e' || e.key === 'E') onEasy();
  else if (e.key === 'h' || e.key === 'H') onHard();
});

loadWords();
