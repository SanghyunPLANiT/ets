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
from .scenarios import build_markets_from_config, load_config


def _market_year_sort_key(market: CarbonMarket) -> tuple[float, str]:
    return expectation_sort_key(market.year)


def solve_scenario_path(
    ordered_markets: list[CarbonMarket],
    max_iterations: int = 25,
    tolerance: float = 1e-3,
) -> list[dict]:
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

    return _simulate_path_details(ordered_markets, expected_prices)


def _simulate_realized_prices(
    ordered_markets: list[CarbonMarket],
    expected_prices: dict[str, float],
) -> dict[str, float]:
    details = _simulate_path_details(ordered_markets, expected_prices)
    return {
        str(item["market"].year): float(item["equilibrium"]["price"])
        for item in details
    }


def _simulate_path_details(
    ordered_markets: list[CarbonMarket],
    expected_prices: dict[str, float],
) -> list[dict]:
    bank_balances = {
        participant.name: 0.0 for participant in ordered_markets[0].participants
    }
    carry_forward_allowances = 0.0
    details: list[dict] = []

    for market in ordered_markets:
        expected_future_price = float(expected_prices.get(str(market.year), 0.0))
        starting_bank_balances = dict(bank_balances)
        equilibrium = market.solve_equilibrium(
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
            carry_forward_in=carry_forward_allowances,
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
        scenario_summaries.append(
            market.scenario_summary(
                equilibrium_price,
                expected_future_price=expected_future_price,
                auction_outcome=equilibrium,
                participant_df=participant_df,
            )
        )
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

        if approach == "hotelling":
            discount_rate = float(getattr(ordered_markets[0], "discount_rate", 0.04) or 0.04)
            path = solve_hotelling_path(ordered_markets, discount_rate=discount_rate)
            _collect_path_results(ordered_markets, path, scenario_summaries, participant_frames)

        elif approach == "nash_cournot":
            strategic = getattr(ordered_markets[0], "nash_strategic_participants", None) or []
            path = solve_nash_path(ordered_markets, strategic_participants=strategic or None)
            _collect_path_results(ordered_markets, path, scenario_summaries, participant_frames)

        elif approach == "all":
            # Run all three approaches and label results
            discount_rate = float(getattr(ordered_markets[0], "discount_rate", 0.04) or 0.04)
            strategic = getattr(ordered_markets[0], "nash_strategic_participants", None) or []

            comp_markets = _rename_markets(ordered_markets, "Competitive")
            hot_markets  = _rename_markets(ordered_markets, "Hotelling")
            nash_markets = _rename_markets(ordered_markets, "Nash-Cournot")

            comp_path = solve_scenario_path(comp_markets)
            hot_path  = solve_hotelling_path(hot_markets, discount_rate=discount_rate)
            nash_path = solve_nash_path(nash_markets, strategic_participants=strategic or None)

            for path, mkt_list in [(comp_path, comp_markets), (hot_path, hot_markets), (nash_path, nash_markets)]:
                _collect_path_results(mkt_list, path, scenario_summaries, participant_frames)

        else:
            # Default: competitive
            path = solve_scenario_path(ordered_markets)
            _collect_path_results(ordered_markets, path, scenario_summaries, participant_frames)

    summary_df = pd.DataFrame.from_records(scenario_summaries)
    participant_df = pd.concat(participant_frames, ignore_index=True)
    return summary_df, participant_df


def run_simulation_from_config(config: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation(build_markets_from_config(config))


def run_simulation_from_file(config_path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation_from_config(load_config(config_path))
