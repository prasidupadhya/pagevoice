"""Small, independent priority record: writable while synthesis owns the session."""
import json
from filelock import FileLock
from .storage import save

BUFFER_SENTENCES = 20


class PreparationPaused(Exception):
    pass


def set_priority(session, chapter):
    with FileLock(str(session / '.listening.lock'), timeout=2):
        save(session / 'listening.json', {'chapter': chapter})


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
        save(session / 'listening.json', {'chapter': priority(session), 'paused': True})


def paused(session):
    try:
        return json.loads((session / 'listening.json').read_text()).get('paused', False) is True
    except (OSError, ValueError):
        return False


def next_priority(session):
    if paused(session):
        raise PreparationPaused('Preparation paused at a sentence boundary.')
    return priority(session)
