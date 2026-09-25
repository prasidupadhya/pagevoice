"""Original, explicit narration markup and editable dialogue suggestions."""
import re
import tempfile
import wave
from pathlib import Path
from .audio import normalize, RATE

TOKEN = re.compile(r'\[(pause:[^\]]*|voice:[^\]]*|/voice)\]')
NAME = r'[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+(?:[- ][A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+)?'
VERB = r'(?:said|asked|replied|whispered|shouted|dijo|preguntó|respondió|susurró|gritó)'


def events(text):
    """Balanced, nonnested voice spans; pauses are seconds, 0 < N <= 30."""
    result, voice, cursor = [], None, 0
    for match in TOKEN.finditer(text):
        if text[cursor:match.start()].strip():
            result.append(('text', text[cursor:match.start()].strip(), voice))
        token = match[1]
        if token.startswith('pause:'):
            try:
                seconds = float(token[6:])
            except ValueError as exc:
                raise ValueError('Pause must be a number of seconds.') from exc
            if not 0 < seconds <= 30:
                raise ValueError('Pause must be greater than zero and at most 30 seconds.')
            result.append(('pause', seconds, None))
        elif token.startswith('voice:'):
            if voice is not None or not token[6:].strip() or len(token[6:]) > 80:
                raise ValueError('Voice spans must have a name and cannot be nested.')
            voice = token[6:].strip()
        else:
            if voice is None:
                raise ValueError('Closing voice tag has no opening tag.')
            voice = None
        cursor = match.end()
    if voice is not None:
        raise ValueError('Close the voice span with [/voice].')
    if text[cursor:].strip():
        result.append(('text', text[cursor:].strip(), None))
    if not result:
        raise ValueError('Narration text is empty.')
    if any(kind == 'text' and re.search(r'\[/?(?:voice|pause)\b', value) for kind, value, _ in result):
        raise ValueError('Malformed narration markup.')
    return result


def effective_voice(state, identifier):
    speaker = state.get('speaker_tags', {}).get(identifier, 'Narrator')
    return state.get('cast', {}).get(speaker) or state['voice']


def voice_plan(state, identifier, text):
    default = effective_voice(state, identifier)
    return [(kind, value, state.get('cast', {}).get(voice, voice) if voice else default)
            for kind, value, voice in events(text)]


def synthesize(adapter, text, destination, voice, language, cast=None):
    """Join speech and silence as normalized PCM without speaking control tags."""
    plan = []
    for kind, value, override in events(text):
        if kind == 'pause':
            plan.append((kind, value, override))
            continue
        # Internal synthesis windows never leak into the sentence editor.
        words, chunk = value.split(), ''
        for word in words:
            if chunk and len(chunk) + len(word) + 1 > 220:
                plan.append(('text', chunk, override)); chunk = ''
            chunk = (chunk + ' ' + word).strip()
        if chunk: plan.append(('text', chunk, override))
    if len(plan) == 1 and plan[0][0] == 'text' and plan[0][2] is None:
        adapter.synthesize(plan[0][1], destination, voice, language)
        return
    with tempfile.TemporaryDirectory(prefix='pagevoice-segments-') as folder:
        with wave.open(str(destination), 'wb') as output:
            output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            for index, (kind, value, override) in enumerate(plan):
                if kind == 'pause':
                    output.writeframes(b'\0\0' * round(value * RATE))
                    continue
                raw = Path(folder) / f'{index}.raw.wav'
                normalized = Path(folder) / f'{index}.wav'
                selected = (cast or {}).get(override, override) if override else voice
                adapter.synthesize(value, raw, selected, language)
                normalize(raw, normalized)
                with wave.open(str(normalized), 'rb') as source:
                    while chunk := source.readframes(RATE * 10):
                        output.writeframes(chunk)


def detect(book):
    tags = {}
    for ci, chapter in enumerate(book['chapters']):
        for si, text in enumerate(chapter['sentences']):
            speaker = 'Narrator'
            if any(mark in text for mark in ('“', '”', '«', '»', '"')) or text.startswith(('—', '–')):
                after = re.search(r'\b' + VERB + r'\s+(' + NAME + r')\b', text)
                before = re.search(r'\b(' + NAME + r')\s+' + VERB + r'\b', text)
                speaker = (after or before)[1] if (after or before) else 'Dialogue'
            tags[f'{ci:04d}-{si:05d}'] = speaker
    return tags
