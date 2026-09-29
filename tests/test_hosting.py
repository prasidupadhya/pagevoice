import zipfile
import pytest
from fastapi.testclient import TestClient
from pagevoice.api import create_app
from pagevoice.config import Config
from pagevoice.security import media_url
from sample import make_sample

TOKEN = "x" * 40


def hosted(monkeypatch, **extra):
    for key, value in {
        "PAGEVOICE_HOSTED": "1",
        "PAGEVOICE_ACCESS_TOKEN": TOKEN,
        "PAGEVOICE_ALLOWED_HOSTS": "books.example",
        "PAGEVOICE_ALLOWED_ORIGINS": "https://reader.example",
        **extra,
    }.items():
        monkeypatch.setenv(key, value)


def test_hosted_fails_closed(monkeypatch):
    monkeypatch.setenv("PAGEVOICE_HOSTED", "1")
    with pytest.raises(ValueError):
        Config()
    hosted(monkeypatch, PAGEVOICE_ALLOWED_ORIGINS="https://*.example")
    with pytest.raises(ValueError):
        Config()


def test_auth_cors_hosts_and_media_capabilities(tmp_path, monkeypatch):
    hosted(monkeypatch)
    with TestClient(create_app(tmp_path), base_url="https://books.example") as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/projects").status_code == 401
        assert client.get("/api/projects", headers=[(b"Authorization", b"Bearer \xff")]).status_code == 401
        headers = {"Authorization": "Bearer " + TOKEN, "Origin": "https://reader.example"}
        response = client.get("/api/projects", headers=headers)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "https://reader.example"
        assert response.headers["cache-control"] == "no-store"
        assert (
            client.get("/api/projects", headers={**headers, "Origin": "https://evil.example"}).status_code
            == 403
        )
        assert client.get("/api/projects", headers={**headers, "Host": "evil.example"}).status_code == 403
        assert (
            client.options(
                "/api/projects",
                headers={"Origin": "https://reader.example", "Access-Control-Request-Method": "POST"},
            ).status_code
            == 200
        )
        path = "/api/projects/" + "a" * 32 + "/download"
        signed = media_url(path, client.app.state.config)
        assert client.get(signed).status_code == 404  # Auth accepted; no such project.
        bundle = media_url(path.replace("/download", "/bundle"), client.app.state.config)
        assert client.get(bundle).status_code == 404  # Bundle route accepts the same scoped capability.
        assert client.get(signed.replace("/download", "/settings")).status_code == 401
        assert client.delete(signed).status_code == 401
        assert client.get(signed + "&unused=ok").status_code == 404
        assert (
            client.get(signed.replace("expires=", "expires=0")).status_code == 404
        )  # Integer representation does not change capability.
        assert client.get(signed[:-1] + "z").status_code == 401
        assert client.get("/api/projects?access_token=" + TOKEN).status_code == 401
        assert (
            client.post(
                "/api/projects", headers={**headers, "Content-Length": str(102 * 1024**2)}
            ).status_code
            == 413
        )


def test_rate_limit_ignores_spoofed_forwarded_for(tmp_path, monkeypatch):
    hosted(monkeypatch, PAGEVOICE_RATE_LIMIT="2")
    with TestClient(create_app(tmp_path), base_url="https://books.example") as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health", headers={"X-Forwarded-For": "1.2.3.4"}).status_code == 429


def test_upload_validation_quota_and_isolation(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path / "one")) as a, TestClient(create_app(tmp_path / "two")) as b:
        assert a.post("/api/projects", files={"file": ("fake.pdf", b"no PDF")}).status_code == 400
        assert a.post("/api/projects", files={"file": ("fake.epub", b"no ZIP")}).status_code == 400
        book = make_sample(tmp_path / "book.epub")
        monkeypatch.setenv("PAGEVOICE_DISK_QUOTA_MB", "1")
        response = a.post("/api/projects", files={"file": ("book.epub", book.read_bytes())})
        assert response.status_code == 507
        assert "Storage quota reached" in response.text
        assert b.get("/api/projects").json() == []
        assert a.get("/api/projects").json() == []


def test_epub_bomb_and_traversal_rejected(tmp_path):
    from pagevoice.uploads import validate_upload

    for name, content in [("huge.txt", b"a" * 2 * 1024**2), ("../escape", b"x")]:
        path = tmp_path / "bad.epub"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("mimetype", "application/epub+zip")
            z.writestr("META-INF/container.xml", "x")
            z.writestr(name, content)
        with pytest.raises(ValueError):
            validate_upload(path)


def test_epub_entry_limit_is_enforced_before_parsing(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from pagevoice.book import read_epub

    class Archive:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def infolist(self):
            return [SimpleNamespace(file_size=0)] * 50001

    monkeypatch.setattr("pagevoice.book.zipfile.ZipFile", lambda _path: Archive())
    with pytest.raises(ValueError, match="50,000-entry"):
        read_epub(tmp_path / "too-many-entries.epub")
