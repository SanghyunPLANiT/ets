from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from .costs import linear_abatement_factory, piecewise_abatement_factory
from .expectations import ALLOWED_EXPECTATION_RULES, validate_expectation_rule
from .market import CarbonMarket
from .participant import MarketParticipant, TechnologyOption

ALLOWED_AUCTION_MODES = {"explicit", "derive_from_cap"}
ALLOWED_ABATEMENT_TYPES = {"linear", "threshold", "piecewise"}


def blank_config() -> dict[str, Any]:
    return {"scenarios": [blank_scenario()]}


def blank_scenario() -> dict[str, Any]:
    return {
        "name": "New Scenario",
        "years": [blank_year_config()],
    }


def blank_year_config() -> dict[str, Any]:
    return {
        "year": "2030",
        "total_cap": 0.0,
        "auction_mode": "explicit",
        "auction_offered": 0.0,
        "reserved_allowances": 0.0,
        "cancelled_allowances": 0.0,
        "auction_reserve_price": 0.0,
        "minimum_bid_coverage": 0.0,
        "unsold_treatment": "reserve",
        "price_lower_bound": 0.0,
        "price_upper_bound": 100.0,
        "banking_allowed": False,
        "borrowing_allowed": False,
        "borrowing_limit": 0.0,
        "expectation_rule": "next_year_baseline",
        "manual_expected_price": 0.0,
        "participants": [],
    }


def blank_participant() -> dict[str, Any]:
    return {
        "name": "New Participant",
        "initial_emissions": 0.0,
        "free_allocation_ratio": 0.0,
        "penalty_price": 0.0,
        "abatement_type": "linear",
        "max_abatement": 0.0,
        "cost_slope": 1.0,
        "threshold_cost": 0.0,
        "mac_blocks": [],
        "technology_options": [],
    }


def blank_technology_option() -> dict[str, Any]:
    option = blank_participant()
    option["name"] = "New Technology"
    option["fixed_cost"] = 0.0
    option.pop("technology_options", None)
    return option


def load_config(config_path: str | Path) -> dict[str, Any]:
    path = Path(config_path)
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return normalize_config(deepcopy(data))


