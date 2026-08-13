from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import mount_frontend


def _build_app(static_dir: Path) -> FastAPI:
    app = FastAPI()
    mount_frontend(app, static_dir)
    return app


@pytest.mark.asyncio
async def test_serves_index_html_at_root(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    transport = ASGITransport(app=_build_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/")

    assert response.status_code == 200
    assert response.text == "<html>SPA</html>"


@pytest.mark.asyncio
async def test_serves_existing_asset_file_directly(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    (tmp_path / "main-ABC123.js").write_text("console.log('hi');")
    transport = ASGITransport(app=_build_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/main-ABC123.js")

    assert response.status_code == 200
    assert response.text == "console.log('hi');"


@pytest.mark.asyncio
async def test_falls_back_to_index_html_for_unknown_spa_route(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    transport = ASGITransport(app=_build_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/reportes/infracciones")

    assert response.status_code == 200
    assert response.text == "<html>SPA</html>"


def test_does_not_mount_when_static_dir_missing(tmp_path):
    missing_dir = tmp_path / "does-not-exist"
    app = _build_app(missing_dir)

    assert not any(route.path == "/{full_path:path}" for route in app.routes)


@pytest.mark.asyncio
async def test_traversal_outside_static_dir_is_rejected(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("do not serve me")

    app = _build_app(tmp_path)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": "/../secret.txt",
        "raw_path": b"/../secret.txt",
        "query_string": b"",
        "headers": [],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
    }

    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)

    body = b"".join(
        m["body"] for m in messages if m["type"] == "http.response.body"
    )
    assert body != b"do not serve me"


@pytest.mark.asyncio
async def test_unknown_api_path_returns_404_not_index_html(tmp_path):
    (tmp_path / "index.html").write_text("<html>SPA</html>")
    transport = ASGITransport(app=_build_app(tmp_path))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/does-not-exist")

    assert response.status_code == 404
