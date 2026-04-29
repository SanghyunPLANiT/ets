# Algorithm Overview

The simulator is organised as **three nested layers**. Each layer has a single, well-defined responsibility. Understanding how they compose is the key to understanding the whole system.

---

## The three layers at a glance

```
┌────────────────────────────────────────────────────────────────────┐
│  Layer 3 — Multi-Year Path  (simulation.py, expectations.py)       │
│                                                                    │
│  For each year t = 2030, 2035, 2040 …                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Layer 2 — Market Equilibrium  (market.py)                   │  │
│  │                                                              │  │
│  │  Find P* such that  Σ demand_i(P*) = auction supply Q        │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Layer 1 — Participant Optimisation  (participant.py)  │  │  │
│  │  │                                                        │  │  │
│  │  │  min_a  Cost(a, P)  for each participant i             │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

The layers call each other in sequence:

- **Layer 3** iterates over years and manages state (bank balances, carry-forward allowances) between them.
- **Layer 2** is called once per year. It evaluates total market demand many times at different trial prices; it does this by calling Layer 1.
- **Layer 1** is called once per participant per trial price. It solves a bounded scalar optimisation to find the cost-minimising abatement level.

---

## Modelling approaches

The `model_approach` field on a scenario selects the price-formation mechanism for Layer 3. All approaches share Layers 1 and 2 — they differ only in how the price path across years is determined.

### Competitive (default)

`model_approach: "competitive"`

Participants are price-takers. Each year, Brent's method finds `P*` such that aggregate demand equals auction supply. With `perfect_foresight` expectations, a fixed-point iteration enforces rational expectations (realised prices equal expected prices). This is the standard ETS model.

### Hotelling Rule

`model_approach: "hotelling"`

Treats emission allowances as an exhaustible resource. The arbitrage condition (no-profit from intertemporal speculation) requires prices to rise at the discount rate. An optional **risk premium** `ρ` can be added to reflect the extra return required by risk-averse holders:

```
P*(t) = λ · (1 + r + ρ)^(t − t₀)
```

where:
- `λ` is the shadow price (royalty) at the base year `t₀`
- `r` is the `discount_rate` (default 0.04)
- `ρ` is the `risk_premium` (default 0.0); steepens the price path without changing its functional form
- `t` is the year index

`λ` is chosen by **bisection** so that cumulative residual emissions across all years equal the cumulative `carbon_budget`. For each candidate `λ`, each year's market is solved at the pinned Hotelling price (by setting `price_lower_bound = price_upper_bound = P_hotelling(t)` on a market copy). Bisection tightens the bracket until the relative residual on cumulative emissions is within `solver_hotelling_convergence_tol` (default `1e-4`).

**When to use:** Long-run optimal resource-extraction analysis, theory benchmarking, or when you want prices to follow an explicit growth path rather than year-by-year market clearing.

### Nash-Cournot

`model_approach: "nash_cournot"`

Participants named in `nash_strategic_participants` internalise their own price impact. A large buyer knows that increasing demand raises the price it pays, so it voluntarily under-demands to lower the equilibrium price. Non-listed participants remain price-takers throughout.

The equilibrium concept is a **Cournot-Nash equilibrium in abatement quantities**: no strategic participant can reduce its total compliance cost by unilaterally changing its abatement level.

Algorithm — **best-response iteration** (Jacobi-style):

1. Start from the competitive equilibrium as initial strategies.
2. For each strategic participant `i`: fix all other participants' net demands; solve `i`'s best response by finding the abatement level that minimises its own compliance cost given the residual demand curve.
3. Update all strategies simultaneously.
4. Repeat until `max|Δa_i| ≤ solver_nash_convergence_tol`.

**When to use:** Markets where a small number of large participants have significant market power (e.g. a single large industrial emitter or a dominant compliance buyer).

### Run All

`model_approach: "all"`

Runs all three approaches on the same scenario config and returns results for each approach in parallel, enabling direct comparison of competitive, Hotelling, and Nash-Cournot outcomes.

---

## Market Stability Reserve (MSR)

**File:** `src/ets/msr.py`  
**Enabled by:** `msr_enabled: true` at the scenario level

The MSR is a non-linear supply-adjustment mechanism that stabilises the aggregate bank by adjusting auction supply before each year's market clearing.

### Rule

```
if total_bank > msr_upper_threshold:
    withheld = min(msr_withhold_rate × auction_offered, auction_offered)
    reserve_pool += withheld
    effective_auction -= withheld

elif total_bank < msr_lower_threshold and reserve_pool > 0:
    released = min(msr_release_rate, reserve_pool)
    reserve_pool -= released
    effective_auction += released
