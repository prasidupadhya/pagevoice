import io
import platform
import wave
import pytest
from fastapi.testclient import TestClient
from filelock import FileLock
from pagevoice.api import create_app
from test_recovery import CountingEngine


@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr('pagevoice.speech.create',lambda *args:CountingEngine())
    monkeypatch.setattr('pagevoice.speech.validate_voice',lambda *args:None)
    with TestClient(create_app(tmp_path)) as client:
        yield client


@pytest.mark.parametrize('format,header',[('wav',b'RIFF'),('mp3',b'ID3'),('flac',b'fLaC'),('opus',b'OggS'),('aac',b'\xff'),('pcm',None)])
def test_audio_formats(client,format,header):
    response=client.post('/v1/audio/speech',json={'input':'Hello.','model':'say','voice':'Samantha','response_format':format})
    assert response.status_code==200,response.text
    assert len(response.content)>100
    if header:assert response.content.startswith(header)


def test_speech_validation_and_lock(client,tmp_path):
    payload={'input':'Hello.','model':'say','voice':'Samantha'}
    for values in ({'language':'fr'},{'model':'gpt-4o-mini-tts'},{'speed':5},{'stream_format':'sse'},{'input':'x'*4097}):
        assert client.post('/v1/audio/speech',json=payload|values).status_code==422
    assert client.post('/v1/audio/speech',json=payload|{'instructions':'Whisper'}).status_code==400
    with FileLock(str(tmp_path/'jobs'/'.synthesis.lock')):
        assert client.post('/v1/audio/speech',json=payload).status_code==409
    assert {m['id'] for m in client.get('/v1/models').json()['data']}=={'say','edge'}


@pytest.mark.smoke
@pytest.mark.skipif(platform.system()!='Darwin',reason='macOS speech')
def test_real_spanish_speech(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response=client.post('/v1/audio/speech',json={'input':'Hola. Este libro está en español.','language':'es','model':'say','voice':'Monica','response_format':'wav','speed':1.25})
        assert response.status_code==200,response.text
        with wave.open(io.BytesIO(response.content)) as audio:
            assert audio.getframerate()==24000
            assert audio.getnframes()>24000
        assert client.post('/v1/audio/speech',json={'input':'Hello','model':'edge','voice':'en-US-AriaNeural'}).status_code==400


def test_removed_xtts_and_cloning_are_rejected(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.post('/v1/audio/speech',json={'model':'xtts','voice':'Ana Florence','input':'Hello.'}).status_code==422
        result=client.post('/v1/audio/speech',json={'model':'edge','voice':'clone:'+'0'*32,'input':'Hello.'})
        assert result.status_code==400 and 'no longer supported' in result.json()['detail']
        assert [e['id'] for e in client.get('/api/engines').json()]==['edge']
