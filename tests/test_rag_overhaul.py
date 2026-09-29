import copy
import json
import sqlite3
import threading
from pathlib import Path
import pytest
from hypothesis import given,settings,strategies as st
from rag import analyze,index_book,search,status
from rag.query import parse,expression
from rag import features


def book(language='en'):
    return {'title':'Evidence','author':'Fixture','language':language,'chapters':[
        {'title':'Chapter 1','source':'book.xhtml#one','evidence':'heading','sentences':['Mira carried the blue lantern.','The birds were singing beside the river.','A distant mountain was covered in snow.','A warm light shone from the lighthouse.']},
        {'title':'Notes','source':'book.xhtml#notes','evidence':'heading','sentences':['Mira carried the blue lantern.','Bibliography and source notes.']} ]}


def test_query_operators_stems_typos_and_explanations(tmp_path):
    b=book()
    for query,typ in [('"blue lantern"','phrase'),('bird sing river','stem'),('lighthousz','fuzzy'),('lanter*','exact'),('NEAR(blue lantern, 2)','phrase')]:
        hits=search(tmp_path,b,query);assert hits and hits[0]['match_type']==typ,(query,hits)
        assert hits[0]['citation'] and hits[0]['source_anchor'] and hits[0]['explanation']
    assert not search(tmp_path,b,'+lantern -Mira')
    assert not search(tmp_path,b,'"lantern blue"')
    assert search(tmp_path,b,'Mira',kind='back_matter')[0]['chapter']==1
    assert not search(tmp_path,b,'river',chapter=1)
    assert not search(tmp_path,b,'lighthousz',match_type='exact')
    assert not search(tmp_path,b,'the and of')
    with pytest.raises(ValueError):search(tmp_path,b,'x'*501)
    with pytest.raises(ValueError):search(tmp_path,b,'river',limit=10000)


def test_spanish_accents_stemming_and_enye(tmp_path):
    b=book('es');b['chapters'][0]['sentences']=['Los pájaros cantaban junto al río.','El pingüino miraba el océano.','Un año tiene doce meses.']
    assert search(tmp_path,b,'pajaro cantar rio')[0]['sentence']==0
    assert search(tmp_path,b,'pinguino oceano')[0]['sentence']==1
    assert search(tmp_path,b,'año')[0]['sentence']==2
    assert not search(tmp_path,b,'ano')
    assert not search(tmp_path,b,'el la de y')


@settings(max_examples=100,deadline=None)
@given(st.text(alphabet=st.characters(blacklist_categories=('Cs',)),max_size=100))
def test_query_parser_never_injects_sqlite(value):
    q=parse(value)
    with sqlite3.connect(':memory:') as db:
        db.execute('CREATE VIRTUAL TABLE passages USING fts5(surface,title,stems,tokenize="unicode61 remove_diacritics 0")')
        for mode in (False,True):
            compiled=expression(q,'es',mode)
            if compiled:db.execute('SELECT rowid FROM passages WHERE passages MATCH ?',(compiled,)).fetchall()
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE name='passages'").fetchone()[0]==1


def test_incremental_migration_corruption_and_stable_ids(tmp_path):
    b=book();index_book(tmp_path,b)
    original=search(tmp_path,b,'lantern',chapter=0)[0]['citation']
    b['chapters'][0]['sentences'][0]='Mira carried the green lantern.'
    assert status(tmp_path,b)['state']=='stale'
    index_book(tmp_path,b);assert status(tmp_path,b)['changed_rows']==1
    assert search(tmp_path,b,'green lantern')[0]['citation']==original
    with sqlite3.connect(tmp_path/'book.sqlite') as db:
        db.execute("UPDATE metadata SET value='2' WHERE key='schema'")
        db.execute("UPDATE metadata SET value='old' WHERE key='fingerprint'")
    index_book(tmp_path,b);assert status(tmp_path,b)['schema']==4
    for p in tmp_path.glob('book.sqlite*'):p.unlink()
    (tmp_path/'book.sqlite').write_bytes(b'corrupt index')
    assert status(tmp_path,b)['state']=='corrupt'
    assert search(tmp_path,b,'green lantern')[0]['citation']==original


@pytest.mark.parametrize('case',json.loads(Path('rag/eval/structure_cases.json').read_text()))
def test_structure_rules_and_precedence(case):
    b={'language':case['language'],'chapters':case['chapters']}
    result=analyze(b)
    assert [s['kind'] for s in result['sections']]==case['expected']
    for section in result['sections']:
        assert section['reasons'] and section['excerpt'] and section['source']
        if section['confidence_level']=='low':assert section['review']


def test_structure_flags_and_verbatim_features():
    b=book();b['chapters'].append(dict(b['chapters'][0],title='Chapter 3'))
    b['chapters'].append(dict(b['chapters'][0]))
    codes={f['code'] for f in analyze(b)['flags']};assert {'numbering_gap','duplicate_title'}<=codes
    for summary in features.summaries(b):
        assert summary['label']=='extractive'
        for item in summary['sentences']:assert item['text']==b['chapters'][item['chapter']]['sentences'][item['sentence']]
    assert features.entities(b)['label']=='heuristic'
    b['chapters'][0]['sentences'].append('Mira said, “Please bring the blue lantern home tonight.”')
    assert features.quotes(b,'lantern')[0]['text']=='“Please bring the blue lantern home tonight.”'
    b['chapters'][1]['sentences'].append(b['chapters'][0]['sentences'][-1])
    assert any(item['count']==4 for item in features.repetitions(b))


