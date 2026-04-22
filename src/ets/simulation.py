from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import pandas as pd

from .config import OUTPUT_DIR
from .market import CarbonMarket
from .plotting import plot_annual_equilibrium
from .scenarios import build_markets_from_config, load_config


def _market_year_sort_key(market: CarbonMarket) -> tuple[float, str]:
    try:
        return (float(market.year), str(market.year))
    except (TypeError, ValueError):
        return (float("inf"), str(market.year))


def run_simulation(
    markets: list[CarbonMarket], output_dir: str | Path = OUTPUT_DIR, write_outputs: bool = True
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if not markets:
        raise ValueError("At least one market scenario must be provided.")

    output_path = Path(output_dir) if write_outputs else None
    if output_path is not None:
        output_path.mkdir(parents=True, exist_ok=True)

    grouped_markets: dict[str, list[CarbonMarket]] = defaultdict(list)
    for market in markets:
        grouped_markets[market.scenario_name].append(market)

    scenario_summaries: list[dict[str, float | str]] = []
    participant_frames: list[pd.DataFrame] = []

    for scenario_name, scenario_markets in grouped_markets.items():
        ordered_markets = sorted(scenario_markets, key=_market_year_sort_key)
        baseline_prices: dict[str, float] = {}
        for market in ordered_markets:
            baseline_prices[str(market.year)] = market.find_equilibrium_price()

        bank_balances = {participant.name: 0.0 for participant in ordered_markets[0].participants}
        carry_forward_allowances = 0.0

        for index, market in enumerate(ordered_markets):
            next_market = ordered_markets[index + 1] if index + 1 < len(ordered_markets) else None
            expected_future_price = 0.0
            if next_market is not None:
                expected_future_price = baseline_prices.get(str(next_market.year), 0.0)

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
            scenario_summaries.append(
                market.scenario_summary(
                    equilibrium_price,
                    bank_balances=bank_balances,
                    expected_future_price=expected_future_price,
                    auction_outcome=equilibrium,
                )
            )
            participant_frames.append(participant_df)
            if output_path is not None:
                market.plot_market_balance(
                    equilibrium_price,
                    output_path,
                    bank_balances=bank_balances,
                    expected_future_price=expected_future_price,
                    auction_supply=float(equilibrium["auction_sold"]),
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

    summary_df = pd.DataFrame.from_records(scenario_summaries)
    participant_df = pd.concat(participant_frames, ignore_index=True)

    if output_path is not None:
        summary_df.to_csv(output_path / "scenario_summary.csv", index=False)
        participant_df.to_csv(output_path / "participant_results.csv", index=False)
        plot_annual_equilibrium(summary_df, output_path)
    return summary_df, participant_df


def run_simulation_from_config(
    config: dict, output_dir: str | Path = OUTPUT_DIR, write_outputs: bool = True
) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation(build_markets_from_config(config), output_dir=output_dir, write_outputs=write_outputs)


def run_simulation_from_file(
    config_path: str | Path, output_dir: str | Path = OUTPUT_DIR, write_outputs: bool = True
) -> tuple[pd.DataFrame, pd.DataFrame]:
    return run_simulation_from_config(load_config(config_path), output_dir=output_dir, write_outputs=write_outputs)
