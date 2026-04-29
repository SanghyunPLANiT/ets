from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable, Union


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
    # CBAM exposure — single-jurisdiction shorthand (EU)
    cbam_export_share: float = 0.0    # share of activity exported to CBAM-covered markets (0–1)
    cbam_coverage_ratio: float = 1.0  # fraction of embedded emissions covered by CBAM (0–1)
    # Multi-jurisdiction CBAM — list of {name, export_share, coverage_ratio}
    # If non-empty, overrides the single-jurisdiction fields above for CBAM calculation.
    cbam_jurisdictions: list = field(default_factory=list)
    # Sector classification for grouped reporting (e.g. "Steel", "Petrochemical")
    sector_group: str = ""
    # Indirect / Scope 2 emissions — electricity-based
    # indirect_emissions = electricity_consumption × grid_emission_factor
    # scope2_cbam_coverage: fraction of indirect embedded emissions covered by CBAM (0 = not covered)
    electricity_consumption: float = 0.0   # MWh (or any consistent energy unit)
    grid_emission_factor: float = 0.0      # tCO2/MWh (grid average or marginal)
    scope2_cbam_coverage: float = 0.0      # 0–1; 0 = Scope 2 not in CBAM scope

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

    # ── Delegate methods — implementation lives in compliance.py / technology.py ──

    def _default_technology(self) -> TechnologyOption:
        from .technology import _default_technology
        return _default_technology(self)

    def _available_technologies(self) -> list[TechnologyOption]:
        from .technology import _available_technologies
        return _available_technologies(self)

    def _abatement_cost(
        self, technology: TechnologyOption, abatement: float, activity_share: float = 1.0
    ) -> float:
        from .compliance import _abatement_cost
        return _abatement_cost(self, technology, abatement, activity_share)

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
        from .compliance import _finalize_inventory
        return _finalize_inventory(
            residual_emissions=residual_emissions,
            free_allocation=free_allocation,
            carbon_price=carbon_price,
            penalty_price=penalty_price,
            starting_bank_balance=starting_bank_balance,
            expected_future_price=expected_future_price,
            banking_allowed=banking_allowed,
            borrowing_allowed=borrowing_allowed,
            borrowing_limit=borrowing_limit,
        )

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
        from .compliance import _total_compliance_cost
        return _total_compliance_cost(
            self, technology, abatement, carbon_price,
            starting_bank_balance, expected_future_price,
            banking_allowed, borrowing_allowed, borrowing_limit,
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
        from .compliance import _optimize_for_technology
        return _optimize_for_technology(
            self, technology, carbon_price,
            starting_bank_balance, expected_future_price,
            banking_allowed, borrowing_allowed, borrowing_limit,
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
        from .compliance import _optimize_mixed_technology_portfolio
        return _optimize_mixed_technology_portfolio(
            self, technologies, carbon_price,
            starting_bank_balance, expected_future_price,
            banking_allowed, borrowing_allowed, borrowing_limit,
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
        from .compliance import optimize_compliance
        return optimize_compliance(
            self, carbon_price,
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
