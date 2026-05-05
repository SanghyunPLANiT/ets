# Algorithm Overview

The simulator is organised as **three nested layers**. Each layer has a single, well-defined responsibility. Understanding how they compose is the key to understanding the whole system.

---

## The Three-Layer Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Layer 3 — Multi-Year Path                                         │
│  src/ets/solvers/simulation.py, hotelling.py, nash.py              │
│                                                                    │
│  For each year t = 2026, 2030, 2035 …                              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Layer 2 — Market Equilibrium                                │  │
│  │  src/ets/market/equilibrium.py                               │  │
│  │                                                              │  │
│  │  Find P* such that  Σ demand_i(P*) = auction_supply Q        │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Layer 1 — Participant Optimisation                    │  │  │
│  │  │  src/ets/participant/compliance.py                     │  │  │
│  │  │                                                        │  │  │
│  │  │  min_a  TotalCost(a, P)  for each participant i        │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

The layers call each other in sequence:

- **Layer 3** iterates over years and manages state (bank balances, carry-forward allowances, MSR reserve pool) between them.
- **Layer 2** is called once per year. It evaluates total market demand at many trial prices by calling Layer 1.
- **Layer 1** is called once per participant per trial price. It solves a bounded scalar optimisation to find the cost-minimising abatement level.

---

## Layer 1: Participant Compliance Optimisation

**File:** `src/ets/participant/compliance.py`

### Objective function

Each participant minimises total compliance cost over a scalar decision variable — abatement `a`:

$$\min_{a} \; C_F + C_{MAC}(a) + C_{ETS}(a, P) + C_{penalty}(a, P) - R_{sales}(a, P) - P_f \cdot B(a, P)$$

where:

| Symbol | Name | Definition |
|---|---|---|
| $a$ | Abatement | Mt CO₂e reduced; bounded $[0, a_{max}]$ |
| $C_F$ | Fixed technology cost | One-time adoption cost per year active (`fixed_cost`) |
| $C_{MAC}(a)$ | Abatement cost | Area under the MAC curve from 0 to `a` |
| $C_{ETS}(a, P)$ | Allowance purchase cost | `allowance_buys × P` |
| $C_{penalty}(a, P)$ | Penalty cost | `penalty_emissions × penalty_price` |
| $R_{sales}(a, P)$ | Sales revenue | `allowance_sells × P` |
| $P_f$ | Expected future price | From expectation rule; used to value banked allowances |
| $B(a, P)$ | Ending bank balance | Allowances saved for future years (can be negative = borrowed) |

**Intuition:** A participant first decides how much to abate (reducing the compliance obligation), then decides whether to buy, sell, bank, or borrow the residual obligation relative to free allocation received.

### Abatement decision by MAC type

**Linear MAC** (`abatement_type = "linear"`):

$$C_{MAC}(a) = \frac{1}{2} \cdot \sigma \cdot a^2$$

where `σ` is `cost_slope` (₩/t per Mt). The total abatement cost is the area of a triangle under the linear MAC curve. The optimal abatement in isolation (ignoring banking) satisfies `MAC(a*) = P`, giving `a* = P / σ`, bounded by `max_abatement`.

Solving `minimize_scalar` is used with bounds `[0, max_abatement]` via scipy's `"bounded"` method (Brent's method in 1D).

**Piecewise MAC** (`abatement_type = "piecewise"`):

The MAC is a step function with blocks ordered by non-decreasing marginal cost:

$$C_{MAC}(a) = \sum_{k} c_k \cdot \min\!\left(\text{amount}_k,\; \max\!\left(0,\; a - \sum_{j<k} \text{amount}_j\right)\right)$$

Each block has a constant marginal cost `c_k` for up to `amount_k` Mt. In the piecewise case, `minimize_scalar` is still used because the total cost is still a convex function of `a`.

**Threshold MAC** (`abatement_type = "threshold"`):

Binary decision — abate 0 or `max_abatement`. Whichever discrete option produces the lower total cost is chosen:

```python
abatement = min([0.0, max_abatement], key=total_cost)
```

### Banking and borrowing decision rule

After fixing abatement, the **natural position** is computed:

$$N = F + B_0 - E_r$$

where $F$ = free allocation, $B_0$ = starting bank balance, $E_r$ = residual emissions = `initial_emissions − abatement`.

```python
# Surplus case (N >= 0)
if banking_allowed and P_future > P_current:
    ending_bank = N          # bank the surplus, sell later at higher price
else:
    ending_bank = 0.0        # sell surplus now

# Deficit case (N < 0)
if borrowing_allowed and P_current > P_future:
    ending_bank = max(-borrowing_limit, N)   # borrow: negative bank balance
else:
    ending_bank = 0.0        # buy on market now
```

**Intuition:** Save allowances when future prices exceed current prices (like earning a return); borrow when current prices exceed future prices (cheaper to repay later).

### Penalty logic

When $P^* \leq \text{penalty\_price}$, it is cheaper to buy allowances on the market:

$$\text{allowance\_buys} = \max(0,\; E_r + B_{end} - F - B_0)$$

