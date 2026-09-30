"""Incremental, transactional FTS5 retrieval with bounded lexical fallbacks."""
from contextlib import closing
import hashlib
import json
import sqlite3
import time
from difflib import get_close_matches
from pathlib import Path
from filelock import FileLock
from .query import parse,tokens,stem,expression
from .structure import analyze

SCHEMA=4


def fingerprint(book):
    relevant={'language':book.get('language','en'),'chapters':book['chapters'],'schema':SCHEMA}
    return hashlib.sha256(json.dumps(relevant,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def connect(path):
    db=sqlite3.connect(path,timeout=10);db.row_factory=sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=NORMAL')
    db.execute('PRAGMA busy_timeout=10000');db.execute('PRAGMA cache_size=-8192')
    return db


def schema(db):
    db.execute('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT)')
    version=db.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
    if version and version[0]==str(SCHEMA):return
    # A migration is one SQLite transaction. An interrupted transaction rolls back;
    # the next invocation retries from the stored text instead of partial tables.
    for name in ('passages','vocabulary','terms','documents'):
        db.execute('DROP TABLE IF EXISTS '+name)
    db.execute('CREATE TABLE documents(id INTEGER PRIMARY KEY, stable_id TEXT UNIQUE, chapter INTEGER, sentence INTEGER, source TEXT, title TEXT, text TEXT, kind TEXT, hash TEXT)')
    db.execute('CREATE INDEX scope ON documents(chapter,kind)')
    db.execute('CREATE VIRTUAL TABLE passages USING fts5(surface,title,stems,tokenize="unicode61 remove_diacritics 0")')
    db.execute('CREATE VIRTUAL TABLE vocabulary USING fts5vocab(passages,"row")')
    db.execute('CREATE TABLE terms(term TEXT PRIMARY KEY)')
    db.execute("INSERT OR REPLACE INTO metadata VALUES('schema',?)",(str(SCHEMA),))
    db.execute("DELETE FROM metadata WHERE key='fingerprint'")


def index_book(folder,book):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True);target=fingerprint(book);path=folder/'book.sqlite'
    # Fast unchanged check does not queue behind a writer with an already-current index.
    if path.exists():
        try:
            with closing(sqlite3.connect(f'file:{path}?mode=ro',uri=True,timeout=1)) as db:
                if db.execute("SELECT value FROM metadata WHERE key='fingerprint'").fetchone()==(target,):return
        except sqlite3.DatabaseError:pass
    with FileLock(str(folder/'.index.lock'),timeout=10):
        for attempt in range(2):
            db=None
            try:
                db=connect(path);db.execute('BEGIN IMMEDIATE');schema(db)
                if db.execute("SELECT value FROM metadata WHERE key='fingerprint'").fetchone()==(target,):db.commit();return
                existing={r['stable_id']:(r['id'],r['hash']) for r in db.execute('SELECT id,stable_id,hash FROM documents')}
                retained=set();vocabulary=set();language=book.get('language','en');kinds=analyze(book)['sections'];changed=0
                for ci,c in enumerate(book['chapters']):
                    title=' '.join(tokens(c['title']))
                    for si,text in enumerate(c['sentences']):
                        identity=f'{ci:04d}-{si:05d}';retained.add(identity)
                        source=(c.get('sentence_anchors') or [c.get('source','')]*len(c['sentences']))[si];kind=kinds[ci]['kind']
                        hashed=hashlib.sha256(json.dumps([text,c['title'],source,kind,language],ensure_ascii=False).encode()).hexdigest()
                        surface=tokens(text);vocabulary.update(surface);vocabulary.update(tokens(c['title']))
                        old=existing.get(identity)
                        if old and old[1]==hashed:continue
                        if old:
                            rowid=old[0];db.execute('DELETE FROM passages WHERE rowid=?',(rowid,))
                            db.execute('UPDATE documents SET source=?,title=?,text=?,kind=?,hash=? WHERE id=?',(source,c['title'],text,kind,hashed,rowid))
                        else:
                            rowid=db.execute('INSERT INTO documents(stable_id,chapter,sentence,source,title,text,kind,hash) VALUES(?,?,?,?,?,?,?,?)',(identity,ci,si,source,c['title'],text,kind,hashed)).lastrowid
                        db.execute('INSERT INTO passages(rowid,surface,title,stems) VALUES(?,?,?,?)',(rowid,' '.join(surface),title,' '.join(stem(t,language) for t in surface+tokens(c['title']))));changed+=1
                for identity,(rowid,_) in existing.items():
                    if identity not in retained:db.execute('DELETE FROM passages WHERE rowid=?',(rowid,));db.execute('DELETE FROM documents WHERE id=?',(rowid,));changed+=1
                db.execute('DELETE FROM terms');db.executemany('INSERT INTO terms VALUES(?)',((t,) for t in sorted(vocabulary)))
                db.executemany('INSERT OR REPLACE INTO metadata VALUES(?,?)',[('fingerprint',target),('updated',str(time.time())),('changed_rows',str(changed))])
                db.commit();return
            except sqlite3.DatabaseError as exc:
                if db:db.rollback();db.close();db=None
                if attempt or not any(x in str(exc).lower() for x in ('malformed','not a database','no such table','fts5')):raise
                # A disposable corrupt index is reconstructed from stored book text.
                for suffix in ('','-wal','-shm'):Path(str(path)+suffix).unlink(missing_ok=True)
            finally:
                if db:db.close()


def status(folder,book=None):
    path=Path(folder)/'book.sqlite'
    if not path.exists():return {'state':'missing','schema':SCHEMA}
    try:
        with closing(sqlite3.connect(f'file:{path}?mode=ro',uri=True)) as db:
            data=dict(db.execute('SELECT key,value FROM metadata'))
            return {'state':'stale' if book and data.get('fingerprint')!=fingerprint(book) else 'ready','schema':int(data.get('schema',0)),
                    'fingerprint':data.get('fingerprint'),'changed_rows':int(data.get('changed_rows',0)),'bytes':sum(p.stat().st_size for p in path.parent.glob('book.sqlite*'))}
    except sqlite3.DatabaseError:return {'state':'corrupt','schema':SCHEMA}


def search(folder,book,query,chapter=None,kind=None,match_type=None,limit=8,mode='lexical'):
    if mode not in ('lexical','hybrid'):raise ValueError('Choose lexical or hybrid search.')
    if chapter is not None and not 0<=chapter<len(book['chapters']):raise ValueError('Chapter is out of range.')
    if kind is not None and kind not in ('chapter','front_matter','back_matter','unclassified'):raise ValueError('Unknown section kind.')
    if not 1<=limit<=50:raise ValueError('Search limit must be between 1 and 50.')
    q=parse(query)
    if not q.terms:return []
    index_book(folder,book)
    language=book.get('language','en');candidates={};where='';args=[]
    if chapter is not None:where+=' AND d.chapter=?';args.append(chapter)
    if kind is not None:where+=' AND d.kind=?';args.append(kind)
    deadline=time.monotonic()+.25
    with closing(connect(Path(folder)/'book.sqlite')) as db:
        db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
        def fetch(expression_value,match,tier,corrections=None):
            if not expression_value:return
            try:
                rows=db.execute('SELECT d.*,bm25(passages,1.0,1.6,0.5) AS bm FROM passages JOIN documents d ON d.id=passages.rowid WHERE passages MATCH ?'+where+' ORDER BY bm LIMIT 160',(expression_value,*args)).fetchall()
            except sqlite3.OperationalError as exc:
                if 'interrupted' in str(exc):return
                raise
            for row in rows:
                identity=row['stable_id']
                if identity in candidates:continue
                surface=set(tokens(row['text']+' '+row['title']));stemmed={stem(t,language) for t in surface}
                matched=[t for t in q.terms if t in surface or ((match=='stem' or match=='partial' and tier==19) and stem(t,language) in stemmed) or (t in q.prefixes and any(s.startswith(t) for s in surface)) or (corrections and corrections.get(t) in surface)]
                coverage=len(matched)/len(q.terms)
                phrase_boost=sum(' '.join(p) in ' '.join(tokens(row['text'])) for p in q.phrases)*.2
                score=tier+coverage+phrase_boost+min(1,abs(row['bm']))*.1
                candidates[identity]=(score,dict(row),match,matched,{'tier':tier,'coverage':coverage,'phrase_boost':phrase_boost,'bm25':row['bm']},corrections or {})
        fetch(expression(q,language),'phrase' if q.phrases or q.near else 'exact',40)
        fetch(expression(q,language,True),'stem',30)
        # Preserve labelled partial evidence; explicit operators remain constraints.
        fetch(expression(q,language,joiner=' OR '),'partial',20)
        fetch(expression(q,language,True,joiner=' OR '),'partial',19)
        if not candidates and not q.phrases and not q.near and not q.required and not q.excluded and not q.prefixes:
            # Candidate vocabulary bounded by first letter/length, never an all-vocab
            # quadratic comparison. Typo support does not invent synonyms.
            corrections={}
            for term in q.terms:
                if len(term)<4:continue
                choices=[r[0] for r in db.execute('SELECT term FROM terms WHERE (term LIKE ? OR term LIKE ?) AND length(term) BETWEEN ? AND ? LIMIT 2500',(term[0]+'%','%'+term[-1],len(term)-2,len(term)+2))]
                close=get_close_matches(term,choices,n=1,cutoff=.78)
                if close:corrections[term]=close[0]
            if corrections:
                from dataclasses import replace
                fuzzy=replace(q,terms=[corrections.get(t,t) for t in q.terms])
                fetch(expression(fuzzy,language),'fuzzy',10,corrections)
    results=[];covered=set();chapter_counts={}
    ordered=sorted(candidates.values(),key=lambda item:(-item[0],item[1]['chapter'],item[1]['sentence']))
    # A small deterministic diversity penalty only breaks close lexical scores.
    while ordered and len(results)<limit:
        best=max(range(len(ordered)),key=lambda i:ordered[i][0]-.08*chapter_counts.get(ordered[i][1]['chapter'],0))
        score,row,match,matched,components,corrections=ordered.pop(best);ci,si=row['chapter'],row['sentence']
        if match_type and match_type!=match:continue
        if (ci,si) in covered:continue
        sentences=book['chapters'][ci]['sentences'];start,end=max(0,si-1),min(len(sentences),si+2)
        results.append({'text':row['text'],'title':row['title'],'chapter':ci,'sentence':si,'source':row['source'],'kind':row['kind'],
                        'citation':row['stable_id'],'source_anchor':row['source'],
                        'context':' '.join(sentences[start:end]),'context_start':start,'context_end':end-1,
                        'matched_terms':matched,'match':'all_terms' if match in ('exact','phrase','stem') else match,'match_type':match,
                        'coverage':components['coverage'],'score':score,'explanation':{'components':components,'corrections':corrections,'terms':matched},'mode':'lexical'})
        covered.update((ci,s) for s in range(start,end));chapter_counts[ci]=chapter_counts.get(ci,0)+1
    if mode=='hybrid':
        # Semantic similarity cannot enforce lexical operators. Preserve their
        # exact constraints instead of broadening an explicitly constrained query.
        if q.phrases or q.near or q.required or q.excluded or q.prefixes:
            return [dict(hit,semantic_status='lexical-constraints') for hit in results]
        from .semantic import hybrid
        hits=hybrid(folder,book,query,results,chapter=chapter,kind=kind,limit=limit)
        return [hit for hit in hits if not match_type or hit['match_type']==match_type]
    return results
