from types import SimpleNamespace
import wave
import pytest
from pagevoice.engines import EdgeSpeech
from pagevoice.text import split_sentences


def test_quoted_terminal_punctuation():
    assert split_sentences('Dijo: «¿Volvemos?» . Después salió.', 'es') == ['Dijo: «¿Volvemos?».', 'Después salió.']
    assert split_sentences('«¿Volvemos?», dijo mirando alrededor. Luego salió.', 'es') == ['«¿Volvemos?», dijo mirando alrededor.', 'Luego salió.']


def test_legacy_punctuation_never_calls_edge(tmp_path):
    adapter=EdgeSpeech()
    adapter.module=SimpleNamespace(Communicate=lambda *args:pytest.fail('Punctuation must not be sent'))
    path=tmp_path/'pause.wav'
    adapter.synthesize('.',path,'es-ES-AlvaroNeural','es')
    with wave.open(str(path)) as audio:
        assert audio.getnframes()==960
        assert audio.getframerate()==24000


def test_no_audio_retries_are_bounded_and_clear_partial_files(tmp_path,monkeypatch):
    from edge_tts.exceptions import NoAudioReceived
    import pagevoice.engines as engines
    attempts=[]
    class Request:
        async def save(self,path):
            from pathlib import Path
            path=Path(path)
            assert not path.exists()
            path.write_bytes(b'partial')
            attempts.append(1)
            raise NoAudioReceived('empty')
    async def no_wait(_):pass
    monkeypatch.setattr(engines.asyncio,'sleep',no_wait)
    adapter=EdgeSpeech();adapter.module=SimpleNamespace(Communicate=lambda *args:Request())
    target=tmp_path/'speech.wav'
    with pytest.raises(RuntimeError,match='after 3 attempts'):
        adapter.synthesize('Una frase.',target,'es-ES-AlvaroNeural','es')
    assert len(attempts)==3
    assert not target.exists()
