from __future__ import annotations

from collections import defaultdict

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


def run_simulation(markets: list[CarbonMarket]) -> tuple[pd.DataFrame, pd.DataFrame]:
    if not markets:
        raise ValueError("At least one market scenario must be provided.")

    grouped_markets: dict[str, list[CarbonMarket]] = defaultdict(list)
    for market in markets:
        grouped_markets[market.scenario_name].append(market)

    scenario_summaries: list[dict[str, float | str]] = []
    participant_frames: list[pd.DataFrame] = []

    for scenario_name, scenario_markets in grouped_markets.items():
        ordered_markets = sorted(scenario_markets, key=_market_year_sort_key)
        for item in solve_scenario_path(ordered_markets):
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

    summary_df = pd.DataFrame.from_records(scenario_summaries)
    participant_df = pd.concat(participant_frames, ignore_index=True)
    return summary_df, participant_df


def run_simulation_from_config(config: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation(build_markets_from_config(config))


def run_simulation_from_file(config_path: str | Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation_from_config(load_config(config_path))
