import io, wave, struct, math
from fastapi.testclient import TestClient
from pagevoice.api import create_app
from pagevoice.voices import reference
import pytest


def recording(seconds=6):
    stream=io.BytesIO()
    with wave.open(stream,'wb') as audio:
        audio.setparams((1,2,24000,0,'NONE','not compressed'))
        audio.writeframes(b''.join(struct.pack('<h',int(5000*math.sin(i*.1))) for i in range(int(24000*seconds))))
    return stream.getvalue()


def test_retired_profile_upload_preserves_existing_recordings(tmp_path):
    from pagevoice.voices import register
    path=tmp_path/'sample.wav';path.write_bytes(recording())
    profile=register(tmp_path/'voices',path,'Archived voice','es',True)
    original=reference(tmp_path/'voices',profile['id']).read_bytes()
    with TestClient(create_app(tmp_path)) as client:
        assert client.post('/api/voices',files={'file':('sample.wav',recording(),'audio/wav')}).status_code==410
        assert reference(tmp_path/'voices',profile['id']).read_bytes()==original
        assert len(client.get('/api/voices').json())==1
