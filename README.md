# Particle Equilibrium — ETS Simulator

A web-based **Emissions Trading System (ETS) simulator** that computes carbon market equilibria across multiple years, scenarios, and participant types. Supports competitive price-taking, Hotelling resource-pricing, and Nash-Cournot strategic behaviour. The solver is built on SciPy; the frontend is React/Vite.

**Live app:** https://ets.vercel.app

---

## What it does

- Configure a carbon market — cap trajectory, auction design, price bounds, participant abatement curves, technology options, banking/borrowing rules
- Solve for the equilibrium carbon price in each year using Brent's root-finding method
- Simulate multi-year pathways with intertemporal banking, borrowing, and four expectation-formation rules including rational expectations (perfect foresight)
- Model price paths under the **Hotelling Rule** (exhaustible-resource arbitrage) with an optional **risk premium** (ρ), or **Nash-Cournot** strategic equilibrium
- Apply smooth policy trajectories for cap, price floor, price ceiling, and free-allocation phase-outs across any date range
- Apply a **Market Stability Reserve (MSR)** to adjust auction supply based on the aggregate bank
- Compute **CBAM** (Carbon Border Adjustment Mechanism) liability for exporting participants post-equilibrium, including multi-jurisdiction CBAM and EUA price ensembles
- Model **indirect (Scope 2) emissions** from electricity consumption and their CBAM exposure
- Group participants by **sector** and aggregate compliance costs, auction revenue, and CBAM liability by sector group
- Compare multiple policy scenarios side by side

---

