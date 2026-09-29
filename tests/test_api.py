import time
import io
import json
import zipfile
import pytest
from fastapi.testclient import TestClient
from pagevoice.api import create_app
from pagevoice.storage import save
from pagevoice.pipeline import new_session
from sample import make_sample
from test_recovery import CountingEngine


def wait(client, identifier):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        project = client.get("/api/projects/" + identifier).json()
        if project["job"]["status"] not in ("queued", "running"):
            assert project["job"]["status"] == "complete", project
            return project
        time.sleep(0.05)
    pytest.fail("Job timed out")


def test_full_api_workflow(tmp_path, monkeypatch):
    engine = CountingEngine()
    monkeypatch.setattr("pagevoice.pipeline.create", lambda *args: engine)
    book = make_sample(tmp_path / "book.epub")
    with TestClient(create_app(tmp_path)) as client:
        response = client.post(
            "/api/projects",
            files={"file": ("book.epub", book.read_bytes(), "application/epub+zip")},
            data={"language": "en"},
        )
        assert response.status_code == 202, response.text
        identifier = response.json()["id"]
        project = wait(client, identifier)
        assert len(project["chapters"]) == 2
        assert project["status"] == "ready"
        response = client.patch(
            f"/api/projects/{identifier}/settings", json={"engine": "edge", "format": "m4b"}
        )
        assert response.status_code == 200
        assert (
            client.post(
                f"/api/projects/{identifier}/preview", json={"chapter": 0, "allow_network": True}
            ).status_code
            == 202
        )
        project = wait(client, identifier)
        assert len(engine.calls) == 2
        assert client.get(project["chapters"][0]["preview"]).headers["content-type"] == "audio/mpeg"
        assert client.get(f"/api/projects/{identifier}/download").status_code == 409
        assert (
            client.post(f"/api/projects/{identifier}/render", json={"allow_network": True}).status_code == 202
        )
        project = wait(client, identifier)
        assert len(engine.calls) == 4
        assert project["last_run"] == {"reused": 2, "synthesized": 2}
        assert client.get(project["output"]).headers["content-type"] == "audio/mp4"
        bundle = client.get(f"/api/projects/{identifier}/bundle")
        assert bundle.status_code == 200
        assert bundle.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
            assert set(archive.namelist()) == {"audio/audiobook.m4b", "chapters.json", "citations.json"}
            citations = json.loads(archive.read("citations.json"))
            assert citations[0]["text"] == "The boat reached the quiet harbour."
            assert citations[0]["source_anchor"].startswith("Book/")
        engine.calls.clear()
        assert (
            client.post(
                f"/api/projects/{identifier}/regen",
                json={"sentence_id": "0000-00001", "text": "A revised sentence.", "allow_network": True},
            ).status_code
            == 202
        )
        project = wait(client, identifier)
        assert engine.calls == ["A revised sentence."]
        assert project["chapters"][0]["sentences"][1]["text"] == "A revised sentence."
        assert client.get(project["chapters"][0]["sentences"][1]["audio"]).status_code == 200


def test_input_boundaries_and_origins(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.post("/api/projects", files={"file": ("bad.txt", b"text")}).status_code == 415
        assert client.post("/api/projects", files={"file": ("book.epub", b"")}).status_code == 400
        assert (
            client.post(
                "/api/projects", files={"file": ("book.epub", b"text")}, data={"language": "fr"}
            ).status_code
            == 422
        )
        assert client.get("/api/projects/nope").status_code == 404
        assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 403
        assert client.post("/api/projects", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/health").json()["languages"] == ["en", "es"]


def test_chapter_structure_endpoint_splits_and_merges_with_stable_source_citations(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response = client.post(
            "/api/projects",
            files={
                "file": (
                    "book.epub",
                    make_sample(tmp_path / "book.epub").read_bytes(),
                    "application/epub+zip",
                )
            },
            data={"language": "en"},
        )
        assert response.status_code == 202, response.text
        identifier = response.json()["id"]
        original = wait(client, identifier)
        split = client.post(
            f"/api/projects/{identifier}/structure", json={"action": "split", "chapter": 0, "boundary": 1}
        )
        assert split.status_code == 200, split.text
        assert len(split.json()["chapters"]) == 3
        assert split.json()["output"] is None
        merged = client.post(f"/api/projects/{identifier}/structure", json={"action": "merge", "chapter": 0})
        assert merged.status_code == 200, merged.text
        assert len(merged.json()["chapters"]) == len(original["chapters"])
        result = client.get(f"/api/projects/{identifier}/analysis", params={"q": "Mira"}).json()["results"]
        assert result and "#sentence=" in result[0]["source_anchor"]


def test_durable_queue_recovery(tmp_path, monkeypatch):
    monkeypatch.setattr("pagevoice.pipeline.create", lambda *args: CountingEngine())
    session = new_session(make_sample(tmp_path / "book.epub"), tmp_path, engine="say")
    folder = tmp_path / "jobs"
    folder.mkdir()
    job = {
        "id": "a" * 32,
        "project": session.name,
        "kind": "render",
        "status": "running",
        "created": 1,
        "options": {},
    }
    save(folder / (job["id"] + ".json"), job)
    with TestClient(create_app(tmp_path)) as client:
        project = wait(client, session.name)
        assert project["output"]
        assert project["job"]["id"] == job["id"]


def test_regen_job_replay_is_idempotent(tmp_path, monkeypatch):
    from pagevoice.pipeline import convert, regenerate

    engine = CountingEngine()
    monkeypatch.setattr("pagevoice.pipeline.create", lambda *args: engine)
    output = convert(make_sample(tmp_path / "book.epub"), tmp_path, engine="say")
    session = tmp_path / "sessions" / output.stem
    regenerate(session, "0000-00001", "Durable edit.", request_id="job123")
    engine.calls.clear()
    regenerate(session, "0000-00001", "Durable edit.", request_id="job123")
    assert not engine.calls
