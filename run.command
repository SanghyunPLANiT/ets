#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

if [[ "$#" -eq 0 ]]; then
  exec "$PYTHON_BIN" "$SCRIPT_DIR/ets_framework.py" --gui
fi

if [[ "$1" == "sample" ]]; then
  shift
  exec "$PYTHON_BIN" "$SCRIPT_DIR/ets_framework.py" --mode "${1:-banking}"
fi

if [[ "$1" == "samples" ]]; then
  exec "$PYTHON_BIN" "$SCRIPT_DIR/ets_framework.py" --list-modes
fi

exec "$PYTHON_BIN" "$SCRIPT_DIR/ets_framework.py" "$@"
