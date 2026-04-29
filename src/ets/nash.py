# Backward-compatibility shim — re-exports from solvers.nash.
# Logic lives in src/ets/solvers/nash.py.
from .solvers.nash import solve_nash_path

__all__ = ["solve_nash_path"]
