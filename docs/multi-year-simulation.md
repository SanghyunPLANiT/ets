# Multi-Year Simulation, Banking, Borrowing & Expectation Formation

**Files:** `src/ets/simulation.py`, `src/ets/expectations.py`

A single-year equilibrium is straightforward — find the price where supply meets demand. The multi-year simulation adds three complications: (1) allowances can be saved between years (banking), (2) allowances can be borrowed from the future (borrowing), and (3) both decisions depend on what participants *expect* future prices to be. This document explains how all three interact.

---

## Why multiple years matter

In a single-year model, each year is completely independent. In reality, ETS participants are forward-looking:

- A company with cheap abatement might over-abate today, bank the surplus allowances, and sell them when prices are higher.
- A company facing a spike in emissions might borrow next year's allowances to avoid buying at a high spot price.
- Both decisions shift supply and demand in every year they affect, changing the equilibrium price trajectory.

The multi-year simulation captures these dynamics by passing **bank balances** and **carry-forward supply** forward in time, and by solving for **consistent expectations** about future prices.

---

## State carried between years

Two pieces of state propagate from year `t` to year `t+1`:

### 1. Bank balances

A `dict[participant_name → float]` tracking the cumulative allowances each participant has saved (positive) or borrowed (negative):

```
bank_balances_t+1 = {
    participant.name: outcome.ending_bank_balance
    for participant in year_t results
}
```

`ending_bank_balance` is determined by `_finalize_inventory()` in `participant.py` (see below).

### 2. Carry-forward allowances

Unsold auction allowances can re-enter the next year's supply if `unsold_treatment = "carry_forward"`:

```python
carry_forward_t+1 = (
    equilibrium["unsold_allowances"]
    if market.unsold_treatment == "carry_forward"
    else 0.0
)
```

These are added to the next year's `auction_offered`:

```python
def effective_auction_offered(self, carry_forward_in=0.0):
    return max(0.0, self.auction_offered + carry_forward_in)
```

---

## Banking: saving allowances for the future

**Enabled by:** `banking_allowed: true` in year config

When a participant ends a year with surplus allowances (free allocation exceeds compliance need), they can either sell the surplus immediately or bank it for a future year.

### Banking decision rule (`_finalize_inventory`)

```python
natural_balance = free_allocation + starting_bank_balance - residual_emissions

if natural_balance >= 0.0:                          # participant has surplus
    if banking_allowed and expected_future_price > carbon_price:
        ending_bank_balance = natural_balance       # bank it — future is more valuable
    else:
        ending_bank_balance = 0.0                   # sell now
```

**Intuition:** Bank if and only if the future price exceeds the current price. Saving an allowance today and selling it next year is like investing at a rate equal to the price appreciation. If you expect prices to rise, banking is rational.

### Balance sheet mechanics

```
Starting bank balance   B₀   (carried from previous year)
Free allocation         F    (= initial_emissions × free_allocation_ratio)
Residual emissions      E_r  (= initial_emissions - abatement)
─────────────────────────────────────────────────────────
Natural position        N = F + B₀ - E_r

  N > 0: surplus → can bank or sell
  N < 0: shortage → must buy or borrow
```

### Effect on market equilibrium

Banked allowances reduce a participant's net demand in the current year (they don't sell their surplus). In future years, they increase supply (the participant sells the banked allowances). This creates a **price-smoothing effect**: participants arbitrage price differences across time, pulling high-price years down and low-price years up.

---

## Borrowing: using future allowances today

**Enabled by:** `borrowing_allowed: true` + `borrowing_limit > 0`

When a participant faces a shortage, they can borrow allowances from their future allocation up to the `borrowing_limit`.

### Borrowing decision rule

```python
if natural_balance < 0.0:                           # participant has shortage
    if borrowing_allowed and effective_current_price > expected_future_price:
        ending_bank_balance = max(-borrowing_limit, natural_balance)  # borrow
    else:
        ending_bank_balance = 0.0                   # buy on market instead
```

**Intuition:** Borrow if and only if the current price exceeds the expected future price. Borrowing now means you'll need to return the allowances next year; if next year's price is lower, this is a net saving.

Note: `ending_bank_balance` is negative when borrowing. The magnitude is the borrowed amount. The `borrowing_limit` field sets the maximum negative balance.

### Borrowing repayment

There is no explicit repayment mechanism — the model handles this implicitly. In the year following borrowing, the participant's `starting_bank_balance` is negative, so their effective shortage is larger:

```
Effective shortage = residual_emissions - free_allocation - starting_bank_balance
                   = residual_emissions - free_allocation + |borrowed|
```

This increases their demand in the next year, which is economically equivalent to repaying the borrowed allowances.

---

## Expectation formation rules

How participants form beliefs about `P_future` is configured per year via the `expectation_rule` field. The rule determines whether participants bank or borrow and at what rate.

### Rule 1: `myopic`

```python
expected_future_price = 0.0
```

Participants ignore the future entirely. No banking or borrowing occurs regardless of the settings (because `P_future = 0 < P_current` always holds when prices are positive, so borrowing is always rational, but `P_future = 0 < P_current` means banking is never rational either — in practice, with zero expected future value, surplus is sold immediately).

**Use case:** Baseline calibration, stress-testing, markets where participants genuinely cannot plan ahead.

---

### Rule 2: `next_year_baseline` (default)

```python
expected_future_price = baseline_prices.get(next_year, 0.0)
```

Where `baseline_prices` is computed at the start of simulation as the independent equilibrium price of each year (solved without banking effects, in isolation).

**Intuition:** Participants expect next year to look like its standalone equilibrium — a reasonable, model-consistent expectation that does not require solving a fixed-point problem.

