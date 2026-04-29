# Backward-compatibility shim — re-exports from web.server.
# Logic lives in src/ets/web/server.py.
from .web.server import app, create_app, _json_response, _file_response, _safe_path

__all__ = ["app", "create_app", "_json_response", "_file_response", "_safe_path"]
