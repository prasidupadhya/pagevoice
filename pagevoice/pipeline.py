"""Durable session state, checksum-verified reuse, and targeted regeneration."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import logging
import re
import shutil
import uuid

from filelock import FileLock, Timeout

from .audio import assemble, normalize, frames
from .book import Book, Chapter, read_epub, clean
from .engines import REGISTRY, create
from .pdf import read_pdf
from .storage import digest, save
from .languages import language_code, default_voice
from .narration import events, synthesize, effective_voice, voice_plan


logger = logging.getLogger(__name__)


def read_book(source, language=None, ocr='auto', ocr_language=None, cache=None):
    if source.suffix.lower() == '.epub':
        return read_epub(source, language)
    if source.suffix.lower() == '.pdf':
        return read_pdf(source, language, ocr, ocr_language, cache)
    raise ValueError('Supported book formats: EPUB and PDF.')


def signature(state, identifier, text):
    settings = {k: state[k] for k in ('engine', 'voice', 'device')}
    settings.update(language=state['book']['language'], text=text,
                    revision=state.get('revisions', {}).get(identifier, 0), pipeline=3,
                    narration=voice_plan(state, identifier, text))
    return hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()


def session_book(state):
    data = dict(state['book'])
    data['chapters'] = [Chapter(**chapter) for chapter in data['chapters']]
    return Book(**data)


def chunk_path(session, record):
    path = (session / record['audio']).resolve()
    if not path.is_relative_to((session / 'chunks').resolve()):
        raise ValueError('Chunk audio path escapes the session.')
    return path


def reusable(session, record, fingerprint):
    if not record or record.get('signature') != fingerprint or record.get('status') != 'complete':
        return False
    try:
        path = chunk_path(session, record)
        frames(path)
        return digest(path) == record['sha256']
    except (OSError, ValueError, EOFError, KeyError):
        return False


def load(session):
    state = json.loads((session / 'session.json').read_text())
    if state.get('schema') not in (1, 2):
        raise ValueError('Unsupported session schema.')
    if state.get('id') != session.name:
        raise ValueError('Session folder must match its recorded ID.')
    if state.get('format') not in ('m4b', 'mp3') or state.get('engine') not in REGISTRY:
        raise ValueError('Invalid session format or engine.')
    if state['schema'] == 1:
        # Adopt validated phase 1 audio once, then use fingerprints/checksums.
        for record in state['chunks']:
            try:
                text = state['book']['chapters'][record['chapter']]['sentences'][record['sentence']]
                if text == record['text']:
                    path = chunk_path(session, record)
                    frames(path)
                    record.update(signature=signature(state, record['id'], text), sha256=digest(path))
            except (OSError, ValueError, EOFError, KeyError, IndexError):
                record['status'] = 'invalid'
        state['schema'] = 2
    state.setdefault('revisions', {})
    return state


def _execute(session, state, allow_network=False, prepare_only=False, chapter_index_only=None):
    manifest = session / 'session.json'
    output = session.parent.parent / 'outputs' / f'{state["id"]}.{state["format"]}'
    output.parent.mkdir(parents=True, exist_ok=True)
    if chapter_index_only is not None:
        output = session / 'previews' / f'chapter-{chapter_index_only}.mp3'
        output.parent.mkdir(exist_ok=True)
    was_current = state.get('output_current', False)
    reused = generated = 0
    try:
        for executable in ('ffmpeg', 'ffprobe'):
            if not shutil.which(executable):
                raise ValueError(f'{executable} is required; install FFmpeg.')
        state.pop('error', None)
        state['output_current'] = False
        if state.get('book') is None:
            state['status'] = 'parsing'
            save(manifest, state)
            source = session.parent.parent / 'uploads' / state['source_name']
            if digest(source) != state['source_sha256']:
                raise ValueError('Stored source checksum mismatch; restore the original upload.')
            options = state['parse_options']
            state['book'] = read_book(source, cache=session / 'pages', **options).to_dict()
            if state['book']['title'] == source.stem:
                state['book']['title'] = Path(state.get('original_name', source.name)).stem
        book = session_book(state)
        book.language = language_code(book.language)
        state['voice'] = state['voice'] or default_voice(state['engine'], book.language)
        if prepare_only:
            state['status'] = 'ready'
            state['output_current'] = was_current
            save(manifest, state)
            return session
        if chapter_index_only is not None and not 0 <= chapter_index_only < len(book.chapters):
            raise ValueError('Chapter does not exist.')
        state['status'] = 'synthesizing'
        save(manifest, state)
        total = sum(len(c.sentences) for c in book.chapters)
        records = {record['id']: record for record in state['chunks']}
        chapter_paths = []
        adapter = None
        if chapter_index_only is not None:
            total = len(book.chapters[chapter_index_only].sentences)
        for chapter_index, chapter in enumerate(book.chapters):
            if chapter_index_only is not None and chapter_index != chapter_index_only:
                continue
            paths = []
            for sentence_index, text in enumerate(chapter.sentences):
                identifier = f'{chapter_index:04d}-{sentence_index:05d}'
                fingerprint = signature(state, identifier, text)
                record = records.get(identifier)
                if reusable(session, record, fingerprint):
                    target = chunk_path(session, record)
                    reused += 1
                else:
                    if adapter is None:
                        adapter = create(state['engine'], state['device'], allow_network, session.parent.parent / 'voices')
                    # Unique generations ensure a crash cannot overwrite previously
                    # committed audio before the replacement record is durable.
                    generation = uuid.uuid4().hex[:12]
                    target = session / 'chunks' / f'{identifier}-{generation}.wav'
                    raw = target.with_suffix('.raw.wav')
                    synthesize(adapter, text, raw, effective_voice(state, identifier), book.language, state.get('cast'))
                    normalize(raw, target)
                    raw.unlink()
                    records[identifier] = {'id': identifier, 'chapter': chapter_index,
                        'sentence': sentence_index, 'text': text, 'audio': str(target.relative_to(session)),
                        'signature': fingerprint, 'sha256': digest(target), 'status': 'complete'}
                    state['chunks'] = list(records.values())
                    save(manifest, state)
                    generated += 1
                paths.append(target)
                logger.info('[%s/%s] %s', reused + generated, total, chapter.title)
            chapter_paths.append(paths)
        state['status'] = 'assembling'
        save(manifest, state)
        assembled_book = book if chapter_index_only is None else Book(book.title, book.author, book.language, [book.chapters[chapter_index_only]])
        probe = assemble(assembled_book, chapter_paths, session, output)
        if chapter_index_only is not None:
            state.setdefault('previews', {})[str(chapter_index_only)] = {'audio': str(output.relative_to(session)), 'sha256': digest(output)}
            state.update(status='ready', output_current=was_current, last_run={'reused': reused, 'synthesized': generated})
            save(manifest, state)
            return output
        state.update(status='complete', output=str(output.resolve()), output_current=True,
                     output_sha256=digest(output), duration=probe['format']['duration'],
                     last_run={'reused': reused, 'synthesized': generated})
        save(manifest, state)
        logger.info('Output: %s\nChapters: %s; duration: %s seconds\nReused: %s; synthesized: %s',
                    output, len(probe['chapters']), state['duration'], reused, generated)
        return output
    except BaseException as exc:
        state.update(status='interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed',
                     error=str(exc), output_current=False, last_run={'reused': reused, 'synthesized': generated})
        save(manifest, state)
        raise


def new_session(source: Path, data: Path, engine='xtts', voice=None, language=None,
            output_format='m4b', device='auto', allow_network=False, ocr='auto', ocr_language=None):
    if source.suffix.lower() not in ('.epub', '.pdf'):
        raise ValueError('Supported book formats: EPUB and PDF.')
    if output_format not in ('m4b', 'mp3') or engine not in REGISTRY:
        raise ValueError('Invalid engine or output format.')
    for folder in ('uploads', 'voices', 'outputs', 'sessions'):
        (data / folder).mkdir(parents=True, exist_ok=True)
    identifier = uuid.uuid4().hex
    session = data / 'sessions' / identifier
    session.mkdir()
    (session / 'chunks').mkdir()
    name = identifier + source.suffix.lower()
    shutil.copyfile(source, data / 'uploads' / name)
    state = {'schema': 2, 'id': identifier, 'created': datetime.now(timezone.utc).isoformat(),
             'source_sha256': digest(data / 'uploads' / name), 'source_name': name, 'original_name': source.name,
             'parse_options': {'language': language, 'ocr': ocr, 'ocr_language': ocr_language},
             'book': None, 'engine': engine, 'voice': voice,
             'device': device, 'format': output_format, 'status': 'pending', 'chunks': [], 'revisions': {}}
    with FileLock(str(session / '.lock'), timeout=0):
        save(session / 'session.json', state)
        logger.info('Session: %s', session)
        return session


def convert(source: Path, data: Path, engine='xtts', voice=None, language=None,
            output_format='m4b', device='auto', allow_network=False, ocr='auto', ocr_language=None):
    session = new_session(source, data, engine, voice, language, output_format, device, allow_network, ocr, ocr_language)
    return resume(session, allow_network)


def resume(session: Path, allow_network=False, prepare_only=False, chapter_index_only=None):
    session = session.resolve()
    if not (session / 'session.json').is_file():
        raise ValueError('Session not found; pass the session directory.')
    try:
        with FileLock(str(session / '.lock'), timeout=0):
            return _execute(session, load(session), allow_network, prepare_only, chapter_index_only)
    except Timeout as exc:
        raise ValueError('This session is already being modified by another process.') from exc


def regenerate(session: Path, identifier: str, text=None, allow_network=False, request_id=None):
    session = session.resolve()
    if not (session / 'session.json').is_file():
        raise ValueError('Session not found; pass the session directory.')
    if not re.fullmatch(r'\d{4}-\d{5}', identifier):
        raise ValueError('Use a sentence ID such as 0000-00001 (zero-based chapter/sentence).')
    try:
        with FileLock(str(session / '.lock'), timeout=0):
            state = load(session)
            if request_id and request_id in state.get('applied_requests', []):
                return _execute(session, state, allow_network)
            if not state.get('book'):
                raise ValueError('Resume parsing before regenerating a sentence.')
            chapter, sentence = map(int, identifier.split('-'))
            try:
                old = state['book']['chapters'][chapter]['sentences'][sentence]
            except IndexError as exc:
                raise ValueError('Sentence ID does not exist.') from exc
            replacement = clean(text) if text is not None else old
            if not replacement or len(replacement) > 220:
                raise ValueError('Replacement text must contain 1–220 characters.')
            events(replacement)
            state['book']['chapters'][chapter]['sentences'][sentence] = replacement
            state['revisions'][identifier] = state['revisions'].get(identifier, 0) + 1
            if request_id:
                state.setdefault('applied_requests', []).append(request_id)
            state.pop('previews', None)
            state.update(status='pending', output_current=False)
            # Persist the request before synthesis, so resume honors the edit even
            # if the process is killed while the selected sentence is rendering.
            save(session / 'session.json', state)
            return _execute(session, state, allow_network)
    except Timeout as exc:
        raise ValueError('This session is already being modified by another process.') from exc
