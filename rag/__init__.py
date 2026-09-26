"""Offline, evidence-backed structure review and contextual book retrieval."""
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

VERSION = 2
FRONT = re.compile(r'^(?:about\b|author\b|biograph|preface\b|foreword\b|introduction\b|copyright\b|dedication\b|contents\b|acknowledg|prologo\b|prefacio\b|introduccion\b|sobre\b|biograf|creditos\b|indice\b|dedicatoria\b)')
BACK = re.compile(r'^(?:notes\b|notas\b|appendix\b|appendices\b|apendice\b|bibliograf|bibliograph|glossary\b|glosario\b|epilogue\b|epilogo\b)')
CHAPTER = re.compile(r'^(?:(?:chapter|capitulo)\s+\S+|[ivxlcdm]+[.]?$)')
FIRST = re.compile(r'^(?:(?:chapter|capitulo)\s+(?:1|i|one|uno|primero)\b|i[.]?$)')
STOP = set('a an the and or of in on at to for from with by is are was were be been this that these those it its as what which who where when why how does do did about el la los las un una unos unas de del al y o en por para con sin es son fue era ser como que quien donde cuando cual cuales sobre se su sus me mi lo le les este esta estos estas'.split())


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD',text.lower()) if not unicodedata.combining(c))


def analyze(book):
    chapters = book['chapters']
    explicit = [i for i,c in enumerate(chapters) if FIRST.match(fold(c['title'])) and c.get('evidence') != 'spine']
    first = explicit[0] if explicit else None
    sections = []
    for index, chapter in enumerate(chapters):
        title, evidence = chapter['title'], chapter.get('evidence', 'legacy-spine')
        normalized = fold(title)
        role = chapter.get('role', '')
        reasons = []
        confidence = 'inferred'
        if role in {'front_matter','back_matter','chapter','unclassified'}:
            kind = role; confidence = 'confirmed' if evidence=='manual' else 'document'
            reasons.append('manual' if evidence=='manual' else 'epub_semantics')
        elif BACK.match(normalized):
            kind = 'back_matter'; reasons.append('section_title')
        elif FRONT.match(normalized):
            kind = 'front_matter' if first is None or index<first else 'back_matter'; reasons.append('section_title')
        elif first is not None and index<first and evidence in {'spine','legacy-spine','page-fallback'}:
            kind = 'front_matter'; reasons.append('before_first_chapter')
        elif evidence in {'table-of-contents','outline','manual'} or (CHAPTER.match(normalized) and evidence=='heading'):
            kind = 'chapter'; confidence = 'document' if evidence!='heading' else 'inferred'; reasons.append('structural_boundary')
        else:
            kind = 'unclassified'; reasons.append('insufficient_structure')
        sections.append({'index':index,'title':title,'kind':kind,'source':chapter.get('source',''),
                         'evidence':evidence,'confidence':confidence,'reasons':reasons,
                         'review':confidence=='inferred' or kind=='unclassified',
                         'sentences':len(chapter['sentences']),
                         'words':sum(len(s.split()) for s in chapter['sentences']),
                         'excerpt':' '.join(chapter['sentences'][:2])[:600]})
    start = next((s['index'] for s in sections if s['kind']=='chapter'), None)
    # Unknown content is never deleted or silently skipped when no narrative is known.
    if start is None: start = next((s['index'] for s in sections if s['kind']=='unclassified'), 0)
    review = sum(s['review'] for s in sections)
    return {'version':VERSION,'method':'local-source-retrieval','start_chapter':start,
            'sections':sections,'needs_review':bool(review),'review_count':review,
            'warnings':['review_inferred_boundaries'] if review else []}


def index_book(folder: Path, book):
    folder.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha256((str(VERSION)+json.dumps(book,sort_keys=True,ensure_ascii=False)).encode()).hexdigest()
    with sqlite3.connect(folder/'book.sqlite',timeout=30) as db:
        db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)')
        db.execute('CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(text, title, chapter UNINDEXED, sentence UNINDEXED, source UNINDEXED, tokenize="unicode61 remove_diacritics 2")')
        if db.execute("SELECT value FROM metadata WHERE key='fingerprint'").fetchone()==(fingerprint,): return
        db.execute('DELETE FROM passages')
        db.executemany('INSERT INTO passages VALUES (?,?,?,?,?)',
                       ((text,c['title'],ci,si,c.get('source','')) for ci,c in enumerate(book['chapters']) for si,text in enumerate(c['sentences'])))
        db.execute("INSERT OR REPLACE INTO metadata VALUES ('fingerprint',?)",(fingerprint,))


def search(folder: Path, book, query, chapter=None):
    terms = list(dict.fromkeys(t for t in re.findall(r'\w+',fold(query)) if t not in STOP))[:24]
    if not terms: return []
    index_book(folder,book)
    quoted = ['"'+term+'"' for term in terms]
    where, args = (' AND chapter = ?', [chapter]) if chapter is not None else ('', [])
    with sqlite3.connect(folder/'book.sqlite') as db:
        def fetch(joiner):
            return db.execute('SELECT text,title,chapter,sentence,source FROM passages WHERE passages MATCH ?'+where+' ORDER BY bm25(passages,1.0,2.0) LIMIT 48',[joiner.join(quoted),*args]).fetchall()
        rows = fetch(' AND ')
        exact = bool(rows)
        if not rows: rows = fetch(' OR ')
    results, covered = [], set()
    for row in rows:
        text,title,ci,si,source = row
        ci,si = int(ci),int(si)
        if (ci,si) in covered: continue
        sentences = book['chapters'][ci]['sentences']
        start,end = max(0,si-1),min(len(sentences),si+2)
        words = set(re.findall(r'\w+',fold(text+' '+title)))
        matched = [t for t in terms if t in words]
        if not matched: continue
        results.append({'text':text,'title':title,'chapter':ci,'sentence':si,'source':source,
                        'citation':f'{ci:04d}-{si:05d}','context':' '.join(sentences[start:end]),
                        'context_start':start,'context_end':end-1,'matched_terms':matched,
                        'match':'all_terms' if exact else 'partial','coverage':len(matched)/len(terms)})
        covered.update((ci,i) for i in range(start,end))
        if len(results)==8: break
    return results