def test_qa_abstains_and_semantic_default_never_downloads(tmp_path,monkeypatch):
    b=book()
    monkeypatch.setenv('PAGEVOICE_RAG_MODEL_DIR',str(tmp_path/'absent'))
    import urllib.request
    monkeypatch.setattr(urllib.request,'urlopen',lambda *a,**k:pytest.fail('Unexpected network request'))
    assert features.answer(tmp_path,b,'quantum spacecraft')['status']=='no supporting passage found'
    assert features.answer(tmp_path,b,'blue lantern')['passages']
    results=search(tmp_path,b,'lantern',mode='hybrid')
    assert results and results[0]['semantic_status']=='not-installed'


def test_background_snapshot_and_deletion_coordination(tmp_path,monkeypatch):
    from rag.background import rebuild,index_status
    from pagevoice.pipeline import new_session,resume,load
    from pagevoice.trash import Trash
    from sample import make_sample
    session=new_session(make_sample(tmp_path/'sample.epub'),tmp_path);resume(session,prepare_only=True)
    entered=threading.Event();release=threading.Event();captured=[]
    def delayed(folder,b):entered.set();assert release.wait(5);captured.append(b['chapters'][0]['sentences'][0]);index_book(folder,b)
    monkeypatch.setattr('rag.background.index_book',delayed)
    b=load(session)['book'];original=b['chapters'][0]['sentences'][0]
    assert rebuild(session,b)['state']=='building';assert entered.wait(5)
    b['chapters'][0]['sentences'][0]='An edit made while indexing.'
    trash=Trash(tmp_path);trash.request(session.name);trash.sweep();assert session.exists()
    release.set()
    import time
    for _ in range(100):
        if index_status(session,b)['state']!='building':break
        time.sleep(.01)
    trash.sweep();assert not session.exists();assert captured==[original]


def test_fixed_gold_regression():
    from rag.eval.run import evaluate,check_regression
    result=evaluate();baseline=json.loads(Path('rag/eval/baseline.json').read_text())
    assert result['query_count']>=100
    assert not check_regression(result,baseline)


def test_semantic_installer_checks_hash_and_resumes(tmp_path,monkeypatch):
    import hashlib,io
    import urllib.request
    from rag import semantic
    payload=b'pinned test model';spec={'id':'fixture/model','revision':'abc','files':{'model.bin':{'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}}}
    monkeypatch.setattr(semantic,'specification',lambda:spec)
    calls=[]
    def fetch(url,**kwargs):calls.append(url);return io.BytesIO(payload)
    monkeypatch.setattr(urllib.request,'urlopen',fetch)
    semantic.install(tmp_path);assert semantic.verified(tmp_path)
    semantic.install(tmp_path);assert len(calls)==1
    (tmp_path/'model.bin').write_bytes(b'corrupt')
    monkeypatch.setattr(urllib.request,'urlopen',lambda *a,**k:io.BytesIO(b'wrong'))
    with pytest.raises(ValueError):semantic.install(tmp_path)
    assert not (tmp_path/'ready.json').exists()
    assert not list(tmp_path.glob('*.part'))
    monkeypatch.setattr(urllib.request,'urlopen',fetch)
    semantic.install(tmp_path);assert semantic.verified(tmp_path)


def test_semantic_vectors_resume_and_manifest_invalidation(tmp_path):
    np=pytest.importorskip("numpy")
    from rag.semantic import semantic_index,model_key
    b=book();index_book(tmp_path,b)
    class Model:
        spec={'dimensions':2,'revision':'test','files':{'onnx/model.onnx':{'sha256':'fake'},'tokenizer.json':{'sha256':'v1'}}}
        calls=0
        def encode(self,rows):self.calls+=len(rows);return np.tile([1.,0.],(len(rows),1))
    model=Model();semantic_index(tmp_path,b,model);assert model.calls==6
    semantic_index(tmp_path,b,model);assert model.calls==6
    old=model_key(model.spec);model.spec['files']['tokenizer.json']['sha256']='v2'
    assert model_key(model.spec)!=old
    semantic_index(tmp_path,b,model);assert model.calls==12
    b['chapters'][0]['sentences'][0]='Changed evidence.';index_book(tmp_path,b)
    semantic_index(tmp_path,b,model);assert model.calls==13


def test_hybrid_preserves_explicit_constraints(tmp_path,monkeypatch):
    monkeypatch.setattr('rag.semantic.hybrid',lambda *a,**k:pytest.fail('Must preserve lexical operators'))
    hits=search(tmp_path,book(),'"blue lantern"',mode='hybrid')
    assert hits and hits[0]['semantic_status']=='lexical-constraints'


def test_analysis_features_api(tmp_path):
    from fastapi.testclient import TestClient
    from pagevoice.api import create_app
    from sample import make_sample
    from test_api import wait
    source=make_sample(tmp_path/'book.epub')
    with TestClient(create_app(tmp_path)) as client:
        ident=client.post('/api/projects',files={'file':('book.epub',source.read_bytes())}).json()['id'];wait(client,ident)
        base=f'/api/projects/{ident}/analysis'
        assert client.get(base+'/index').json()['state']=='ready'
        assert client.get(base+'/summaries').json()['summaries']
        assert client.get(base+'/entities').json()['label']=='heuristic'
        assert client.get(base+'/qa?q=quantum-spacecraft').json()['status']=='no supporting passage found'
        assert client.get(base+'?q=harbour&kind=chapter&limit=5').status_code==200
        assert client.get(base+'?q=harbour&limit=5000').status_code==422
        assert client.post(base+'/index').status_code==202


def test_roman_numbering_gap_is_reviewable():
    b=book();b['chapters'][0]['title']='Chapter I';b['chapters'][1]['title']='Chapter IV'
    assert any(f['code']=='numbering_gap' for f in analyze(b)['flags'])
