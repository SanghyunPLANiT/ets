# Data Model & Configuration Schema

**Files:** `src/ets/scenarios.py` (`normalize_*` functions), `src/ets/config.py`

All simulation inputs are represented as a single JSON object. This document describes every field, its type, allowed values, default, and validation rules.

---

## Top-level structure

```json
{
  "scenarios": [
    { ...scenario },
    { ...scenario }
  ]
}
```

A config must contain at least one scenario. Multiple scenarios are run independently and compared in the Scenario tab.

---

## Scenario object

```json
{
  "name": "Aggressive Decarbonisation",
  "years": [ { ...year }, { ...year } ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | ✅ | Non-empty. Used as the scenario identifier in all results. |
| `years` | array of year objects | ✅ | At least one year required. Sorted chronologically before simulation. |

---

## Year object

One year object configures a complete market period (e.g. 2030, 2035).

```json
{
  "year": "2030",
  "total_cap": 500.0,
  "auction_mode": "explicit",
  "auction_offered": 300.0,
  "reserved_allowances": 0.0,
  "cancelled_allowances": 20.0,
  "auction_reserve_price": 15.0,
  "minimum_bid_coverage": 0.8,
  "unsold_treatment": "reserve",
  "price_lower_bound": 10.0,
  "price_upper_bound": 200.0,
  "banking_allowed": true,
  "borrowing_allowed": false,
  "borrowing_limit": 0.0,
  "expectation_rule": "next_year_baseline",
  "manual_expected_price": 0.0,
  "participants": [ { ...participant }, ... ]
}
```

### Market structure fields

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `year` | string | `"2030"` | Non-empty | Label for this period. Used for display and chronological sorting. |
| `total_cap` | float ≥ 0 | `0.0` | ≥ 0 | Hard annual ceiling on total covered emissions (Mt CO₂e). All allowance buckets must sum to ≤ this value. |
| `auction_mode` | `"explicit"` \| `"derive_from_cap"` | `"explicit"` | One of the two values | Controls how auction supply is determined. |
| `auction_offered` | float ≥ 0 | `0.0` | ≥ 0; ignored when `auction_mode = "derive_from_cap"` | Volume offered at auction (Mt CO₂e). Only used when `auction_mode = "explicit"`. |
| `reserved_allowances` | float ≥ 0 | `0.0` | ≥ 0 | Allowances withheld from the market. Not sold, not freely allocated. Count toward the cap but not toward supply. |
| `cancelled_allowances` | float ≥ 0 | `0.0` | ≥ 0 | Allowances permanently retired. Reduce effective supply. Count toward the cap. |

**Supply identity constraint:**

```
free_allocation + auction_offered + reserved + cancelled ≤ total_cap
```

Violation raises `ValueError` at market construction time.

**`auction_mode = "derive_from_cap"` formula:**

```
auction_offered = total_cap - free_allocation - reserved - cancelled
```

If the result is negative (over-allocated), an error is raised.

---

### Auction design fields

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `auction_reserve_price` | float ≥ 0 | `0.0` | ≥ 0 | Minimum clearing price at auction. Allowances that cannot reach this price go unsold. |
| `minimum_bid_coverage` | float [0, 1] | `0.0` | 0–1 | Minimum fraction of offered volume that must be bid for the auction to clear. E.g. `0.8` = 80%. If bids cover less than this fraction, the entire auction is cancelled. |
| `unsold_treatment` | `"reserve"` \| `"cancel"` \| `"carry_forward"` | `"reserve"` | One of three values | What happens to allowances that do not sell at auction. |

**`unsold_treatment` values:**

| Value | Effect |
|---|---|
| `"reserve"` | Held in government reserve. Does not re-enter the market. |
| `"cancel"` | Permanently retired. No future impact (treated identically to `"reserve"` in the model since both remove allowances). |
| `"carry_forward"` | Added to next year's auction supply (`carry_forward_in` parameter). |

---

### Price bound fields

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `price_lower_bound` | float ≥ 0 | `0.0` | ≥ 0, must be < `price_upper_bound` | Equilibrium price floor. The solver uses this as the lower bracket boundary. |
| `price_upper_bound` | float > 0 | `100.0` | > `price_lower_bound` | Equilibrium price ceiling. Used as upper bracket; also limits the search range. |

If `price_upper_bound ≤ price_lower_bound`, `ValueError` is raised immediately during config normalisation.

---

### Banking & borrowing fields

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `banking_allowed` | bool | `false` | — | If true, participants may save surplus allowances for future years. |
| `borrowing_allowed` | bool | `false` | — | If true, participants may borrow from future allocations. |
| `borrowing_limit` | float ≥ 0 | `0.0` | ≥ 0 | Maximum volume any participant may borrow (Mt CO₂e). Only active when `borrowing_allowed = true`. |

See [Multi-Year Simulation](multi-year-simulation.md) for full banking/borrowing logic.

---

### Expectation fields

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `expectation_rule` | string | `"next_year_baseline"` | One of four allowed values | How participants form beliefs about next year's price. |
| `manual_expected_price` | float ≥ 0 | `0.0` | ≥ 0 | Used only when `expectation_rule = "manual"`. |

**Allowed `expectation_rule` values:**

| Value | Expected price used |
|---|---|
| `"myopic"` | `0.0` — ignore the future |
| `"next_year_baseline"` | Independent equilibrium price of next year (no banking effects) |
| `"perfect_foresight"` | Actual realised price of next year (requires fixed-point iteration) |
| `"manual"` | `manual_expected_price` field value |

---

## Participant object

```json
{
  "name": "Steel Plant A",
  "sector": "Steel",
  "initial_emissions": 100.0,
  "free_allocation_ratio": 0.9,
  "penalty_price": 150.0,
  "abatement_type": "piecewise",
  "max_abatement": 0.0,
  "cost_slope": 1.0,
  "threshold_cost": 0.0,
  "mac_blocks": [
    {"amount": 6, "marginal_cost": 20},
    {"amount": 8, "marginal_cost": 55},
    {"amount": 8, "marginal_cost": 110}
  ],
  "technology_options": [ { ...technology_option }, ... ]
}
```

### Participant fields

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `name` | string | `"New Participant"` | Non-empty, unique within year | Participant identifier. Used as key in all result tables. |
| `sector` | string | `"Other"` | — | Display label for grouping in charts. Not used in calculations. |
| `initial_emissions` | float ≥ 0 | `0.0` | ≥ 0 | Gross emissions baseline (Mt CO₂e) before any abatement. Determines compliance obligation. |
| `free_allocation_ratio` | float [0, 1] | `0.0` | 0–1 | Share of initial emissions covered by free allowances. `1.0` = fully covered for free. |
| `penalty_price` | float > 0 | `100.0` | > 0 | Fine per tonne of uncovered emissions. Acts as a compliance ceiling — no participant buys above this price. |
| `abatement_type` | `"linear"` \| `"piecewise"` \| `"threshold"` | `"linear"` | One of three values | Selects which MAC model to use. |

### Abatement model fields (mutually exclusive groups)

**Linear** (`abatement_type = "linear"`):

| Field | Type | Default | Description |
|---|---|---|---|
| `max_abatement` | float ≥ 0 | `0.0` | Maximum abatement possible (Mt CO₂e). |
| `cost_slope` | float > 0 | `1.0` | Slope of the linear MAC curve ($/t per Mt abated). Higher = more expensive. |

Total abatement cost = `½ × cost_slope × abatement²`

**Piecewise** (`abatement_type = "piecewise"`):

| Field | Type | Default | Description |
|---|---|---|---|
| `mac_blocks` | array of block objects | `[]` | At least one block required. Must be ordered by non-decreasing `marginal_cost`. |

Block object: `{"amount": float ≥ 0, "marginal_cost": float ≥ 0}`

**Threshold** (`abatement_type = "threshold"`):

| Field | Type | Default | Description |
|---|---|---|---|
| `max_abatement` | float ≥ 0 | `0.0` | Abatement amount if threshold is exceeded (Mt CO₂e). |
| `threshold_cost` | float ≥ 0 | `0.0` | Price at which abatement switches from 0 to `max_abatement`. |

---

## Technology option object

Technology options extend a participant with alternative production technologies. Each option has the same abatement fields as a participant, plus adoption-specific fields.

```json
{
  "name": "Hydrogen DRI",
  "initial_emissions": 70.0,
  "free_allocation_ratio": 0.65,
  "penalty_price": 150.0,
  "abatement_type": "piecewise",
  "max_abatement": 0.0,
  "cost_slope": 1.0,
  "threshold_cost": 0.0,
  "mac_blocks": [
    {"amount": 8, "marginal_cost": 15},
    {"amount": 10, "marginal_cost": 35},
    {"amount": 8, "marginal_cost": 70}
  ],
  "fixed_cost": 200.0,
  "max_activity_share": 0.5
}
```

| Field | Type | Default | Validation | Description |
|---|---|---|---|---|
| `name` | string | `"New Technology"` | Non-empty | Technology label. Shown in results and charts. |
| `initial_emissions` | float ≥ 0 | `0.0` | ≥ 0 | Baseline emissions if 100% of activity uses this technology. |
| `free_allocation_ratio` | float [0, 1] | `0.0` | 0–1 | Free allowance share for this technology. May differ from base technology (e.g. lower for new tech not yet covered by benchmarks). |
| `penalty_price` | float > 0 | `100.0` | > 0 | Same meaning as participant penalty price. |
| `abatement_type` | string | `"linear"` | One of three values | MAC model for this technology. |
| `mac_blocks` | array | `[]` | Required if `piecewise` | MAC blocks for this technology. |
| `max_abatement` | float ≥ 0 | `0.0` | ≥ 0 | Used by `linear` and `threshold` models. |
| `cost_slope` | float > 0 | `1.0` | > 0 | Used by `linear` model. |
| `threshold_cost` | float ≥ 0 | `0.0` | ≥ 0 | Used by `threshold` model. |
| `fixed_cost` | float ≥ 0 | `0.0` | ≥ 0 | One-time adoption investment per year active ($/M or $M depending on scale). Paid in every year the technology is used. |
| `max_activity_share` | float [0, 1] | `1.0` | 0–1 | Maximum fraction of the participant's total activity that can use this technology in a given year. If any option has `max_activity_share < 1`, a mixed portfolio optimisation is triggered. |

**Constraint on `max_activity_share`:**

Across all technology options for a participant, the sum of `max_activity_share` values must be ≥ 1.0, otherwise the participant cannot cover 100% of their activity:

```python
if share_caps.sum() < 1.0 - 1e-9:
    raise ValueError("technology max_activity_share values sum to less than 1.0")
