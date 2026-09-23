import json
import os
import platform
import shutil
import subprocess
import sys
import wave

import pytest
from filelock import FileLock

from pagevoice import pipeline
from pagevoice.storage import digest
from sample import make_sample


class CountingEngine:
    def __init__(self, fail_at=None):
        self.calls = []
        self.fail_at = fail_at

    def synthesize(self, text, destination, voice, language):
        self.calls.append(text)
        if len(self.calls) == self.fail_at:
            raise RuntimeError('engine interrupted')
        with wave.open(str(destination), 'wb') as audio:
            audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            audio.writeframes(b'\x01\x00' * (2400 + len(text)))


def manifest(session):
    return json.loads((session / 'session.json').read_text())


def snapshots(session):
    return {r['id']: (r['audio'], digest(session / r['audio']), (session / r['audio']).stat().st_mtime_ns)
            for r in manifest(session)['chunks']}


def new_session(tmp_path, monkeypatch, engine):
    monkeypatch.setattr(pipeline, 'create', lambda *args: engine)
    output = pipeline.convert(make_sample(tmp_path / 'sample.epub'), tmp_path, engine='say')
    return tmp_path / 'sessions' / output.stem


def test_resume_only_missing_corrupt_chunks(tmp_path, monkeypatch):
    engine = CountingEngine(fail_at=2)
    monkeypatch.setattr(pipeline, 'create', lambda *args: engine)
    with pytest.raises(RuntimeError):
        pipeline.convert(make_sample(tmp_path / 'sample.epub'), tmp_path, engine='say')
    session = next((tmp_path / 'sessions').iterdir())
    before = snapshots(session)
    engine.fail_at = None
    engine.calls.clear()
    pipeline.resume(session)
    assert len(engine.calls) == 3
    assert snapshots(session)['0000-00000'] == before['0000-00000']
    assert manifest(session)['last_run'] == {'reused': 1, 'synthesized': 3}
    # A malformed header must regenerate, not abort; missing files likewise.
    state = manifest(session)
    (session / state['chunks'][1]['audio']).write_bytes(b'broken')
    (session / state['chunks'][2]['audio']).unlink()
    engine.calls.clear()
    pipeline.resume(session)
    assert len(engine.calls) == 2
    assert manifest(session)['last_run'] == {'reused': 2, 'synthesized': 2}
    monkeypatch.setattr(pipeline, 'create', lambda *args: pytest.fail('No engine needed when all chunks are valid'))
    pipeline.resume(session)
    assert manifest(session)['last_run'] == {'reused': 4, 'synthesized': 0}


def test_regeneration_and_crash_durable_edit(tmp_path, monkeypatch):
    engine = CountingEngine()
    session = new_session(tmp_path, monkeypatch, engine)
    before = snapshots(session)
    engine.calls.clear()
    pipeline.regenerate(session, '0000-00001', 'Mira found a red book beside the lantern.')
    assert len(engine.calls) == 1
    after = snapshots(session)
    assert before['0000-00001'] != after['0000-00001']
    assert all(before[k] == after[k] for k in before if k != '0000-00001')
    assert manifest(session)['last_run'] == {'reused': 3, 'synthesized': 1}
    # Same-text regeneration must still replace this one take.
    engine.calls.clear()
    pipeline.regenerate(session, '0000-00001')
    assert len(engine.calls) == 1
    engine.calls.clear()
    engine.fail_at = 1
    output = session.parent.parent / 'outputs' / (session.name + '.m4b')
    old_output = digest(output)
    with pytest.raises(RuntimeError):
        pipeline.regenerate(session, '0000-00001', 'This edit must survive the failure.')
    assert digest(output) == old_output
    assert not manifest(session)['output_current']
    engine.fail_at = None
    engine.calls.clear()
    pipeline.resume(session)
    assert engine.calls == ['This edit must survive the failure.']
    assert manifest(session)['output_current']


