"""Normalize chunks and assemble chapters using exact PCM sample counts."""
from pathlib import Path
import json
import subprocess
import wave
import shutil

RATE = 24000


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {result.stderr[-3000:]}')
    return result.stdout


def normalize(source: Path, target: Path):
    temporary = target.with_suffix('.part.wav')
    # Most local engines already return our exact PCM format. Avoid a process
    # launch for every sentence while retaining full validation and atomic publish.
    try:
        frames(source)
    except (OSError, ValueError, EOFError):
        pass
    else:
        shutil.copyfile(source, temporary)
        temporary.replace(target)
        return
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-ac', '1', '-ar', str(RATE),
         '-c:a', 'pcm_s16le', str(temporary)])
    frames(temporary)
    temporary.replace(target)


def frames(path: Path) -> int:
    try:
        with wave.open(str(path), 'rb') as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, RATE):
                raise ValueError(f'Invalid normalized audio: {path}')
            expected = audio.getnframes()
            count = 0
            while data := audio.readframes(RATE * 10):
                count += len(data)
            if expected == 0 or count != expected * 2:
                raise ValueError(f'Empty or truncated audio: {path}')
            return expected
    except (wave.Error, EOFError) as exc:
        raise ValueError(f'Invalid WAV file: {path}') from exc


def escape(value: str) -> str:
    return value.replace('\\', '\\\\').replace('\n', ' ').replace('\r', ' ').replace('=', '\\=').replace(';', '\\;').replace('#', '\\#')


def assemble(book, chunks: list[list[Path]], session: Path, output: Path):
    # Stream raw PCM to avoid WAV's 4 GB header limit on long books.
    pcm = session / 'assembled.pcm'
    metadata = [';FFMETADATA1', f'title={escape(book.title)}',
                f'artist={escape(book.author)}', f'album={escape(book.title)}',
                f'language={escape(book.language)}', 'genre=Audiobook']
    cursor = 0
    with pcm.open('wb') as merged:
        for chapter, paths in zip(book.chapters, chunks):
            start = cursor
            for path in paths:
                cursor += frames(path)
                with wave.open(str(path), 'rb') as audio:
                    while data := audio.readframes(RATE * 10):
                        merged.write(data)
            metadata.extend(['[CHAPTER]', f'TIMEBASE=1/{RATE}', f'START={start}',
                             f'END={cursor}', f'title={escape(chapter.title)}'])
    meta = session / 'chapters.ffmeta'
    meta.write_text('\n'.join(metadata) + '\n', encoding='utf-8')
    temporary = session / ('encoded' + output.suffix)
    codec = ['-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'ipod'] if output.suffix == '.m4b' else ['-c:a', 'libmp3lame', '-b:a', '128k']
    run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(RATE), '-ac', '1',
         '-i', str(pcm), '-i', str(meta), '-map', '0:a:0', '-map_metadata', '1',
         '-map_chapters', '1', '-metadata:s:a:0',
         'language=' + {'en': 'eng', 'es': 'spa'}.get(book.language, book.language),
         *codec, str(temporary)])
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_format', '-show_chapters', '-of', 'json', str(temporary)]))
    if len(probe['chapters']) != len(book.chapters):
        raise RuntimeError('Encoded chapter count does not match the book.')
    # Keep the output on the same filesystem as the temporary destination.
    import shutil
    staging = output.with_name(output.name + '.part')
    shutil.copyfile(temporary, staging)
    staging.replace(output)
    pcm.unlink()
    temporary.unlink()
    return probe
