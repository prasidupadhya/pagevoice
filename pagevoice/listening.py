"""Small, independent priority record: writable while synthesis owns the session."""
import json
from filelock import FileLock
from .storage import save

BUFFER_SENTENCES = 20


class PreparationPaused(Exception):
    pass


def set_priority(session, chapter, sentence=0):
    with FileLock(str(session / '.listening.lock'), timeout=2):
        save(session / 'listening.json', {'chapter': chapter, 'sentence': sentence})


def priority(session):
    try:
        value = json.loads((session / 'listening.json').read_text())['chapter']
        return value if isinstance(value, int) and value >= 0 else 0
    except (OSError, ValueError, KeyError, TypeError):
        return 0


def chapter_order(count, start):
    start = start if 0 <= start < count else 0
    return [*range(start, count), *range(start)]


def pause(session):
    with FileLock(str(session / '.listening.lock'), timeout=2):
        save(session / 'listening.json', {'chapter': priority(session), 'sentence': sentence_priority(session), 'paused': True})


def paused(session):
    try:
        return json.loads((session / 'listening.json').read_text()).get('paused', False) is True
    except (OSError, ValueError):
        return False


def next_priority(session):
    if (session.parent.parent/'trash'/session.name/'deletion.json').exists():
        raise PreparationPaused('Project deletion requested.')
    if paused(session):
        raise PreparationPaused('Preparation paused at a sentence boundary.')
    return priority(session)


def sentence_priority(session):
    try:
        value=json.loads((session/'listening.json').read_text()).get('sentence',0)
        return value if isinstance(value,int) and value>=0 else 0
    except (OSError,ValueError,TypeError):return 0


def next_sentence(remaining,start,sentence):
    order=chapter_order(max(remaining,default=-1)+1,start)
    # Selected sentence through the final chapter, then earlier material for export.
    for ci in order:
        rows=remaining.get(ci)
        if not rows:continue
        offset=next((i for i,(si,_) in enumerate(rows) if ci!=start or si>=sentence),None)
        if offset is not None:
            rows.rotate(-offset);item=rows.popleft();rows.rotate(offset)
            return ci,item
    ci=next(ci for ci in order if remaining.get(ci))
    return ci,remaining[ci].popleft()
