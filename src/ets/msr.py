# Backward-compatibility shim — re-exports from solvers.msr.
# Logic lives in src/ets/solvers/msr.py.
from .solvers.msr import MSRState, MSR_DEFAULTS

__all__ = ["MSRState", "MSR_DEFAULTS"]
