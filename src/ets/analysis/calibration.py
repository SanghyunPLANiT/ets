"""
MACC calibration: fit abatement_cost_slope parameters to observed carbon prices.

Algorithm:
  For each candidate slope vector θ, run the full simulation, compute modelled
  equilibrium prices P_model(t), minimise MSE = Σ (P_model(t) - P_obs(t))².
  Uses scipy.optimize.minimize with method='Nelder-Mead'.

Usage:
  from ets.analysis.calibration import calibrate_slopes
  result = calibrate_slopes(base_config, observed_prices, participant_names)
"""
from __future__ import annotations
import copy
import numpy as np
from scipy.optimize import minimize
from typing import Any


def calibrate_slopes(
    base_config: dict[str, Any],
    observed_prices: dict[str, float],
    participant_names: list[str],
    initial_slopes: list[float] | None = None,
    max_iter: int = 500,
) -> dict[str, Any]:
    """
    Fit abatement_cost_slope for named participants to minimise MSE vs observed prices.

    Args:
        base_config: Full simulation config dict (scenarios[0] used).
        observed_prices: Dict of {year_str: price}, e.g. {"2026": 18.5, "2027": 22.0}.
        participant_names: Participants whose slope to calibrate (others fixed).
        initial_slopes: Starting slopes. Defaults to current values in config.
        max_iter: Nelder-Mead iteration limit.

    Returns:
        Dict with keys:
          "calibrated_slopes": {participant_name: slope},
          "final_mse": float,
          "iterations": int,
          "success": bool,
          "modelled_prices": {year_str: price}
    """
    from ..config_io.builder import build_markets_from_config
    from ..solvers.simulation import run_simulation

    scenario = base_config["scenarios"][0]
    years_order = [str(y["year"]) for y in scenario["years"]]

    obs_years = [y for y in years_order if y in observed_prices]
    obs_vals = np.array([observed_prices[y] for y in obs_years])

    # Extract initial slopes from config
    if initial_slopes is None:
        initial_slopes = []
        for name in participant_names:
            slope = 5.0
            for yr in scenario["years"]:
                for p in yr.get("participants", []):
                    if p["name"] == name and p.get("abatement_type") == "linear":
                        slope = float(p.get("abatement_cost_slope") or p.get("cost_slope") or 5.0)
                        break
            initial_slopes.append(slope)

    def _set_slopes(cfg: dict, slopes: list[float]) -> dict:
        cfg = copy.deepcopy(cfg)
        slope_map = dict(zip(participant_names, slopes))
        for yr in cfg["scenarios"][0]["years"]:
            for p in yr.get("participants", []):
                if p["name"] in slope_map and p.get("abatement_type") == "linear":
                    p["abatement_cost_slope"] = max(0.01, slope_map[p["name"]])
                    p["cost_slope"] = p["abatement_cost_slope"]
        return cfg

    def _objective(slopes: np.ndarray) -> float:
        try:
            cfg = _set_slopes(base_config, slopes.tolist())
            markets = build_markets_from_config(cfg)
            summary_df, _ = run_simulation(markets)
            year_prices: dict[str, float] = {}
            if not summary_df.empty and "Year" in summary_df.columns and "Equilibrium Carbon Price" in summary_df.columns:
                for _, row in summary_df.iterrows():
                    year_prices[str(row["Year"])] = float(row["Equilibrium Carbon Price"])
            modelled = np.array([year_prices.get(y, 0.0) for y in obs_years])
            return float(np.mean((modelled - obs_vals) ** 2))
        except Exception:
            return 1e12

    x0 = np.array(initial_slopes, dtype=float)
    xatol = float(scenario.get("solver_calibration_xatol", 0.1))
    fatol = float(scenario.get("solver_calibration_fatol", 0.01))
    result = minimize(_objective, x0, method="Nelder-Mead",
                      options={"maxiter": max_iter, "xatol": xatol, "fatol": fatol})

    final_cfg = _set_slopes(base_config, result.x.tolist())
    markets = build_markets_from_config(final_cfg)
    summary_df, _ = run_simulation(markets)
    modelled_prices: dict[str, float] = {}
    if not summary_df.empty and "Year" in summary_df.columns and "Equilibrium Carbon Price" in summary_df.columns:
        for _, row in summary_df.iterrows():
            modelled_prices[str(row["Year"])] = float(row["Equilibrium Carbon Price"])

    return {
        "calibrated_slopes": dict(zip(participant_names, result.x.tolist())),
        "final_mse": float(result.fun),
        "iterations": int(result.nit),
        "success": bool(result.success),
        "modelled_prices": modelled_prices,
        "observed_prices": observed_prices,
    }
