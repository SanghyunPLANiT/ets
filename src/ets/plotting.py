from __future__ import annotations

from pathlib import Path

from .config import MPLCONFIG_DIR

MPLCONFIG_DIR.mkdir(parents=True, exist_ok=True)

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


def market_plot_filename(scenario_name: str, year: str | None = None) -> str:
    file_stub = scenario_name.lower().replace(" ", "_")
    if year is not None:
        file_stub = f"{file_stub}_{str(year).lower().replace(' ', '_')}"
    return f"{file_stub}_market_clearing.png"


def annual_equilibrium_plot_filename(scenario_name: str) -> str:
    return f"{scenario_name.lower().replace(' ', '_')}_annual_equilibrium.png"


def plot_market_balance(
    scenario_name: str,
    participants: list,
    auction_supply: float,
    equilibrium_price: float,
    output_dir: Path,
    year: str | None = None,
    price_points: int = 250,
    bank_balances: dict[str, float] | None = None,
    expected_future_price: float = 0.0,
    banking_allowed: bool = False,
    borrowing_allowed: bool = False,
    borrowing_limit: float = 0.0,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    max_penalty = max(participant.penalty_price for participant in participants)
    max_price = max(max_penalty * 1.2, equilibrium_price * 1.5, 1.0)
    prices = np.linspace(0.0, max_price, price_points)

    total_net_demand = np.array(
        [
            sum(
                participant.allowance_demand_or_supply(price)
                if bank_balances is None
                else participant.allowance_demand_or_supply(
                    price,
                    starting_bank_balance=float(bank_balances.get(participant.name, 0.0)),
                    expected_future_price=expected_future_price,
                    banking_allowed=banking_allowed,
                    borrowing_allowed=borrowing_allowed,
                    borrowing_limit=borrowing_limit,
                )
                for participant in participants
            )
            for price in prices
        ]
    )

    fig, ax = plt.subplots(figsize=(9, 6))
    ax.plot(
        prices,
        total_net_demand,
        label="Total net participant demand",
        linewidth=2.2,
    )
    ax.axhline(
        auction_supply,
        color="tab:red",
        linestyle="--",
        linewidth=2,
        label="Auction supply entering the market",
    )
    ax.scatter(
        [equilibrium_price],
        [auction_supply],
        color="black",
        zorder=5,
        label=(
            f"Equilibrium = {equilibrium_price:.2f} $/tCO2, "
            f"{auction_supply:.0f} allowances"
        ),
    )
    title = f"Allowance Market Clearing: {scenario_name}"
    if year is not None:
        title = f"{title} ({year})"
    ax.set_title(title)
    ax.set_xlabel("Carbon price")
    ax.set_ylabel("Allowances")
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()

    file_name = market_plot_filename(scenario_name, year)
    output_path = output_dir / file_name
    fig.savefig(output_path, dpi=180)
    plt.close(fig)
    return output_path


def plot_annual_equilibrium(summary_df: pd.DataFrame, output_dir: Path) -> list[Path]:
    if summary_df.empty or "Scenario" not in summary_df.columns:
        return []

    output_dir.mkdir(parents=True, exist_ok=True)
    plot_paths: list[Path] = []

    working_summary = summary_df.copy()
    if "Year" not in working_summary.columns:
        working_summary["Year"] = "Base Year"

    for scenario_name, group in working_summary.groupby("Scenario"):
        scenario_group = group.copy()
        scenario_group["_year_numeric"] = pd.to_numeric(
            scenario_group["Year"], errors="coerce"
        )
        scenario_group = scenario_group.sort_values(
            by=["_year_numeric", "Year"], ascending=[True, True]
        )

        x_positions = np.arange(len(scenario_group))
        prices = scenario_group["Equilibrium Carbon Price"].astype(float).to_numpy()
        abatement = scenario_group["Total Abatement"].astype(float).to_numpy()
        revenue = scenario_group["Total Auction Revenue"].astype(float).to_numpy()

        fig, ax1 = plt.subplots(figsize=(7.2, 4.2))
        ax1.plot(
            x_positions,
            prices,
            color="tab:green",
            linewidth=2.4,
            marker="o",
            label="Equilibrium carbon price",
        )
        ax1.set_xticks(x_positions)
        ax1.set_xticklabels(scenario_group["Year"].astype(str).tolist())
        ax1.set_xlabel("Year")
        ax1.set_ylabel("Carbon price", color="tab:green")
        ax1.tick_params(axis="y", labelcolor="tab:green")
        ax1.grid(True, axis="y", alpha=0.25)

        ax2 = ax1.twinx()
        ax2.bar(
            x_positions - 0.18,
            abatement,
            width=0.34,
            color="tab:blue",
            alpha=0.35,
            label="Total abatement",
        )
        ax2.bar(
            x_positions + 0.18,
            revenue,
            width=0.34,
            color="tab:orange",
            alpha=0.25,
            label="Auction revenue",
        )
        ax2.set_ylabel("Abatement / revenue")

        handles_1, labels_1 = ax1.get_legend_handles_labels()
        handles_2, labels_2 = ax2.get_legend_handles_labels()
        ax1.legend(handles_1 + handles_2, labels_1 + labels_2, loc="upper left")
        ax1.set_title(f"Annual Equilibrium Path: {scenario_name}")
        fig.tight_layout()

        output_path = output_dir / annual_equilibrium_plot_filename(scenario_name)
        fig.savefig(output_path, dpi=180)
        plt.close(fig)
        plot_paths.append(output_path)

    return plot_paths
