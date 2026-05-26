import json
import re
from pathlib import Path

COLUMNS = ['german_word', 'meaning', 'word_type', 'artikel', 'sentence']


class VocabularyStore:
    def __init__(self, vocab_dir: Path, app_dir: Path):
        self.vocab_dir = Path(vocab_dir)
        self.app_dir   = Path(app_dir)
        self.vocab_dir.mkdir(exist_ok=True)

    # ── Set discovery ─────────────────────────────────────────
    # Scans both vocabulary/ and the app root; vocabulary/ takes priority
    # for duplicate names (it holds the most up-to-date enriched copy).

    def _all_json_files(self) -> dict:
        """Return {stem: Path} for every valid vocabulary json found."""
        found = {}
        # App root first (lower priority)
        for f in sorted(self.app_dir.glob('*.json')):
            data = self._load(f)
            if data and isinstance(data, list) and data[0].get('german_word'):
                found[f.stem] = f
        # vocabulary/ folder overwrites app-root entries
        for f in sorted(self.vocab_dir.glob('*.json')):
            found[f.stem] = f
        return found

    def _find_file(self, set_name: str) -> Path | None:
        """Locate a set's json: vocabulary/ first, then app root."""
        p = self._path(set_name)
        if p.exists():
            return p
        p2 = self.app_dir / f'{self._safe(set_name)}.json'
        return p2 if p2.exists() else None

    # ── User sets ─────────────────────────────────────────────

    def list_sets(self) -> list:
        sets = []
        for name, f in sorted(self._all_json_files().items()):
            words   = self._load(f)
            missing = sum(1 for w in words if not w.get('sentence'))
            sets.append({'name': name, 'count': len(words), 'missing_sentences': missing})
        return sets

    def get_words(self, set_name: str = None) -> list:
        if set_name:
            f     = self._find_file(set_name)
            words = self._load(f) if f else []
            for i, w in enumerate(words):
                w['id']       = i
                w['set_name'] = set_name
            return words
        all_records, idx = [], 0
        for name, f in sorted(self._all_json_files().items()):
            for w in self._load(f):
                w['id']       = idx
                w['set_name'] = name
                all_records.append(w)
                idx += 1
        return all_records

    def save_set(self, set_name: str, words: list) -> int:
        """Always saves to vocabulary/ (creates enriched copy there)."""
        path = self._path(set_name)
        # Seed from existing file wherever it lives
        src = self._find_file(set_name)
        existing = {w['german_word']: w for w in self._load(src)} if src else {}
        for w in words:
            existing[w['german_word']] = {col: str(w.get(col, '') or '') for col in COLUMNS}
        self._save(path, list(existing.values()))
        return len(words)

    def update_sentences(self, set_name: str, updates: list) -> int:
        src = self._find_file(set_name)
        if not src:
            return 0
        words      = self._load(src)
        update_map = {w['german_word']: w for w in updates}
        changed    = 0
        for w in words:
            if w['german_word'] in update_map:
                u = update_map[w['german_word']]
                for col in ['word_type', 'artikel', 'sentence']:
                    if u.get(col):
                        w[col] = u[col]
                changed += 1
        # Always write the enriched file to vocabulary/
        self._save(self._path(set_name), words)
        return changed

    def delete_set(self, set_name: str):
        for p in [self._path(set_name), self.app_dir / f'{self._safe(set_name)}.json']:
            if p.exists():
                p.unlink()

    def delete_word(self, set_name: str, word_id: int):
        src = self._find_file(set_name)
        if not src:
            return
        words = self._load(src)
        if word_id < len(words):
            words.pop(word_id)
            self._save(self._path(set_name), words)

    def word_count(self, set_name: str = None) -> int:
        if set_name:
            f = self._find_file(set_name)
            return len(self._load(f)) if f else 0
        return sum(len(self._load(f)) for f in self._all_json_files().values())

    def has_words(self, set_name: str = None) -> bool:
        return self.word_count(set_name) > 0

    def missing_sentences_count(self, set_name: str = None) -> int:
        return sum(1 for w in self.get_words(set_name) if not w.get('sentence'))

    # ── Helpers ───────────────────────────────────────────────

    def _path(self, set_name: str) -> Path:
        return self.vocab_dir / f'{self._safe(set_name)}.json'

    def _load(self, path: Path) -> list:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if not isinstance(data, list):
                return []
            return [{col: str(row.get(col, '') or '') for col in COLUMNS} for row in data]
        except Exception:
            return []

    def _save(self, path: Path, words: list):
        rows = [{col: w.get(col, '') for col in COLUMNS} for w in words]
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)

    def _load_xlsx(self, path: Path) -> list:
        import pandas as pd
        try:
            df = pd.read_excel(path, dtype=str).fillna('')
            df.columns = [c.lower().strip() for c in df.columns]
            for col in COLUMNS:
                if col not in df.columns:
                    df[col] = ''
            return df[COLUMNS].to_dict('records')
        except Exception:
            return []

    def load_starter_pack(self, name: str) -> int:
        src_json = self.app_dir / f'{name}.json'
        src_xlsx = self.app_dir / f'{name}.xlsx'
        if src_json.exists():
            words = self._load(src_json)
        elif src_xlsx.exists():
            words = self._load_xlsx(src_xlsx)
        else:
            raise FileNotFoundError(f"'{name}' not found in the app folder.")
        dest = self._path(name)
        existing = {w['german_word']: w for w in self._load(dest)} if dest.exists() else {}
        for w in words:
            existing[w['german_word']] = {col: str(w.get(col, '') or '') for col in COLUMNS}
        self._save(dest, list(existing.values()))
        return len(words)

    @staticmethod
    def _safe(name: str) -> str:
        return re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name).strip()[:100]
