# Backward-compatibility shim — re-exports from the participant sub-package.
from .participant import MarketParticipant, TechnologyOption, ComplianceOutcome, CostSpec

__all__ = [
    "MarketParticipant",
    "TechnologyOption",
    "ComplianceOutcome",
    "CostSpec",
]