```

---

## Derived / computed fields

These fields are not in the config JSON but are computed during market construction:

| Field | Where computed | Formula |
|---|---|---|
| `free_allocation` | `participant.py` | `initial_emissions × free_allocation_ratio` |
| `max_abatement` | `participant.py` | `initial_emissions × max_abatement_share` |
| `unallocated_allowances` | `market.py` | `max(0, total_cap - free_alloc - auction - reserved - cancelled)` |
| `effective_auction_offered` | `market.py` | `auction_offered + carry_forward_in` |

---

## Validation summary

All validation runs in `scenarios.py` during `normalize_config()`. Errors raise `ValueError` immediately before any simulation begins.

| Rule | Error message pattern |
|---|---|
| Missing `scenarios` list | `"Config must contain a 'scenarios' list."` |
| Empty scenario name | `"Each scenario must have a non-empty name."` |
| Missing or empty `years` | `"Scenario '...' must contain a non-empty 'years' list."` |
| Empty year label | `"Each yearly configuration must have a non-empty year label."` |
| Invalid `auction_mode` | `"Year '...' has invalid auction_mode '...'"` |
| `price_upper_bound ≤ price_lower_bound` | `"Year '...' must have price_upper_bound greater than price_lower_bound."` |
| `minimum_bid_coverage` outside [0, 1] | `"Year '...' minimum_bid_coverage must be between 0 and 1."` |
| Negative `auction_reserve_price` | `"Year '...' auction_reserve_price must be non-negative."` |
| Invalid `unsold_treatment` | `"Year '...' unsold_treatment must be one of reserve, cancel, carry_forward."` |
| Invalid `expectation_rule` | `"Year '...' expectation_rule must be one of ..."` |
| Empty participant name | `"Each participant must have a non-empty name."` |
| Invalid `abatement_type` | `"Participant '...' has invalid abatement_type '...'"` |
| Piecewise with no blocks | `"Participant '...' piecewise abatement requires mac_blocks."` |
| MAC blocks out of order | `"Participant '...' mac_blocks must be ordered by non-decreasing marginal_cost."` |
| Supply exceeds cap | `"Inconsistent cap setup: free allocations plus auctioned, reserved, and cancelled allowances cannot exceed total_cap."` |
| Negative auction supply | `"Scenario '...' year '...' implies negative auction offered."` |
| `max_activity_share` sum < 1 | `"technology max_activity_share values sum to less than 1.0."` |

---

## Minimal valid config

The smallest config that will run without error:

```json
{
  "scenarios": [
    {
      "name": "Minimal",
      "years": [
        {
          "year": "2030",
          "total_cap": 100.0,
          "auction_mode": "explicit",
          "auction_offered": 80.0,
          "price_lower_bound": 0.0,
          "price_upper_bound": 200.0,
          "participants": [
            {
              "name": "Industry A",
              "initial_emissions": 100.0,
              "free_allocation_ratio": 0.2,
              "penalty_price": 150.0,
              "abatement_type": "linear",
              "max_abatement": 20.0,
              "cost_slope": 3.0
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Full example config (multi-year, multi-participant, technology options)

```json
{
  "scenarios": [
    {
      "name": "Technology Transition",
      "years": [
        {
          "year": "2030",
          "total_cap": 500.0,
          "auction_mode": "explicit",
          "auction_offered": 300.0,
          "reserved_allowances": 0.0,
          "cancelled_allowances": 0.0,
          "auction_reserve_price": 15.0,
          "minimum_bid_coverage": 0.7,
          "unsold_treatment": "reserve",
          "price_lower_bound": 10.0,
          "price_upper_bound": 250.0,
          "banking_allowed": true,
          "borrowing_allowed": false,
          "borrowing_limit": 0.0,
          "expectation_rule": "next_year_baseline",
          "manual_expected_price": 0.0,
          "participants": [
            {
              "name": "Steel Plant",
              "sector": "Steel",
              "initial_emissions": 100.0,
              "free_allocation_ratio": 0.9,
              "penalty_price": 200.0,
              "abatement_type": "piecewise",
              "mac_blocks": [
                {"amount": 6,  "marginal_cost": 20},
                {"amount": 8,  "marginal_cost": 55},
                {"amount": 8,  "marginal_cost": 110}
              ],
              "technology_options": [
                {
                  "name": "Hydrogen DRI",
                  "initial_emissions": 70.0,
                  "free_allocation_ratio": 0.65,
                  "penalty_price": 200.0,
                  "abatement_type": "piecewise",
                  "mac_blocks": [
                    {"amount": 8,  "marginal_cost": 15},
                    {"amount": 10, "marginal_cost": 35},
                    {"amount": 8,  "marginal_cost": 70}
                  ],
                  "fixed_cost": 200.0,
                  "max_activity_share": 0.5
                }
              ]
            },
            {
              "name": "Coal Generator",
              "sector": "Power",
              "initial_emissions": 140.0,
              "free_allocation_ratio": 0.25,
              "penalty_price": 200.0,
              "abatement_type": "piecewise",
              "mac_blocks": [
                {"amount": 8,  "marginal_cost": 25},
                {"amount": 12, "marginal_cost": 50},
                {"amount": 20, "marginal_cost": 95}
              ]
            }
          ]
        },
        {
          "year": "2035",
          "total_cap": 400.0,
          "auction_mode": "explicit",
          "auction_offered": 220.0,
          "auction_reserve_price": 20.0,
          "minimum_bid_coverage": 0.7,
          "unsold_treatment": "carry_forward",
          "price_lower_bound": 15.0,
          "price_upper_bound": 250.0,
          "banking_allowed": true,
          "borrowing_allowed": false,
          "expectation_rule": "next_year_baseline",
          "participants": [
            { "...": "same participants, possibly with updated free_allocation_ratio" }
          ]
        }
      ]
    }
  ]
}
```

---

## JSON ↔ Python object mapping

| JSON path | Python object | Python field |
|---|---|---|
| `scenarios[].name` | `CarbonMarket.scenario_name` | `str` |
| `scenarios[].years[].year` | `CarbonMarket.year` | `str` |
| `scenarios[].years[].total_cap` | `CarbonMarket.total_cap` | `float` |
| `scenarios[].years[].auction_offered` | `CarbonMarket.auction_offered` | `float` |
| `scenarios[].years[].price_lower_bound` | `CarbonMarket.price_lower_bound` | `float` |
| `scenarios[].years[].price_upper_bound` | `CarbonMarket.price_upper_bound` | `float` |
| `scenarios[].years[].banking_allowed` | `CarbonMarket.banking_allowed` | `bool` |
| `scenarios[].years[].participants[].name` | `MarketParticipant.name` | `str` |
| `scenarios[].years[].participants[].initial_emissions` | `MarketParticipant.initial_emissions` | `float` |
| `scenarios[].years[].participants[].free_allocation_ratio` | `MarketParticipant.free_allocation_ratio` | `float` |
| `scenarios[].years[].participants[].penalty_price` | `MarketParticipant.penalty_price` | `float` |
| `scenarios[].years[].participants[].mac_blocks` | `piecewise_abatement_factory(mac_blocks)` | callable |
| `scenarios[].years[].participants[].technology_options[]` | `MarketParticipant.technology_options` | `list[TechnologyOption]` |

---

## See also

- [Algorithm Overview](algorithm-overview.md) — how config flows into the simulation
- [MAC & Abatement Models](mac-abatement.md) — abatement field details
- [Technology Transition](technology-transition.md) — technology_options field details
- [Multi-Year Simulation](multi-year-simulation.md) — banking/borrowing/expectation fields