## Quick start

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py                  # API server on :8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                    # Vite dev server on :5173 (proxies /api → :8000)
```

### Build & deploy

```bash
cd frontend && npm run build
cp public/styles.css dist/styles.css
cd ..
vercel --prod
```

---

## Modelling approaches

Set `model_approach` at the scenario level. Four values are accepted.

| Value | Behaviour |
|---|---|
| `"competitive"` | Price-taking participants. Brent's method finds `P*` where aggregate demand equals auction supply. Optional perfect-foresight iteration for rational expectations. This is the default. |
| `"hotelling"` | Prices are pinned to the Hotelling path `P*(t) = λ·(1+r+ρ)^(t−t₀)` where `ρ` is an optional risk premium. The shadow price `λ` is found by bisection so that cumulative residual emissions equal the cumulative `carbon_budget`. Participants are still price-takers at each pinned price. |
| `"nash_cournot"` | Participants listed in `nash_strategic_participants` internalise their price impact. Best-response iteration (Jacobi-style) converges to the Cournot-Nash equilibrium in abatement quantities. Non-listed participants remain price-takers. |
| `"all"` | Runs all three approaches and returns results for each, enabling direct comparison. |

---

## Key features

| Feature | Config field(s) | Notes |
|---|---|---|
| Free allocation | `free_allocation_ratio` per participant | Share of baseline emissions allocated for free |
| Free-allocation phase-out | `free_allocation_trajectories` at scenario level | Linearly interpolates per-participant ratios over any date range |
| Auction design | `auction_offered`, `auction_reserve_price`, `minimum_bid_coverage`, `unsold_treatment` | Full EU-ETS-style auction mechanics |
| Price floor / ceiling | `price_lower_bound`, `price_upper_bound` | Bracket limits for the root-finder |
| Policy trajectories | `cap_trajectory`, `price_floor_trajectory`, `price_ceiling_trajectory` | Linearly interpolate cap or price bounds over any date range |
| Banking | `banking_allowed` | Participants save surplus allowances if future price > current price |
| Borrowing | `borrowing_allowed`, `borrowing_limit` | Participants borrow against future allocation |
| Technology switching | `technology_options` per participant | Discrete (winner-takes-all) or mixed-portfolio (SLSQP) |
| MSR | `msr_enabled`, `msr_upper_threshold`, `msr_lower_threshold`, `msr_withhold_rate`, `msr_release_rate` | Adjusts auction supply before each year's market clearing |
| CBAM (single jurisdiction) | `cbam_export_share`, `cbam_coverage_ratio`, `eua_price` | Post-equilibrium liability: `max(0, EUA−KAU) × residual × export_share × coverage` |
| CBAM (multi-jurisdiction) | `cbam_jurisdictions` per participant, `eua_prices` dict per year | Per-jurisdiction liability columns (e.g. `CBAM Liability (EU)`, `CBAM Liability (UK)`) |
| EUA price ensemble | `eua_price_ensemble` per year | Evaluates CBAM against multiple price forecasts (EC, Enerdata, BNEF) simultaneously |
| Scope 2 / indirect emissions | `electricity_consumption`, `grid_emission_factor`, `scope2_cbam_coverage` | Adds `Indirect Emissions` and `Scope 2 CBAM Liability` to results |
| Sector grouping | `sector_group` per participant | Aggregated cost, abatement, revenue, and CBAM rows in `scenario_summary` |
| Hotelling path | `model_approach: "hotelling"`, `discount_rate`, `carbon_budget` | Shadow-price bisection over cumulative budget |
| Hotelling risk premium | `risk_premium` at scenario level | Augments growth rate: `P(t) = λ·(1+r+ρ)^t` |
| Nash-Cournot | `model_approach: "nash_cournot"`, `nash_strategic_participants` | Best-response iteration for named strategic participants |
| Validation | automatic | Duplicate names, penalty < floor, cap < supply all raise `ValueError` |

---

## Config schema quick reference

Full field reference: [docs/data-model.md](docs/data-model.md)

### Scenario-level fields

```json
{
  "name": "My Scenario",
  "model_approach": "competitive",
  "discount_rate": 0.04,
  "risk_premium": 0.01,
  "nash_strategic_participants": ["Steel Plant A"],
  "msr_enabled": false,
  "msr_upper_threshold": 200.0,
  "msr_lower_threshold": 50.0,
  "msr_withhold_rate": 0.12,
  "msr_release_rate": 50.0,
  "msr_cancel_excess": false,
  "msr_cancel_threshold": 400.0,
  "cap_trajectory": {"start_year": "2030", "end_year": "2040", "start_value": 500.0, "end_value": 350.0},
  "price_floor_trajectory": {"start_year": "2030", "end_year": "2040", "start_value": 15.0, "end_value": 40.0},
  "price_ceiling_trajectory": {"start_year": "2030", "end_year": "2040", "start_value": 200.0, "end_value": 300.0},
  "free_allocation_trajectories": [
    {"participant_name": "Steel Plant A", "start_year": "2025", "end_year": "2034", "start_ratio": 1.0, "end_ratio": 0.0}
  ],
  "years": [ { ...year }, ... ]
}
```

### Year-level fields (key subset)

| Field | Type | Default | Description |
|---|---|---|---|
| `year` | string | `"2030"` | Period label used for sorting and display |
| `total_cap` | float ≥ 0 | `0.0` | Hard cap on covered emissions (Mt CO₂e) |
| `carbon_budget` | float ≥ 0 | `0.0` | Cumulative budget used by the Hotelling solver |
| `auction_mode` | `"explicit"` \| `"derive_from_cap"` | `"explicit"` | How auction supply is computed |
| `auction_offered` | float ≥ 0 | `0.0` | Allowances offered at auction (explicit mode) |
| `price_lower_bound` | float ≥ 0 | `0.0` | Price floor |
| `price_upper_bound` | float > 0 | `100.0` | Price ceiling |
| `banking_allowed` | bool | `false` | Allow saving surplus allowances |
| `borrowing_allowed` | bool | `false` | Allow borrowing from future allocation |
| `borrowing_limit` | float ≥ 0 | `0.0` | Maximum borrowing per participant |
| `expectation_rule` | string | `"next_year_baseline"` | One of `myopic`, `next_year_baseline`, `perfect_foresight`, `manual` |
| `eua_price` | float ≥ 0 | `0.0` | Reference EUA price for single-jurisdiction CBAM calculation |
| `eua_prices` | object | `{}` | Dict of jurisdiction → price for multi-jurisdiction CBAM, e.g. `{"EU": 65.0, "UK": 55.0}` |
| `eua_price_ensemble` | object | `{}` | Dict of forecast source → price for ensemble CBAM, e.g. `{"EC": 70.0, "Enerdata": 65.0, "BNEF": 60.0}` |

### Participant-level fields (key subset)

| Field | Type | Default | Description |
|---|---|---|---|
| `initial_emissions` | float ≥ 0 | `0.0` | Gross emissions baseline (Mt CO₂e) |
| `free_allocation_ratio` | float [0,1] | `0.0` | Share of emissions allocated for free |
| `penalty_price` | float > 0 | `100.0` | Fine per uncovered tonne |
| `abatement_type` | `"linear"` \| `"piecewise"` \| `"threshold"` | `"linear"` | MAC model |
| `cbam_export_share` | float [0,1] | `0.0` | Share of output exported to CBAM-covered markets (single-jurisdiction) |
| `cbam_coverage_ratio` | float [0,1] | `1.0` | Fraction of exported emissions under CBAM scope (single-jurisdiction) |
| `cbam_jurisdictions` | array | `[]` | Multi-jurisdiction CBAM config: `[{name, export_share, coverage_ratio}]` |
| `sector_group` | string | `""` | Groups participant into a named sector for aggregated summary rows |
| `electricity_consumption` | float ≥ 0 | `0.0` | Annual electricity use (MWh) for Scope 2 emissions calculation |
| `grid_emission_factor` | float ≥ 0 | `0.0` | Tonnes CO₂e per MWh for the participant's grid |
| `scope2_cbam_coverage` | float [0,1] | `0.0` | Fraction of indirect emissions subject to CBAM |

---

## Solver settings

All nine parameters are user-overridable at the scenario level. The table shows their defaults.

| Parameter | Default | Description |
|---|---|---|
| `solver_competitive_max_iters` | `25` | Maximum perfect-foresight iterations |
| `solver_competitive_tolerance` | `0.001` | Convergence tolerance on price ($/t) |
| `solver_hotelling_max_bisection_iters` | `80` | Maximum bisection steps for λ |
| `solver_hotelling_max_lambda_expansions` | `20` | Bracket-expansion attempts before error |
| `solver_hotelling_convergence_tol` | `0.0001` | Relative tolerance on cumulative emissions |
| `solver_nash_price_step` | `0.5` | Step size for residual demand curve in best-response ($/t) |
| `solver_nash_max_iters` | `120` | Maximum best-response iterations |
| `solver_nash_convergence_tol` | `0.001` | Convergence tolerance on abatement changes (Mt) |
| `solver_penalty_price_multiplier` | `1.25` | Upper bracket = max penalty × this multiplier |

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/algorithm-overview.md](docs/algorithm-overview.md) | Three-layer architecture, modelling approaches, MSR, CBAM, execution flow |
| [docs/data-model.md](docs/data-model.md) | Full JSON config schema — every field's type, default, validation, and examples |
| [docs/mac-abatement.md](docs/mac-abatement.md) | Marginal Abatement Cost models — linear, piecewise, threshold — maths, code, examples |
| [docs/technology-transition.md](docs/technology-transition.md) | Endogenous technology choice, mixed portfolio optimisation, transition pathways |
| [docs/market-equilibrium.md](docs/market-equilibrium.md) | Brent's method equilibrium solver, auction mechanics, price bounds, edge cases |
| [docs/multi-year-simulation.md](docs/multi-year-simulation.md) | Banking, borrowing, expectation rules, Hotelling path, Nash-Cournot path, MSR integration, CBAM |

---

## GUI walkthrough

### Header controls

| Button | Action |
|---|---|
| `Load template` | Load a predefined scenario or blank config (does not run) |
| `Add scenario` | Create a new empty scenario |
| `Duplicate scenario` | Copy the current scenario |
| `Remove scenario` | Delete the current scenario (requires ≥ 2 scenarios) |
| `Run scenario` | Run the base template |
| `Run edited` | Run the current values in the editor |
| `Compare all scenarios` | Switch to multi-scenario comparison view |

Always use **Run edited** after changing values in the builder.

### Scenario builder steps

**Step 1 — Scenario:** Name, colour, description. Affects labelling across all charts.

**Step 2 — Market Rules:** Per-year settings: cap, auction volume, price bounds, banking/borrowing, expectation rule.
- `auction_mode = explicit`: set `auctioned_allowances` directly.
- `auction_mode = derive_from_cap`: auction supply = cap − free allocation − reserved − cancelled.

**Step 3 — Participants:** Name, sector, emissions, free allocation ratio, penalty price, abatement model (with visual MAC block editor), and technology options (with transition wizard).

**Step 4 — Review:** Compact pre-run validation summary: scenario metadata, year settings, participant count, technology options, intertemporal rules.

### MAC block editor

MAC blocks are entered as structured rows or as raw text `amount@cost; amount@cost`. Example:

```
6@20; 8@55; 8@110
```

means: first 6 Mt at $20/t, next 8 Mt at $55/t, next 8 Mt at $110/t.

### Transition wizard

Guided tool for building technology pathways:
1. Select a participant.
2. Choose an archetype (Steel, Coal power, Cement, Generic industry).
3. Choose replacement technologies.
4. Choose aggressiveness (conservative / moderate / aggressive).
5. Preview and apply — the wizard writes `technology_options` into the participant config.

### Outputs

After running: equilibrium carbon price, auction revenue, total abatement, allowance trading positions, technology pathway, participant-level compliance costs, bank balances, MSR pool movements, CBAM liability (single and multi-jurisdiction), Scope 2 CBAM liability, indirect emissions, and sector-group aggregates.

---

## Core model concepts

### Compliance cost minimisation (Layer 1)

Each participant minimises:

```
min_a  fixed_cost  +  abatement_cost(a)  +  P × allowances_bought
                   +  penalty × uncovered  −  P × allowances_sold
                   −  P_future × ending_bank_balance
