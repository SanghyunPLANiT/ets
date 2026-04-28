from __future__ import annotations

from collections import defaultdict
from copy import deepcopy

import pandas as pd

from .expectations import (
    build_expectation_specs,
    derive_expected_prices,
    expectation_sort_key,
)
from .market import CarbonMarket
from .msr import MSRState
from .scenarios import build_markets_from_config, load_config


def _market_year_sort_key(market: CarbonMarket) -> tuple[float, str]:
    return expectation_sort_key(market.year)


def solve_scenario_path(
    ordered_markets: list[CarbonMarket],
    max_iterations: int | None = None,
    tolerance: float | None = None,
) -> list[dict]:
    # Use solver settings from the first market if not explicitly supplied
    if max_iterations is None:
        max_iterations = int(getattr(ordered_markets[0], "solver_competitive_max_iters", 25) or 25)
    if tolerance is None:
        tolerance = float(getattr(ordered_markets[0], "solver_competitive_tolerance", 1e-3) or 1e-3)
    if not ordered_markets:
        return []

    ordered_years = [str(market.year) for market in ordered_markets]
    baseline_prices = {
        str(market.year): market.find_equilibrium_price() for market in ordered_markets
    }
    expectation_specs = build_expectation_specs(ordered_markets)

    expected_prices = derive_expected_prices(
        ordered_years,
        expectation_specs,
        baseline_prices,
    )

    if any(spec.rule == "perfect_foresight" for spec in expectation_specs.values()):
        for _ in range(max_iterations):
            realized_prices = _simulate_realized_prices(
                ordered_markets,
                expected_prices,
            )
            updated_expected_prices = derive_expected_prices(
                ordered_years,
                expectation_specs,
                baseline_prices,
                realized_prices=realized_prices,
            )
            max_delta = max(
                abs(updated_expected_prices[year] - expected_prices.get(year, 0.0))
                for year in ordered_years
            )
            expected_prices = updated_expected_prices
            if max_delta <= tolerance:
                break

    msr_state = MSRState() if getattr(ordered_markets[0], "msr_enabled", False) else None
    return _simulate_path_details(ordered_markets, expected_prices, msr_state=msr_state)


def _simulate_realized_prices(
    ordered_markets: list[CarbonMarket],
    expected_prices: dict[str, float],
) -> dict[str, float]:
    # MSR is NOT applied in the inner convergence loop (prices only)
    details = _simulate_path_details(ordered_markets, expected_prices, msr_state=None)
    return {
        str(item["market"].year): float(item["equilibrium"]["price"])
        for item in details
    }


def _simulate_path_details(
    ordered_markets: list[CarbonMarket],
    expected_prices: dict[str, float],
    msr_state: MSRState | None = None,
) -> list[dict]:
    bank_balances = {
        participant.name: 0.0 for participant in ordered_markets[0].participants
    }
    carry_forward_allowances = 0.0
    details: list[dict] = []

    for market in ordered_markets:
        expected_future_price = float(expected_prices.get(str(market.year), 0.0))
        starting_bank_balances = dict(bank_balances)

        # ── MSR: adjust auction supply before clearing ────────────────────
        msr_withheld = 0.0
        msr_released = 0.0
        msr_pool = 0.0
        effective_carry = carry_forward_allowances

        if msr_state is not None and getattr(market, "msr_enabled", False):
            total_bank = sum(bank_balances.values())
            adj_auction, msr_withheld, msr_released = msr_state.apply(
                total_bank=total_bank,
                auction_offered=market.auction_offered,
                upper_threshold=float(getattr(market, "msr_upper_threshold", 200.0)),
                lower_threshold=float(getattr(market, "msr_lower_threshold", 50.0)),
                withhold_rate=float(getattr(market, "msr_withhold_rate", 0.12)),
                release_rate=float(getattr(market, "msr_release_rate", 50.0)),
                cancel_excess=bool(getattr(market, "msr_cancel_excess", False)),
                cancel_threshold=float(getattr(market, "msr_cancel_threshold", 400.0)),
                year_label=str(market.year),
            )
            msr_pool = msr_state.reserve_pool
            # Inject MSR adjustment as carry-forward so solve_equilibrium sees it
            # (net: released adds to supply; withheld is already subtracted via adj_auction)
            msr_net = msr_released - msr_withheld
            effective_carry = carry_forward_allowances + msr_net

        equilibrium = market.solve_equilibrium(
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
            carry_forward_in=effective_carry,
        )
        equilibrium_price = float(equilibrium["price"])
        participant_df = market.participant_results(
            equilibrium_price,
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
        )
        details.append(
            {
                "market": market,
                "expected_future_price": expected_future_price,
                "starting_bank_balances": starting_bank_balances,
                "equilibrium": equilibrium,
                "participant_df": participant_df,
                "msr_withheld": msr_withheld,
                "msr_released": msr_released,
                "msr_pool": msr_pool,
            }
        )
        carry_forward_allowances = (
            float(equilibrium["unsold_allowances"])
            if market.unsold_treatment == "carry_forward"
            else 0.0
        )
        bank_balances = {
            str(row["Participant"]): float(row["Ending Bank Balance"])
            for _, row in participant_df.iterrows()
        }

    return details


