from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Union

import numpy as np
from scipy.optimize import minimize, minimize_scalar


CostSpec = Union[float, Callable[[float], float]]


@dataclass(frozen=True)
class TechnologyOption:
    name: str
    initial_emissions: float
    free_allocation_ratio: float
    penalty_price: float
    marginal_abatement_cost: CostSpec
    max_abatement_share: float = 1.0
    max_activity_share: float = 1.0
    fixed_cost: float = 0.0

    def __post_init__(self) -> None:
        if self.initial_emissions < 0:
            raise ValueError(f"{self.name}: initial_emissions must be non-negative.")
        if not 0.0 <= self.free_allocation_ratio <= 1.0:
            raise ValueError(
                f"{self.name}: free_allocation_ratio must be between 0 and 1."
            )
        if self.penalty_price < 0:
            raise ValueError(f"{self.name}: penalty_price must be non-negative (0 = no cap).")
        if not 0.0 <= self.max_abatement_share <= 1.0:
            raise ValueError(
                f"{self.name}: max_abatement_share must be between 0 and 1."
            )
        if not 0.0 <= self.max_activity_share <= 1.0:
            raise ValueError(
                f"{self.name}: max_activity_share must be between 0 and 1."
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
    technology_mix: tuple[tuple[str, float], ...] = ()

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
    # CBAM exposure — fraction of output subject to EU carbon border adjustment
    cbam_export_share: float = 0.0    # share of activity exported to CBAM-covered markets (0–1)
    cbam_coverage_ratio: float = 1.0  # fraction of embedded emissions covered by CBAM (0–1)

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
        if penalty_price < 0:
            raise ValueError(f"{label}: penalty_price must be non-negative (0 = no cap).")
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
            max_activity_share=1.0,
            fixed_cost=0.0,
        )

    def _available_technologies(self) -> list[TechnologyOption]:
        return self.technology_options or [self._default_technology()]

    def _abatement_cost(
        self, technology: TechnologyOption, abatement: float, activity_share: float = 1.0
    ) -> float:
        activity_share = float(np.clip(activity_share, 0.0, 1.0))
        scaled_max_abatement = technology.max_abatement * activity_share
        abatement = float(np.clip(abatement, 0.0, scaled_max_abatement))
        if activity_share <= 1e-12 or abatement <= 1e-12:
            return 0.0

        if callable(technology.marginal_abatement_cost):
            cost_model = getattr(technology.marginal_abatement_cost, "cost_model", None)
            if cost_model == "linear":
                cost_slope = float(
                    getattr(technology.marginal_abatement_cost, "cost_slope")
                )
                return 0.5 * cost_slope * abatement**2 / activity_share
            if cost_model == "piecewise":
                blocks = getattr(technology.marginal_abatement_cost, "mac_blocks")
                remaining = abatement
                total_cost = 0.0
                for block in blocks:
                    used = min(remaining, float(block["amount"]) * activity_share)
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

    def _finalize_inventory(
        self,
        *,
        residual_emissions: float,
        free_allocation: float,
        carbon_price: float,
        penalty_price: float,
        starting_bank_balance: float,
        expected_future_price: float,
        banking_allowed: bool,
        borrowing_allowed: bool,
        borrowing_limit: float,
    ) -> dict[str, float]:
        # penalty_price == 0 means "no compliance cap" — treat as infinity so the
        # participant always buys allowances at market price rather than paying a penalty
        effective_penalty = penalty_price if penalty_price > 0 else float("inf")
        effective_current_price = min(carbon_price, effective_penalty)
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
        if carbon_price <= effective_penalty:
            allowance_buys = shortage
            penalty_emissions = 0.0
        else:
            allowance_buys = 0.0
            penalty_emissions = shortage
        return {
            "ending_bank_balance": ending_bank_balance,
            "allowance_buys": allowance_buys,
            "allowance_sells": surplus,
            "penalty_emissions": penalty_emissions,
            "allowance_cost": allowance_buys * carbon_price,
            "penalty_cost": penalty_emissions * (penalty_price if penalty_price > 0 else 0.0),
            "sales_revenue": surplus * carbon_price,
            "effective_current_price": effective_current_price,
        }

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
        inventory = self._finalize_inventory(
            residual_emissions=residual_emissions,
            free_allocation=free_allocation,
            carbon_price=carbon_price,
            penalty_price=technology.penalty_price,
            starting_bank_balance=starting_bank_balance,
            expected_future_price=expected_future_price,
            banking_allowed=banking_allowed,
            borrowing_allowed=borrowing_allowed,
            borrowing_limit=borrowing_limit,
        )
        abatement_cost = self._abatement_cost(technology, abatement)
        allowance_cost = inventory["allowance_cost"]
        penalty_cost = inventory["penalty_cost"]
        sales_revenue = inventory["sales_revenue"]
        return (
            technology.fixed_cost
            + abatement_cost
            + allowance_cost
            + penalty_cost
            - sales_revenue
            - expected_future_price * inventory["ending_bank_balance"]
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
        inventory = self._finalize_inventory(
            residual_emissions=residual_emissions,
            free_allocation=free_allocation,
            carbon_price=bounded_price,
            penalty_price=technology.penalty_price,
            starting_bank_balance=starting_bank_balance,
            expected_future_price=expected_future_price,
            banking_allowed=banking_allowed,
            borrowing_allowed=borrowing_allowed,
            borrowing_limit=bounded_borrowing_limit,
        )

        abatement_cost = self._abatement_cost(technology, abatement)
        allowance_cost = inventory["allowance_cost"]
        penalty_cost = inventory["penalty_cost"]
        sales_revenue = inventory["sales_revenue"]
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
            allowance_buys=inventory["allowance_buys"],
            allowance_sells=inventory["allowance_sells"],
            penalty_emissions=inventory["penalty_emissions"],
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
            ending_bank_balance=inventory["ending_bank_balance"],
            expected_future_price=expected_future_price,
            banked_allowances=max(0.0, inventory["ending_bank_balance"]),
            borrowed_allowances=max(0.0, -inventory["ending_bank_balance"]),
            total_cost=total_cost,
            technology_mix=((technology.name, 1.0),),
        )

    def _optimize_mixed_technology_portfolio(
        self,
        technologies: list[TechnologyOption],
        carbon_price: float,
        starting_bank_balance: float,
        expected_future_price: float,
        banking_allowed: bool,
        borrowing_allowed: bool,
        borrowing_limit: float,
    ) -> ComplianceOutcome:
        tech_count = len(technologies)
        share_caps = np.array([max(0.0, option.max_activity_share) for option in technologies], dtype=float)
        if share_caps.sum() < 1.0 - 1e-9:
            raise ValueError(
                f"{self.name}: technology max_activity_share values sum to less than 1.0."
            )

        unit_profiles = [
            self._optimize_for_technology(
                option,
                carbon_price,
                starting_bank_balance=0.0,
                expected_future_price=0.0,
                banking_allowed=False,
                borrowing_allowed=False,
                borrowing_limit=0.0,
            )
            for option in technologies
        ]
        initial_shares = share_caps.copy()
        if initial_shares.sum() <= 0:
            initial_shares[:] = 1.0
        initial_shares = initial_shares / initial_shares.sum()
        x0 = initial_shares

        bounds = [(0.0, cap) for cap in share_caps]

        def aggregate_from_shares(shares: np.ndarray) -> dict[str, float]:
            residual_emissions = 0.0
            free_allocation = 0.0
            abatement_cost = 0.0
            fixed_cost = 0.0
            penalty_price = 0.0
            initial_emissions = 0.0
            total_abatement = 0.0
            for share, option, unit in zip(shares, technologies, unit_profiles):
                share = float(max(0.0, share))
                residual_emissions += unit.residual_emissions * share
                free_allocation += unit.free_allocation * share
                abatement_cost += unit.abatement_cost * share
                fixed_cost += option.fixed_cost * share
                penalty_price += option.penalty_price * share
                initial_emissions += option.initial_emissions * share
                total_abatement += unit.abatement * share
            inventory = self._finalize_inventory(
                residual_emissions=residual_emissions,
                free_allocation=free_allocation,
                carbon_price=carbon_price,
                penalty_price=max(penalty_price, self.penalty_price),
                starting_bank_balance=starting_bank_balance,
                expected_future_price=expected_future_price,
                banking_allowed=banking_allowed,
                borrowing_allowed=borrowing_allowed,
                borrowing_limit=borrowing_limit,
            )
            return {
                "residual_emissions": residual_emissions,
                "free_allocation": free_allocation,
                "abatement_cost": abatement_cost,
                "fixed_cost": fixed_cost,
                "penalty_price": max(penalty_price, self.penalty_price),
                "initial_emissions": initial_emissions,
                "total_abatement": total_abatement,
                **inventory,
            }

        def objective(vector: np.ndarray) -> float:
            shares = np.clip(vector, 0.0, share_caps)
            aggregate = aggregate_from_shares(shares)
            return (
                aggregate["fixed_cost"]
                + aggregate["abatement_cost"]
                + aggregate["allowance_cost"]
                + aggregate["penalty_cost"]
                - aggregate["sales_revenue"]
            )

        constraints = [
            {"type": "eq", "fun": lambda vector: np.sum(vector) - 1.0}
        ]

        result = minimize(
            objective,
            x0=x0,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"maxiter": 400, "ftol": 1e-9},
        )
        if not result.success:
            candidate_shares = [initial_shares]
            capped = share_caps.copy()
            if capped.sum() > 0:
                candidate_shares.append(capped / capped.sum())
            for index, cap in enumerate(share_caps):
                if cap >= 1.0 - 1e-9:
                    pure = np.zeros(tech_count)
                    pure[index] = 1.0
                    candidate_shares.append(pure)
            shares = min(candidate_shares, key=objective)
        else:
            shares = np.clip(result.x, 0.0, share_caps)
        if shares.sum() > 0:
            shares = shares / shares.sum()
        aggregate = aggregate_from_shares(shares)
        technology_mix: list[tuple[str, float]] = []
        for index, option in enumerate(technologies):
            share = float(shares[index])
            if share <= 1e-6:
                continue
            technology_mix.append((option.name, share))
        allowance_cost = aggregate["allowance_cost"]
        penalty_cost = aggregate["penalty_cost"]
        sales_revenue = aggregate["sales_revenue"]
        total_cost = (
            aggregate["fixed_cost"]
            + aggregate["abatement_cost"]
            + allowance_cost
            + penalty_cost
            - sales_revenue
        )
        if len(technology_mix) == 1 and technology_mix[0][1] >= 0.999:
            technology_name = technology_mix[0][0]
        else:
            mix_label = ", ".join(
                f"{name} {share * 100:.0f}%" for name, share in technology_mix if share >= 0.01
            )
            technology_name = f"Mixed Portfolio ({mix_label})"

        return ComplianceOutcome(
            abatement=aggregate["total_abatement"],
            residual_emissions=aggregate["residual_emissions"],
            allowance_buys=aggregate["allowance_buys"],
            allowance_sells=aggregate["allowance_sells"],
            penalty_emissions=aggregate["penalty_emissions"],
            abatement_cost=aggregate["abatement_cost"],
            allowance_cost=allowance_cost,
            penalty_cost=penalty_cost,
            sales_revenue=sales_revenue,
            fixed_cost=aggregate["fixed_cost"],
            technology_name=technology_name,
            initial_emissions=aggregate["initial_emissions"],
            free_allocation=aggregate["free_allocation"],
            penalty_price=aggregate["penalty_price"],
            starting_bank_balance=starting_bank_balance,
            ending_bank_balance=aggregate["ending_bank_balance"],
            expected_future_price=expected_future_price,
            banked_allowances=max(0.0, aggregate["ending_bank_balance"]),
            borrowed_allowances=max(0.0, -aggregate["ending_bank_balance"]),
            total_cost=total_cost,
            technology_mix=tuple(technology_mix),
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
        technologies = self._available_technologies()
        mixed_enabled = any(
            option.max_activity_share < 1.0 - 1e-9 for option in technologies
        )
        if len(technologies) == 1 or not mixed_enabled:
            return self._optimize_for_technology(
                technologies[0],
                carbon_price,
                starting_bank_balance=starting_bank_balance,
                expected_future_price=expected_future_price,
                banking_allowed=banking_allowed,
                borrowing_allowed=borrowing_allowed,
                borrowing_limit=borrowing_limit,
            ) if len(technologies) == 1 else min(
                [
                    self._optimize_for_technology(
                        option,
                        carbon_price,
                        starting_bank_balance=starting_bank_balance,
                        expected_future_price=expected_future_price,
                        banking_allowed=banking_allowed,
                        borrowing_allowed=borrowing_allowed,
                        borrowing_limit=borrowing_limit,
                    )
                    for option in technologies
                ],
                key=lambda outcome: outcome.total_cost,
            )
        return self._optimize_mixed_technology_portfolio(
            technologies,
            carbon_price,
            starting_bank_balance=starting_bank_balance,
            expected_future_price=expected_future_price,
            banking_allowed=banking_allowed,
            borrowing_allowed=borrowing_allowed,
            borrowing_limit=borrowing_limit,
        )

    def abatement_amount(self, carbon_price: float, **kwargs: float) -> float:
        return self.optimize_compliance(carbon_price, **kwargs).abatement

    def residual_emissions(self, carbon_price: float, **kwargs: float) -> float:
        return self.optimize_compliance(carbon_price, **kwargs).residual_emissions

    def allowance_demand_or_supply(self, carbon_price: float, **kwargs: float) -> float:
        return self.optimize_compliance(carbon_price, **kwargs).net_allowances_traded
