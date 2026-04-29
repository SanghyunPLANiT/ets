from __future__ import annotations

from typing import Any

from ..msr import MSR_DEFAULTS


def blank_config() -> dict[str, Any]:
    return {"scenarios": [blank_scenario()]}


def blank_scenario() -> dict[str, Any]:
    return {
        "name": "New Scenario",
        "model_approach": "competitive",
        "discount_rate": 0.04,
        "risk_premium": 0.0,
        "nash_strategic_participants": [],
        # ── Free-allocation phase-out trajectories ───────────────────────────
        # List of {participant_name, start_year, end_year, start_ratio, end_ratio}
        "free_allocation_trajectories": [],
        # ── Policy cap and price-bound trajectories ──────────────────────────
        # Each: {start_year, end_year, start_value, end_value} — empty dict = disabled
        "cap_trajectory": {},            # auto-declining total_cap
        "price_floor_trajectory": {},    # rising price floor (MSR / carbon floor)
        "price_ceiling_trajectory": {},  # declining/rising price ceiling
        # ── MSR settings ────────────────────────────────────────────────────
        **MSR_DEFAULTS,
        # ── Solver / model settings (all user-overridable) ──────────────────
        # Competitive perfect-foresight iteration
        "solver_competitive_max_iters": 25,
        "solver_competitive_tolerance": 0.001,
        # Hotelling bisection
        "solver_hotelling_max_bisection_iters": 80,
        "solver_hotelling_max_lambda_expansions": 20,
        "solver_hotelling_convergence_tol": 0.0001,
        # Nash best-response iteration
        "solver_nash_price_step": 0.5,
        "solver_nash_max_iters": 120,
        "solver_nash_convergence_tol": 0.001,
        # Market clearing
        "solver_penalty_price_multiplier": 1.25,
        "years": [blank_year_config()],
    }


def blank_year_config() -> dict[str, Any]:
    return {
        "year": "2030",
        "total_cap": 0.0,
        "carbon_budget": 0.0,
        "auction_mode": "explicit",
        "auction_offered": 0.0,
        "reserved_allowances": 0.0,
        "cancelled_allowances": 0.0,
        "auction_reserve_price": 0.0,
        "minimum_bid_coverage": 0.0,
        "unsold_treatment": "reserve",
        "price_lower_bound": 0.0,
        "price_upper_bound": 100.0,
        "banking_allowed": False,
        "borrowing_allowed": False,
        "borrowing_limit": 0.0,
        "expectation_rule": "next_year_baseline",
        "manual_expected_price": 0.0,
        "eua_price": 0.0,
        "eua_prices": {},           # per-jurisdiction: {"EU": 65, "UK": 50}
        "eua_price_ensemble": {},   # named trajectories: {"EC": 65, "Enerdata": 70, "BNEF": 80}
        "participants": [],
    }


def blank_participant() -> dict[str, Any]:
    return {
        "name": "New Participant",
        "initial_emissions": 0.0,
        "free_allocation_ratio": 0.0,
        "penalty_price": 0.0,
        "abatement_type": "linear",
        "max_abatement": 0.0,
        "cost_slope": 1.0,
        "threshold_cost": 0.0,
        "mac_blocks": [],
        "technology_options": [],
        "cbam_export_share": 0.0,
        "cbam_coverage_ratio": 1.0,
        "cbam_jurisdictions": [],   # [{name, export_share, coverage_ratio}] overrides single fields
        "sector_group": "",
        # Scope 2 / indirect emissions
        "electricity_consumption": 0.0,  # MWh
        "grid_emission_factor": 0.0,     # tCO2/MWh
        "scope2_cbam_coverage": 0.0,     # 0–1
    }


def blank_technology_option() -> dict[str, Any]:
    option = blank_participant()
    option["name"] = "New Technology"
    option["fixed_cost"] = 0.0
    option["max_activity_share"] = 1.0
    option.pop("technology_options", None)
    return option
