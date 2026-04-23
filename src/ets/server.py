from __future__ import annotations

import json
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs

from .config import FRONTEND_DIST_DIR
from .webapp import ASSET_CONTENT_TYPES, _build_dashboard_payload, _predefined_templates


def _json_response(start_response, payload: dict, status: HTTPStatus = HTTPStatus.OK):
    data = json.dumps(payload).encode("utf-8")
    start_response(
        f"{status.value} {status.phrase}",
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(data))),
        ],
    )
    return [data]


def _file_response(start_response, path: Path):
    if not path.exists() or not path.is_file():
        return _json_response(start_response, {"error": "Not found"}, HTTPStatus.NOT_FOUND)
    data = path.read_bytes()
    start_response(
        f"{HTTPStatus.OK.value} {HTTPStatus.OK.phrase}",
        [
            ("Content-Type", ASSET_CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")),
            ("Content-Length", str(len(data))),
        ],
    )
    return [data]


def _safe_path(root: Path, relative_path: str) -> Path | None:
    resolved = (root / relative_path).resolve()
    if resolved != root.resolve() and root.resolve() not in resolved.parents:
        return None
    return resolved


def app(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/") or "/"
    _ = parse_qs(environ.get("QUERY_STRING", ""))

    if method == "GET" and path == "/api/templates":
        return _json_response(start_response, {"templates": _predefined_templates()})

    if method == "POST" and path == "/api/run":
        try:
            length = int(environ.get("CONTENT_LENGTH") or "0")
        except ValueError:
            length = 0
        raw = environ["wsgi.input"].read(length) if length > 0 else b"{}"
        try:
            payload = _build_dashboard_payload(json.loads(raw.decode("utf-8")))
            return _json_response(start_response, payload)
        except Exception as exc:  # pragma: no cover - deployment path
            return _json_response(start_response, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    if method != "GET":
        return _json_response(start_response, {"error": "Method not allowed"}, HTTPStatus.METHOD_NOT_ALLOWED)

    if path == "/":
        return _file_response(start_response, FRONTEND_DIST_DIR / "index.html")

    if path.startswith("/api/"):
        return _json_response(start_response, {"error": "Not found"}, HTTPStatus.NOT_FOUND)

    safe = _safe_path(FRONTEND_DIST_DIR, path.lstrip("/"))
    if safe is None:
        return _json_response(start_response, {"error": "Forbidden"}, HTTPStatus.FORBIDDEN)
    if safe.exists() and safe.is_file():
        return _file_response(start_response, safe)
    return _file_response(start_response, FRONTEND_DIST_DIR / "index.html")

