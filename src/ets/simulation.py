# Backward-compatibility shim — re-exports from solvers.simulation.
# Logic lives in src/ets/solvers/simulation.py.
from .solvers.simulation import (
    solve_scenario_path,
    run_simulation,
    run_simulation_from_config,
    run_simulation_from_file,
    _simulate_path_details,
    _simulate_realized_prices,
    _collect_path_results,
    _rename_markets,
    _market_year_sort_key,
)

__all__ = [
    "solve_scenario_path",
    "run_simulation",
    "run_simulation_from_config",
    "run_simulation_from_file",
    "_simulate_path_details",
    "_simulate_realized_prices",
    "_collect_path_results",
    "_rename_markets",
    "_market_year_sort_key",
]
