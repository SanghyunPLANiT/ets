from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd
from scipy.optimize import root_scalar

from .participant import MarketParticipant


class CarbonMarket:
    def __init__(
        self,
        participants: list[MarketParticipant],
        total_cap: float,
        auction_offered: float,
        reserved_allowances: float = 0.0,
        cancelled_allowances: float = 0.0,
        auction_reserve_price: float = 0.0,
        minimum_bid_coverage: float = 0.0,
        unsold_treatment: str = "reserve",
        scenario_name: str = "Unnamed Scenario",
        year: str | None = None,
        price_lower_bound: float | None = None,
        price_upper_bound: float | None = None,
        banking_allowed: bool = False,
        borrowing_allowed: bool = False,
        borrowing_limit: float = 0.0,
        expectation_rule: str = "next_year_baseline",
        manual_expected_price: float = 0.0,
    ) -> None:
        if not participants:
            raise ValueError("CarbonMarket requires at least one participant.")
        if total_cap < 0 or auction_offered < 0 or reserved_allowances < 0 or cancelled_allowances < 0:
            raise ValueError("total_cap and allowance supply buckets must be non-negative.")

        self.participants = participants
        self.total_cap = float(total_cap)
        self.auction_offered = float(auction_offered)
        self.reserved_allowances = float(reserved_allowances)
        self.cancelled_allowances = float(cancelled_allowances)
        self.auction_reserve_price = float(auction_reserve_price)
        self.minimum_bid_coverage = float(minimum_bid_coverage)
        self.unsold_treatment = str(unsold_treatment)
        self.scenario_name = scenario_name
        self.year = year
        self.price_lower_bound = price_lower_bound
        self.price_upper_bound = price_upper_bound
        self.banking_allowed = banking_allowed
        self.borrowing_allowed = borrowing_allowed
        self.borrowing_limit = float(borrowing_limit)
        self.expectation_rule = str(expectation_rule)
        self.manual_expected_price = float(manual_expected_price)

        free_allocations = sum(participant.free_allocation for participant in participants)
        allowance_supply = (
            free_allocations
            + self.auction_offered
            + self.reserved_allowances
            + self.cancelled_allowances
        )
        self.unallocated_allowances = max(0.0, self.total_cap - allowance_supply)

        if allowance_supply - self.total_cap > 1e-9:
            raise ValueError(
                "Inconsistent cap setup: free allocations plus auctioned, reserved, and cancelled allowances "
                f"cannot exceed total_cap. Got {allowance_supply:.2f} vs {self.total_cap:.2f}."
            )

    def total_net_demand(
        self,
        carbon_price: float,
        bank_balances: dict[str, float] | None = None,
        expected_future_price: float = 0.0,
    ) -> float:
        return sum(
            self._participant_outcome(
                participant,
                carbon_price,
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
            ).net_allowances_traded
            for participant in self.participants
        )

    def effective_auction_offered(self, carry_forward_in: float = 0.0) -> float:
        return max(0.0, self.auction_offered + float(carry_forward_in))

    def solve_equilibrium(
        self,
        lower_bound: float = 0.0,
        upper_bound: float | None = None,
        bank_balances: dict[str, float] | None = None,
        expected_future_price: float = 0.0,
        carry_forward_in: float = 0.0,
    ) -> dict[str, float]:
        if lower_bound == 0.0 and self.price_lower_bound is not None:
            lower_bound = self.price_lower_bound

        if upper_bound is None:
            if self.price_upper_bound is not None:
                upper_bound = self.price_upper_bound
            else:
                max_penalty = max(
                    participant.penalty_price for participant in self.participants
                )
                upper_bound = max_penalty * 1.25

        floor_price = max(lower_bound, self.auction_reserve_price)
        offered = self.effective_auction_offered(carry_forward_in)

        def demand_at(price: float) -> float:
            return max(
                0.0,
                self.total_net_demand(
                    price,
                    bank_balances=bank_balances,
                    expected_future_price=expected_future_price,
                ),
            )

        if offered <= 0.0:
            sold = 0.0
            unsold = 0.0
            price = self._solve_for_supply(
                0.0,
                lower_bound,
                upper_bound,
                bank_balances,
                expected_future_price,
            )
            return {
                "price": price,
                "auction_offered": offered,
                "auction_sold": sold,
                "unsold_allowances": unsold,
                "coverage_ratio": 1.0,
            }

        demand_floor = demand_at(floor_price)
        if demand_floor + 1e-9 < offered:
            coverage = demand_floor / offered if offered > 0 else 1.0
            if coverage < self.minimum_bid_coverage:
                sold = 0.0
                unsold = offered
                price = self._solve_for_supply(
                    0.0,
                    lower_bound,
                    upper_bound,
                    bank_balances,
                    expected_future_price,
                )
            else:
                sold = demand_floor
                unsold = max(0.0, offered - sold)
                price = floor_price
            return {
                "price": price,
                "auction_offered": offered,
                "auction_sold": sold,
                "unsold_allowances": unsold,
                "coverage_ratio": coverage,
            }

        price = self._solve_for_supply(
            offered,
            floor_price,
            upper_bound,
            bank_balances,
            expected_future_price,
        )
        return {
            "price": price,
            "auction_offered": offered,
            "auction_sold": offered,
            "unsold_allowances": 0.0,
            "coverage_ratio": 1.0,
        }

    def _solve_for_supply(
        self,
        target_supply: float,
        lower_bound: float,
        upper_bound: float,
        bank_balances: dict[str, float] | None,
        expected_future_price: float,
    ) -> float:
        f_low = self.total_net_demand(
            lower_bound,
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
        ) - target_supply
        f_high = self.total_net_demand(
            upper_bound,
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
        ) - target_supply

        expansion_count = 0
        while f_low * f_high > 0 and expansion_count < 10:
            upper_bound *= 2.0
            f_high = self.total_net_demand(
                upper_bound,
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
            ) - target_supply
            expansion_count += 1

        if f_low * f_high > 0:
            raise RuntimeError(
                f"Could not bracket equilibrium price for {self.scenario_name}. "
                f"target_supply={target_supply:.2f}, "
                f"condition({lower_bound})={f_low:.2f}, condition({upper_bound})={f_high:.2f}"
            )

        solution = root_scalar(
            lambda carbon_price: self.total_net_demand(
                carbon_price,
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
            ) - target_supply,
            bracket=[lower_bound, upper_bound],
            method="brentq",
        )

        if not solution.converged:
            raise RuntimeError(
                f"Market clearing did not converge for {self.scenario_name}."
            )

        return float(solution.root)

    def _participant_outcome(
        self,
        participant: MarketParticipant,
        carbon_price: float,
        bank_balances: dict[str, float] | None = None,
        expected_future_price: float = 0.0,
    ):
        starting_bank_balance = 0.0
        if bank_balances is not None:
            starting_bank_balance = float(bank_balances.get(participant.name, 0.0))
        return participant.optimize_compliance(
            carbon_price,
            starting_bank_balance=starting_bank_balance,
            expected_future_price=expected_future_price,
            banking_allowed=self.banking_allowed,
            borrowing_allowed=self.borrowing_allowed,
            borrowing_limit=self.borrowing_limit,
        )

    def find_equilibrium_price(
        self,
        lower_bound: float = 0.0,
        upper_bound: float | None = None,
        bank_balances: dict[str, float] | None = None,
        expected_future_price: float = 0.0,
        carry_forward_in: float = 0.0,
    ) -> float:
        return self.solve_equilibrium(
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            bank_balances=bank_balances,
            expected_future_price=expected_future_price,
            carry_forward_in=carry_forward_in,
        )["price"]

    def calculate_auction_revenue(
        self, equilibrium_price: float, auction_sold: float | None = None
    ) -> float:
        sold = self.auction_offered if auction_sold is None else float(auction_sold)
        return equilibrium_price * sold

    def participant_results(
        self,
        equilibrium_price: float,
        bank_balances: dict[str, float] | None = None,
        expected_future_price: float = 0.0,
    ) -> pd.DataFrame:
        records: list[Dict[str, float | str]] = []
        for participant in self.participants:
            outcome = self._participant_outcome(
                participant,
                equilibrium_price,
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
            )
            record: Dict[str, float | str] = {
                "Scenario": self.scenario_name,
                "Participant": participant.name,
                "Chosen Technology": outcome.technology_name,
                "Initial Emissions": outcome.initial_emissions,
                "Free Allocation": outcome.free_allocation,
                "Abatement": outcome.abatement,
                "Residual Emissions": outcome.residual_emissions,
                "Allowance Buys": outcome.allowance_buys,
                "Allowance Sells": outcome.allowance_sells,
                "Penalty Emissions": outcome.penalty_emissions,
                "Net Allowances Traded": outcome.net_allowances_traded,
                "Starting Bank Balance": outcome.starting_bank_balance,
                "Ending Bank Balance": outcome.ending_bank_balance,
                "Banked Allowances": outcome.banked_allowances,
                "Borrowed Allowances": outcome.borrowed_allowances,
                "Expected Future Price": outcome.expected_future_price,
                "Fixed Technology Cost": outcome.fixed_cost,
                "Abatement Cost": outcome.abatement_cost,
                "Allowance Cost": outcome.allowance_cost,
                "Penalty Cost": outcome.penalty_cost,
                "Sales Revenue": outcome.sales_revenue,
                "Total Compliance Cost": outcome.total_cost,
            }
            if self.year is not None:
                record["Year"] = self.year
            records.append(record)
        return pd.DataFrame.from_records(records)

    def scenario_summary(
        self,
        equilibrium_price: float,
        bank_balances: dict[str, float] | None = None,
        expected_future_price: float = 0.0,
        auction_outcome: dict[str, float] | None = None,
        participant_df: pd.DataFrame | None = None,
    ) -> Dict[str, float | str]:
        if participant_df is None:
            participant_df = self.participant_results(
                equilibrium_price,
                bank_balances=bank_balances,
                expected_future_price=expected_future_price,
            )
        if auction_outcome is None:
            auction_outcome = {
                "auction_offered": self.auction_offered,
                "auction_sold": self.auction_offered,
                "unsold_allowances": 0.0,
                "coverage_ratio": 1.0,
            }
        summary: Dict[str, float | str] = {
            "Scenario": self.scenario_name,
            "Equilibrium Carbon Price": equilibrium_price,
            "Total Abatement": float(participant_df["Abatement"].sum()),
            "Total Allowance Buys": float(participant_df["Allowance Buys"].sum()),
            "Total Allowance Sells": float(participant_df["Allowance Sells"].sum()),
            "Total Penalty Emissions": float(
                participant_df["Penalty Emissions"].sum()
            ),
            "Total Net Allowances Traded": float(
                participant_df["Net Allowances Traded"].sum()
            ),
            "Auction Offered": float(auction_outcome["auction_offered"]),
            "Auction Sold": float(auction_outcome["auction_sold"]),
            "Unsold Allowances": float(auction_outcome["unsold_allowances"]),
            "Auction Coverage Ratio": float(auction_outcome["coverage_ratio"]),
            "Reserved Allowances": self.reserved_allowances,
            "Cancelled Allowances": self.cancelled_allowances,
            "Unallocated Allowances": self.unallocated_allowances,
            "Total Auction Revenue": self.calculate_auction_revenue(
                equilibrium_price, float(auction_outcome["auction_sold"])
            ),
            "Total Starting Bank": float(participant_df["Starting Bank Balance"].sum()),
            "Total Ending Bank": float(participant_df["Ending Bank Balance"].sum()),
            "Total Banked Allowances": float(participant_df["Banked Allowances"].sum()),
            "Total Borrowed Allowances": float(
                participant_df["Borrowed Allowances"].sum()
            ),
            "Expectation Rule": self.expectation_rule,
            "Manual Expected Price": self.manual_expected_price,
            "Total Compliance Cost": float(
                participant_df["Total Compliance Cost"].sum()
            ),
        }
        if self.year is not None:
            summary["Year"] = self.year
        for _, row in participant_df.iterrows():
            participant_name = str(row["Participant"])
            summary[f"{participant_name} Technology"] = str(row["Chosen Technology"])
            summary[f"{participant_name} Abatement"] = float(row["Abatement"])
            summary[f"{participant_name} Net Trade"] = float(
                row["Net Allowances Traded"]
            )
        return summary
