"""Regression: the browser must keep working after its launch terminal disconnects."""
import os
import platform
import socket
import subprocess
import sys
import time
from pathlib import Path
import httpx
import pytest
from sample import make_sample
from test_api import wait


@pytest.mark.parametrize('engine', ['fake', pytest.param('say', marks=pytest.mark.skipif(platform.system() != 'Darwin', reason='macOS speech'))])
def test_server_with_closed_output_pipe(tmp_path, engine):
    # Pass a bound socket so the subprocess cannot race another process for a port.
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
        listener.listen()
        code = '''
import os, sys
import uvicorn
from pagevoice.api import serve
from pagevoice import pipeline
from test_recovery import CountingEngine
if sys.argv[3] == 'fake':
    pipeline.create = lambda *args: CountingEngine()
original_run = uvicorn.run
def run(*args, **kwargs):
    kwargs.update(fd=int(sys.argv[2]), log_level='warning')
    return original_run(*args, **kwargs)
uvicorn.run = run
os.environ['PAGEVOICE_DATA'] = sys.argv[1]
serve()
'''
        env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(Path.cwd()), str(Path('tests').resolve())]))
        process = subprocess.Popen([sys.executable, '-u', '-c', code, str(tmp_path), str(listener.fileno()), engine],
            pass_fds=(listener.fileno(),), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        process.stdout.close()  # Real EPIPE, not a mocked exception.
        try:
            with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=10) as client:
                deadline = time.monotonic() + 15
                while True:
                    try:
                        if client.get('/api/health').status_code == 200: break
                    except httpx.TransportError:
                        pass
                    if time.monotonic() > deadline: pytest.fail('Server did not start')
                    time.sleep(.05)
                source = make_sample(tmp_path / 'book.epub')
                response = client.post('/api/projects', files={'file':('book.epub',source.read_bytes(),'application/epub+zip')})
                assert response.status_code == 202, response.text
                project = response.json()['id']
                wait(client, project)
                base = f'/api/projects/{project}'
                assert client.patch(base + '/settings', json={'engine':'say'}).status_code == 200
                # Exercise both deterministic fake audio and actual system speech.
                assert client.post(base + '/preview', json={'chapter':0}).status_code == 202
                preview = wait(client, project)
                assert client.get(preview['chapters'][0]['preview']).status_code == 200
                assert client.post(base + '/render', json={}).status_code == 202
                rendered = wait(client, project)
                assert client.get(rendered['output']).status_code == 200
                assert client.post(base + '/regen', json={'sentence_id':'0000-00001','text':'A corrected sentence.'}).status_code == 202
                edited = wait(client, project)
                assert edited['last_run'] == {'reused':3,'synthesized':1}
                # Leave SSE open while stopping the actual production entry point.
                # Shutdown must be bounded even while a browser is connected.
                with client.stream('GET', base + '/events') as stream:
                    lines = stream.iter_lines()
                    assert next(lines) == 'event: progress'
                    process.terminate()
                    process.wait(timeout=12)
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
