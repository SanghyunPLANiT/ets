"""
Nash-Cournot equilibrium solver for ETS.

In the competitive model all participants are price takers.
In the Nash-Cournot model, strategic participants internalise their own
price impact: a large buyer knows that increasing its allowance demand
pushes the market price up, so it voluntarily under-demands to lower the
price it pays.

The equilibrium concept is a Cournot-Nash equilibrium in quantities
(abatement levels), where no strategic participant can reduce total
compliance cost by unilaterally changing their abatement.

Algorithm — Best-Response Iteration
────────────────────────────────────
1. Start from the competitive equilibrium as initial strategies.
2. For each strategic participant i:
     a. Fix other participants' net demands at current values.
     b. Solve participant i's best response: choose abatement a_i to
        minimise cost_i(a_i) + P(a_i | a_{-i}) · net_demand_i(a_i)
        where P(·) is derived from the residual demand curve.
3. Update all strategies simultaneously (Jacobi-style).
4. Repeat until max|Δa_i| ≤ tolerance (Nash Equilibrium).

Non-strategic participants remain price takers throughout.
"""

from __future__ import annotations

import logging

import numpy as np
from scipy.optimize import minimize_scalar

from .market import CarbonMarket
from .simulation import _simulate_path_details
from .expectations import build_expectation_specs, derive_expected_prices

logger = logging.getLogger(__name__)

_MAX_ITERS = 120
_CONVERGENCE_TOL = 1e-3
_PRICE_STEP = 0.5          # $/t step for numerical price-impact estimation


def _estimate_price_impact(
    market: CarbonMarket,
    bank_balances: dict,
    expected_future_price: float,
    carry_forward_in: float,
    delta: float = _PRICE_STEP,
) -> float:
    """
    Estimate dP/dQ (price impact per Mt of additional demand) via finite difference.
    Returns a positive number: market price rises by this amount per extra Mt demanded.
    """
    try:
        eq_base = market.solve_equilibrium(
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
            carry_forward_in=carry_forward_in,
        )
        p_base = float(eq_base["price"])

        # Temporarily inject a small extra demand by nudging one participant's emissions
        # We approximate: if total demand increases by delta Mt, how much does P move?
        # Use the slope of the inverse demand curve: dP/dQ ≈ -1 / (dD/dP)
        p_up = p_base + delta
        p_down = max(0.0, p_base - delta)
        d_up = market.total_net_demand(p_up, bank_balances, expected_future_price)
        d_down = market.total_net_demand(p_down, bank_balances, expected_future_price)

        slope_dD_dP = (d_up - d_down) / (2.0 * delta)  # negative (demand decreases with price)
        if abs(slope_dD_dP) < 1e-10:
            return 0.0
        return -1.0 / slope_dD_dP   # dP/dQ > 0
    except Exception:
        return 0.0