When $P^* > \text{penalty\_price}$, it is cheaper to pay the fine:

$$\text{penalty\_emissions} = \max(0,\; E_r + B_{end} - F - B_0)$$

A `penalty_price = 0` is interpreted as "no compliance cap" and treated as infinity, forcing participants to always buy rather than pay fines.

### Technology-switching decision

When a participant has `technology_options`, two cases arise:

**Exclusive choice** (no option has `max_activity_share < 1`): Each technology is evaluated independently via `_optimize_for_technology()`. The technology with minimum total cost is selected.

**Mixed portfolio** (at least one option has `max_activity_share < 1`): A continuous share vector `s = [s₁, …, sₙ]` is optimised via SLSQP with constraint `Σsᵢ = 1` and bounds `0 ≤ sᵢ ≤ max_activity_share_i`. This allows smooth transitions between technologies.

```python
result = minimize(
    objective,          # total cost as function of activity shares
    x0=initial_shares,
    method="SLSQP",
    bounds=[(0, cap_i) for cap_i in share_caps],
    constraints=[{"type": "eq", "fun": lambda s: sum(s) - 1.0}],
    options={"maxiter": 400, "ftol": 1e-9},
)
```

---

## Layer 2: Market Equilibrium

**File:** `src/ets/market/equilibrium.py`

### Equilibrium condition

The market clears when aggregate net demand equals auction supply:

$$D(P^*) = Q$$

where:
- $D(P) = \sum_i \text{net\_demand}_i(P)$ — aggregate net allowance demand (buys minus sells)
- $Q$ = `effective_auction_offered` = `auction_offered + carry_forward_in`
- $P^*$ = equilibrium carbon price

### Why $D(P)$ is monotonically non-increasing

At higher prices, participants abate more and buy fewer allowances. The demand function is therefore weakly decreasing in $P$. This guarantees that the function $D(P) - Q$ changes sign exactly once over any interval bracketing the root.

### Bracketing procedure

The solver constructs a bracket `[P_low, P_high]` such that `D(P_low) - Q > 0` and `D(P_high) - Q < 0`:

- `P_low` = `max(price_lower_bound, auction_reserve_price)` — at this price, demand is high (little abatement)
- `P_high` = `max(penalty_price) × solver_penalty_price_multiplier` — at this price, all participants prefer to pay the fine over buying; demand collapses to zero

If the bracket fails (no sign change), the upper bound is doubled up to 10 times:

```python
for _ in range(10):
    if f_low * f_high <= 0:
        break
    upper_bound *= 2.0
    f_high = total_net_demand(market, upper_bound, ...) - target_supply
```

### Brent's method

scipy's `root_scalar` with `method="brentq"` is used. Brent's method combines bisection (guaranteed convergence), secant method (fast local convergence), and inverse quadratic interpolation. It converges super-linearly and requires only function evaluations (no derivatives).

```python
solution = root_scalar(
    lambda P: total_net_demand(market, P, ...) - target_supply,
    bracket=[lower_bound, upper_bound],
    method="brentq",
)
```

### Auction mechanics (three conditions)

**Condition 1 — Demand exceeds supply at floor price:**

If `D(floor_price) ≥ Q`, a standard Brent root-finding solve is used targeting `D(P*) = Q`. The auction clears fully.

**Condition 2 — Demand is below supply but above minimum coverage:**

If `D(floor_price) < Q` but `D(floor_price) / Q ≥ minimum_bid_coverage`:
- `auction_sold = D(floor_price)`
- `price = floor_price`
- Unsold allowances are disposed per `unsold_treatment`

**Condition 3 — Demand is below minimum coverage:**

The auction fails entirely. All allowances are unsold. The equilibrium price is solved for zero auction supply (Brent targeting `D(P*) = 0`). Participants still clear compliance obligations via OTC trades at this shadow price.

### Price bounds application

`price_lower_bound` and `price_upper_bound` are applied as hard constraints on the solution. The equilibrium price is clamped to `[price_lower_bound, price_upper_bound]` when both are set. The bounds can be set to identical values (pinned price) which is how the Hotelling solver forces the price to the theoretical path.

### Supply identity

```
effective_supply = free_allocations + auction_offered + reserved + cancelled
assert effective_supply ≤ total_cap
```

`unallocated_allowances = max(0, total_cap - effective_supply)` captures any gap between the cap and distributed allowances.

---

## Layer 3: Multi-Year Simulation

**File:** `src/ets/solvers/simulation.py`

### State propagation

Three pieces of state propagate from year `t` to year `t+1`:

| State variable | Type | Description |
|---|---|---|
| `bank_balances` | `dict[str, float]` | Per-participant allowance savings (positive) or borrowings (negative) |
| `carry_forward_allowances` | float | Unsold auction volume when `unsold_treatment = "carry_forward"` |
| `msr_state.reserve_pool` | float | Accumulated withheld allowances in the MSR pool |

### Expectation rules — all four

The `expectation_rule` field on each year selects how $P_f$ (expected future price) is formed. This value is passed to every participant's compliance optimisation for their banking/borrowing decision.

