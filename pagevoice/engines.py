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
            'ffmpeg': shutil.which('ffmpeg'), 'ffprobe': shutil.which('ffprobe')}


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
    def __init__(self, device):
        try:
            from TTS.api import TTS
        except ImportError as exc:
            raise ValueError("Install XTTS with: .venv/bin/pip install -e '.[xtts]' (large dependencies).") from exc
        selected = hardware()['device'] if device == 'auto' else device
        if selected == 'rocm':
            selected = 'cuda'  # PyTorch's ROCm backend uses this device spelling.
        self.model = TTS(model_name='tts_models/multilingual/multi-dataset/xtts_v2', progress_bar=False).to(selected)

    def synthesize(self, text, destination, voice, language):
        self.model.tts_to_file(text=text, file_path=str(destination), speaker=voice,
                               language='zh-cn' if language == 'zh' else language, split_sentences=False)


def create(name, device='auto', allow_network=False) -> Engine:
    if REGISTRY[name].online and not allow_network:
        raise ValueError('Edge sends book text to Microsoft. Pass --allow-network to opt in.')
    if name == 'xtts':
        return XttsSpeech(device)
    return {'say': MacSpeech, 'edge': EdgeSpeech}[name]()
