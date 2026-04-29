# Multi-Year Simulation, Banking, Borrowing & Expectation Formation

**Files:** `src/ets/simulation.py`, `src/ets/expectations.py`, `src/ets/hotelling.py`, `src/ets/nash.py`, `src/ets/msr.py`

A single-year equilibrium is straightforward — find the price where supply meets demand. The multi-year simulation adds three complications: (1) allowances can be saved between years (banking), (2) allowances can be borrowed from the future (borrowing), and (3) both decisions depend on what participants *expect* future prices to be. This document explains how all three interact, and how the Hotelling and Nash-Cournot price paths extend the base competitive model.

---

## Why multiple years matter

In a single-year model, each year is completely independent. In reality, ETS participants are forward-looking:

- A company with cheap abatement might over-abate today, bank the surplus allowances, and sell them when prices are higher.
- A company facing a spike in emissions might borrow next year's allowances to avoid buying at a high spot price.
- Both decisions shift supply and demand in every year they affect, changing the equilibrium price trajectory.

The multi-year simulation captures these dynamics by passing **bank balances** and **carry-forward supply** forward in time, and by solving for **consistent expectations** about future prices.

---

## State carried between years

Three pieces of state propagate from year `t` to year `t+1`:

### 1. Bank balances

A `dict[participant_name → float]` tracking the cumulative allowances each participant has saved (positive) or borrowed (negative):

```
bank_balances_t+1 = {
    participant.name: outcome.ending_bank_balance
    for participant in year_t results
}
```

### 2. MSR reserve pool