**Rule 1 — `myopic`:**

$$P_f = 0$$

Participants ignore the future entirely. No banking occurs (surplus is sold immediately because $P_f < P^*$ always). Useful as a baseline that eliminates intertemporal arbitrage.

**Rule 2 — `next_year_baseline`** (default):

$$P_f = \text{baseline\_price}(\text{next\_year})$$

`baseline_prices` is computed by solving each year's equilibrium independently (no banking, no carry-forward). This is a model-consistent, non-circular expectation that does not require a fixed-point problem.

**Rule 3 — `perfect_foresight`:**

$$P_f = P^*_{\text{next\_year}}$$

Participants know the actual future equilibrium price. This creates a circular dependency resolved by **fixed-point iteration** (see below).

**Rule 4 — `manual`:**

$$P_f = \text{manual\_expected\_price}$$

User-specified. Used for sensitivity analysis or when calibrating to observed futures prices.

### Perfect-foresight fixed-point iteration

When any year uses `perfect_foresight`, the system is circular: expectations affect banking decisions, which affect equilibrium prices, which feed back into expectations. The solver resolves this by iterating until convergence:

```python
# Initial guess: baseline prices
expected_prices = {year: baseline_price(year) for year in years}

for iteration in range(solver_competitive_max_iters):
    # Step A: simulate full path with current expected prices
    realized_prices = _simulate_realized_prices(markets, expected_prices)

    # Step B: update only perfect_foresight years
    updated = derive_expected_prices(years, specs, baseline_prices,
                                     realized_prices=realized_prices)

    # Step C: check convergence
    max_delta = max(|updated[y] - expected_prices[y]| for y in years)
    expected_prices = updated
    if max_delta <= solver_competitive_tolerance:
        break   # converged
```

The MSR is deliberately excluded from the inner convergence loop — it is applied only in the final path simulation. This prevents the MSR's discontinuous rule from disrupting convergence.

### Year-by-year execution pseudocode

```python
bank_balances = {p.name: 0.0 for p in first_year_participants}
carry_forward = 0.0
msr_state = MSRState() if msr_enabled else None

for market in ordered_markets:                     # chronological order
    P_future = expected_prices[market.year]
    B_start  = dict(bank_balances)

    # ── 1. MSR supply adjustment ─────────────────────────────
    if msr_state and market.msr_enabled:
        total_bank = sum(bank_balances.values())
        effective_auction, withheld, released = msr_state.apply(
            total_bank, market.auction_offered,
            upper_threshold, lower_threshold,
            withhold_rate, release_rate, cancel_excess, cancel_threshold,
        )
        effective_carry = carry_forward + released - withheld
    else:
        effective_carry = carry_forward

    # ── 2. Market clearing (Layer 2) ─────────────────────────
    equilibrium = market.solve_equilibrium(
        bank_balances=bank_balances,
        expected_future_price=P_future,
        carry_forward_in=effective_carry,
    )
    P_star = equilibrium["price"]

    # ── 3. Participant outcomes + CBAM (Layer 1 + post-process)
    participant_df = market.participant_results(P_star, bank_balances, P_future)

    # ── 4. State update ───────────────────────────────────────
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

## Hotelling Rule Solver

**File:** `src/ets/solvers/hotelling.py`

### Theory

Harold Hotelling (1931) showed that the optimal price path for an exhaustible resource must rise at the rate of interest, otherwise intertemporal arbitrage opportunities exist. Applied to carbon allowances with a risk premium:

$$P^*(t) = \lambda \cdot (1 + r + \rho)^{t - t_0}$$

where:

| Symbol | Name | Default |
|---|---|---|
| $\lambda$ | Shadow price (royalty) at base year $t_0$ | Bisected |
| $r$ | Risk-free annual discount rate | `discount_rate` = 0.04 |
| $\rho$ | Policy/market risk premium | `risk_premium` = 0.0 |
| $t_0$ | Base year (first year of simulation) | Automatic |
| $t$ | Year number | From year label |

The risk premium $\rho$ captures the additional return required by holders facing policy uncertainty (future cap ambiguity, MSR rule changes, CBAM schedule). Setting $\rho = 0$ recovers the pure Hotelling path.

### Shadow price bisection algorithm

`λ` is found by bisection because total residual emissions is a strictly decreasing function of `λ` (higher `λ` → higher prices → more abatement):

```python
# Step 1: bracket
lam_low, lam_high = 0.001, 20.0

for _ in range(max_lambda_expansions):
    if total_emissions(lam_low) > total_budget:
        break
    lam_low /= 2.0             # need lower prices → smaller λ

for _ in range(max_lambda_expansions):
    if total_emissions(lam_high) < total_budget:
        break
    lam_high *= 3.0            # need higher prices → larger λ

# Step 2: bisect
for _ in range(max_bisection_iters):
    lam_mid = (lam_low + lam_high) / 2.0
    details, em_mid = simulate_at_hotelling_prices(lam_mid)
    if |em_mid - total_budget| / total_budget <= convergence_tol:
        break
    if em_mid > total_budget:
        lam_low = lam_mid      # too many emissions → need higher λ
    else:
        lam_high = lam_mid     # too few emissions → need lower λ