def test_lock_and_invalid_edits(tmp_path, monkeypatch):
    session = new_session(tmp_path, monkeypatch, CountingEngine())
    before = (session / 'session.json').read_bytes()
    with FileLock(str(session / '.lock')):
        with pytest.raises(ValueError, match='already being modified'):
            pipeline.resume(session)
        with pytest.raises(ValueError, match='already being modified'):
            pipeline.regenerate(session, '0000-00000')
    for identifier, text in [('9999-99999', None), ('../bad', None), ('0000-00000', ''),
                             ('0000-00000', 'x' * 221), ('0000-00000', '[pause:2]')]:
        with pytest.raises(ValueError):
            pipeline.regenerate(session, identifier, text)
    assert (session / 'session.json').read_bytes() == before


def test_phase1_migration_and_settings_invalidation(tmp_path, monkeypatch):
    engine = CountingEngine()
    session = new_session(tmp_path, monkeypatch, engine)
    state = manifest(session)
    state['schema'] = 1
    for record in state['chunks']:
        record.pop('signature')
        record.pop('sha256')
    pipeline.save(session / 'session.json', state)
    engine.calls.clear()
    pipeline.resume(session)
    assert engine.calls == []
    state = manifest(session)
    state['voice'] = 'a different voice'
    pipeline.save(session / 'session.json', state)
    pipeline.resume(session)
    assert len(engine.calls) == 4


def test_recovery_after_assembly_failure(tmp_path, monkeypatch):
    engine = CountingEngine()
    original = pipeline.assemble
    monkeypatch.setattr(pipeline, 'assemble', lambda *args: (_ for _ in ()).throw(RuntimeError('assembly interrupted')))
    with pytest.raises(RuntimeError, match='assembly interrupted'):
        new_session(tmp_path, monkeypatch, engine)
    session = next((tmp_path / 'sessions').iterdir())
    engine.calls.clear()
    monkeypatch.setattr(pipeline, 'assemble', original)
    pipeline.resume(session)
    assert not engine.calls
    assert manifest(session)['status'] == 'complete'


@pytest.mark.smoke
@pytest.mark.skipif(platform.system() != 'Darwin' or not shutil.which('tesseract'),
                    reason='Real offline macOS speech and Tesseract')
def test_actual_process_kill_and_cli_resume(tmp_path):
    from pdf_sample import make_pdf
    source = make_pdf(tmp_path / 'mixed.pdf', scanned=True)
    cli = [sys.executable, '-c', 'from pagevoice.cli import main; raise SystemExit(main())']
    child = subprocess.Popen([*cli, 'convert', str(source), '--engine', 'say', '--data-dir', str(tmp_path)],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = []
    try:
        for line in child.stdout:
            lines.append(line)
            if '[1/' in line:
                child.kill()
                break
        child.wait(timeout=30)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
    assert child.returncode < 0, ''.join(lines)
    session = next((tmp_path / 'sessions').iterdir())
    before = snapshots(session)
    assert before
    result = subprocess.run([*cli, 'resume', str(session)], text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    after = snapshots(session)
    assert all(after[k] == v for k, v in before.items())
    assert manifest(session)['last_run']['reused'] == len(before)
    result = subprocess.run([*cli, 'regen', str(session), '0000-00001', '--text', 'The lantern shone across the water.'],
                            text=True, capture_output=True, timeout=180)
    assert result.returncode == 0, result.stderr
    assert manifest(session)['last_run']['synthesized'] == 1
    final = snapshots(session)
    assert all(final[k] == v for k, v in after.items() if k != '0000-00001')
    output = tmp_path / 'outputs' / (session.name + '.m4b')
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True, capture_output=True)
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_chapters', '-of', 'json', str(output)]))
    assert [c['tags']['title'] for c in probe['chapters']] == ['Chapter One', 'Chapter Two']


def test_checksum_detects_valid_wav_tampering(tmp_path, monkeypatch):
    engine = CountingEngine()
    session = new_session(tmp_path, monkeypatch, engine)
    record = manifest(session)['chunks'][0]
    path = session / record['audio']
    data = bytearray(path.read_bytes())
    data[-1] ^= 1
    path.write_bytes(data)
    engine.calls.clear()
    pipeline.resume(session)
    assert len(engine.calls) == 1
    assert manifest(session)['last_run'] == {'reused': 3, 'synthesized': 1}
