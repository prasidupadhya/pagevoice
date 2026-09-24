"""Local, immutable voice references with recorded speaker consent."""
from datetime import datetime, timezone
from pathlib import Path
import json
import re
import uuid

from .audio import run, normalize, frames, RATE
from .languages import language_code
from .storage import digest, save


def register(root, source, name, language, consent):
    if not consent:
        raise ValueError('Speaker consent is required to create a voice profile.')
    name=name.strip()
    if not name or len(name)>80:
        raise ValueError('Voice name must contain 1–80 characters.')
    language=language_code(language)
    probe=json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(source)],timeout=30))
    duration=float(probe.get('format',{}).get('duration',0))
    if not 5 <= duration <= 15 or not any(s.get('codec_type')=='audio' for s in probe['streams']):
        raise ValueError('Use a clean recording between 5 and 15 seconds long.')
    identifier=uuid.uuid4().hex
    folder=Path(root)/identifier
    folder.mkdir(parents=True)
    audio=folder/'reference.wav'
    normalize(Path(source),audio)
    duration=frames(audio)/RATE
    if not 5 <= duration <= 15:
        raise ValueError('Decoded recording must be between 5 and 15 seconds.')
    record={'id':'clone:'+identifier,'name':name,'language':language,'consent':True,
            'consent_notice':'I have permission from this speaker to clone and use their voice.',
            'created':datetime.now(timezone.utc).isoformat(),'duration':duration,'sha256':digest(audio)}
    save(folder/'voice.json',record)
    return record


def reference(root, voice):
    if not re.fullmatch(r'clone:[0-9a-f]{32}',voice):
        raise ValueError('Invalid cloned voice ID.')
    folder=Path(root)/voice[6:]
    record=json.loads((folder/'voice.json').read_text())
    audio=folder/'reference.wav'
    if record.get('consent') is not True or record.get('sha256')!=digest(audio):
        raise ValueError('Voice consent or reference checksum is invalid; create the voice profile again.')
    return audio


def catalogue(root):
    voices=[]
    for path in sorted(Path(root).glob('*/voice.json')):
        try:
            record=json.loads(path.read_text())
            reference(root,record['id'])
            voices.append(record)
        except (OSError,ValueError,KeyError):
            continue
    return voices
