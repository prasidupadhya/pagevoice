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
    'xtts': EngineInfo('XTTSv2', False, 'Ana Florence'),
    'say': EngineInfo('macOS speech', False, 'Samantha'),
    'edge': EngineInfo('Edge draft', True, 'en-US-AriaNeural'),
}


class Engine(Protocol):
    def synthesize(self, text: str, destination: Path, voice: str, language: str) -> None: ...


def hardware():
    device = 'unverified (install torch to probe accelerators)'
    torch_version = None
    try:
        import torch
        torch_version = torch.__version__
        device = 'cpu'
        if torch.cuda.is_available():
            device = 'rocm' if torch.version.hip else 'cuda'
        elif torch.backends.mps.is_available():
            device = 'mps'
    except ImportError:
        pass
    return {'system': platform.system(), 'machine': platform.machine(), 'python': platform.python_version(),
            'device': device, 'torch': torch_version,
            'recommendation': 'say for a fast offline draft; xtts for neural narration' if platform.system() == 'Darwin' else 'xtts',
            'warning': 'Modern neural engines can be very slow on CPU.' if device == 'cpu' else 'Benchmark a chapter before rendering a whole book.',
            'ffmpeg': shutil.which('ffmpeg'), 'ffprobe': shutil.which('ffprobe'),
            'tesseract': shutil.which('tesseract')}


class MacSpeech:
    def __init__(self):
        if platform.system() != 'Darwin' or not shutil.which('say'):
            raise ValueError('The say engine requires macOS. Choose xtts instead.')

    def synthesize(self, text, destination, voice, language):
        # stdin avoids interpreting book text as command-line flags or a shell program.
        run(['say', '-v', voice, '-o', str(destination), '--file-format=WAVE',
             '--data-format=LEI16@24000'], input=text, timeout=180)


class EdgeSpeech:
    def __init__(self):
        try:
            import edge_tts
        except ImportError as exc:
            raise ValueError("Install Edge with: .venv/bin/pip install -e '.[edge]'") from exc
        self.module = edge_tts

    def synthesize(self, text, destination, voice, language):
        asyncio.run(asyncio.wait_for(self.module.Communicate(text, voice).save(str(destination)), timeout=180))


class XttsSpeech:
    def __init__(self, device, voices_dir=None):
        self.voices_dir = voices_dir or Path("voices")
        if not xtts_ready():
            raise ValueError('XTTS model is not installed. Run .venv/bin/pagevoice setup-xtts and review the model terms, or select a built-in local voice.')
        try:
            from TTS.api import TTS
        except ImportError as exc:
            raise ValueError("Install XTTS with: .venv/bin/pip install -e '.[xtts]' (large dependencies).") from exc
        selected = hardware()['device'] if device == 'auto' else device
        if selected == 'rocm':
            selected = 'cuda'  # PyTorch's ROCm backend uses this device spelling.
        self.model = TTS(model_name='tts_models/multilingual/multi-dataset/xtts_v2', progress_bar=False).to(selected)

    def synthesize(self, text, destination, voice, language):
        from .voices import reference
        options = {'speaker_wav': str(reference(self.voices_dir, voice))} if voice.startswith('clone:') else {'speaker': voice}
        self.model.tts_to_file(text=text, file_path=str(destination), language=language, split_sentences=False, **options)


def create(name, device='auto', allow_network=False, voices_dir=None) -> Engine:
    if REGISTRY[name].online and not allow_network:
        raise ValueError('Edge sends book text to Microsoft. Pass --allow-network to opt in.')
    if name == 'xtts':
        return XttsSpeech(device, voices_dir)
    return {'say': MacSpeech, 'edge': EdgeSpeech}[name]()


def xtts_ready():
    """No download or license acceptance is performed by this probe."""
    try:
        from TTS.utils.manage import ModelManager
        folder = Path(ModelManager(progress_bar=False).output_prefix) / 'tts_models--multilingual--multi-dataset--xtts_v2'
        return all((folder / name).is_file() for name in ('model.pth', 'config.json', 'vocab.json', 'speakers_xtts.pth'))
    except ImportError:
        return False


def builtin_voices(engine):
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
        return result
    if engine == 'edge':
        return [{'id': voice, 'language': language} for language, voices in (
            ('en', ['en-US-AriaNeural', 'en-US-GuyNeural']),
            ('es', ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural'])) for voice in voices]
    return [{'id': 'Ana Florence', 'language': language} for language in ('en','es')]


def validate_voice(engine, voice, language, voices_dir):
    from .voices import reference, catalogue
    if voice.startswith('clone:'):
        if engine != 'xtts':
            raise ValueError('Cloned voices require XTTS.')
        try:
            reference(voices_dir, voice)
        except (OSError, KeyError) as exc:
            raise ValueError('Voice profile is missing or invalid.') from exc
        if not any(v['id'] == voice and v['language'] == language for v in catalogue(voices_dir)):
            raise ValueError('Voice profile language must match the book.')
    elif not any(v['id'] == voice and v['language'] == language for v in builtin_voices(engine)):
        raise ValueError('Choose an available voice for the selected engine and language.')
