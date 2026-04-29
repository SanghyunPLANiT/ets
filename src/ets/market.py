# Backward-compatibility shim — re-exports from the market sub-package.
# Note: Python resolves 'market' to the market/ package when both exist.
from .market import CarbonMarket

__all__ = ["CarbonMarket"]
