import json
import platform
import wave
import pytest
from pagevoice.narration import events, detect, synthesize
from pagevoice.book import sentences
from pagevoice.pipeline import new_session, resume, load
from pagevoice.storage import save
from test_recovery import CountingEngine
from sample import make_sample


def test_markup_boundaries():
    rows=sentences('[voice:Mira]First sentence. Second sentence.[/voice] [pause:1.5] Last sentence.', 'en')
    assert rows==['[voice:Mira]First sentence.[/voice]','[voice:Mira]Second sentence.[/voice]','[pause:1.5]','Last sentence.']
    for invalid in ('[pause:-1]','[pause:nan]','[voice:X]oops','[/voice]oops','[voice:X][voice:Y]nested[/voice][/voice]','[pause:99]','[voice:]empty[/voice]'):
        with pytest.raises(ValueError):events(invalid)
    long=sentences('[voice:Long name]'+('word '*200)+'[/voice]','es')
    assert len(long) == 1  # One editable sentence; synthesis windows are internal.
    assert ' '.join(event[1] for row in long for event in events(row) if event[0]=='text')==('word '*200).strip()


def test_bilingual_dialogue():
    tags=detect({'chapters':[{'sentences':['The sun rose.', '“Hello,” said Mira.', '«Hola», dijo María.', 'Diego respondió: «Buenos días».', '“Unknown.”']}]})
    assert list(tags.values())==['Narrator','Mira','María','Diego','Dialogue']


def test_pause_exact_samples_and_voice(tmp_path):
    class Capture(CountingEngine):
        def synthesize(self,text,destination,voice,language):
            super().synthesize(text,destination,voice,language)
            selected.append(voice)
    selected=[]
    synthesize(Capture(), '[voice:Mira]Hello.[/voice][pause:1.5]Again.',tmp_path/'out.wav','Samantha','en',{'Mira':'Daniel'})
    assert selected==['Daniel','Samantha']
    with wave.open(str(tmp_path/'out.wav')) as result:
        assert result.getnframes()==36000+2*2400+len("Hello.")+len("Again.")


def test_cast_change_reuses_unaffected_chunks(tmp_path,monkeypatch):
    engine=CountingEngine();monkeypatch.setattr('pagevoice.pipeline.create',lambda *args:engine)
    session=new_session(make_sample(tmp_path/'book.epub'),tmp_path,engine='say')
    resume(session,prepare_only=True)
    state=load(session);state['speaker_tags']={'0000-00001':'Mira'};state['cast']={'Mira':'Daniel'};save(session/'session.json',state)
    resume(session);engine.calls.clear()
    state=load(session);state['cast']['Mira']='Fred';save(session/'session.json',state)
    resume(session)
    assert len(engine.calls)==1
    assert load(session)['last_run']=={'reused':3,'synthesized':1}


@pytest.mark.smoke
@pytest.mark.skipif(platform.system()!='Darwin',reason='macOS speech')
def test_real_multivoice_render(tmp_path):
    session=new_session(make_sample(tmp_path/'book.epub'),tmp_path,engine='say')
    resume(session,prepare_only=True)
    state=load(session)
    state['book']['chapters'][0]['sentences'][1]='[voice:Mira]Welcome to the harbour.[/voice] [pause:0.3] A new day begins.'
    state['cast']={'Mira':'Daniel'}
    save(session/'session.json',state)
    output=resume(session)
    assert output.stat().st_size>10000
    assert load(session)['output_current']


def test_casting_api_validation(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from pagevoice.api import create_app
    monkeypatch.setattr('pagevoice.api.validate_voice',lambda *args:None)
    session=new_session(make_sample(tmp_path/'book.epub'),tmp_path,engine='say')
    resume(session,prepare_only=True)
    state=load(session);state['book']['chapters'][0]['sentences'][1]='“Hello,” said Mira.';save(session/'session.json',state)
    base=f'/api/projects/{session.name}'
    with TestClient(create_app(tmp_path)) as client:
        detected=client.post(base+'/speakers/detect').json()
        assert 'Mira' in detected['speakers']
        changed=client.patch(base+'/casting',json={'cast':{'Mira':'Daniel'},'tags':{'0000-00001':'Mira'}})
        assert changed.status_code==200
        assert changed.json()['cast']['Mira']=='Daniel'
        assert client.patch(base+'/casting',json={'tags':{'9999-99999':'Mira'}}).status_code==400
        client.patch(base+'/casting',json={'tags':{'0000-00001':'Manually corrected'}})
        assert client.post(base+'/speakers/detect').json()['chapters'][0]['sentences'][1]['speaker']=='Manually corrected'
