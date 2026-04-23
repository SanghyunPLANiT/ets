from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Union

import numpy as np
from scipy.optimize import minimize_scalar


CostSpec = Union[float, Callable[[float], float]]


@dataclass(frozen=True)
class TechnologyOption:
    name: str
    initial_emissions: float
    free_allocation_ratio: float
    penalty_price: float
    marginal_abatement_cost: CostSpec
    max_abatement_share: float = 1.0
    fixed_cost: float = 0.0

    def __post_init__(self) -> None:
        if self.initial_emissions < 0:
            raise ValueError(f"{self.name}: initial_emissions must be non-negative.")
        if not 0.0 <= self.free_allocation_ratio <= 1.0:
            raise ValueError(
                f"{self.name}: free_allocation_ratio must be between 0 and 1."
            )
        if self.penalty_price <= 0:
            raise ValueError(f"{self.name}: penalty_price must be positive.")
        if not 0.0 <= self.max_abatement_share <= 1.0:
            raise ValueError(
                f"{self.name}: max_abatement_share must be between 0 and 1."
            )
        if self.fixed_cost < 0:
            raise ValueError(f"{self.name}: fixed_cost must be non-negative.")

    @property
    def free_allocation(self) -> float:
        return self.initial_emissions * self.free_allocation_ratio

    @property
    def max_abatement(self) -> float:
        return self.initial_emissions * self.max_abatement_share


@dataclass
class ComplianceOutcome:
    abatement: float
    residual_emissions: float
    allowance_buys: float
    allowance_sells: float
    penalty_emissions: float
    abatement_cost: float
    allowance_cost: float
    penalty_cost: float
    sales_revenue: float
    fixed_cost: float
    technology_name: str
    initial_emissions: float
    free_allocation: float
    penalty_price: float
    starting_bank_balance: float
    ending_bank_balance: float
    expected_future_price: float
    banked_allowances: float
    borrowed_allowances: float
    total_cost: float

    @property
    def net_allowances_traded(self) -> float:
        return self.allowance_buys - self.allowance_sells


