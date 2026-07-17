const TYPE_LABELS = {
  noun:                  'Noun',
  verb:                  'Verb',
  adjective:             'Adjective',
  adverb:                'Adverb',
  phrase:                'Phrase',
  nomen_verb_verbindung: 'NVV',
  conjunction:           'Conjunction',
  verb_mit_präposition:  'Verb + Prep.',
  nomen_mit_präposition: 'Noun + Prep.',
  adj_mit_präposition:   'Adj + Prep.',
  unknown:               '',
};

const TYPE_COLORS = {
  noun:                  '#2563eb',
  verb:                  '#dc2626',
  adjective:             '#16a34a',
  adverb:                '#7c3aed',
  phrase:                '#6b7280',
  nomen_verb_verbindung: '#b45309',
  conjunction:           '#0891b2',
  verb_mit_präposition:  '#b91c1c',
  nomen_mit_präposition: '#1d4ed8',
  adj_mit_präposition:   '#15803d',
  unknown:               '#6b7280',
};

const TYPE_GROUPS = {
  noun:      ['noun', 'nomen_mit_präposition'],
  verb:      ['verb', 'verb_mit_präposition', 'nomen_verb_verbindung'],
  adjective: ['adjective', 'adj_mit_präposition'],
  other:     ['adverb', 'phrase', 'conjunction', 'unknown'],
};

let allWords = [];
let queue    = [];
let history  = [];
let isFlipped = false;
let activeFilter = 'all';
let _transitioning = false;

const SET_NAME    = document.getElementById('set-config')?.dataset.set || null;
const REVISE_MODE = new URLSearchParams(location.search).get('mode') === 'revise';

// ── Bookmarks (server-backed, in-memory cache for instant UI) ─
let _bmCache = [];

function _bmKey(word) {
  return `${word.set_name || SET_NAME || 'all'}::${word.german_word}`;
}

function _isBookmarked(word) {
  return _bmCache.some(b => b._key === _bmKey(word));
}

async function _loadBmCache() {
  // One-time migration: push any existing localStorage bookmarks to the server
  const OLD_KEY = 'ff_bookmarks';
  const local = JSON.parse(localStorage.getItem(OLD_KEY) || '[]');
  if (local.length) {
    await Promise.all(local.map(b => fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })));
    localStorage.removeItem(OLD_KEY);
  }
  try {
    _bmCache = await (await fetch('/api/bookmarks')).json();
  } catch { _bmCache = []; }
  _updateBmBtn();
  _updateNavBmBadge();
}

function toggleBookmark() {
  if (!queue.length) return;
  const word = queue[0];
  const key  = _bmKey(word);
  const idx  = _bmCache.findIndex(b => b._key === key);
  if (idx >= 0) {
    _bmCache.splice(idx, 1);
    fetch(`/api/bookmarks?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  } else {
    const entry = { ...word, set_name: word.set_name || SET_NAME || 'all', _key: key };
    _bmCache.push(entry);
    fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  }
  _updateBmBtn();
  _updateNavBmBadge();
}

function _updateBmBtn() {
  const btn = document.getElementById('bookmark-btn');
  if (!btn) return;
  const bookmarked = queue.length && _isBookmarked(queue[0]);
  btn.innerHTML = bookmarked
    ? '<i class="bi bi-bookmark-fill"></i>'
    : '<i class="bi bi-bookmark"></i>';
  btn.classList.toggle('btn-warning',           !!bookmarked);
  btn.classList.toggle('btn-outline-secondary', !bookmarked);
  btn.title = bookmarked ? 'Remove bookmark' : 'Bookmark this word';
}

function _updateNavBmBadge() {
  const badge = document.getElementById('bm-count-badge');
  if (!badge) return;
  const n = _bmCache.length;
  badge.textContent  = n || '';
  badge.style.display = n ? 'inline-flex' : 'none';
}

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
  } else if (filter === 'bookmarked') {
    const keys = new Set(_bmCache.map(b => b._key));
    filtered   = allWords.filter(w => keys.has(_bmKey(w)));
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
  wrapper.classList.remove('card-pop-in'); // reset any previous pop
  wrapper.classList.add('card-exit');

  setTimeout(() => {
    _renderCard();
    wrapper.classList.remove('card-exit');
    // Force reflow so the animation restart is picked up
    void wrapper.offsetWidth;
    wrapper.classList.add('card-pop-in');
    _transitioning = false;
  }, 210);
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
    document.getElementById('front-artikel').textContent  = '';
    document.getElementById('front-word').textContent     = '🎉 All done!';
    document.getElementById('back-meaning').textContent   = '';
    document.getElementById('back-artikel').textContent   = '';
    document.getElementById('back-german').textContent    = '';
    document.getElementById('back-sentence').innerHTML    = '';
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

  if (REVISE_MODE) {
    // Front: English meaning, no artikel
    document.getElementById('front-artikel').textContent = '';
    document.getElementById('front-word').textContent    = w.meaning;
    document.getElementById('flip-hint').textContent     = 'Click to reveal German word';

    // Back: artikel + German word (swap back-meaning out)
    document.getElementById('back-meaning').classList.add('d-none');
    document.getElementById('back-artikel').textContent = w.artikel || '';
    document.getElementById('back-artikel').classList.toggle('d-none', !w.artikel);
    document.getElementById('back-german').textContent  = w.german_word;
    document.getElementById('back-german').classList.remove('d-none');
  } else {
    // Normal mode: front is German word
    document.getElementById('front-artikel').textContent = w.artikel || '';
    document.getElementById('front-word').textContent    = w.german_word;
    document.getElementById('flip-hint').textContent     = 'Click to reveal meaning';

    document.getElementById('back-meaning').textContent = w.meaning;
    document.getElementById('back-meaning').classList.remove('d-none');
    document.getElementById('back-artikel').classList.add('d-none');
    document.getElementById('back-german').classList.add('d-none');
  }

  const sentenceEl = document.getElementById('back-sentence');
  if (w.sentence) {
    const [ger, eng] = w.sentence.split('|').map(s => s.trim());
    let html = `<span class="sentence-de">${escHtml(ger)}</span>`;
    if (eng) html += `<span class="sentence-en">${escHtml(eng)}</span>`;
    sentenceEl.innerHTML = html;
  } else {
    sentenceEl.innerHTML = '';
  }

  _updateBmBtn();
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
document.getElementById('flashcard-wrapper')?.addEventListener('click', e => {
  if (window.getSelection()?.toString()) return; // don't flip if user is selecting text
  if (e.target.closest('.card-sentence')) return; // don't flip on sentence click
  flipCard();
});
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
  else if (e.key === 'b' || e.key === 'B') toggleBookmark();
});

loadWords();
_loadBmCache();
