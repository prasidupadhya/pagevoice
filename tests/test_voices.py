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


def test_voice_consent_duration_and_checksum(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        files={'file':('sample.wav',recording(),'audio/wav')}
        assert client.post('/api/voices',files=files,data={'name':'Owned sample'}).status_code==400
        short=client.post('/api/voices',files={'file':('sample.wav',recording(1),'audio/wav')},data={'name':'Owned sample','consent':'true'})
        assert short.status_code==400
        response=client.post('/api/voices',files=files,data={'name':'Owned sample','language':'es','consent':'true'})
        assert response.status_code==201,response.text
        record=response.json();assert record['consent'] and record['language']=='es'
        path=reference(tmp_path/'voices',record['id']);assert path.is_file()
        assert len(client.get('/api/voices').json())==1
        path.write_bytes(b'corrupted')
        with pytest.raises(ValueError,match='checksum'):reference(tmp_path/'voices',record['id'])
        assert client.get('/api/voices').json()==[]
