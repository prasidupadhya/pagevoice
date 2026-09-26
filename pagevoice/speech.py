"""Local implementation of the audio/speech request and binary response shape."""
from pathlib import Path
from typing import Literal
import tempfile
import wave
from pydantic import BaseModel, ConfigDict, Field
from .audio import RATE, normalize, run
from .book import sentences
from .engines import create, validate_voice
from .narration import synthesize, events


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    model: Literal['say', 'edge']
    input: str = Field(min_length=1, max_length=4096)
    voice: str = Field(min_length=1, max_length=120)
    response_format: Literal['mp3','wav','pcm','flac','aac','opus'] = 'mp3'
    speed: float = Field(default=1, ge=.25, le=4)
    language: Literal['en','es'] = 'en'
    allow_network: bool = False
    stream_format: Literal['audio'] = 'audio'
    instructions: str | None = None


FORMATS = {
    'mp3': ('audio/mpeg', ['-c:a','libmp3lame','-f','mp3']),
    'wav': ('audio/wav', ['-c:a','pcm_s16le','-f','wav']),
    'pcm': ('audio/pcm', ['-c:a','pcm_s16le','-f','s16le']),
    'flac': ('audio/flac', ['-c:a','flac','-f','flac']),
    'aac': ('audio/aac', ['-c:a','aac','-f','adts']),
    'opus': ('audio/ogg', ['-c:a','libopus','-f','ogg']),
}


def render(request, root):
    if request.instructions:
        raise ValueError('Style instructions are not supported by these local engines.')
    validate_voice(request.model, request.voice, request.language, root / 'voices')
    for kind, _, voice in events(request.input):
        if kind == 'text' and voice:
            validate_voice(request.model, voice, request.language, root / 'voices')
    parts = sentences(request.input, request.language)
    adapter = create(request.model, 'auto', request.allow_network, root / 'voices')
    with tempfile.TemporaryDirectory(prefix='pagevoice-speech-') as folder:
        folder = Path(folder)
        combined = folder / 'all.wav'
        with wave.open(str(combined), 'wb') as output:
            output.setparams((1,2,RATE,0,'NONE','not compressed'))
            for index, part in enumerate(parts):
                raw, normalized = folder / f'{index}.raw.wav', folder / f'{index}.wav'
                synthesize(adapter, part, raw, request.voice, request.language)
                normalize(raw, normalized)
                with wave.open(str(normalized),'rb') as source:
                    while data := source.readframes(RATE * 10):
                        output.writeframes(data)
        # Multiple atempo stages preserve the full supported 0.25–4 range.
        speed, filters = request.speed, []
        while speed < .5:
            filters.append('atempo=0.5'); speed /= .5
        while speed > 2:
            filters.append('atempo=2'); speed /= 2
        filters.append(f'atempo={speed}')
        target = folder / 'response.audio'
        mime, codec = FORMATS[request.response_format]
        run(['ffmpeg','-v','error','-y','-i',str(combined),'-af',','.join(filters),
             '-ar',str(RATE),'-ac','1',*codec,str(target)], timeout=180)
        return target.read_bytes(), mime