```

**Carbon budget:** `total_budget = Σ_t carbon_budget_t`. If per-year `carbon_budget` is zero, the solver falls back to `Σ_t total_cap_t` and logs a warning. If the bracket cannot be established after `max_lambda_expansions` attempts, the solver falls back to the competitive path.

### Execution at pinned Hotelling price

For each candidate `λ`, each year's market is solved by running participants directly at the Hotelling price — **no Brent's method is used in Hotelling mode**:

```python
p_hotelling = λ · (1 + r + ρ)^(t − t₀)
p_effective = clamp(p_hotelling, price_lower_bound, price_upper_bound)
participant_df = market.participant_results(p_effective, ...)
```

Bank balances still propagate exactly as in competitive mode. The Hotelling condition governs the price path; participants respond optimally at each pinned price.

---

## Nash-Cournot Solver

**File:** `src/ets/solvers/nash.py`

### Equilibrium concept

A **Cournot-Nash equilibrium in abatement quantities**: a profile $(a_1^*, \ldots, a_n^*)$ such that no strategic participant $i$ can reduce total compliance cost by unilaterally deviating from $a_i^*$. Non-strategic participants remain price-takers throughout.

### Residual demand concept

For strategic participant $i$, the residual demand curve from all other participants is:

$$Q_{-i}(P) = \sum_{j \neq i} \text{net\_demand}_j(P)$$

The equilibrium price is determined by:

$$P(Q_i) : Q_{-i}(P) + Q_i = Q_{\text{auction}}$$

A strategic participant internalises this inverse relationship — increasing demand raises the price it pays.

### Price impact estimation

The price impact `dP/dQ` is estimated via finite difference:

```python
slope_dD_dP = (D(P + δ) - D(P - δ)) / (2δ)    # δ = solver_nash_price_step
dP_dQ = -1 / slope_dD_dP                         # positive: higher demand → higher price
```

### Jacobi best-response iteration

```
1. Initialise: a_i^(0) = competitive abatement for all strategic participants i

2. For each iteration k:
   For each strategic participant i simultaneously (Jacobi, not Gauss-Seidel):

     a. Compute Q_{-i} = net demand from all others at current price
     b. Solve participant i's best response:
        min_{a_i} compliance_cost_i(a_i, P(a_i | Q_{-i}))
        where P is updated by price impact: ΔP ≈ dP/dQ × Δ(net_demand_i)
     c. Record new a_i^(k+1)

3. Update all strategies simultaneously:
   a_i ← a_i^(k+1) for all i

4. Convergence check:
   max_i |a_i^(k+1) - a_i^(k)| <= solver_nash_convergence_tol  → STOP
```

**Jacobi vs Gauss-Seidel:** All strategies are updated simultaneously (Jacobi style) to avoid sequential-update artifacts where early participants in the loop have information advantages.

### Convergence criterion

$$\max_i \left|a_i^{(k+1)} - a_i^{(k)}\right| \leq \text{solver\_nash\_convergence\_tol}$$

If this is not achieved within `solver_nash_max_iters` iterations, the solver logs a warning and uses the current best approximation. The final equilibrium price is re-solved via Brent's method at the converged abatement profile.

### Strategic vs non-strategic participants

```python
# From solve_nash_path():
all_names = {p.name for p in markets[0].participants}
strategic_names = set(nash_strategic_participants) if nash_strategic_participants else all_names
# If nash_strategic_participants is empty → all participants are strategic
```

Non-strategic participants are fixed price-takers throughout the iteration. The strategic participants' best-response optimisation accounts for price impact. This creates a mixed market — useful for modelling one dominant buyer among many small firms.

---

## Market Stability Reserve (MSR)

**File:** `src/ets/solvers/msr.py`

### Rule pseudocode

```
MSRState: { reserve_pool: float }

def apply(total_bank, auction_offered, upper_threshold, lower_threshold,
          withhold_rate, release_rate, cancel_excess, cancel_threshold):

    withheld = 0.0
    released = 0.0

    if total_bank > upper_threshold:
        withheld = min(withhold_rate × auction_offered, auction_offered)
        reserve_pool += withheld
        # effective_auction = auction_offered - withheld

    elif total_bank < lower_threshold AND reserve_pool > 0:
        released = min(release_rate, reserve_pool)
        reserve_pool -= released
        # effective_auction = auction_offered + released

    if cancel_excess AND reserve_pool > cancel_threshold:
        cancelled = reserve_pool - cancel_threshold
        reserve_pool = cancel_threshold
        # Cancelled allowances are permanently destroyed

    effective_auction = max(0, auction_offered - withheld + released)
    return effective_auction, withheld, released