```

### Parameters and defaults

| Parameter | Default | Description |
|---|---|---|
| `msr_upper_threshold` | `200.0` Mt | Bank above which withholding starts |
| `msr_lower_threshold` | `50.0` Mt | Bank below which release starts |
| `msr_withhold_rate` | `0.12` | Fraction of auction_offered withheld per year |
| `msr_release_rate` | `50.0` Mt | Volume released per year when bank is below lower threshold |
| `msr_cancel_excess` | `false` | If true, pool above `msr_cancel_threshold` is permanently cancelled |
| `msr_cancel_threshold` | `400.0` Mt | Pool level above which excess is cancelled (when `msr_cancel_excess = true`) |

### Mechanics

The `MSRState` object carries the `reserve_pool` across years for a single scenario. The MSR is applied **before** market clearing in each year (Layer 3), so the effective auction supply seen by the equilibrium solver already reflects any withholding or release. The `reserve_pool` persists from year to year.

**Interpretation:** The MSR implements a rule-based quantity signal analogous to the EU ETS MSR. When the aggregate bank is excessive (prices tend to be low), the MSR withholds allowances to tighten supply. When the bank is depleted (prices tend to be high), it releases previously withheld allowances to ease supply. This dampens price volatility caused by asymmetric banking.

---

## CBAM (Carbon Border Adjustment Mechanism)

CBAM liability is computed **after** market equilibrium is established — it does not affect the clearing price.

### Single-jurisdiction formula

For each participant with `cbam_export_share > 0`:

```
cbam_liability = max(0, eua_price − P*) × residual_emissions
                 × cbam_export_share × cbam_coverage_ratio
```

where:
- `eua_price` is the reference EU ETS price set in the year config
- `P*` is the domestic equilibrium price found by the solver
- `residual_emissions` is the participant's post-abatement direct emissions
- `cbam_export_share` is the fraction of output exported to CBAM-covered markets
- `cbam_coverage_ratio` is the fraction of exported emissions within CBAM scope

**Interpretation:** CBAM imposes a levy on the price gap between the importing jurisdiction and the domestic price, applied to the exported residual emissions. If the domestic price equals or exceeds the reference EUA price, CBAM liability is zero.

### Multi-jurisdiction CBAM

When a participant specifies `cbam_jurisdictions` (an array of `{name, export_share, coverage_ratio}` objects), liability is computed independently per jurisdiction using `eua_prices[name]` from the year config. Each jurisdiction produces a separate column in the results (`CBAM Liability (EU)`, `CBAM Liability (UK)`, etc.) and the single-jurisdiction `cbam_export_share` / `cbam_coverage_ratio` fields are ignored.

### EUA price ensemble

Setting `eua_price_ensemble` in the year config (e.g. `{"EC": 70.0, "Enerdata": 75.0, "BNEF": 82.0}`) evaluates CBAM liability under multiple price forecasts simultaneously. Each source produces its own liability column (`CBAM Liability (EC)`, …), enabling direct comparison of CBAM exposure across forecast assumptions.

### Scope 2 / indirect emissions

Participants with `electricity_consumption > 0` and `grid_emission_factor > 0` generate **indirect (Scope 2) emissions**:

```
indirect_emissions = electricity_consumption × grid_emission_factor
```

If `scope2_cbam_coverage > 0`, a parallel CBAM liability is computed on these indirect emissions:

```
scope2_cbam_liability = max(0, eua_price − P*) × indirect_emissions × scope2_cbam_coverage
```

Both `Indirect Emissions` and `Scope 2 CBAM Liability` appear in participant-level outputs. Like direct CBAM, they do not feed back into `net_allowances_traded` or the market-clearing equation.

---

## Full execution flow

```
run_simulation(config)
│
├─ build_markets_from_config(config)           # scenarios.py
│   └─ For each scenario × year:
│       ├─ Normalise & validate JSON config
│       └─ Build CarbonMarket + MarketParticipant objects
│
└─ For each scenario (grouped markets):
    │
    ├─ Select solver based on model_approach
    │
    ├─ [competitive / all]
    │   ├─ Sort years chronologically
    │   ├─ Compute baseline_prices (independent equilibrium, no banking)
    │   ├─ Build expectation_specs
    │   ├─ [IF perfect_foresight] Fixed-point iteration (≤ solver_competitive_max_iters):
    │   │   ├─ Simulate full path → realised_prices
    │   │   ├─ Update expected_prices
    │   │   └─ Stop when max|Δprice| ≤ solver_competitive_tolerance
    │   └─ Final path simulation:
    │       For each year t:
    │       ├─ [IF msr_enabled] Apply MSR to effective_auction
    │       ├─ market.solve_equilibrium(bank_t, P_future_t, carry_t)
    │       │   └─ scipy.root_scalar("brentq")
    │       │       └─ market.total_net_demand(P)
    │       │           └─ participant.optimize_compliance(P)  × n
    │       ├─ Compute CBAM liability post-equilibrium
    │       └─ bank_{t+1}, carry_{t+1} ← year t results
    │
    ├─ [hotelling]
    │   ├─ Bisect on λ until cumulative emissions = cumulative carbon_budget
    │   └─ At each λ: pin each year's price to λ·(1+r+ρ)^(t−t₀), run participants
    │
    └─ [nash_cournot]
        ├─ Initialise from competitive equilibrium
        └─ Best-response iteration until max|Δa_i| ≤ solver_nash_convergence_tol
