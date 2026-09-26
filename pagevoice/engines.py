"""Small engine registry; optional dependencies are imported only on use."""
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
import asyncio
import platform
import shutil

from .audio import run


@dataclass(frozen=True)
class EngineInfo:
    name: str
    online: bool
    default_voice: str


REGISTRY = {
    'say': EngineInfo('macOS speech', False, 'Samantha'),
    'edge': EngineInfo('Edge online', True, 'en-US-AriaNeural'),
}


class Engine(Protocol):
    def synthesize(self, text: str, destination: Path, voice: str, language: str) -> None: ...


def hardware():
    return {'system': platform.system(), 'machine': platform.machine(), 'python': platform.python_version(),
            'device': 'cpu', 'torch': None,
            'recommendation': 'Edge online for narration; no local GPU or model download needed.',
            'warning': 'Edge requires internet and sends narration text to Microsoft. Parsing and exports stay local.',
            'ffmpeg': shutil.which('ffmpeg'), 'ffprobe': shutil.which('ffprobe'),
            'tesseract': shutil.which('tesseract')}


class MacSpeech:
    def __init__(self):
        if platform.system() != 'Darwin' or not shutil.which('say'):
            raise ValueError('The say engine requires macOS. Choose Edge with explicit network consent instead.')

    def synthesize(self, text, destination, voice, language):
        # stdin avoids interpreting book text as command-line flags or a shell program.
        run(['say', '-v', voice, '-o', str(destination), '--file-format=WAVE',
             '--data-format=LEI16@24000'], input=text, timeout=180)


class EdgeSpeech:
    # Below the service message limit even for multibyte Spanish text.
    max_text_bytes = 3500
    def __init__(self):
        try:
            import edge_tts
        except ImportError as exc:
            raise ValueError("Install Edge with: .venv/bin/pip install -e '.[edge]'") from exc
        self.module = edge_tts

    def synthesize(self, text, destination, voice, language):
        import tempfile
        from .audio import normalize, trim_transport_padding
        with tempfile.TemporaryDirectory(prefix='pagevoice-edge-') as folder:
            raw = Path(folder) / 'speech.mp3'
            asyncio.run(asyncio.wait_for(self.module.Communicate(text, voice).save(str(raw)), timeout=180))
            normalize(raw, destination)
            trim_transport_padding(destination)


def create(name, device='auto', allow_network=False, voices_dir=None) -> Engine:
    if name not in REGISTRY:
        raise ValueError('This engine has been removed. Select Edge online and save settings before rendering.')
    if REGISTRY[name].online and not allow_network:
        raise ValueError('Edge sends book text to Microsoft. Pass --allow-network to opt in.')
    return {'say': MacSpeech, 'edge': EdgeSpeech}[name]()


def builtin_voices(engine, curated=True):
    if engine == 'say':
        if not shutil.which('say'):
            return []
        import re
        import unicodedata
        result = []
        for line in run(['say', '-v', '?'], timeout=10).splitlines():
            match = re.match(r'(.+?)\s+(en|es)_[A-Z]+\s', line)
            if match:
                name = match[1].strip()
                # The system accepts the unaccented aliases used by our defaults.
                if name in ('Mónica',):
                    name = ''.join(c for c in unicodedata.normalize('NFD', name) if not unicodedata.combining(c))
                result.append({'id': name, 'language': match[2]})
        if not curated: return result
        choices = [('Samantha','en','female','young'), ('Grandma (English (US))','en','female','older'),
                   ('Eddy (English (US))','en','male','young'), ('Grandpa (English (US))','en','male','older'),
                   ('Monica','es','female','young'), ('Grandma (Spanish (Spain))','es','female','older'),
                   ('Eddy (Spanish (Spain))','es','male','young'), ('Grandpa (Spanish (Spain))','es','male','older')]
        available = {v['id'] for v in result}
        return [{'id':name,'language':lang,'gender':gender,'style':style} for name,lang,gender,style in choices if name in available]
    if engine == 'edge':
        # Verified with Microsoft's live catalogue; ages are not published.
        choices = [
            ('en-US-AriaNeural','Aria','en','female','US','Clear, bright'),
            ('en-US-JennyNeural','Jenny','en','female','US','Sincere, approachable'),
            ('en-US-GuyNeural','Guy','en','male','US','Friendly, expressive'),
            ('en-US-ChristopherNeural','Christopher','en','male','US','Deep, warm'),
            ('en-GB-SoniaNeural','Sonia','en','female','GB','British English'),
            ('en-GB-LibbyNeural','Libby','en','female','GB','British English'),
            ('en-GB-RyanNeural','Ryan','en','male','GB','British English'),
            ('en-GB-ThomasNeural','Thomas','en','male','GB','British English'),
            ('es-ES-ElviraNeural','Elvira','es','female','ES','Bright, clear'),
            ('es-ES-XimenaNeural','Ximena','es','female','ES','Spanish (Spain)'),
            ('es-ES-AlvaroNeural','Álvaro','es','male','ES','Confident, animated')]
        return [dict(zip(('id','name','language','gender','region','description'),v)) for v in choices]
    return []


def validate_voice(engine, voice, language, voices_dir):
    if voice.startswith('clone:'):
        raise ValueError('Voice cloning is no longer supported. Choose an Edge voice.')
    if not any(v['id'] == voice and v['language'] == language for v in builtin_voices(engine, curated=False)):
        raise ValueError('Choose an available voice for the selected engine and language.')