```

### MSR parameters and defaults

| Parameter | Default | Description |
|---|---|---|
| `msr_enabled` | `false` | Must be `true` to activate; off by default |
| `msr_upper_threshold` | `200.0` Mt | Bank level above which withholding fires |
| `msr_lower_threshold` | `50.0` Mt | Bank level below which release fires |
| `msr_withhold_rate` | `0.12` | Fraction of `auction_offered` withheld per year (12%) |
| `msr_release_rate` | `50.0` Mt | Volume released per year when bank is below lower threshold |
| `msr_cancel_excess` | `false` | When `true`, pool above `msr_cancel_threshold` is permanently cancelled |
| `msr_cancel_threshold` | `400.0` Mt | Pool ceiling above which excess is cancelled |

### Effect on price dynamics

The MSR creates a **stabilising feedback loop**: when the bank is too large (low-price environment), auction supply is reduced, tightening the market; when the bank is depleted (high-price environment), stored allowances are released, easing supply. This dampens the price volatility caused by asymmetric banking incentives.

The MSR acts on the auction supply **before** market clearing. The equilibrium solver sees only `effective_auction` — it has no direct visibility into the MSR mechanism.

---

## CBAM (Carbon Border Adjustment Mechanism)

CBAM liability is computed **after** market clearing — it does not feed back into the equilibrium price.

### Single-jurisdiction formula

For each participant with `cbam_export_share > 0`:

$$\text{CBAM\_liability}_i = \max(0,\; P_{EUA} - P^*) \times E_{r,i} \times s_i \times c_i$$

where:

| Symbol | Name | Config field |
|---|---|---|
| $P_{EUA}$ | EU ETS reference price | `eua_price` |
| $P^*$ | Domestic equilibrium price | Solved by Layer 2 |
| $E_{r,i}$ | Participant's residual emissions (Mt) | `residual_emissions` |
| $s_i$ | Export share | `cbam_export_share` |
| $c_i$ | Coverage ratio | `cbam_coverage_ratio` |

**Interpretation:** CBAM charges the price gap between the importing jurisdiction and the domestic price, applied to the share of residual emissions embedded in exports. If $P^* \geq P_{EUA}$, the liability is zero (domestic price is already at or above the EUA level).

### Multi-jurisdiction CBAM

When `cbam_jurisdictions` is non-empty, each jurisdiction contributes independently:

$$\text{CBAM\_liability}_i = \sum_j \max(0,\; P_{j} - P^*) \times E_{r,i} \times s_{ij} \times c_{ij}$$

where $P_j$ is looked up from `eua_prices[name_j]`, falling back to the per-jurisdiction `reference_price` if set, then to the scalar `eua_price`.

Results appear as separate columns: `CBAM Liability (EU)`, `CBAM Liability (UK)`, `CBAM Gap (EU)`, etc.

### EUA price ensemble

Setting `eua_price_ensemble` (e.g. `{"EC": 70, "Enerdata": 75, "BNEF": 82}`) evaluates CBAM liability under multiple forecast prices simultaneously. Each source produces its own `CBAM Liability (source)` column in participant results — enabling a fan chart of CBAM exposure without duplicating scenarios.

### Scope 2 / indirect emissions

Participants with electricity consumption have additional indirect emissions and potential CBAM exposure:

$$\text{indirect\_emissions}_i = E_{elec,i} \times G_i$$

$$\text{Scope2\_CBAM}_i = \max(0,\; P_{EUA} - P^*) \times \text{indirect\_emissions}_i \times k_i$$

where:
- $E_{elec,i}$ = `electricity_consumption` (MWh)
- $G_i$ = `grid_emission_factor` (tCO₂/MWh)
- $k_i$ = `scope2_cbam_coverage` (fraction of indirect emissions in CBAM scope)

Both `Indirect Emissions` and `Scope 2 CBAM Liability` appear in participant-level outputs. They do not affect market clearing.

---

## Output-Based Allocation (OBA)

**Files:** `src/ets/config_io/builder.py` (override logic), `src/ets/participant/models.py` (property)

### Formula

$$\text{free\_allocation}_i = \beta_i \times Y_i$$

where:
- $\beta_i$ = `benchmark_emission_intensity` (tCO₂/unit of product)
- $Y_i$ = `production_output` (units/year, e.g. Mt steel)

This is then converted to a ratio for internal use:

$$\text{free\_allocation\_ratio}_i = \min\!\left(1,\; \frac{\beta_i \times Y_i}{E_{0,i}}\right)$$

where $E_{0,i}$ = `initial_emissions`.

### Override priority

OBA takes the highest priority when both `production_output > 0` AND `benchmark_emission_intensity > 0`:

```
1. OBA override (highest):    production_output × benchmark_emission_intensity
2. Sector-derived allocation: sector_pool × sector_allocation_share
3. Per-year free_allocation_ratio (lowest)
```

The builder applies these in reverse order so that OBA always wins when set.

### When OBA fires

```python
# From builder.py:
for p in raw_participants:
    po  = float(p.get("production_output") or 0.0)
    bei = float(p.get("benchmark_emission_intensity") or 0.0)
    ie  = float(p.get("initial_emissions") or 0.0)
    if po > 0 and bei > 0 and ie > 0:
        free_alloc_mt = bei * po
        p["free_allocation_ratio"] = min(1.0, free_alloc_mt / ie)