```

---

## Layer 1 — Participant optimisation

**File:** `src/ets/participant.py`  
**Detailed doc:** [mac-abatement.md](mac-abatement.md), [technology-transition.md](technology-transition.md)

Each participant minimises their total compliance cost over a scalar variable — abatement:

```
min_{a}  fixed_cost  +  abatement_cost(a)  +  allowance_cost(a, P)  +  penalty(a, P)
       −  sales_revenue(a, P)  −  P_future × banking_balance(a, P)
```

The optimisation is bounded: `0 ≤ a ≤ max_abatement`.

Key outputs per participant:
- `abatement` — tonnes reduced
- `residual_emissions` — remaining obligations
- `net_allowances_traded` — positive = buyer, negative = seller
- `ending_bank_balance` — allowances carried to next year
- `cbam_liability` — post-equilibrium border adjustment cost

---

## Layer 2 — Market equilibrium

**File:** `src/ets/market.py`  
**Detailed doc:** [market-equilibrium.md](market-equilibrium.md)

The equilibrium condition is:

```
D(P*) = Q       where  D(P) = Σ_i net_allowances_traded_i(P)
```

`D(P)` is monotonically non-increasing (higher price → more abatement → less demand). The solver brackets a root using the penalty price as an upper bound, then applies **Brent's method** for guaranteed, fast convergence.

Auction-specific rules (reserve price, minimum bid coverage, unsold treatment) are evaluated before the root-finding step.

---

## Layer 3 — Multi-year simulation

**File:** `src/ets/simulation.py`, `src/ets/expectations.py`  
**Detailed doc:** [multi-year-simulation.md](multi-year-simulation.md)

State carried between years:
- **Bank balances** per participant (allowances saved from previous years)
- **MSR reserve pool** (withheld allowances, persists across years when MSR is enabled)
- **Carry-forward allowances** (unsold auction volume, when `unsold_treatment = "carry_forward"`)

Four expectation-formation rules govern how participants predict future carbon prices. Under `perfect_foresight`, the simulation loops until expected and realised prices converge — implementing a **rational expectations equilibrium**.

---

## Computational complexity

| Step | Operations per call | Typical count |
|---|---|---|
| `minimize_scalar` (per participant, per price evaluation) | ~50–100 function evaluations | n_participants × n_brent_evals |
| Brent's method convergence | ~10–20 price evaluations | 1 per year |
| Perfect foresight iterations | 1 full path per iteration | ≤ 25 |
| Nash best-response iterations | 1 full path per iteration | ≤ 120 |
| Hotelling bisection iterations | 1 full path per iteration | ≤ 80 |
| Total (competitive, 5 participants, 5 years) | ~18,750 function evaluations | — |

In practice, all three solvers complete in under 1–2 seconds for typical configurations.

---

## Input validation

Config validation runs at two distinct points in the pipeline:

### Config-time validation (`normalize_year`)

Runs when the raw JSON is first parsed, before any trajectories are applied. Raises `ValueError` immediately if:

| Rule | Description |
|---|---|
| Duplicate participant names | Two participants in the same year share the same `name` |
| Penalty below price floor | `penalty_price > 0` and `penalty_price < price_lower_bound` — the penalty is economically incoherent if it is below the floor |
| `scope2_cbam_coverage` out of range | Must be in `[0, 1]` |

### Build-time validation (`build_market_from_year`)

Runs after policy trajectories have been applied to the year's parameters (cap, floor, ceiling). Raises `ValueError` if:

| Rule | Description |
|---|---|
| Supply exceeds cap | `free_allocations + auction_offered + reserved + cancelled > total_cap` when `total_cap > 0` — the sum of allowance components cannot exceed the declared cap |

**Why two stages?** Trajectory overrides are applied at build time, not parse time. Moving the cap-supply check to build time avoids false positives when a `cap_trajectory` or `free_allocation_trajectory` overrides a per-year config value that would otherwise appear to violate the cap.

---

## Monotonicity guarantee

Brent's method requires that `D(P) − Q` changes sign over the bracketed interval. This is guaranteed because:

1. At `P = 0`: no abatement, full emissions, high demand → `D(0) − Q > 0`
2. At `P = penalty_price × multiplier`: paying the fine is cheaper than buying, demand → 0 → `D(P_high) − Q < 0`

If the upper bound is still insufficient, the solver doubles the upper bound up to 10 times before raising an error.

---

## Related documents

- [MAC & Abatement Models](mac-abatement.md)
- [Technology Transition](technology-transition.md)
- [Market Equilibrium Solver](market-equilibrium.md)
- [Multi-Year Simulation](multi-year-simulation.md)
- [Data Model & Config Schema](data-model.md)