When `msr_enabled = true`, the `MSRState.reserve_pool` accumulates withheld allowances and persists across years. See the [MSR Integration](#msr-integration) section below.

### 3. Carry-forward allowances

Unsold auction allowances re-enter the next year's supply if `unsold_treatment = "carry_forward"`:

```python
carry_forward_t+1 = (
    equilibrium["unsold_allowances"]
    if market.unsold_treatment == "carry_forward"
    else 0.0
)
```

---

## Banking: saving allowances for the future

**Enabled by:** `banking_allowed: true` in year config

When a participant ends a year with surplus allowances, they can either sell the surplus immediately or bank it for a future year.

### Banking decision rule

```python
natural_balance = free_allocation + starting_bank_balance - residual_emissions

if natural_balance >= 0.0:                          # surplus
    if banking_allowed and expected_future_price > carbon_price:
        ending_bank_balance = natural_balance       # bank it
    else:
        ending_bank_balance = 0.0                   # sell now
```

**Intuition:** Bank if and only if the future price exceeds the current price. Saving an allowance and selling it next year is like investing at the price-appreciation rate.

### Balance sheet mechanics

```
Starting bank balance   B₀   (carried from previous year)
Free allocation         F    (= initial_emissions × free_allocation_ratio)
Residual emissions      E_r  (= initial_emissions − abatement)
────────────────────────────────────────────────────────
Natural position        N = F + B₀ − E_r

  N > 0: surplus → can bank or sell
  N < 0: shortage → must buy or borrow
```

### Effect on market equilibrium

Banked allowances reduce a participant's net demand in the current year. In future years, they increase supply. This creates a **price-smoothing effect**: participants arbitrage price differences across time.

---

## Borrowing: using future allowances today

**Enabled by:** `borrowing_allowed: true` + `borrowing_limit > 0`

### Borrowing decision rule

```python
if natural_balance < 0.0:                           # shortage
    if borrowing_allowed and carbon_price > expected_future_price:
        ending_bank_balance = max(-borrowing_limit, natural_balance)
    else:
        ending_bank_balance = 0.0                   # buy on market
```

**Intuition:** Borrow if the current price exceeds the expected future price — you'll repay at a lower price.

`ending_bank_balance` is negative when borrowing. Repayment is implicit: in the following year, the negative starting balance increases the participant's effective shortage, raising demand.

---

## Expectation formation rules

Configured per year via `expectation_rule`. Governs the `P_future` used in banking and borrowing decisions.

### Rule 1: `myopic`

```python
expected_future_price = 0.0
```

Participants ignore the future. No banking occurs (surplus is sold immediately). Borrowing logic fires vacuously (current price always exceeds zero), but is bounded by `borrowing_limit`.

**Use case:** Baseline calibration, stress-testing, short-horizon compliance behaviour.

### Rule 2: `next_year_baseline` (default)

```python
expected_future_price = baseline_prices.get(next_year, 0.0)
```

`baseline_prices` is the independent equilibrium price of each year solved in isolation (no banking effects). A reasonable, model-consistent expectation that does not require a fixed-point problem.

**Use case:** Standard setting for most simulations.

### Rule 3: `perfect_foresight`

```python
expected_future_price = realized_prices[next_year]
```

Participants know the actual future equilibrium price. Requires a **fixed-point iteration** — see the [Rational Expectations section](#perfect-foresight--rational-expectations-equilibrium) below.

**Use case:** Economic theory benchmark, long-run policy analysis, internal consistency checks.

### Rule 4: `manual`

```python
expected_future_price = market.manual_expected_price
```

User-specified expected price. No iteration required.

**Use case:** Sensitivity analysis, calibration to observed futures prices, anchored expectations.

---

## Perfect foresight — rational expectations equilibrium

`perfect_foresight` creates a circular dependency (expectations → decisions → outcomes → prices → expectations). Resolved by **fixed-point iteration**:

```
Step 0: Initial guess
    expected_prices = { year: baseline_equilibrium_price(year) }

Step 1–25: Iterate
    a) Simulate full path using expected_prices → realised_prices
    b) Update: expected_prices ← realised_prices (for perfect_foresight years)
    c) max_delta = max |new_expected[y] − old_expected[y]|
    d) If max_delta ≤ solver_competitive_tolerance: CONVERGED
```

Convergence is not mathematically guaranteed for all configurations but holds empirically for well-posed ETS models because the demand function is monotone and banking effects are bounded.

### Example: 3-year convergence

```
Year    Baseline   Iteration 1   Iteration 2   Converged
2030      $45          $52           $50          $50
2035      $55          $50           $51          $51
2040      $65          $65           $65          $65
```

---

## Hotelling price path

**File:** `src/ets/hotelling.py`  
**Activated by:** `model_approach: "hotelling"`

### Theory

The Hotelling Rule (1931) states that for an exhaustible resource in competitive equilibrium, the net price (royalty) must rise at the rate of interest — otherwise owners would rearrange extraction to exploit arbitrage. Applied to carbon allowances, with an optional **risk premium** `ρ` to reflect the extra return required by risk-averse holders:

```
P*(t) = λ · (1 + r + ρ)^(t − t₀)
```

If prices rose faster than `r`, participants would bank heavily today, cutting current supply and driving prices up. If prices rose slower, they would front-load compliance, reducing future demand. The Hotelling condition is the no-arbitrage price path consistent with using the allowance budget exactly over the policy horizon.

### Implementation

1. **Pin prices:** For a given candidate `λ`, set `price_lower_bound = price_upper_bound = P_hotelling(t)` on a copy of each year's market. Run all participants at the pinned price (Layer 1 compliance optimisation). Sum residual emissions.

2. **Bisect on `λ`:** The total residual emissions across all years is a decreasing function of `λ` (higher `λ` → higher prices → more abatement). Bisect `λ` until:

   ```
   |Σ_t residual_emissions(t) − carbon_budget| / carbon_budget ≤ solver_hotelling_convergence_tol
   ```

3. **Bracket expansion:** If the initial bracket `[0, λ_max]` does not contain a sign change, `λ_max` is doubled up to `solver_hotelling_max_lambda_expansions` times.

### Config fields

| Field | Role |
|---|---|
| `carbon_budget` | Cumulative Mt CO₂e limit across all years in the scenario |
| `discount_rate` | Annual discount rate `r` used in `(1+r+ρ)^t` |
| `risk_premium` | Additional return `ρ` steepening the price path (default 0.0) |
| `solver_hotelling_max_bisection_iters` | Maximum bisection steps (default 80) |
| `solver_hotelling_max_lambda_expansions` | Bracket-expansion attempts (default 20) |
| `solver_hotelling_convergence_tol` | Relative tolerance on cumulative emissions (default 1e-4) |

### Key difference from competitive

In competitive mode, each year's price is determined by supply-demand clearing. In Hotelling mode, prices are **pinned** to the theoretical path; the solver finds the `λ` that exhausts the budget. Participants are still price-takers at the pinned price — they do not know `λ` explicitly.

---

## Nash-Cournot price path

**File:** `src/ets/nash.py`  
**Activated by:** `model_approach: "nash_cournot"`

### Theory

In the competitive model, all participants are price-takers: each believes its own actions do not affect the market price. In the Nash-Cournot model, **strategic participants** internalise their price impact. A large buyer knows that buying more raises the price it pays, so it voluntarily under-demands — reducing total abatement below the competitive level and raising the equilibrium price paid by non-strategic participants.

The equilibrium concept is a **Cournot-Nash equilibrium in abatement quantities**: a profile of abatement levels `(a₁*, …, aₙ*)` such that no strategic participant `i` can lower its total compliance cost by unilaterally deviating from `aᵢ*`.

### Strategic vs non-strategic participants

Participants named in `nash_strategic_participants` are treated as strategic. All others are price-takers throughout the iteration. This allows mixed markets — e.g. one dominant industrial buyer who is strategic, and many small participants who are competitive.

### Best-response iteration algorithm

```
1. Initialise strategies from competitive equilibrium
   a_i^(0) = competitive abatement for each strategic participant i

2. For each iteration k:
   For each strategic participant i:
     a. Compute residual demand excluding i:
        Q_residual(P) = Σ_{j ≠ i} net_demand_j(P) (non-strategic at current equilibrium)
     b. Derive residual inverse demand: P(Q_i) from Q_total = Q_residual + Q_i
     c. Solve i's best response:
        min_{a_i} compliance_cost_i(a_i) + P(net_demand_i(a_i)) · net_demand_i(a_i)
   Update all strategies simultaneously (Jacobi-style)

3. Convergence: max|a_i^(k) − a_i^(k-1)| ≤ solver_nash_convergence_tol → STOP
```

`solver_nash_price_step` (default 0.5 $/t) controls the discretisation step when constructing the residual demand curve numerically.

### Config fields

| Field | Role |
|---|---|
| `nash_strategic_participants` | List of participant names treated as strategic |
| `solver_nash_price_step` | Step size for residual demand curve ($/t) |
| `solver_nash_max_iters` | Maximum best-response iterations (default 120) |
| `solver_nash_convergence_tol` | Convergence tolerance on abatement (Mt) (default 0.001) |

### Interpretation

Nash-Cournot produces **higher equilibrium prices and lower abatement** than the competitive model when strategic participants have market power. The gap between competitive and Nash prices measures the market-power distortion. This is useful for assessing how concentrated compliance demand affects price formation.

---

## Policy trajectories

**Configured at:** scenario level  
**Applied at:** build time (after per-year config is loaded, before market clearing)

Policy trajectories let you specify smooth, linearly interpolated paths for four scenario-level parameters without setting them individually in every year config. Each trajectory is defined by a start year, end year, start value, and end value.

### Free-allocation phase-out (`free_allocation_trajectories`)

A list of per-participant trajectories. Overrides each participant's `free_allocation_ratio` in years that fall within `[start_year, end_year]`:

```json
"free_allocation_trajectories": [
  {
    "participant_name": "Steel Plant A",
    "start_year": "2026",
    "end_year": "2034",
    "start_ratio": 1.0,
    "end_ratio": 0.0
  }
]
```

Years before `start_year` use the participant's per-year `free_allocation_ratio`. Years after `end_year` use `end_ratio`. Years between are linearly interpolated.

### Cap trajectory (`cap_trajectory`)

Overrides `total_cap` for years within the trajectory window:

```json
"cap_trajectory": {
  "start_year": "2026",
  "end_year": "2035",
  "start_value": 500.0,
  "end_value": 300.0
}
```

This allows a smoothly declining cap without specifying `total_cap` in each year config.

### Price floor trajectory (`price_floor_trajectory`)

Overrides `price_lower_bound` for years within the window:

```json
"price_floor_trajectory": {
  "start_year": "2026",
  "end_year": "2035",
  "start_value": 15.0,
  "end_value": 50.0
}
```

### Price ceiling trajectory (`price_ceiling_trajectory`)

Overrides `price_upper_bound` for years within the window:

```json
"price_ceiling_trajectory": {
  "start_year": "2026",
  "end_year": "2035",
  "start_value": 150.0,
  "end_value": 300.0
}
```

### Interpolation formula

All four trajectory types use the same linear interpolation:

```
value(t) = start_value + (end_value − start_value)
           × (t − start_year) / (end_year − start_year)
```

Years outside `[start_year, end_year]` are not overridden by the trajectory — those years use their per-year config values as-is.

### Interaction with cap-supply validation

The cap consistency check (`free_allocations + auction_offered + reserved + cancelled ≤ total_cap`) runs **after** trajectories are applied. This means you can safely set `free_allocation_ratio` to a high value in per-year configs while a `free_allocation_trajectory` reduces it at build time — the validator will see the trajectory-adjusted value, not the config value.

---

## MSR integration

**File:** `src/ets/msr.py`  
**Enabled by:** `msr_enabled: true`

The MSR adjusts auction supply **before each year's market clearing**. The sequence within Layer 3 for each year `t` is:

```
1. Compute total_bank = Σ_i starting_bank_balance_i

2. Apply MSR:
   effective_auction, withheld, released = msr_state.apply(
       total_bank, auction_offered, upper_threshold, lower_threshold,
       withhold_rate, release_rate, cancel_excess, cancel_threshold
   )

3. Solve equilibrium with effective_auction as the supply target

4. Update msr_state.reserve_pool (persists to year t+1)
```

The equilibrium solver (Layer 2) receives `effective_auction` — it has no visibility into whether supply was adjusted by the MSR. MSR withholding/release amounts appear in the year-level outputs alongside `auction_sold` and `unsold_allowances`.

**The MSR does not interact with banking decisions directly.** Participants form banking expectations based on `expected_future_price`, not on the MSR rule. However, MSR adjustments change the actual equilibrium price, which feeds back into banking behaviour in subsequent years through the `next_year_baseline` or `perfect_foresight` expectation rules.

---

## CBAM: post-equilibrium computation

**Does not affect market clearing.**

CBAM liability is computed after `P*` is determined for each year. It appears in participant-level outputs as an additional cost item and does not feed back into the clearing equation.

### Single-jurisdiction CBAM

```
cbam_liability_i = max(0, eua_price − P*) × residual_emissions_i
                   × cbam_export_share_i × cbam_coverage_ratio_i
```

`eua_price` is set in the year config; `P*` is the domestic equilibrium price from whichever solver was used.

### Multi-jurisdiction CBAM

When a participant specifies `cbam_jurisdictions`, liability is computed for each jurisdiction separately using the per-jurisdiction `eua_prices[name]` from the year config. Results appear as `CBAM Liability (EU)`, `CBAM Liability (UK)`, etc.

### EUA price ensemble

Setting `eua_price_ensemble` in the year config evaluates CBAM liability under multiple forecast prices simultaneously (e.g. `{"EC": 70.0, "Enerdata": 75.0, "BNEF": 82.0}`). Each source yields its own liability column, allowing side-by-side comparison without re-running the simulation.

### Scope 2 / indirect emissions

Participants with electricity consumption have an additional post-equilibrium liability:

```
indirect_emissions_i = electricity_consumption_i × grid_emission_factor_i

scope2_cbam_liability_i = max(0, eua_price − P*) × indirect_emissions_i
                          × scope2_cbam_coverage_i
```

`Indirect Emissions` and `Scope 2 CBAM Liability` are reported alongside direct CBAM columns. The `scope2_cbam_coverage` field controls what fraction of indirect emissions is subject to the border adjustment.

### Sector-level aggregates

The `scenario_summary` output includes sector-group rows (keyed by `sector_group`) that aggregate across all participants in a sector:

- `{sector} Allowance Buys` — total net allowances bought
- `{sector} Allowance Cost` — total direct compliance spend
- `{sector} Auction Revenue Share` — proportional share of total auction revenue (by buy volume)
- `{sector} Indirect Emissions` — sum of indirect (Scope 2) emissions
- `{sector} Scope 2 CBAM Liability` — sum of Scope 2 CBAM exposure

---

## Sequential year execution

The inner simulation loop runs each year in order — each year depends on the previous year's output:

```python
bank_balances = {p.name: 0.0 for p in first_year_participants}
carry_forward = 0.0

for market in ordered_markets:
    expected_future_price = expected_prices[str(market.year)]

    # MSR adjustment (if enabled)
    if market.msr_enabled:
        total_bank = sum(bank_balances.values())
        effective_auction, withheld, released = msr_state.apply(total_bank, ...)
    else:
        effective_auction = market.auction_offered

    # Equilibrium
    equilibrium = market.solve_equilibrium(
        bank_balances=bank_balances,
        expected_future_price=expected_future_price,
        carry_forward_in=carry_forward,
        auction_override=effective_auction,
    )
    P_star = equilibrium["price"]

    # Participant outcomes + CBAM
    participant_df = market.participant_results(P_star, bank_balances, expected_future_price)

    # State update
    carry_forward = (
        equilibrium["unsold_allowances"]
        if market.unsold_treatment == "carry_forward" else 0.0
    )
    bank_balances = {
        row["Participant"]: row["Ending Bank Balance"]
        for _, row in participant_df.iterrows()
    }
```

---

## Interaction between banking and price trajectory

Banking creates a **price-smoothing arbitrage**. Consider a scenario where the cap tightens sharply in 2035:

**Without banking:**
```
2030: P* = $30   (loose cap, low price)
2035: P* = $90   (tight cap, price spikes)
```

**With banking + next_year_baseline expectations:**
```
2030: P* = $55   (participants bank → less current supply → price rises)
2035: P* = $60   (banked allowances re-enter → price falls from $90)
```

Banking arbitrages the price difference down until the differential equals the opportunity cost of holding allowances (zero here — no discounting in the base competitive model).

---

## Edge cases and guards

| Situation | Handling |
|---|---|
| First year (no prior bank balance) | All `starting_bank_balance = 0` |
| Last year (no next year) | `expected_future_price = 0` regardless of rule |
| Participant added mid-pathway | Starts with `bank_balance = 0` |
| Borrowing limit = 0 | Disables borrowing even if `borrowing_allowed = true` |
| `perfect_foresight` on only some years | Other years use their own rules; iteration only updates perfect_foresight years |
| MSR disabled | `reserve_pool` never created; `effective_auction = auction_offered` |
| `carbon_budget = 0` with Hotelling | Solver raises an error — a finite budget is required to bisect `λ` |
| Nash with no strategic participants | Falls back to competitive equilibrium |

---

## See also

- [Market Equilibrium Solver](market-equilibrium.md) — how each year's price is found
- [MAC & Abatement Models](mac-abatement.md) — how participant demand responds to price
- [Algorithm Overview](algorithm-overview.md) — full execution flow and modelling approaches