```

OBA does not fire if any of the three values is zero. This allows participants to have OBA fields set without activating the override (e.g. when exploring what a benchmark would imply without changing behaviour).

---

## BAU Trajectory

**File:** `src/ets/config_io/builder.py` (`_interp_value` function)

### What it does

The `initial_emissions_trajectory` field allows a participant's BAU gross emissions to decline (or change) smoothly over the simulation horizon, without requiring separate `initial_emissions` values in every year config.

### Interpolation formula

$$E_0(t) = E_{start} + (E_{end} - E_{start}) \cdot \frac{t - t_{start}}{t_{end} - t_{start}}$$

Years before `start_year` receive `start_value`. Years after `end_year` receive `end_value`. Years between are linearly interpolated.

### Override interaction

The trajectory **overrides** the per-year `initial_emissions` field in the participant config:

```python
ie_traj = participant.get("initial_emissions_trajectory") or {}
if ie_traj:
    overridden = _interp_value(year_num, ie_traj)
    if overridden is not None:
        participant["initial_emissions"] = max(0.0, overridden)
```

The per-year `initial_emissions` value is still required in the JSON for schema compatibility, but it is silently overridden when a trajectory is active. This avoids the need to duplicate the trajectory calculation in every year object.

### Grid emission factor trajectory

`grid_emission_factor_trajectory` follows the identical pattern, interpolating `grid_emission_factor` (tCO₂/MWh) year by year. This is used to model a decarbonising electricity grid:

```python
gef_traj = participant.get("grid_emission_factor_trajectory") or {}
if gef_traj:
    overridden = _interp_value(year_num, gef_traj)
    if overridden is not None:
        participant["grid_emission_factor"] = max(0.0, overridden)
```

---

## Sector-Participants Level

**File:** `src/ets/config_io/builder.py` (sector derivation block)

### Purpose

The `sectors[]` array at the scenario level defines aggregated caps and auction share trajectories for named industry sectors. This enables modelling the K-ETS allocation plan at the sector level — particularly the 4th National Allocation Plan which specifies sector-level budgets.

### Derivation steps

For each sector `s` and year `t`:

```python
sector_cap_s(t)  = interp(cap_trajectory_s, t)
sector_auc_s(t)  = sector_cap_s(t) × interp(auction_share_trajectory_s, t)
sector_pool_s(t) = sector_cap_s(t) - sector_auc_s(t)   # free pool