**Use case:** The standard setting for most simulations. Captures forward-looking behaviour with reasonable computational cost.

---

### Rule 3: `perfect_foresight`

```python
expected_future_price = realized_prices[next_year]
```

Participants know the actual future equilibrium price exactly. This requires solving a **fixed-point problem** because the realised price depends on participants' decisions, which depend on their expectations.

See the [Perfect Foresight section](#perfect-foresight--rational-expectations-equilibrium) below.

**Use case:** Economic theory benchmark, long-run policy analysis, testing whether a scenario is internally consistent.

---

### Rule 4: `manual`

```python
expected_future_price = market.manual_expected_price
```

The user specifies the expected future price directly. The simulation uses this value without modification.

**Use case:** Sensitivity analysis ("what if participants expect $100/t regardless of the market?"), calibrating to observed market futures prices, modelling irrational or anchored expectations.

---

## Perfect foresight — rational expectations equilibrium

`perfect_foresight` creates a circular dependency:

```
Participants need P_future to decide banking today
    ↓
Their banking decisions change supply/demand next year
    ↓
Which changes P_future
    ↓
Which changes their banking decisions today
    ↓ (loop)
```

This is resolved using **fixed-point iteration** — repeatedly simulating the path until expected prices converge to realised prices.

### Algorithm

```
Step 0: Initial guess
    expected_prices = { year: baseline_equilibrium_price(year) }
    (independent equilibrium for each year, ignoring banking)

Step 1–25: Iterate
    For i = 1 to max_iterations (25):

        a) Simulate full path using current expected_prices
               → get realised_prices from simulation

        b) Update: expected_prices ← realised_prices
               (for perfect_foresight years only;
                other years keep their own rule)

        c) Compute convergence criterion:
               max_delta = max |new_expected[y] - old_expected[y]|  for all years y

        d) If max_delta ≤ tolerance (1e-3):
               CONVERGED → stop
```

### Code

```python
def solve_scenario_path(ordered_markets, max_iterations=25, tolerance=1e-3):
    # Step 0
    baseline_prices = {str(m.year): m.find_equilibrium_price() for m in ordered_markets}
    expected_prices = derive_expected_prices(years, specs, baseline_prices)

    if any(spec.rule == "perfect_foresight" for spec in specs.values()):
        for _ in range(max_iterations):
            # Steps a–b
            realised_prices = _simulate_realized_prices(ordered_markets, expected_prices)
            updated = derive_expected_prices(years, specs, baseline_prices,
                                             realized_prices=realised_prices)
            # Step c
            max_delta = max(abs(updated[y] - expected_prices[y]) for y in years)
            expected_prices = updated
            # Step d
            if max_delta <= tolerance:
                break

    return _simulate_path_details(ordered_markets, expected_prices)
```

### Convergence behaviour

The iteration converges when participants' price expectations are self-consistent — what they expect is exactly what the market produces given those expectations. This is the **Rational Expectations Equilibrium (REE)**.

Convergence is not mathematically guaranteed for all configurations, but holds empirically in well-posed ETS models because:
- The demand function is monotone and continuous
- Banking/borrowing effects are bounded (by limits and penalty prices)
- The price-expectation map is a contraction in typical parameter ranges

If convergence fails (rare), the simulation uses the best available approximation after 25 iterations.

### Example: 3-year perfect foresight

```
Year    Baseline P*   Iteration 1   Iteration 2   Converged
2030       $45           $52           $50          $50
2035       $55           $50           $51          $51
2040       $65           $65           $65          $65

In iteration 1:
  Participants expect P_2035 = $55 (baseline)
  → They bank heavily in 2030 (P rises to $52)
  → Less banking pressure in 2035 (P falls to $50)

In iteration 2:
  Participants now expect P_2035 = $50
  → Less incentive to bank in 2030 (P falls to $50)
  → 2035 recovers slightly to $51

Converged at iteration 3: $50, $51, $65
```

---

## Sequential year execution

The inner simulation loop (`_simulate_path_details`) runs sequentially — each year depends on the previous year's output:

```python
bank_balances = {p.name: 0.0 for p in first_year_participants}
carry_forward = 0.0

for market in ordered_markets:
    expected_future_price = expected_prices[str(market.year)]

    # Solve equilibrium for this year
    equilibrium = market.solve_equilibrium(
        bank_balances=bank_balances,
        expected_future_price=expected_future_price,
        carry_forward_in=carry_forward,
    )
    P_star = equilibrium["price"]

    # Compute participant outcomes
    participant_df = market.participant_results(
        P_star,
        bank_balances=bank_balances,
        expected_future_price=expected_future_price,
    )

    # Update state for next year
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
2030: P* = $55   (participants bank, reducing supply → price rises)
2035: P* = $60   (banked allowances re-enter market → price falls from $90)
```

Banking arbitrages the $60 price difference down until the price differential just equals the opportunity cost of capital (which is zero in this model — there is no discounting).

---

## Edge cases and guards

| Situation | Handling |
|---|---|
| First year (no prior bank balance) | All `starting_bank_balance = 0` |
| Last year (no next year) | `expected_future_price = 0` regardless of rule |
| Participant added mid-pathway | They start with `bank_balance = 0` |
| Borrowing limit = 0 | Effectively disables borrowing even if `borrowing_allowed = true` |
| `perfect_foresight` on only some years | Other years use their own rules; iteration only updates perfect_foresight years |

---

## See also

- [Market Equilibrium Solver](market-equilibrium.md) — how each year's price is found
- [MAC & Abatement Models](mac-abatement.md) — how participant demand responds to price
- [Algorithm Overview](algorithm-overview.md) — full execution flow
