# Backward-compatibility shim — re-exports from solvers.expectations.
# Logic lives in src/ets/solvers/expectations.py.
from .solvers.expectations import (
    ALLOWED_EXPECTATION_RULES,
    ExpectationSpec,
    expectation_sort_key,
    validate_expectation_rule,
    build_expectation_specs,
    derive_expected_prices,
)

__all__ = [
    "ALLOWED_EXPECTATION_RULES",
    "ExpectationSpec",
    "expectation_sort_key",
    "validate_expectation_rule",
    "build_expectation_specs",
    "derive_expected_prices",
]