def _collect_path_results(
    ordered_markets: list[CarbonMarket],
    path_details: list[dict],
    scenario_summaries: list,
    participant_frames: list,
) -> None:
    """Append results from a solved path into the accumulator lists."""
    for item in path_details:
        market = item["market"]
        expected_future_price = item["expected_future_price"]
        equilibrium = item["equilibrium"]
        equilibrium_price = float(equilibrium["price"])
        participant_df = item["participant_df"]
        summary = market.scenario_summary(
            equilibrium_price,
            expected_future_price=expected_future_price,
            auction_outcome=equilibrium,
            participant_df=participant_df,
        )
        # Patch in MSR stats from the simulation step
        summary["MSR Withheld"] = float(item.get("msr_withheld", 0.0))
        summary["MSR Released"] = float(item.get("msr_released", 0.0))
        summary["MSR Reserve Pool"] = float(item.get("msr_pool", 0.0))
        scenario_summaries.append(summary)
        participant_frames.append(participant_df)


def _rename_markets(markets: list[CarbonMarket], suffix: str) -> list[CarbonMarket]:
    """Return shallow copies of markets with scenario_name suffixed."""
    renamed = []
    for m in markets:
        copy = deepcopy(m)
        copy.scenario_name = f"{m.scenario_name} [{suffix}]"
        renamed.append(copy)
    return renamed


def run_simulation(markets: list[CarbonMarket]) -> tuple[pd.DataFrame, pd.DataFrame]:
    if not markets:
        raise ValueError("At least one market scenario must be provided.")

    # Lazy imports to avoid circular dependency
    from .hotelling import solve_hotelling_path
    from .nash import solve_nash_path

    grouped_markets: dict[str, list[CarbonMarket]] = defaultdict(list)
    for market in markets:
        grouped_markets[market.scenario_name].append(market)

    scenario_summaries: list[dict[str, float | str]] = []
    participant_frames: list[pd.DataFrame] = []

    for scenario_name, scenario_markets in grouped_markets.items():
        ordered_markets = sorted(scenario_markets, key=_market_year_sort_key)
        approach = getattr(ordered_markets[0], "model_approach", "competitive") or "competitive"

        m0 = ordered_markets[0]

        def _hot_kwargs():
            return dict(
                discount_rate=float(getattr(m0, "discount_rate", 0.04) or 0.04),
                max_bisection_iters=int(getattr(m0, "solver_hotelling_max_bisection_iters", 80) or 80),
                max_lambda_expansions=int(getattr(m0, "solver_hotelling_max_lambda_expansions", 20) or 20),
                convergence_tol=float(getattr(m0, "solver_hotelling_convergence_tol", 1e-4) or 1e-4),
            )

        def _nash_kwargs():
            return dict(
                strategic_participants=list(getattr(m0, "nash_strategic_participants", None) or []) or None,
                price_step=float(getattr(m0, "solver_nash_price_step", 0.5) or 0.5),
                max_iters=int(getattr(m0, "solver_nash_max_iters", 120) or 120),
                convergence_tol=float(getattr(m0, "solver_nash_convergence_tol", 1e-3) or 1e-3),
            )

        if approach == "hotelling":
            path = solve_hotelling_path(ordered_markets, **_hot_kwargs())
            _collect_path_results(ordered_markets, path, scenario_summaries, participant_frames)

        elif approach == "nash_cournot":
            path = solve_nash_path(ordered_markets, **_nash_kwargs())
            _collect_path_results(ordered_markets, path, scenario_summaries, participant_frames)

        elif approach == "all":
            comp_markets = _rename_markets(ordered_markets, "Competitive")
            hot_markets  = _rename_markets(ordered_markets, "Hotelling")
            nash_markets = _rename_markets(ordered_markets, "Nash-Cournot")

            comp_path = solve_scenario_path(comp_markets)
            hot_path  = solve_hotelling_path(hot_markets, **_hot_kwargs())
            nash_path = solve_nash_path(nash_markets, **_nash_kwargs())

            for path, mkt_list in [(comp_path, comp_markets), (hot_path, hot_markets), (nash_path, nash_markets)]:
                _collect_path_results(mkt_list, path, scenario_summaries, participant_frames)

        else:
            # Default: competitive (MSR handled inside solve_scenario_path)
            path = solve_scenario_path(ordered_markets)
            _collect_path_results(ordered_markets, path, scenario_summaries, participant_frames)

    summary_df = pd.DataFrame.from_records(scenario_summaries)
    participant_df = pd.concat(participant_frames, ignore_index=True)
    return summary_df, participant_df


def run_simulation_from_config(config: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation(build_markets_from_config(config))


def run_simulation_from_file(config_path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation_from_config(load_config(config_path))
