# Backward-compatibility shim — re-exports from solvers.hotelling.
# Logic lives in src/ets/solvers/hotelling.py.
from .solvers.hotelling import solve_hotelling_path

__all__ = ["solve_hotelling_path"]
