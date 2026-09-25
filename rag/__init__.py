"""Local, source-grounded book structure and retrieval. No network or generated facts."""
import hashlib
import json
import re
import sqlite3
from pathlib import Path

FRONT = re.compile(r'^(?:about|author|biograph|preface|foreword|introduction|copyright|dedication|contents|acknowledg|prólogo|prologo|prefacio|introducción|introduccion|sobre|biograf|créditos|creditos|índice|indice|dedicatoria)', re.I)
BACK = re.compile(r'^(?:notes|notas|appendix|appendices|apéndice|bibliograf|bibliograph|glossary|glosario|epilogue|epílogo)', re.I)
CHAPTER = re.compile(r'^(?:(?:chapter|capítulo|capitulo)\s+(?:\d+|[ivxlcdm]+|one|uno|primero)\b|[IVXLCDM]+[.]?$)', re.I)


def analyze(book):
    sections = []
    explicit = [i for i,c in enumerate(book['chapters']) if CHAPTER.match(c['title']) and c.get('evidence') != 'spine']
    first = explicit[0] if explicit else next((i for i,c in enumerate(book['chapters']) if not FRONT.match(c['title']) and not BACK.match(c['title'])), 0)
    for index, chapter in enumerate(book['chapters']):
        title = chapter['title']
        kind = 'front_matter' if index < first else 'back_matter' if BACK.match(title) or FRONT.match(title) else 'chapter'
        evidence = chapter.get('evidence', 'legacy-spine')
        sections.append({'index': index, 'title': title, 'kind': kind,
                         'source': chapter.get('source', ''), 'evidence': evidence,
                         'review': evidence in ('spine', 'legacy-spine', 'page-fallback', 'heading'),
                         'sentences': len(chapter['sentences'])})
    return {'version': 1, 'method': 'local-source-retrieval', 'start_chapter': first,
            'sections': sections, 'needs_review': any(s['review'] for s in sections),
            'warnings': ['Review inferred boundaries. OCR and unconventional layouts can need corrections.']}


def index_book(folder: Path, book):
    """Transactionally refresh a per-project FTS5 index only when content changes."""
    folder.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha256(json.dumps(book, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    with sqlite3.connect(folder / 'book.sqlite', timeout=30) as db:
        db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)')
        db.execute('CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(text, title, chapter UNINDEXED, sentence UNINDEXED, source UNINDEXED, tokenize="unicode61 remove_diacritics 2")')
        if db.execute("SELECT value FROM metadata WHERE key='fingerprint'").fetchone() == (fingerprint,): return
        db.execute('DELETE FROM passages')
        db.executemany('INSERT INTO passages VALUES (?,?,?,?,?)',
                       ((text,c['title'],ci,si,c.get('source','')) for ci,c in enumerate(book['chapters']) for si,text in enumerate(c['sentences'])))
        db.execute("INSERT OR REPLACE INTO metadata VALUES ('fingerprint',?)", (fingerprint,))


def search(folder: Path, book, query):
    index_book(folder, book)
    terms = re.findall(r'\w+', query, re.UNICODE)[:24]
    if not terms: return []
    expression = ' OR '.join('"'+term+'"' for term in terms)
    with sqlite3.connect(folder / 'book.sqlite') as db:
        rows = db.execute('SELECT text,title,chapter,sentence,source FROM passages WHERE passages MATCH ? ORDER BY bm25(passages) LIMIT 8', (expression,)).fetchall()
    return [dict(zip(('text','title','chapter','sentence','source'),row)) for row in rows]
