import json
import platform
import shutil
import subprocess
import sys
import wave
from zipfile import ZipFile

import pytest

from pagevoice.book import read_epub, sentences, member
from pagevoice.audio import escape
from pagevoice.engines import create
from sample import make_sample


def test_spine_metadata_and_cleaning(tmp_path):
    book = read_epub(make_sample(tmp_path / 'sample.epub'))
    assert book.title == 'The Quiet Harbour'
    assert book.author == 'PageVoice'
    assert [c.title for c in book.chapters] == ['Arrival', 'Morning']
    assert 'The boat reached the quiet harbour.' in ' '.join(book.chapters[0].sentences)
    assert len(book.chapters) == 2


def test_bounded_multilingual_text():
    assert sentences('Dr. Reed arrived. He smiled.', 'en') == ['Dr. Reed arrived.', 'He smiled.']
    text = '界' * 650
    pieces = sentences(text, 'zh')
    assert ''.join(pieces) == text
    assert max(map(len, pieces)) <= 220
    with pytest.raises(ValueError, match='Unsupported'):
        sentences('Hello.', 'zz')


def test_unsafe_paths_and_network():
    with pytest.raises(ValueError):
        member('Book', '../../etc/passwd')
    with pytest.raises(ValueError):
        member('Book', 'https://example.com/a')
    with pytest.raises(ValueError, match='Microsoft'):
        create('edge')
    assert escape('A=B;#\\') == 'A\\=B\\;\\#\\\\'


def test_empty_book(tmp_path):
    path = make_sample(tmp_path / 'empty.epub')
    # Rebuild archive with an empty spine.
    with ZipFile(path) as z:
        entries = {n: z.read(n) for n in z.namelist()}
    entries['Book/book.opf'] = entries['Book/book.opf'].replace(b'<itemref idref="one"/>', b'').replace(b'<itemref idref="two"/>', b'')
    with ZipFile(path, 'w') as z:
        for name, content in entries.items():
            z.writestr(name, content)
    with pytest.raises(ValueError, match='no readable'):
        read_epub(path)


@pytest.mark.smoke
@pytest.mark.skipif(platform.system() != 'Darwin' or not shutil.which('ffmpeg'), reason='Offline macOS speech smoke test')
@pytest.mark.parametrize('output_format', ['m4b', 'mp3'])
def test_real_cli_conversion(tmp_path, output_format):
    source = make_sample(tmp_path / 'sample.epub')
    result = subprocess.run([sys.executable, '-c', 'from pagevoice.cli import main; raise SystemExit(main())',
                             'convert', str(source), '--engine', 'say', '--data-dir', str(tmp_path),
                             '--format', output_format], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stderr
    output = next((tmp_path / 'outputs').glob('*.' + output_format))
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_chapters', '-show_format', '-show_streams', '-of', 'json', str(output)]))
    assert probe['format']['tags']['title'] == 'The Quiet Harbour'
    assert probe['format']['tags']['artist'] == 'PageVoice'
    assert [c['tags']['title'] for c in probe['chapters']] == ['Arrival', 'Morning']
    assert float(probe['format']['duration']) > 4
    assert probe['streams'][0]['codec_name'] == ('aac' if output_format == 'm4b' else 'mp3')
    assert float(probe['chapters'][0]['end_time']) == pytest.approx(float(probe['chapters'][1]['start_time']), abs=.002)
    manifest = json.loads(next((tmp_path / 'sessions').glob('*/session.json')).read_text())
    assert manifest['status'] == 'complete'
    assert len(manifest['chunks']) >= 4
    # Assert actual non-silent speech samples, not an empty/silent placeholder.
    chunk = next((tmp_path / 'sessions').glob('*/chunks/*.wav'))
    with wave.open(str(chunk)) as audio:
        pcm = audio.readframes(audio.getnframes())
    assert any(pcm)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True, capture_output=True)


def test_failed_engine_keeps_completed_chunks(tmp_path, monkeypatch):
    from pagevoice import pipeline
    class FailsOnSecondSentence:
        count = 0
        def synthesize(self, text, destination, voice, language):
            self.count += 1
            if self.count == 2:
                raise RuntimeError('simulated engine failure')
            with wave.open(str(destination), 'wb') as audio:
                audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
                audio.writeframes(b'\x01\x00' * 2400)
    monkeypatch.setattr(pipeline, 'create', lambda *args: FailsOnSecondSentence())
    with pytest.raises(RuntimeError, match='simulated'):
        pipeline.convert(make_sample(tmp_path / 'sample.epub'), tmp_path, engine='say')
    manifest_path = next((tmp_path / 'sessions').glob('*/session.json'))
    manifest = json.loads(manifest_path.read_text())
    assert manifest['status'] == 'failed'
    assert manifest['error'] == 'simulated engine failure'
    assert len(manifest['chunks']) == 1
    assert (manifest_path.parent / manifest['chunks'][0]['audio']).exists()