```

subject to `0 ≤ a ≤ max_abatement`.

### Market clearing (Layer 2)

```
f(P) = Σ_i net_allowances_traded_i(P) − Q = 0
```

Solved with Brent's method. `D(P)` is monotonically non-increasing, guaranteeing a unique root.

### Multi-year path (Layer 3)

State carried forward per year: bank balances per participant, carry-forward unsold allowances.

### Abatement types

| Type | Formula | Use case |
|---|---|---|
| `linear` | `MAC(a) = slope × a`, `C(a) = ½ slope a²` | Simple sectors, early-stage modelling |
| `piecewise` | Ordered blocks `(amount, mc)` fully taken if `P ≥ mc` | Industrial sectors with known measure costs |
| `threshold` | `a = max_abatement if P ≥ threshold_cost else 0` | Breakthrough technologies with binary viability |

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
| API | Falcon WSGI | `/api/run`, `/api/templates`, `/api/save-scenario` |
| Solver | NumPy, SciPy | Market equilibrium + participant cost minimisation |

---

## Project structure

```
particalequlibrium/
├── api/index.py               # Vercel WSGI entry point
├── app.py                     # Local dev entry point
├── src/ets/
│   ├── participant.py         # Layer 1 — participant cost minimisation
│   ├── market.py              # Layer 2 — market equilibrium solver
│   ├── simulation.py          # Layer 3 — multi-year path runner
│   ├── expectations.py        # Expectation-formation rules
│   ├── costs.py               # MAC function factories
│   ├── hotelling.py           # Hotelling Rule solver (shadow price bisection)
│   ├── nash.py                # Nash-Cournot best-response solver
│   ├── msr.py                 # Market Stability Reserve
│   ├── scenarios.py           # JSON config → CarbonMarket factory
│   ├── server.py              # Falcon WSGI app + route registration
│   ├── webapp.py              # API request handlers
│   └── config.py              # Config loading & validation
├── frontend/
│   ├── src/
│   │   ├── app.jsx            # Root component, global state
│   │   └── components/        # Views, shared components, charts
│   ├── public/styles.css
│   └── dist/                  # Built assets (committed for Vercel)
├── templates/                 # Built-in scenario JSON files
├── docs/                      # Technical documentation
└── vercel.json
```

---

## Limitations

- No endogenous production/output decision (emissions are exogenous)
- Technology switching is per-year discrete; no irreversibility constraint across years unless modelled manually via `max_activity_share` progression
- CBAM does not feed back into market clearing — it is a post-equilibrium accounting entry
- No benchmark-based free allocation; only ratio-based
- No BAU trajectory auto-generation; emissions paths must be set manually per year
- Not calibrated to any real national ETS out of the box
