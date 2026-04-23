from __future__ import annotations

import os
import tempfile
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
SRC_DIR = PROJECT_DIR / "src"
FRONTEND_DIR = PROJECT_DIR / "frontend"
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"
EXAMPLES_DIR = PROJECT_DIR / "examples"
SERVERLESS_ROOT = Path(tempfile.gettempdir()) / "ets_runtime"

if os.environ.get("VERCEL"):
    MPLCONFIG_DIR = SERVERLESS_ROOT / ".mplconfig"
else:
    MPLCONFIG_DIR = PROJECT_DIR / ".mplconfig"

os.environ.setdefault("MPLCONFIGDIR", str(MPLCONFIG_DIR))
