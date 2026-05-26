import io
import re
from pathlib import Path

import pandas as pd


def parse_uploaded_file(content: bytes, filename: str) -> list:
    ext = Path(filename).suffix.lower()
    if ext == '.txt':
        return parse_txt(content.decode('utf-8', errors='replace'))
    elif ext == '.csv':
        return parse_csv(content)
    elif ext in ('.xlsx', '.xls'):
        return parse_excel(content)
    else:
        return parse_txt(content.decode('utf-8', errors='replace'))


def parse_txt(text: str) -> list:
    """Parse lines like: 'German word (type_hint) - English meaning'"""
    words = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        type_match = re.search(r'\(([^)]+)\)', line)
        type_hint = type_match.group(1).strip() if type_match else ''

        clean = re.sub(r'\([^)]*\)', '', line).strip()

        if ' - ' in clean:
            parts = clean.split(' - ', 1)
        elif '-' in clean:
            parts = clean.split('-', 1)
        else:
            continue

        german_word = parts[0].strip()
        meaning = parts[1].strip()
        if german_word and meaning:
            words.append({
                'german_word': german_word,
                'meaning': meaning,
                'type_hint': type_hint,
            })
    return words


def parse_csv(content: bytes) -> list:
    df = pd.read_csv(io.BytesIO(content), dtype=str).fillna('')
    return _extract_columns(df)


def parse_excel(content: bytes) -> list:
    df = pd.read_excel(io.BytesIO(content), dtype=str).fillna('')
    return _extract_columns(df)


def _extract_columns(df: pd.DataFrame) -> list:
    df.columns = [str(c).lower().strip() for c in df.columns]

    german_col = _find_col(df, ['german_word', 'german', 'deutsch', 'word', 'wort', 'question'])
    if german_col is None and len(df.columns) >= 1:
        german_col = df.columns[0]

    meaning_col = _find_col(df, ['meaning', 'english', 'translation', 'answer', 'bedeutung'])
    if meaning_col is None and len(df.columns) >= 2:
        meaning_col = df.columns[1]

    if german_col is None:
        raise ValueError("Could not identify German word column in file.")

    words = []
    for _, row in df.iterrows():
        german_word = str(row[german_col]).strip()
        if not german_word or german_word.lower() == 'nan':
            continue
        entry = {
            'german_word': german_word,
            'meaning': str(row[meaning_col]).strip() if meaning_col else '',
            'type_hint': '',
        }
        for field in ['word_type', 'artikel', 'sentence']:
            if field in df.columns:
                entry[field] = str(row[field]).strip()
        words.append(entry)
    return words


def _find_col(df: pd.DataFrame, candidates: list):
    for name in candidates:
        if name in df.columns:
            return name
    return None
