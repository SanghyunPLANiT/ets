# Backward-compatibility shim — re-exports from web.handlers.
# Logic lives in src/ets/web/handlers.py.
from .web.handlers import (
    ASSET_CONTENT_TYPES,
    ETSRequestHandler,
    launch_web_app,
    build_analysis,
    _predefined_templates,
    _decorate_frontend_config,
    _build_dashboard_payload,
    _save_user_scenario,
    _slugify_filename,
    _lookup_sector,
    _json_safe,
    _WarningCollector,
)

__all__ = [
    "ASSET_CONTENT_TYPES",
    "ETSRequestHandler",
    "launch_web_app",
    "build_analysis",
    "_predefined_templates",
    "_decorate_frontend_config",
    "_build_dashboard_payload",
    "_save_user_scenario",
    "_slugify_filename",
    "_lookup_sector",
    "_json_safe",
    "_WarningCollector",
]