@dataclass
class MarketParticipant:
    """
    A heterogeneous ETS participant with optional endogenous technology choice.
    """

    name: str
    initial_emissions: float
    marginal_abatement_cost: CostSpec
    free_allocation_ratio: float
    penalty_price: float
    max_abatement_share: float = 1.0
    technology_options: list[TechnologyOption] | None = None

    def __post_init__(self) -> None:
        self._validate_state(
            self.name,
            self.initial_emissions,
            self.free_allocation_ratio,
            self.penalty_price,
            self.max_abatement_share,
        )
        if self.technology_options:
            for option in self.technology_options:
                if not isinstance(option, TechnologyOption):
                    raise ValueError(
                        f"{self.name}: technology_options must contain TechnologyOption instances."
                    )

    @staticmethod
    def _validate_state(
        label: str,
        initial_emissions: float,
        free_allocation_ratio: float,
        penalty_price: float,
        max_abatement_share: float,
    ) -> None:
        if initial_emissions < 0:
            raise ValueError(f"{label}: initial_emissions must be non-negative.")
        if not 0.0 <= free_allocation_ratio <= 1.0:
            raise ValueError(
                f"{label}: free_allocation_ratio must be between 0 and 1."
            )
        if penalty_price <= 0:
            raise ValueError(f"{label}: penalty_price must be positive.")
        if not 0.0 <= max_abatement_share <= 1.0:
            raise ValueError(
                f"{label}: max_abatement_share must be between 0 and 1."
            )

    @property
    def free_allocation(self) -> float:
        return self.initial_emissions * self.free_allocation_ratio

    @property
    def max_abatement(self) -> float:
        return self.initial_emissions * self.max_abatement_share

    def _default_technology(self) -> TechnologyOption:
        return TechnologyOption(
            name="Base Technology",
            initial_emissions=self.initial_emissions,
            free_allocation_ratio=self.free_allocation_ratio,
            penalty_price=self.penalty_price,
            marginal_abatement_cost=self.marginal_abatement_cost,
            max_abatement_share=self.max_abatement_share,
            fixed_cost=0.0,
        )

    def _available_technologies(self) -> list[TechnologyOption]:
        return self.technology_options or [self._default_technology()]

    def _abatement_cost(
        self, technology: TechnologyOption, abatement: float
    ) -> float:
        abatement = float(np.clip(abatement, 0.0, technology.max_abatement))

        if callable(technology.marginal_abatement_cost):
            cost_model = getattr(technology.marginal_abatement_cost, "cost_model", None)
            if cost_model == "linear":
                cost_slope = float(
                    getattr(technology.marginal_abatement_cost, "cost_slope")
                )
                return 0.5 * cost_slope * abatement**2
            if cost_model == "piecewise":
                blocks = getattr(technology.marginal_abatement_cost, "mac_blocks")
                remaining = abatement
                total_cost = 0.0
                for block in blocks:
                    used = min(remaining, float(block["amount"]))
                    total_cost += used * float(block["marginal_cost"])
                    remaining -= used
                    if remaining <= 0:
                        break
                return total_cost
            raise ValueError(
                f"{self.name}: unsupported callable abatement cost model for optimization."
            )

        threshold_cost = float(technology.marginal_abatement_cost)
        return threshold_cost * abatement

    def _total_compliance_cost(
        self,
        technology: TechnologyOption,
        abatement: float,
        carbon_price: float,
        starting_bank_balance: float,
        expected_future_price: float,
        banking_allowed: bool,
        borrowing_allowed: bool,
        borrowing_limit: float,
    ) -> float:
        abatement = float(np.clip(abatement, 0.0, technology.max_abatement))
        residual_emissions = technology.initial_emissions - abatement
        free_allocation = technology.free_allocation
        effective_current_price = min(carbon_price, technology.penalty_price)
        natural_balance = free_allocation + starting_bank_balance - residual_emissions

        if natural_balance >= 0.0:
            if banking_allowed and expected_future_price > carbon_price:
                ending_bank_balance = natural_balance
            else:
                ending_bank_balance = 0.0
        else:
            if borrowing_allowed and effective_current_price > expected_future_price:
                ending_bank_balance = max(-borrowing_limit, natural_balance)
            else:
                ending_bank_balance = 0.0

        shortage = max(
            0.0,
            residual_emissions + ending_bank_balance - free_allocation - starting_bank_balance,
        )
        surplus = max(
            0.0,
            free_allocation + starting_bank_balance - residual_emissions - ending_bank_balance,
        )

        if carbon_price <= technology.penalty_price:
            allowance_buys = shortage
            penalty_emissions = 0.0
        else:
            allowance_buys = 0.0
            penalty_emissions = shortage

        abatement_cost = self._abatement_cost(technology, abatement)
        allowance_cost = allowance_buys * carbon_price
        penalty_cost = penalty_emissions * technology.penalty_price
        sales_revenue = surplus * carbon_price
        return (
            technology.fixed_cost
            + abatement_cost
            + allowance_cost
            + penalty_cost
            - sales_revenue
            - expected_future_price * ending_bank_balance
        )

    def _optimize_for_technology(
        self,
        technology: TechnologyOption,
        carbon_price: float,
        starting_bank_balance: float,
        expected_future_price: float,
        banking_allowed: bool,
        borrowing_allowed: bool,
        borrowing_limit: float,
    ) -> ComplianceOutcome:
        bounded_price = max(0.0, carbon_price)
        bounded_borrowing_limit = max(0.0, borrowing_limit)

        if callable(technology.marginal_abatement_cost):
            result = minimize_scalar(
                lambda abatement: self._total_compliance_cost(
                    technology,
                    abatement,
                    bounded_price,
                    starting_bank_balance,
                    expected_future_price,
                    banking_allowed,
                    borrowing_allowed,
                    bounded_borrowing_limit,
                ),
                bounds=(0.0, technology.max_abatement),
                method="bounded",
            )
            if not result.success:
                raise RuntimeError(
                    f"{self.name}: compliance optimization failed at price {carbon_price:.2f}."
                )
            abatement = float(result.x)
        else:
            candidate_abatements = [0.0, technology.max_abatement]
            abatement = min(
                candidate_abatements,
                key=lambda value: self._total_compliance_cost(
                    technology,
                    value,
                    bounded_price,
                    starting_bank_balance,
                    expected_future_price,
                    banking_allowed,
                    borrowing_allowed,
                    bounded_borrowing_limit,
                ),
        )

        abatement = float(np.clip(abatement, 0.0, technology.max_abatement))
        residual_emissions = technology.initial_emissions - abatement
        free_allocation = technology.free_allocation
        effective_current_price = min(bounded_price, technology.penalty_price)
        natural_balance = free_allocation + starting_bank_balance - residual_emissions

        if natural_balance >= 0.0:
            if banking_allowed and expected_future_price > bounded_price:
                ending_bank_balance = natural_balance
            else:
                ending_bank_balance = 0.0
        else:
            if borrowing_allowed and effective_current_price > expected_future_price:
                ending_bank_balance = max(-bounded_borrowing_limit, natural_balance)
            else:
                ending_bank_balance = 0.0

        shortage_after_inventory = max(
            0.0,
            residual_emissions + ending_bank_balance - free_allocation - starting_bank_balance,
        )
        surplus_after_inventory = max(
            0.0,
            free_allocation + starting_bank_balance - residual_emissions - ending_bank_balance,
        )

        if bounded_price <= technology.penalty_price:
            allowance_buys = shortage_after_inventory
            penalty_emissions = 0.0
        else:
            allowance_buys = 0.0
            penalty_emissions = shortage_after_inventory
        allowance_sells = surplus_after_inventory

        abatement_cost = self._abatement_cost(technology, abatement)
        allowance_cost = allowance_buys * bounded_price
        penalty_cost = penalty_emissions * technology.penalty_price
        sales_revenue = allowance_sells * bounded_price
        total_cost = (
            technology.fixed_cost
            + abatement_cost
            + allowance_cost
            + penalty_cost
            - sales_revenue
        )

        return ComplianceOutcome(
            abatement=abatement,
            residual_emissions=residual_emissions,
            allowance_buys=allowance_buys,
            allowance_sells=allowance_sells,
            penalty_emissions=penalty_emissions,
            abatement_cost=abatement_cost,
            allowance_cost=allowance_cost,
            penalty_cost=penalty_cost,
            sales_revenue=sales_revenue,
            fixed_cost=technology.fixed_cost,
            technology_name=technology.name,
            initial_emissions=technology.initial_emissions,
            free_allocation=free_allocation,
            penalty_price=technology.penalty_price,
            starting_bank_balance=starting_bank_balance,
            ending_bank_balance=ending_bank_balance,
            expected_future_price=expected_future_price,
            banked_allowances=max(0.0, ending_bank_balance),
            borrowed_allowances=max(0.0, -ending_bank_balance),
            total_cost=total_cost,
        )

    def optimize_compliance(
        self,
        carbon_price: float,
        starting_bank_balance: float = 0.0,
        expected_future_price: float = 0.0,
        banking_allowed: bool = False,
        borrowing_allowed: bool = False,
        borrowing_limit: float = 0.0,
    ) -> ComplianceOutcome:
        candidate_outcomes = [
            self._optimize_for_technology(
                option,
                carbon_price,
                starting_bank_balance=starting_bank_balance,
                expected_future_price=expected_future_price,
                banking_allowed=banking_allowed,
                borrowing_allowed=borrowing_allowed,
                borrowing_limit=borrowing_limit,
            )
            for option in self._available_technologies()
        ]
        return min(candidate_outcomes, key=lambda outcome: outcome.total_cost)

    def abatement_amount(self, carbon_price: float, **kwargs: float) -> float:
        return self.optimize_compliance(carbon_price, **kwargs).abatement

    def residual_emissions(self, carbon_price: float, **kwargs: float) -> float:
        return self.optimize_compliance(carbon_price, **kwargs).residual_emissions

    def allowance_demand_or_supply(self, carbon_price: float, **kwargs: float) -> float:
        return self.optimize_compliance(carbon_price, **kwargs).net_allowances_traded