total_cap(t)     = Σ_s sector_cap_s(t)       # overrides per-year total_cap
auction_offered(t) = Σ_s sector_auc_s(t)     # overrides per-year auction_offered
```

### Per-participant free allocation from sector pool

For participant `i` in sector `s` with `sector_allocation_share > 0`:

$$\text{free\_allocation\_ratio}_i = \min\!\left(1,\; \frac{\text{sector\_pool}_s \times \sigma_i}{E_{0,i}}\right)$$

where $\sigma_i$ = `sector_allocation_share` (the participant's fractional claim on the sector's free pool).

```python
allocated_mt = sector_pool[sg] × sector_allocation_share
derived_ratio = min(1.0, allocated_mt / initial_emissions)
```

### Interaction with OBA

If OBA fields are also set (`production_output > 0` and `benchmark_emission_intensity > 0`), the OBA override is applied **after** the sector derivation, replacing the sector-derived ratio. Priority order: OBA > sector-derived > per-year ratio.

---

## Policy Trajectories

Four trajectory types allow smooth, linearly interpolated paths for scenario-level parameters without per-year specification.

### Interpolation formula (all four types)

$$\text{value}(t) = v_{start} + (v_{end} - v_{start}) \cdot \frac{t - t_{start}}{t_{end} - t_{start}}$$

For $t \leq t_{start}$: value = $v_{start}$. For $t \geq t_{end}$: value = $v_{end}$.

### Trajectory types

| Type | Overrides | Applied to |
|---|---|---|
| `cap_trajectory` | `total_cap` per year | Market-level; scenario scope |
| `price_floor_trajectory` | `price_lower_bound` per year | Market-level; scenario scope |
| `price_ceiling_trajectory` | `price_upper_bound` per year | Market-level; scenario scope |
| `free_allocation_trajectories[]` | `free_allocation_ratio` per participant | Participant-level; named by `participant_name` |

### Sector trajectories

Inside each sector object:

| Type | Overrides |
|---|---|
| `cap_trajectory` | Sector's cap → derives `total_cap` and `sector_pool` |
| `auction_share_trajectory` | Fraction of sector cap auctioned → derives `auction_offered` |

### Validation ordering

All trajectories are applied at **build time** (inside `build_market_from_year()`), after the raw JSON is normalised. This means:

1. JSON normalisation validates raw field values (config-time)
2. Trajectory overrides are applied (build-time)
3. Cap consistency check runs against the post-override values (build-time)

This prevents false positive validation errors when a trajectory overrides a per-year value that would otherwise exceed the cap.

---

## Input/Output Validation

### Config-time validation (`normalize_year`, `normalize_participant`)

Runs at JSON parse time. Raises `ValueError` immediately if:

| Rule | Checked field | Error condition |
|---|---|---|
| Duplicate participant names | `participants[].name` | Two participants share the same name in the same year |
| Penalty below price floor | `penalty_price`, `price_lower_bound` | `0 < penalty_price < price_lower_bound` — participant would always pay penalty |
| `scope2_cbam_coverage` out of range | `scope2_cbam_coverage` | Not in `[0, 1]` |
| `cbam_export_share` out of range | `cbam_export_share` | Not in `[0, 1]` |
| `sector_allocation_share` out of range | `sector_allocation_share` | Not in `[0, 1]` |
| MAC blocks out of order | `mac_blocks[].marginal_cost` | Not non-decreasing |
| Piecewise with no blocks | `mac_blocks` | Empty list when `abatement_type = "piecewise"` |
| Invalid auction mode | `auction_mode` | Not in `{"explicit", "derive_from_cap"}` |
| Price bounds inverted | `price_lower_bound`, `price_upper_bound` | `upper <= lower` |
| Invalid expectation rule | `expectation_rule` | Not in the four allowed values |
| Invalid unsold treatment | `unsold_treatment` | Not in `{"reserve", "cancel", "carry_forward"}` |

### Build-time validation (`build_market_from_year`)

Runs after trajectory overrides. Raises `ValueError` if:

| Rule | Description |
|---|---|
| Supply exceeds cap | `free_allocations + auction_offered + reserved + cancelled > total_cap` when `total_cap > 0` |
| Negative auction supply | `auction_offered < 0` after derivation |
| `max_activity_share` sum < 1 | Technology options cannot cover 100% of activity |
| Sector group mismatch | Participant's `sector_group` references an undefined sector name |

### Monotonicity guarantee for Brent's method

$D(P)$ is weakly decreasing because:
- Each participant's MAC is non-decreasing → more abatement at higher prices
- More abatement → lower residual emissions → lower allowance demand
- Therefore total net demand is weakly decreasing in $P$

This guarantees a unique root and valid bracketing for Brent's method.

---

## Calibration Tool

**File:** `src/ets/analysis/calibration.py`

### Purpose

Fit `abatement_cost_slope` (σ) for named participants to match historical KAU prices. The slope controls how steeply the MAC curve rises, determining how much abatement occurs at any given price — which in turn determines equilibrium.

### Nelder-Mead objective function

$$\text{MSE}(\boldsymbol{\sigma}) = \frac{1}{T} \sum_{t=1}^{T} \left(P_{model}(t;\boldsymbol{\sigma}) - P_{obs}(t)\right)^2$$

where $\boldsymbol{\sigma} = [\sigma_1, \ldots, \sigma_n]$ is the vector of slopes for the named participants. $P_{model}(t;\boldsymbol{\sigma})$ is the full simulation equilibrium price for year $t$ given slopes $\boldsymbol{\sigma}$.

### Algorithm

```python
result = minimize(
    _objective,                  # MSE function above
    x0=initial_slopes,           # starting point
    method="Nelder-Mead",
    options={"maxiter": max_iter, "xatol": 0.1, "fatol": 0.01}
)
```

Nelder-Mead is used (rather than gradient-based methods) because the objective is non-smooth — it involves discrete MAC evaluations and potentially non-differentiable banking decisions. Slopes are clamped to `>= 0.01` inside the objective to prevent negative-slope pathologies.

### Inputs and outputs

| Input | Type | Description |
|---|---|---|
| `base_config` | dict | Full simulation config |
| `observed_prices` | `{year: price}` | Historical prices to match (₩/t) |
| `participant_names` | list | Participants whose slopes are calibrated |
| `initial_slopes` | list | Optional starting values; defaults to current config values |
| `max_iter` | int | Nelder-Mead iteration limit; default 500 |

| Output | Type | Description |
|---|---|---|
| `calibrated_slopes` | dict | `{participant_name: slope}` |
| `final_mse` | float | Objective value at solution |
| `iterations` | int | Nelder-Mead iterations used |
| `success` | bool | Whether Nelder-Mead reported convergence |
| `modelled_prices` | dict | `{year: price}` at calibrated slopes |
| `observed_prices` | dict | Input prices (echoed back) |

---

## Batch Runner

**File:** `src/ets/analysis/batch.py`

### JSON-path notation

The batch runner addresses config fields using dotted/bracket notation:

- `scenarios[0].years[*].eua_price` — sets `eua_price` on **all** years (wildcard `[*]`)
- `scenarios[0].discount_rate` — sets a scalar at scenario level
- `scenarios[0].years[2].participants[0].cost_slope` — sets a specific participant's slope

The `[*]` wildcard applies the value to every element in the list at that position, enabling sweep-all-years operations with a single path.

### Cartesian product

```python
for combo in itertools.product(*value_lists):
    cfg = deepcopy(base_config)
    params = {}
    for path, val in zip(paths, combo):
        cfg = _set_path(cfg, path, val)
        params[path] = val
    run_simulation(cfg) → year_summaries
