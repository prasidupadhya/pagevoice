import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from pagevoice.api import create_app
from pagevoice.pipeline import new_session, resume, load
from pagevoice.storage import save
from pagevoice.trash import Trash
from sample import make_sample
from test_recovery import CountingEngine


def prepared(root):
    session=new_session(make_sample(root/'book.epub'),root,engine='say')
    resume(session,prepare_only=True)
    return session


def test_idle_delete_undo_expiry_rag_and_double_delete(tmp_path,monkeypatch):
    session=prepared(tmp_path);source=tmp_path/'uploads'/load(session)['source_name']
    assert (session/'rag'/'book.sqlite').exists()
    with TestClient(create_app(tmp_path)) as client:
        base='/api/projects/'+session.name
        info=client.get(base+'/deletion').json();assert info['bytes']>0
        r=client.delete(base);assert r.status_code==202,r.text
        assert not session.exists() and not source.exists()
        assert client.get(base).status_code==404
        assert client.delete(base).status_code==404
        restored=client.post('/api/trash/'+session.name+'/restore');assert restored.status_code==200
        assert (session/'rag'/'book.sqlite').exists() and source.exists()
        r=client.delete(base).json()
        marker=client.app.state.jobs.trash.marker(session.name)
        data=json.loads(marker.read_text());data['expires']=time.time()-1;save(marker,data)
        with client.app.state.jobs.guard:client.app.state.jobs.trash.sweep()
        assert not marker.parent.exists()
        assert client.post('/api/trash/'+session.name+'/restore').status_code==404
    assert not list((tmp_path/'jobs').glob('*.json'))


def test_deletion_during_render_finishes_sentence_and_never_requeues(tmp_path,monkeypatch):
    started=threading.Event();release=threading.Event()
    class Engine(CountingEngine):
        def synthesize(self,*args):
            started.set();assert release.wait(10);super().synthesize(*args)
    engine=Engine();monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:engine)
    session=prepared(tmp_path);base='/api/projects/'+session.name
    with TestClient(create_app(tmp_path)) as client,ThreadPoolExecutor() as pool:
        assert client.post(base+'/render',json={}).status_code==202
        assert started.wait(5)
        assert client.get(base+'/analysis?q=harbour').status_code==200
        pending=pool.submit(client.delete,base)
        deadline=time.monotonic()+5
        while not client.app.state.jobs.trash.hidden(session.name):
            assert time.monotonic()<deadline;time.sleep(.01)
        assert not pending.done();release.set()
        result=pending.result(10);assert result.status_code==202,result.text
        assert len(engine.calls)==1
        assert not session.exists()
    with TestClient(create_app(tmp_path)) as client:
        assert client.get(base).status_code==404
        assert not client.app.state.jobs.records


def test_shared_source_survives_sibling_delete_and_undo(tmp_path):
    a=prepared(tmp_path);b=prepared(tmp_path)
    state=load(b);(tmp_path/'uploads'/state['source_name']).unlink()
    state['source_name']=load(a)['source_name'];save(b/'session.json',state)
    source=tmp_path/'uploads'/state['source_name']
    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/api/projects/'+a.name+'/deletion').json()['source_shared']
        client.delete('/api/projects/'+a.name);assert source.exists()
        client.delete('/api/projects/'+b.name);assert source.exists()
        assert client.post('/api/trash/'+a.name+'/restore').status_code==200
        assert source.exists()
        trash=client.app.state.jobs.trash;data=trash.read(b.name);data['expires']=0;save(trash.marker(b.name),data)
        with client.app.state.jobs.guard:trash.sweep()
        assert source.exists()


def test_restart_finishes_partial_move_and_cancels_jobs(tmp_path):
    session=prepared(tmp_path);trash=Trash(tmp_path)
    folder=tmp_path/'jobs';folder.mkdir(exist_ok=True)
    record={'id':'a'*32,'project':session.name,'status':'running','kind':'render','options':{},'created':1}
    save(folder/(record['id']+'.json'),record)
    data=trash.request(session.name);data['state']='moving';save(trash.marker(session.name),data)
    target=trash.marker(session.name).parent/'files'/'sessions'/session.name
    target.parent.mkdir(parents=True);session.replace(target)
    with TestClient(create_app(tmp_path)) as client:
        assert not client.app.state.jobs.records
        assert trash.read(session.name)['state']=='trashed'
        assert not list(folder.glob('*.json'))
        assert client.post('/api/trash/'+session.name+'/restore').status_code==200
        assert json.loads((folder/(record['id']+'.json')).read_text())['status']=='paused'


def test_traversal_and_symlinks(tmp_path):
    session=prepared(tmp_path)
    with TestClient(create_app(tmp_path)) as client:
        for value in ['bad','%2e%2e%2fetc','f'*31,'f'*33]:
            assert client.delete('/api/projects/'+value).status_code in (404,405)
        (session/'evil').symlink_to(tmp_path/'book.epub')
        assert client.delete('/api/projects/'+session.name).status_code==400
        assert session.exists() and (tmp_path/'book.epub').exists()


def test_sse_closes_on_delete(tmp_path):
    session=prepared(tmp_path)
    with TestClient(create_app(tmp_path)) as client,ThreadPoolExecutor() as pool:
        events=pool.submit(client.get,f'/api/projects/{session.name}/events')
        time.sleep(.15)
        assert client.delete('/api/projects/'+session.name).status_code==202
        response=events.result(5)
        assert 'event: deleted' in response.text


def test_paused_and_queued_records_do_not_return_on_restart(tmp_path):
    session=prepared(tmp_path);trash=Trash(tmp_path);folder=tmp_path/'jobs';folder.mkdir(exist_ok=True)
    for index,status in enumerate(['queued','paused']):
        record={'id':str(index)*32,'project':session.name,'status':status,'kind':'render','options':{},'created':index}
        save(folder/(record['id']+'.json'),record)
    trash.request(session.name)
    with TestClient(create_app(tmp_path)) as client:
        assert not client.app.state.jobs.records
        assert not session.exists()


def test_cli_deletes_owned_outputs_logs_and_jobs(tmp_path):
    import subprocess,sys
    session=prepared(tmp_path)
    (tmp_path/'outputs'/f'{session.name}.mp3').write_bytes(b'audio')
    (tmp_path/'logs').mkdir();(tmp_path/'logs'/f'{session.name}.log').write_text('private job log')
    shared=tmp_path/'logs'/'server.log';shared.write_text('shared log')
    jobfolder=tmp_path/'jobs';jobfolder.mkdir()
    save(jobfolder/('a'*32+'.json'),{'id':'a'*32,'project':session.name,'status':'paused','kind':'render','options':{},'created':1})
    result=subprocess.run([sys.executable,'-c','from pagevoice.cli import main; raise SystemExit(main())','delete',str(session)],capture_output=True,text=True,timeout=20)
    assert result.returncode==0,result.stderr
    assert not session.exists()
    assert not list((tmp_path/'outputs').glob(session.name+'*'))
    assert not list(jobfolder.glob('*.json'))
    assert not (tmp_path/'logs'/f'{session.name}.log').exists()
    assert shared.read_text()=='shared log'
