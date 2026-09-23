from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import uuid

from .audio import assemble, normalize
from .book import read_epub
from .engines import REGISTRY, create


def save(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def convert(source: Path, data: Path, engine='xtts', voice=None, language=None,
            output_format='m4b', device='auto', allow_network=False):
    if source.suffix.lower() != '.epub':
        raise ValueError('Phase 1 accepts EPUB only; PDF arrives in phase 2.')
    for executable in ('ffmpeg', 'ffprobe'):
        if not shutil.which(executable):
            raise ValueError(f'{executable} is required; install FFmpeg.')
    book = read_epub(source, language)
    voice = voice or REGISTRY[engine].default_voice
    for folder in ('uploads', 'voices', 'outputs', 'sessions'):
        (data / folder).mkdir(parents=True, exist_ok=True)
    identifier = uuid.uuid4().hex
    session = data / 'sessions' / identifier
    session.mkdir()
    (session / 'chunks').mkdir()
    shutil.copyfile(source, data / 'uploads' / f'{identifier}.epub')
    state = {'schema': 1, 'id': identifier, 'created': datetime.now(timezone.utc).isoformat(),
             'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
             'book': book.to_dict(), 'engine': engine, 'voice': voice, 'device': device,
             'format': output_format, 'status': 'synthesizing', 'chunks': []}
    manifest = session / 'session.json'
    save(manifest, state)
    print(f'Session: {session}', flush=True)
    try:
        adapter = create(engine, device, allow_network)
        total = sum(len(c.sentences) for c in book.chapters)
        chapter_paths = []
        for chapter_index, chapter in enumerate(book.chapters):
            paths = []
            for sentence_index, text in enumerate(chapter.sentences):
                chunk_id = f'{chapter_index:04d}-{sentence_index:05d}'
                target = session / 'chunks' / f'{chunk_id}.wav'
                raw = session / 'chunks' / (chunk_id + '.raw.wav')
                adapter.synthesize(text, raw, voice, book.language)
                normalize(raw, target)
                raw.unlink()
                paths.append(target)
                state['chunks'].append({'id': chunk_id, 'chapter': chapter_index,
                                        'sentence': sentence_index, 'text': text,
                                        'audio': str(target.relative_to(session)), 'status': 'complete'})
                save(manifest, state)
                print(f'[{len(state["chunks"])}/{total}] {chapter.title}', flush=True)
            chapter_paths.append(paths)
        state['status'] = 'assembling'
        save(manifest, state)
        output = data / 'outputs' / f'{identifier}.{output_format}'
        probe = assemble(book, chapter_paths, session, output)
        state.update(status='complete', output=str(output.resolve()), duration=probe['format']['duration'])
        save(manifest, state)
        print(f'Output: {output}\nChapters: {len(probe["chapters"])}; duration: {state["duration"]} seconds', flush=True)
        return output
    except BaseException as exc:
        state.update(status='interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed', error=str(exc))
        save(manifest, state)
        raise