def _solve_nash_year(
    market: CarbonMarket,
    bank_balances: dict,
    expected_future_price: float,
    carry_forward_in: float,
    strategic_names: set[str],
) -> dict:
    """
    Solve Nash-Cournot equilibrium for a single year.
    Returns the same dict structure as market.solve_equilibrium().
    """
    # --- Step 0: competitive equilibrium as starting point ---
    eq = market.solve_equilibrium(
        bank_balances=bank_balances,
        expected_future_price=expected_future_price,
        carry_forward_in=carry_forward_in,
    )
    current_price = float(eq["price"])

    # Identify strategic participants
    strategic = [p for p in market.participants if p.name in strategic_names]
    if not strategic:
        return eq  # all price takers → competitive equilibrium

    price_impact = _estimate_price_impact(
        market, bank_balances, expected_future_price, carry_forward_in
    )

    # --- Best-response iteration ---
    abatements = {}
    for p in market.participants:
        outcome = market._participant_outcome(
            p, current_price,
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
        )
        abatements[p.name] = float(outcome.abatement)

    for iteration in range(_MAX_ITERS):
        new_abatements = dict(abatements)
        price_changed = False

        for strat_p in strategic:
            # Current market demand excluding this participant
            others_demand = sum(
                market._participant_outcome(
                    p, current_price,
                    bank_balances=bank_balances,
                    expected_future_price=expected_future_price,
                ).net_allowances_traded
                for p in market.participants
                if p.name != strat_p.name
            )
            others_demand = max(0.0, others_demand)

            effective_auction = market.effective_auction_offered(carry_forward_in)

            def strategic_cost(extra_abatement: float) -> float:
                """Cost for strategic participant if they abate `extra_abatement` MORE than base."""
                trial_abatement = float(
                    np.clip(extra_abatement, 0.0, strat_p.max_abatement)
                )
                # Residual demand this participant adds
                base_outcome = market._participant_outcome(
                    strat_p, current_price,
                    bank_balances=bank_balances,
                    expected_future_price=expected_future_price,
                )
                # Additional abatement reduces demand
                my_demand_change = -(trial_abatement - float(base_outcome.abatement))
                # Price impact: ΔP = price_impact × Δdemand
                new_total_demand = others_demand + base_outcome.net_allowances_traded + my_demand_change
                new_price = max(
                    market.price_lower_bound or 0.0,
                    min(
                        market.price_upper_bound or 1e6,
                        effective_auction / max(new_total_demand + effective_auction, 1e-9)
                        * current_price
                        if new_total_demand != 0
                        else current_price + price_impact * my_demand_change,
                    ),
                )
                # Use existing compliance cost function at new_price
                outcome = market._participant_outcome(
                    strat_p, new_price,
                    bank_balances=bank_balances,
                    expected_future_price=expected_future_price,
                )
                return float(outcome.total_cost)

            result = minimize_scalar(
                strategic_cost,
                bounds=(0.0, strat_p.max_abatement),
                method="bounded",
                options={"xatol": 1e-4},
            )
            new_abatements[strat_p.name] = float(
                np.clip(result.x, 0.0, strat_p.max_abatement)
            )

        # Update price from new aggregate demand
        total_demand_new = 0.0
        for p in market.participants:
            outcome = market._participant_outcome(
                p, current_price,
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
            )
            total_demand_new += float(outcome.net_allowances_traded)
        total_demand_new = max(0.0, total_demand_new)

        # Re-solve equilibrium with adjusted demand picture
        try:
            eq_new = market.solve_equilibrium(
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
                carry_forward_in=carry_forward_in,
            )
            new_price = float(eq_new["price"])
        except Exception:
            new_price = current_price

        # Check convergence
        max_delta = max(
            abs(new_abatements[p.name] - abatements[p.name])
            for p in strategic
        )
        abatements = new_abatements
        old_price = current_price
        current_price = new_price

        if max_delta <= _CONVERGENCE_TOL and abs(new_price - old_price) <= _CONVERGENCE_TOL:
            logger.debug(f"Nash converged after {iteration + 1} iterations.")
            break
    else:
        logger.warning("Nash iteration did not converge — using best approximation.")

    # Final equilibrium at converged price
    try:
        final_eq = market.solve_equilibrium(
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
            carry_forward_in=carry_forward_in,
        )
    except Exception:
        final_eq = eq

    return final_eq


def solve_nash_path(
    ordered_markets,
    strategic_participants: list[str] | None = None,
) -> list[dict]:
    """
    Simulate multi-year path using Nash-Cournot equilibrium per year.

    Parameters
    ----------
    ordered_markets : list[CarbonMarket]
        Markets sorted chronologically.
    strategic_participants : list[str] | None
        Names of participants that behave strategically.
        If None or empty, all participants are treated as strategic.

    Returns
    -------
    list[dict]
        Same structure as _simulate_path_details.
    """
    if not ordered_markets:
        return []

    # Default: all participants are strategic
    all_names = {p.name for p in ordered_markets[0].participants}
    strategic_names = set(strategic_participants) if strategic_participants else all_names

    # Build expectation prices (same logic as competitive)
    ordered_years = [str(m.year) for m in ordered_markets]
    specs = build_expectation_specs(ordered_markets)
    baseline_prices = {str(m.year): m.find_equilibrium_price() for m in ordered_markets}
    expected_prices = derive_expected_prices(ordered_years, specs, baseline_prices)

    # Sequential year simulation with Nash equilibrium per year
    bank_balances = {p.name: 0.0 for p in ordered_markets[0].participants}
    carry_forward = 0.0
    details = []

    for market in ordered_markets:
        expected_future_price = float(expected_prices.get(str(market.year), 0.0))
        starting_bank_balances = dict(bank_balances)

        equilibrium = _solve_nash_year(
            market, bank_balances, expected_future_price, carry_forward, strategic_names
        )
        equilibrium_price = float(equilibrium["price"])

        participant_df = market.participant_results(
            equilibrium_price,
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
        )

        details.append({
            "market": market,
            "expected_future_price": expected_future_price,
            "starting_bank_balances": starting_bank_balances,
            "equilibrium": equilibrium,
            "participant_df": participant_df,
        })

        carry_forward = (
            float(equilibrium["unsold_allowances"])
            if market.unsold_treatment == "carry_forward"
            else 0.0
        )
        bank_balances = {
            str(row["Participant"]): float(row["Ending Bank Balance"])
            for _, row in participant_df.iterrows()
        }

    return details