```

If `sweeps` has two axes with 4 and 3 values respectively, the runner produces 4×3=12 runs.

### Output structure

```json
{
  "sweep_axes": [
    {"path": "...", "label": "...", "values": [...]},
    ...
  ],
  "runs": [
    {
      "params": {"path1": value1, "path2": value2},
      "results": [
        {"year": "2026", "price": 18500, "total_abatement": 45.2, ...},
        ...
      ],
      "error": null
    },
    ...
  ],
  "n_runs": 12,
  "n_errors": 0
}
```

---

## Auction Revenue Tracker

The scenario summary automatically computes three auction revenue metrics:

| Column | Formula | Interpretation |
|---|---|---|
| `Domestic Retained Revenue` | `P* × auction_sold` | Revenue that flows to the Korean government's green fund |
| `CBAM Foregone Revenue` | `Σᵢ CBAM_liability_i` | Compliance cost paid to the EU instead of Korea — money that would stay domestic if KAU = EUA |
| `Potential Revenue if KAU=EUA` | `Domestic Retained Revenue + CBAM Foregone Revenue` | What the domestic revenue would be if the domestic price equalled the EUA price |

These three metrics are computed in `scenario_summary()` in `src/ets/market/results.py` and appear in every scenario-year row of the summary DataFrame.

---

## Full Execution Flow Diagram

```
run_simulation(config)
│
├─ build_markets_from_config(config)
│   └─ For each scenario × year:
│       ├─ normalize_config()          [config-time validation]
│       ├─ Apply sector derivations     [total_cap, auction, sector_pool]
│       ├─ Apply BAU trajectories       [initial_emissions per participant]
│       ├─ Apply grid factor trajs      [grid_emission_factor per participant]
│       ├─ Apply OBA overrides          [free_allocation_ratio from benchmark]
│       ├─ Apply policy trajectories    [cap, price floor, price ceiling]
│       ├─ Apply free_alloc trajs       [per-participant ratio phase-out]
│       ├─ build_market_from_year()     [build-time validation]
│       └─ Attach scenario metadata     [model_approach, MSR, solver params]
│
└─ For each scenario (grouped markets):
    │
    ├─ model_approach == "competitive" or "all":
    │   ├─ Sort years chronologically
    │   ├─ Compute baseline_prices (independent equilibrium)
    │   ├─ Build expectation_specs
    │   ├─ [IF perfect_foresight] Fixed-point iteration:
    │   │   ├─ Simulate path → realised_prices (no MSR)
    │   │   ├─ Update expected_prices for perfect_foresight years
    │   │   └─ Stop when max|ΔP| ≤ solver_competitive_tolerance
    │   └─ Final path simulation:
    │       For each year t:
    │       ├─ [IF msr_enabled] MSRState.apply() → effective_auction
    │       ├─ market.solve_equilibrium()         → P*, auction_outcome
    │       │   └─ scipy.root_scalar("brentq")
    │       │       └─ total_net_demand(P)
    │       │           └─ participant.optimize_compliance(P) × N
    │       ├─ market.participant_results()        → CBAM, Scope 2, OBA display
    │       ├─ market.scenario_summary()           → aggregates + revenue tracker
    │       └─ Update bank_balances, carry_forward
    │
    ├─ model_approach == "hotelling":
    │   ├─ Establish λ bracket [lam_low, lam_high]
    │   ├─ Bisect λ until Σ_t residual_emissions = total_carbon_budget
    │   │   └─ At each λ: pin price to λ·(1+r+ρ)^(t−t₀), run all participants
    │   └─ Final path at converged λ
    │
    └─ model_approach == "nash_cournot":
        ├─ Compute baseline expected prices
        └─ For each year t:
            ├─ Initialise from competitive equilibrium
            ├─ Estimate dP/dQ (finite difference)
            ├─ Jacobi best-response iteration (≤ solver_nash_max_iters)
            │   └─ Each strategic participant minimises cost given residual demand
            └─ Final Brent solve at converged abatement profile
```

---

## Computational Complexity

| Step | Operations per call | Typical count per scenario-year |
|---|---|---|
| `minimize_scalar` (per participant, per price evaluation) | ~20–80 evaluations | N_participants × N_brent_evals |
| Brent's method convergence | ~10–20 price evaluations | 1 per year |
| Perfect foresight iterations | 1 full path per iteration | ≤ 25 |
| Nash best-response iterations | N_strategic × 1 minimisation per iteration | ≤ 120 |
| Hotelling bisection | 1 full path per bisection step | ≤ 80 |
| Total (5 participants, 5 years, competitive) | ~5 × 5 × 15 × 50 = 18,750 evaluations | — |

In practice, all three solvers complete in under 1–2 seconds for typical K-ETS configurations.

---

## Related Documents

- [Data Model & Configuration Schema](data-model.md)
- [Multi-Year Simulation](multi-year-simulation.md)
- [Output-Based Allocation](oba-allocation.md)
- [Sector Configuration](sector-config.md)
- [Analysis Tools](analysis-tools.md)
- [MAC & Abatement Models](mac-abatement.md)
- [Market Equilibrium Solver](market-equilibrium.md)
- [Technology Transition](technology-transition.md)
