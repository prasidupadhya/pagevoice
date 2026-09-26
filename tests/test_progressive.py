import threading
import time
import json
from pathlib import Path
from fastapi.testclient import TestClient
from pagevoice.api import create_app
from pagevoice.pipeline import new_session, resume, load
from pagevoice.storage import save
from pagevoice.listening import set_priority, priority
from test_recovery import CountingEngine
from sample import make_sample
from test_api import wait


def prepared(root):
    session=new_session(make_sample(root/'book.epub'),root,engine='say')
    resume(session,prepare_only=True)
    state=load(session)
    state['book']['chapters']=[{'title':f'Chapter {ci+1}','sentences':[f'Chapter {ci+1} sentence {si+1}.' for si in range(25)]} for ci in range(4)]
    save(session/'session.json',state)
    return session


def test_priority_buffer_and_full_export(tmp_path,monkeypatch):
    reached=threading.Event();release=threading.Event()
    class Engine(CountingEngine):
        def synthesize(self,*args):
            if len(self.calls)==20:
                reached.set()
                if not release.wait(20): raise RuntimeError('test release timed out')
            super().synthesize(*args)
    engine=Engine();monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:engine)
    session=prepared(tmp_path);base=f'/api/projects/{session.name}'
    with TestClient(create_app(tmp_path)) as client:
        try:
            assert client.post(base+'/listen',json={'chapter':2}).status_code==202
            assert reached.wait(10)
            p=client.get(base).json()
            assert p['chapters'][2]['contiguous_ready']==20
            assert p['chapters'][0]['ready']==p['chapters'][1]['ready']==0
            assert p['job']['status']=='running' and p['output'] is None
            # Listen to committed audio while the next sentence is synthesizing.
            audio=p['chapters'][2]['sentences'][0]['audio']
            assert client.get(audio).content[:4]==b'RIFF'
            assert client.post(base+'/listen',json={'chapter':3}).status_code==202
            assert len([j for j in client.app.state.jobs.records.values() if j['project']==session.name])==1
        finally:
            release.set()
        p=wait(client,session.name)
        assert p['progress']['complete']==100
        # In-flight C3 sentence may finish; the very next sentence follows new priority.
        assert engine.calls[:20]==[f'Chapter 3 sentence {i+1}.' for i in range(20)]
        assert engine.calls[21]=='Chapter 4 sentence 1.'
        assert engine.calls.index('Chapter 4 sentence 25.') < engine.calls.index('Chapter 1 sentence 1.')
        assert p['output'] and client.get(p['output']).status_code==200
        state=load(session)
        assert [c['title'] for c in state['book']['chapters']]==['Chapter 1','Chapter 2','Chapter 3','Chapter 4']
        metadata=(session/'chapters.ffmeta').read_text()
        assert metadata.index('title=Chapter 1')<metadata.index('title=Chapter 3')
        assert client.get(audio.replace('v=','v=invalid')).status_code==409


def test_priority_persists_across_worker_restart(tmp_path,monkeypatch):
    engine=CountingEngine();monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:engine)
    session=prepared(tmp_path);set_priority(session,2)
    folder=tmp_path/'jobs';folder.mkdir()
    record={'id':'f'*32,'project':session.name,'kind':'listen','status':'running','created':1,'options':{'allow_network':False}}
    save(folder/(record['id']+'.json'),record)
    with TestClient(create_app(tmp_path)) as client:
        result=wait(client,session.name)
        assert result['output']
    assert engine.calls[0]=='Chapter 3 sentence 1.'
    assert engine.calls[25]=='Chapter 4 sentence 1.'
    assert engine.calls[50]=='Chapter 1 sentence 1.'
    assert priority(session)==2


def test_pause_preserves_chunks_and_resumes(tmp_path,monkeypatch):
    reached=threading.Event();release=threading.Event()
    class Engine(CountingEngine):
        def synthesize(self,*args):
            if not self.calls:
                reached.set();assert release.wait(10)
            super().synthesize(*args)
    engine=Engine();monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:engine)
    session=prepared(tmp_path);base=f'/api/projects/{session.name}'
    with TestClient(create_app(tmp_path)) as client:
        try:
            client.post(base+'/listen',json={'chapter':2})
            assert reached.wait(10)
            assert client.post(base+'/pause').status_code==202
        finally:release.set()
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            p=client.get(base).json()
            if p['job']['status']=='paused':break
            time.sleep(.02)
        assert p['status']=='paused' and not p['error']
        assert len(engine.calls)==1
        assert client.get(p['chapters'][2]['sentences'][0]['audio']).status_code==200
        client.post(base+'/listen',json={'chapter':2})
        done=wait(client,session.name)
        assert done['last_run']=={'reused':1,'synthesized':99}
        assert not done['listening']['pausing']
