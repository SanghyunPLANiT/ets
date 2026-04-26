# Particle Equilibrium — ETS Simulator

A web-based **Emissions Trading System (ETS) simulator** that models carbon market equilibria across multiple years and scenarios. Built with a Python WSGI backend (SciPy-powered numerical solver) and a React/Vite frontend deployed on Vercel.

**Live app:** https://ets.vercel.app

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Algorithm & Computational Flow](#algorithm--computational-flow)
   - [Layer 1 — Participant Optimisation](#layer-1--participant-optimisation)
   - [Layer 2 — Market Equilibrium Solver](#layer-2--market-equilibrium-solver)
   - [Layer 3 — Multi-Year Path Simulation](#layer-3--multi-year-path-simulation)
4. [Key Concepts](#key-concepts)
5. [Project Structure](#project-structure)
6. [Local Development](#local-development)
7. [Deployment](#deployment)

---

## Overview

An ETS works by placing a hard cap on total emissions. Companies must hold one allowance per tonne of CO₂ emitted; they can buy, sell, and earn allowances in a competitive auction. This simulator:

- Solves for the **equilibrium carbon price** where allowance supply equals total demand
- Models **heterogeneous participants** with distinct abatement cost curves and technology options
- Supports **multi-year pathways** with banking, borrowing, and four expectation-formation rules
- Enables **scenario comparison** across different cap trajectories, auction designs, and price bounds

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Vercel Edge                      │
│                                                     │
│  ┌──────────────────┐    ┌───────────────────────┐  │
│  │  React / Vite    │    │  Python WSGI (Falcon)  │  │
│  │  frontend/dist/  │◄──►│  api/index.py          │  │
│  │                  │    │  src/ets/              │  │
│  └──────────────────┘    └───────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

| Layer | Technology | Role |
|---|---|---|
| UI | React 18, Vite, custom SVG charts | Scenario editor, interactive charts, results display |
| API | Falcon (Python WSGI) | `/api/run`, `/api/templates`, `/api/save-scenario` |
| Solver | NumPy, SciPy (`root_scalar`, `minimize_scalar`, `minimize`) | Market equilibrium + participant optimisation |

---

## Algorithm & Computational Flow

The simulation executes in **three nested layers**, innermost first:

```
For each scenario
  └─ For each year (ordered chronologically)
       ├─ [Layer 1] Each participant minimises compliance cost at price P
       ├─ [Layer 2] Find P* such that Σ demand(P*) = auction supply
       └─ [Layer 3] Carry bank balances & unsold allowances to next year

If perfect_foresight expectation rule is active:
  └─ Repeat entire path until expected prices ≈ realised prices (≤ 25 iterations)
```

---

### Layer 1 — Participant Optimisation

**File:** `src/ets/participant.py`

**Question:** *Given carbon price P, what abatement level minimises this participant's total compliance cost?*

#### Objective function

$$\min_{a \geq 0} \quad C_{\text{fixed}} + C_{\text{abatement}}(a) + P \cdot \max(0,\, e - a - f - b_0) - P \cdot \max(0,\, f + b_0 - e + a) + \text{penalty} - P_{\text{future}} \cdot b_1$$

where:

| Symbol | Meaning |
|---|---|
| $a$ | abatement quantity (optimisation variable) |
| $e$ | initial emissions |
| $f$ | free allowances received |
| $b_0, b_1$ | starting / ending bank balance |
| $P$ | current carbon price |
| $P_{\text{future}}$ | expected future carbon price |

#### Abatement cost models

| Model | Cost function | Solver |
|---|---|---|
| **Linear** | $\frac{1}{2} \cdot \text{slope} \cdot a^2$ | `minimize_scalar` (bounded) |
| **Piecewise (MAC blocks)** | $\sum_i \min(a_i,\, \text{amount}_i) \cdot \text{mc}_i$ stepped blocks | `minimize_scalar` (bounded) |
| **Threshold** | $\text{mc}_{\text{threshold}} \cdot a$ (zero below threshold price) | analytic (0 or max) |

#### Banking & borrowing decision

```
Surplus (free allocation > residual emissions):
  P_future > P  →  bank the surplus (rational carry-forward)
  P_future ≤ P  →  sell surplus on market

Shortage (residual emissions > free allocation):
  P > P_future  →  borrow from future (if borrowing enabled & limit permits)
  P ≤ P_future  →  buy at auction / secondary market
```

#### Technology choice

When a participant has multiple technology options:

- **Pure switch:** each technology is optimised independently; lowest total cost wins.
- **Mixed portfolio** (when any option has `max_activity_share < 1`): activity shares across technologies are optimised via `scipy.optimize.minimize` with SLSQP, subject to `Σ shares = 1` and individual share caps.

---

### Layer 2 — Market Equilibrium Solver

**File:** `src/ets/market.py`

**Question:** *What price P\* clears the market — i.e. total net allowance demand equals auction supply?*

#### Demand function

$$D(P) = \sum_{i} \text{net\_allowances\_traded}_i(P)$$

Each participant's net demand is positive (buyer) or negative (seller) depending on their compliance outcome at price $P$.

#### Root-finding: Brent's method

The equilibrium condition is:

$$D(P^*) - Q = 0$$

where $Q$ is the effective auction supply. Solved numerically using **Brent's method** (`scipy.optimize.root_scalar`, `method='brentq'`):

```
1. Evaluate f(P_low) = D(0) - Q       → should be > 0  (excess demand at zero price)
2. Evaluate f(P_high) = D(P_max) - Q  → should be < 0  (excess supply at penalty price)
   If bracket not found: double P_high up to 10 times
3. Brent's method converges on P* within the bracket
   (combines bisection + inverse quadratic interpolation)
```

Brent's method is guaranteed to converge on a continuous function with a valid bracket, typically in O(log n) evaluations.

#### Auction failure cases

```
Auction supply = 0
  └─ Solve D(P*) = 0 (price set by scarcity alone)

Demand at floor price < auction offered
  ├─ Coverage ratio < minimum_bid_coverage threshold
  │    └─ Auction fails entirely; all allowances go unsold
  └─ Coverage ratio ≥ threshold
       └─ Partial clearance at floor/reserve price

Normal case
  └─ Brent's method finds P* where D(P*) = Q
```

#### Price bounds

After solving, the equilibrium price is clamped:

$$P^* = \max(P_{\text{floor}},\; \min(P_{\text{ceiling}},\; P^*_{\text{raw}}))$$

---

### Layer 3 — Multi-Year Path Simulation

**File:** `src/ets/simulation.py`, `src/ets/expectations.py`

**Question:** *How does the market evolve across years when participants form expectations about future prices?*

#### Sequential year execution

```python
bank_balances = {participant: 0.0 for each participant}
carry_forward  = 0.0

for year in [2030, 2035, 2040, ...]:
    P* = market.solve_equilibrium(bank_balances, expected_future_price, carry_forward)
    outcomes = market.participant_results(P*)

    # State carried to next year
    carry_forward  = unsold_allowances  if unsold_treatment == "carry_forward" else 0.0
    bank_balances  = { p: outcome.ending_bank_balance for p in participants }
```

#### Expectation formation rules

| Rule | Expected future price |
|---|---|
| `myopic` | 0 — participants ignore the future |
| `next_year_baseline` | Independent equilibrium price of next year (no banking effects) |
| `perfect_foresight` | Actual realised equilibrium price of next year (see below) |
| `manual` | User-specified value |

#### Perfect foresight — fixed-point iteration

`perfect_foresight` creates a circular dependency: *participants need to know next year's price to decide banking today, but that price depends on their banking decisions.* This is resolved as a **Rational Expectations Equilibrium**:

```
Initial guess: expected_prices = { year: baseline_equilibrium_price(year) }

Repeat up to 25 times:
  1. Simulate full path using current expected_prices
  2. Record realised_prices from simulation
  3. Update expected_prices to match realised_prices
  4. Compute max|Δprice| across all years
  5. Stop if max|Δprice| ≤ 1e-3  (converged)
```

This is a **fixed-point iteration** on the price expectations map $\Phi: \mathbf{P}^e \mapsto \mathbf{P}^{\text{realised}}$. Convergence is not guaranteed in general but holds empirically for well-posed ETS configurations.

#### Full simulation flow diagram

```
run_simulation(markets)
│
├─ Group markets by scenario_name
│
└─ For each scenario:
     │
     ├─ Sort years chronologically
     │
     ├─ Compute baseline_prices  (independent equilibrium per year, ignoring banking)
     │
     ├─ Build expectation_specs  (one rule per year)
     │
     ├─ Derive initial expected_prices from specs + baseline_prices
     │
     ├─ [If perfect_foresight] Fixed-point iteration (≤25 rounds):
     │    ├─ _simulate_path_details(expected_prices) → realised_prices
     │    ├─ derive_expected_prices(realized=realised_prices)
     │    └─ Check convergence
     │
     └─ _simulate_path_details(converged expected_prices)
          │
          └─ For each year t:
               ├─ market.solve_equilibrium(bank_t, P_future_t, carry_t)  [Layer 2]
               │    └─ participant.optimize_compliance(P)  [Layer 1]
               ├─ market.participant_results(P*)
               └─ Update bank_{t+1}, carry_{t+1}
```

---

## Key Concepts

### Allowance budget (per participant, per year)

```
Free allocation   = initial_emissions × free_allocation_ratio
Residual emissions = initial_emissions − abatement
Net demand        = residual_emissions − free_allocation − bank_balance
  > 0  →  must BUY allowances (or pay penalty)
  < 0  →  can SELL surplus or bank for next year
```

### Supply identity

```
Total cap = free_allocation + auction_offered + reserved + cancelled
                                    ↑
                               effective supply Q
```

Any gap between cap and the sum of buckets is tracked as `unallocated_allowances`.

### Compliance ceiling

A participant will never pay more than their `penalty_price` per tonne — they will accept a penalty instead. This acts as an implicit price ceiling at the participant level.

---

## Project Structure

```
particalequlibrium/
├── api/
│   └── index.py              # Vercel WSGI entry point
├── src/ets/
│   ├── participant.py         # Participant optimisation (Layers 1)
│   ├── market.py              # Market equilibrium solver (Layer 2)
│   ├── simulation.py          # Multi-year path runner (Layer 3)
│   ├── expectations.py        # Expectation rule logic
│   ├── scenarios.py           # Config → CarbonMarket factory
│   ├── costs.py               # MAC function builders
│   ├── server.py              # Falcon WSGI app
│   ├── webapp.py              # API route handlers
│   └── config.py              # Config loading & validation
├── frontend/
│   ├── src/
│   │   ├── app.jsx            # Root React component, state management
│   │   └── components/
│   │       ├── AppShared.jsx  # Shared components, field metadata, chart primitives
│   │       ├── AppViews.jsx   # BuildView, ValidationView, AnalysisView, Compare
│   │       ├── GuideView.jsx  # In-app user guide
│   │       ├── Editor.jsx     # Step-by-step scenario editor
│   │       ├── MarketChart.jsx
│   │       ├── TrajectoryChart.jsx
│   │       ├── ParticipantPanel.jsx
│   │       ├── AnnualMarketChart.jsx
│   │       └── AnnualEmissionsChart.jsx
│   ├── public/styles.css      # Global stylesheet
│   └── dist/                  # Built assets (committed for Vercel)
├── templates/                 # Built-in scenario JSON templates
├── user-scenarios/            # User-saved scenarios
├── app.py                     # Local dev entry point
└── vercel.json                # Vercel routing config
```

---

## Local Development

### Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py          # starts development server on :8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # Vite dev server on :5173 (proxies /api → :8000)
```

### Build for production

```bash
cd frontend
npm run build          # outputs to frontend/dist/
cp public/styles.css dist/styles.css
```

---

## Deployment

The project is deployed on **Vercel** using Python Serverless Functions:

- `api/index.py` re-exports the Falcon WSGI app
- `vercel.json` routes `/api/*` to the Python runtime and everything else to `frontend/dist/`
- `frontend/dist/` is committed to the repo so Vercel serves it as static files without a separate build step

```bash
vercel --prod
```