def save_config(config: dict[str, Any], config_path: str | Path) -> None:
    path = Path(config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = normalize_config(deepcopy(config))
    with path.open("w", encoding="utf-8") as handle:
        json.dump(normalized, handle, indent=2)


def normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    scenarios = config.get("scenarios")
    if not isinstance(scenarios, list):
        raise ValueError("Config must contain a 'scenarios' list.")
    return {"scenarios": [normalize_scenario(scenario) for scenario in scenarios]}


def normalize_scenario(raw_scenario: dict[str, Any]) -> dict[str, Any]:
    scenario = blank_scenario()
    scenario.update(raw_scenario)
    scenario["name"] = str(scenario["name"]).strip()
    if not scenario["name"]:
        raise ValueError("Each scenario must have a non-empty name.")

    years = scenario.get("years")
    if years is None:
        years = [_legacy_scenario_to_year(raw_scenario)]
    if not isinstance(years, list) or not years:
        raise ValueError(
            f"Scenario '{scenario['name']}' must contain a non-empty 'years' list."
        )

    scenario["years"] = [normalize_year(item) for item in years]
    return {"name": scenario["name"], "years": scenario["years"]}


def _legacy_scenario_to_year(raw_scenario: dict[str, Any]) -> dict[str, Any]:
    legacy_year = blank_year_config()
    for field in legacy_year:
        if field in raw_scenario:
            legacy_year[field] = raw_scenario[field]
    legacy_year["participants"] = raw_scenario.get("participants", [])
    legacy_year["year"] = str(raw_scenario.get("year", "Base Year"))
    return legacy_year


def normalize_year(raw_year: dict[str, Any]) -> dict[str, Any]:
    year_config = blank_year_config()
    year_config.update(raw_year)

    year_config["year"] = str(year_config["year"]).strip()
    if not year_config["year"]:
        raise ValueError("Each yearly configuration must have a non-empty year label.")

    year_config["total_cap"] = float(year_config["total_cap"])
    year_config["auction_mode"] = str(year_config["auction_mode"]).strip()
    if "auction_offered" not in year_config and "auctioned_allowances" in raw_year:
        year_config["auction_offered"] = raw_year["auctioned_allowances"]
    year_config["auction_offered"] = float(
        year_config.get("auction_offered", 0.0)
    )
    year_config["reserved_allowances"] = float(
        year_config.get("reserved_allowances", 0.0)
    )
    year_config["cancelled_allowances"] = float(
        year_config.get("cancelled_allowances", 0.0)
    )
    year_config["auction_reserve_price"] = float(
        year_config.get("auction_reserve_price", 0.0)
    )
    year_config["minimum_bid_coverage"] = float(
        year_config.get("minimum_bid_coverage", 0.0)
    )
    year_config["unsold_treatment"] = str(
        year_config.get("unsold_treatment", "reserve")
    ).strip()
    year_config["price_lower_bound"] = float(year_config["price_lower_bound"])
    year_config["price_upper_bound"] = float(year_config["price_upper_bound"])
    year_config["banking_allowed"] = bool(year_config.get("banking_allowed", False))
    year_config["borrowing_allowed"] = bool(
        year_config.get("borrowing_allowed", False)
    )
    year_config["borrowing_limit"] = float(year_config.get("borrowing_limit", 0.0))
    year_config["expectation_rule"] = validate_expectation_rule(
        year_config.get("expectation_rule", "next_year_baseline"),
        year_config["year"],
    )
    year_config["manual_expected_price"] = float(
        year_config.get("manual_expected_price", 0.0)
    )

    if year_config["auction_mode"] not in ALLOWED_AUCTION_MODES:
        raise ValueError(
            f"Year '{year_config['year']}' has invalid auction_mode "
            f"'{year_config['auction_mode']}'."
        )
    if year_config["price_upper_bound"] <= year_config["price_lower_bound"]:
        raise ValueError(
            f"Year '{year_config['year']}' must have price_upper_bound greater than "
            "price_lower_bound."
        )
    if not 0.0 <= year_config["minimum_bid_coverage"] <= 1.0:
        raise ValueError(
            f"Year '{year_config['year']}' minimum_bid_coverage must be between 0 and 1."
        )
    if year_config["auction_reserve_price"] < 0.0:
        raise ValueError(
            f"Year '{year_config['year']}' auction_reserve_price must be non-negative."
        )
    if year_config["unsold_treatment"] not in {"reserve", "cancel", "carry_forward"}:
        raise ValueError(
            f"Year '{year_config['year']}' unsold_treatment must be one of reserve, cancel, carry_forward."
        )
    if year_config["manual_expected_price"] < 0.0:
        raise ValueError(
            f"Year '{year_config['year']}' manual_expected_price must be non-negative."
        )

    participants = year_config.get("participants", [])
    if not isinstance(participants, list):
        raise ValueError(
            f"Year '{year_config['year']}' participants must be provided as a list."
        )
    year_config["participants"] = [normalize_participant(item) for item in participants]
    return year_config


def normalize_participant(raw_participant: dict[str, Any]) -> dict[str, Any]:
    participant = blank_participant()
    participant.update(raw_participant)

    participant["name"] = str(participant["name"]).strip()
    if not participant["name"]:
        raise ValueError("Each participant must have a non-empty name.")

    participant["abatement_type"] = str(participant["abatement_type"]).strip()
    if participant["abatement_type"] not in ALLOWED_ABATEMENT_TYPES:
        raise ValueError(
            f"Participant '{participant['name']}' has invalid abatement_type "
            f"'{participant['abatement_type']}'."
        )

    numeric_fields = [
        "initial_emissions",
        "free_allocation_ratio",
        "penalty_price",
        "max_abatement",
        "cost_slope",
        "threshold_cost",
    ]
    for field in numeric_fields:
        participant[field] = float(participant[field])
    technology_options = participant.get("technology_options", [])
    if not isinstance(technology_options, list):
        raise ValueError(
            f"Participant '{participant['name']}' technology_options must be a list."
        )
    participant["technology_options"] = [
        normalize_technology_option(item, participant["name"])
        for item in technology_options
    ]

    mac_blocks = participant.get("mac_blocks", [])
    if not isinstance(mac_blocks, list):
        raise ValueError(
            f"Participant '{participant['name']}' mac_blocks must be a list."
        )
    normalized_blocks: list[dict[str, float]] = []
    previous_cost = -float("inf")
    for index, block in enumerate(mac_blocks):
        if not isinstance(block, dict):
            raise ValueError(
                f"Participant '{participant['name']}' MAC block {index + 1} must be an object."
            )
        amount = float(block.get("amount", 0.0))
        marginal_cost = float(block.get("marginal_cost", 0.0))
        if amount < 0 or marginal_cost < 0:
            raise ValueError(
                f"Participant '{participant['name']}' MAC block {index + 1} must be non-negative."
            )
        if marginal_cost < previous_cost:
            raise ValueError(
                f"Participant '{participant['name']}' mac_blocks must be ordered by non-decreasing marginal_cost."
            )
        normalized_blocks.append(
            {"amount": amount, "marginal_cost": marginal_cost}
        )
        previous_cost = marginal_cost
    participant["mac_blocks"] = normalized_blocks

    if participant["abatement_type"] == "piecewise" and not normalized_blocks:
        raise ValueError(
            f"Participant '{participant['name']}' piecewise abatement requires mac_blocks."
        )

    return participant


def normalize_technology_option(
    raw_option: dict[str, Any], participant_name: str
) -> dict[str, Any]:
    option = blank_technology_option()
    option.update(raw_option)
    option["name"] = str(option["name"]).strip()
    if not option["name"]:
        raise ValueError(
            f"Participant '{participant_name}' technology options must have a non-empty name."
        )

    option["abatement_type"] = str(option["abatement_type"]).strip()
    if option["abatement_type"] not in ALLOWED_ABATEMENT_TYPES:
        raise ValueError(
            f"Participant '{participant_name}' technology '{option['name']}' has invalid "
            f"abatement_type '{option['abatement_type']}'."
        )

    numeric_fields = [
        "initial_emissions",
        "free_allocation_ratio",
        "penalty_price",
        "max_abatement",
        "cost_slope",
        "threshold_cost",
        "fixed_cost",
    ]
    for field in numeric_fields:
        option[field] = float(option[field])

    mac_blocks = option.get("mac_blocks", [])
    if not isinstance(mac_blocks, list):
        raise ValueError(
            f"Participant '{participant_name}' technology '{option['name']}' mac_blocks must be a list."
        )
    normalized_blocks: list[dict[str, float]] = []
    previous_cost = -float("inf")
    for index, block in enumerate(mac_blocks):
        if not isinstance(block, dict):
            raise ValueError(
                f"Participant '{participant_name}' technology '{option['name']}' MAC block {index + 1} must be an object."
            )
        amount = float(block.get("amount", 0.0))
        marginal_cost = float(block.get("marginal_cost", 0.0))
        if amount < 0 or marginal_cost < 0:
            raise ValueError(
                f"Participant '{participant_name}' technology '{option['name']}' MAC block {index + 1} must be non-negative."
            )
        if marginal_cost < previous_cost:
            raise ValueError(
                f"Participant '{participant_name}' technology '{option['name']}' mac_blocks must be ordered by non-decreasing marginal_cost."
            )
        normalized_blocks.append({"amount": amount, "marginal_cost": marginal_cost})
        previous_cost = marginal_cost
    option["mac_blocks"] = normalized_blocks

    if option["abatement_type"] == "piecewise" and not normalized_blocks:
        raise ValueError(
            f"Participant '{participant_name}' technology '{option['name']}' piecewise abatement requires mac_blocks."
        )

    return option


def build_markets_from_file(config_path: str | Path) -> list[CarbonMarket]:
    return build_markets_from_config(load_config(config_path))


def build_markets_from_config(config: dict[str, Any]) -> list[CarbonMarket]:
    normalized = normalize_config(deepcopy(config))
    markets: list[CarbonMarket] = []
    for scenario in normalized["scenarios"]:
        for year_config in scenario["years"]:
            markets.append(build_market_from_year(scenario["name"], year_config))
    return markets


def build_market_from_year(scenario_name: str, year_config: dict[str, Any]) -> CarbonMarket:
    participants = [build_participant(item) for item in year_config["participants"]]
    free_allocations = sum(participant.free_allocation for participant in participants)
    reserved_allowances = float(year_config.get("reserved_allowances", 0.0))
    cancelled_allowances = float(year_config.get("cancelled_allowances", 0.0))

    if year_config["auction_mode"] == "derive_from_cap":
        auction_offered = (
            year_config["total_cap"]
            - free_allocations
            - reserved_allowances
            - cancelled_allowances
        )
    else:
        auction_offered = year_config["auction_offered"]

    if auction_offered < 0:
        raise ValueError(
            f"Scenario '{scenario_name}' year '{year_config['year']}' implies negative "
            "auction offered. Raise the cap or lower free allocation."
        )

    return CarbonMarket(
        participants=participants,
        total_cap=year_config["total_cap"],
        auction_offered=auction_offered,
        reserved_allowances=reserved_allowances,
        cancelled_allowances=cancelled_allowances,
        auction_reserve_price=year_config["auction_reserve_price"],
        minimum_bid_coverage=year_config["minimum_bid_coverage"],
        unsold_treatment=year_config["unsold_treatment"],
        scenario_name=scenario_name,
        year=year_config["year"],
        price_lower_bound=year_config["price_lower_bound"],
        price_upper_bound=year_config["price_upper_bound"],
        banking_allowed=year_config["banking_allowed"],
        borrowing_allowed=year_config["borrowing_allowed"],
        borrowing_limit=year_config["borrowing_limit"],
        expectation_rule=year_config["expectation_rule"],
        manual_expected_price=year_config["manual_expected_price"],
    )


def build_participant(participant: dict[str, Any]) -> MarketParticipant:
    technology_options = [
        build_technology_option(item) for item in participant.get("technology_options", [])
    ]
    if participant["abatement_type"] == "linear":
        marginal_abatement_cost = linear_abatement_factory(
            max_abatement=participant["max_abatement"],
            cost_slope=participant["cost_slope"],
        )
        max_abatement_share = 1.0
    elif participant["abatement_type"] == "piecewise":
        marginal_abatement_cost = piecewise_abatement_factory(
            participant["mac_blocks"]
        )
        initial_emissions = participant["initial_emissions"]
        max_abatement = sum(
            float(block["amount"]) for block in participant["mac_blocks"]
        )
        max_abatement_share = 0.0
        if initial_emissions > 0:
            max_abatement_share = min(1.0, max_abatement / initial_emissions)
    else:
        initial_emissions = participant["initial_emissions"]
        max_abatement_share = 0.0
        if initial_emissions > 0:
            max_abatement_share = min(
                1.0, participant["max_abatement"] / initial_emissions
            )
        marginal_abatement_cost = participant["threshold_cost"]

    return MarketParticipant(
        name=participant["name"],
        initial_emissions=participant["initial_emissions"],
        marginal_abatement_cost=marginal_abatement_cost,
        free_allocation_ratio=participant["free_allocation_ratio"],
        penalty_price=participant["penalty_price"],
        max_abatement_share=max_abatement_share,
        technology_options=technology_options or None,
    )


def build_technology_option(option: dict[str, Any]) -> TechnologyOption:
    if option["abatement_type"] == "linear":
        marginal_abatement_cost = linear_abatement_factory(
            max_abatement=option["max_abatement"],
            cost_slope=option["cost_slope"],
        )
        max_abatement_share = 1.0
    elif option["abatement_type"] == "piecewise":
        marginal_abatement_cost = piecewise_abatement_factory(option["mac_blocks"])
        max_abatement = sum(float(block["amount"]) for block in option["mac_blocks"])
        max_abatement_share = 0.0
        if option["initial_emissions"] > 0:
            max_abatement_share = min(1.0, max_abatement / option["initial_emissions"])
    else:
        marginal_abatement_cost = option["threshold_cost"]
        max_abatement_share = 0.0
        if option["initial_emissions"] > 0:
            max_abatement_share = min(
                1.0, option["max_abatement"] / option["initial_emissions"]
            )

    return TechnologyOption(
        name=option["name"],
        initial_emissions=option["initial_emissions"],
        free_allocation_ratio=option["free_allocation_ratio"],
        penalty_price=option["penalty_price"],
        marginal_abatement_cost=marginal_abatement_cost,
        max_abatement_share=max_abatement_share,
        fixed_cost=option["fixed_cost"],
    )
