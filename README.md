# K-ETS Partial-Equilibrium Simulator

A research-grade, multi-year partial-equilibrium simulator for the Korean Emissions Trading Scheme (K-ETS) and comparable cap-and-trade systems. Models competitive, Hotelling-optimal, and Nash-Cournot price formation with banking, borrowing, CBAM exposure, Output-Based Allocation, sector-level caps, and Market Stability Reserve mechanics.

---

## Live App

**Deployed:** https://ets.vercel.app

The `api/index.py` shim exposes the WSGI application to Vercel's serverless runtime. The React frontend communicates with the Python backend via a JSON REST API.

---

## Quick Start

### Backend (local server)

```bash
# Install dependencies
pip install -e ".[dev]"        # or: uv sync --all-extras

# Start the combined backend + frontend server
python app.py                  # opens http://127.0.0.1:8765 in your browser
```

### Frontend (development)

```bash
cd frontend
npm install
npm run dev                    # Vite dev server at http://localhost:5173
```

### Frontend (production build)

```bash
cd frontend
npm run build
cp public/styles.css dist/styles.css
```

### Vercel Deploy

1. Fork the repository.
2. Connect to Vercel. The `vercel.json` routes all requests to `api/index.py`.
3. No environment variables are required for a basic deployment.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite)                                                  │
│  frontend/src/                                                           │
│  Editor → scenario builder, collapsible config panels                   │
│  AppViews → Market/Trajectory/Emissions charts, Participant panel        │
└───────────────────────────┬──────────────────────────────────────────────┘
                             │ JSON over HTTP
┌───────────────────────────▼──────────────────────────────────────────────┐
│  WSGI Web Layer  (src/ets/web/)                                          │
│  server.py        ThreadingHTTPServer                                    │
│  handlers.py      Route: /api/run, /api/calibrate, /api/batch-run,      │
│                         /api/import-csv, /api/narrative, /api/templates  │
└───────────────────────────┬──────────────────────────────────────────────┘
                             │ Python function calls
┌───────────────────────────▼──────────────────────────────────────────────┐
│  Simulation Engine  (src/ets/)                                           │
│                                                                          │
│  config_io/        JSON → normalised dicts → CarbonMarket objects       │
│  solvers/          simulation.py  competitive path + perfect foresight   │
│                    hotelling.py   Hotelling shadow-price bisection       │
│                    nash.py        Nash-Cournot best-response iteration   │
│                    expectations.py expectation rules                    │
│                    msr.py         Market Stability Reserve state         │
│  market/           equilibrium.py Brent's method root-finder            │
│                    results.py     CBAM, Scope 2, sector aggregates      │
│                    core.py        CarbonMarket dataclass                │
│  participant/      compliance.py  cost minimisation                     │
│                    models.py      MarketParticipant, TechnologyOption   │
│                    technology.py  technology-switching helpers           │
│  analysis/         calibration.py Nelder-Mead slope fitting            │
│                    batch.py       cartesian-product sweep runner        │
│                    csv_import.py  CSV → config converter                │
│                    narrative.py   rule-based text summary               │
│  costs.py          linear and piecewise MAC factories                   │
│  expectations.py   shim → solvers/expectations                         │
│  msr.py            shim → solvers/msr                                  │
│  config.py         path configuration (EXAMPLES_DIR, etc.)             │
└──────────────────────────────────────────────────────────────────────────┘
                             │
┌───────────────────────────▼──────────────────────────────────────────────┐
│  Storage                                                                 │
│  examples/         pre-built JSON scenario files                        │
│  user-scenarios/   user-saved scenario files (runtime)                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### File and layer reference

| Path | Layer | Role |
|---|---|---|
| `src/ets/participant/models.py` | 1 | `MarketParticipant`, `TechnologyOption`, `ComplianceOutcome` dataclasses |
| `src/ets/participant/compliance.py` | 1 | Cost minimisation; abatement, banking, borrowing, penalty logic |
| `src/ets/participant/technology.py` | 1 | Technology-switching helpers |
| `src/ets/market/core.py` | 2 | `CarbonMarket` — holds participants, cap, auction params |
| `src/ets/market/equilibrium.py` | 2 | `solve_equilibrium()` — Brent's method root finder |
| `src/ets/market/results.py` | 2 | `participant_results()`, `scenario_summary()` — CBAM, Scope 2, sector aggregation |
| `src/ets/solvers/simulation.py` | 3 | `run_simulation()`, `solve_scenario_path()` — competitive path |
| `src/ets/solvers/hotelling.py` | 3 | `solve_hotelling_path()` — Hotelling shadow-price bisection |
| `src/ets/solvers/nash.py` | 3 | `solve_nash_path()` — Nash-Cournot best-response iteration |
| `src/ets/solvers/expectations.py` | 3 | `derive_expected_prices()` — four expectation rules |
| `src/ets/solvers/msr.py` | 3 | `MSRState` — Market Stability Reserve accumulator |
| `src/ets/config_io/normalize.py` | config | JSON field normalisation and config-time validation |
| `src/ets/config_io/builder.py` | config | `build_markets_from_config()` — trajectory application, OBA, sector derivation |
| `src/ets/config_io/templates.py` | config | Blank config scaffolding |
| `src/ets/analysis/calibration.py` | analysis | Nelder-Mead MACC slope fitting |
| `src/ets/analysis/batch.py` | analysis | Cartesian-product parameter sweep |
| `src/ets/analysis/csv_import.py` | analysis | CSV → ETS config conversion |
| `src/ets/analysis/narrative.py` | analysis | Rule-based plain-language summary |
| `src/ets/web/handlers.py` | web | HTTP request handlers, route dispatch |
| `src/ets/web/server.py` | web | `ThreadingHTTPServer` launcher |
| `src/ets/costs.py` | shared | `linear_abatement_factory`, `piecewise_abatement_factory` |

---

## Modelling Approaches

The `model_approach` field on a scenario selects the price-formation mechanism. All three approaches share the same Layer 1 (participant compliance optimisation) and Layer 2 (market clearing) — they differ in how the price path across years is determined.

### Competitive (default)

```
model_approach: "competitive"
```

All participants are price-takers. Each year, Brent's method finds `P*` such that:

```
Σᵢ net_demand_i(P*) = auction_offered
```

With `perfect_foresight` expectations, a fixed-point iteration ensures `E[P_{t+1}] = P*_{t+1}`. This is the standard partial-equilibrium ETS model and the appropriate default for most policy analysis.

**When to use:** Standard policy simulation, CBAM analysis, banking/borrowing dynamics, MSR impact assessment.

### Hotelling Rule

```
model_approach: "hotelling"
```

Allowances are treated as an exhaustible resource. The no-arbitrage condition requires the net price (royalty) to grow at the effective discount rate:

```
P*(t) = λ · (1 + r + ρ)^(t − t₀)
```

where `λ` is the shadow price (royalty) at the base year `t₀`, `r` is the risk-free discount rate, and `ρ` is an optional policy risk premium. `λ` is found by bisection so that cumulative residual emissions equal the cumulative `carbon_budget`.

**When to use:** Optimal exhaustible-resource benchmarking, theory comparison, calibration of observed price paths that rise faster than the risk-free rate.

### Nash-Cournot

```
model_approach: "nash_cournot"
```

Strategic participants named in `nash_strategic_participants` internalise their own price impact. The equilibrium satisfies: no strategic participant `i` can reduce total compliance cost by unilaterally changing abatement `aᵢ`. Non-listed participants remain price-takers. Uses Jacobi best-response iteration starting from the competitive equilibrium.

**When to use:** Markets with a small number of dominant emitters or buyers; assessment of market-power distortion on price formation.

### Run All

```
model_approach: "all"
```

Runs competitive, Hotelling, and Nash-Cournot in parallel on the same config and returns all three in a single response, allowing direct model comparison without re-submitting the scenario three times.

---

## Key Features

| Feature | Config field(s) | Description |
|---|---|---|
| Multi-year simulation | `scenarios[].years[]` | Sequential year execution with bank balance propagation |
| Banking | `banking_allowed: true` | Carry surplus allowances to future years |
| Borrowing | `borrowing_allowed: true`, `borrowing_limit` | Advance future allocations to current year |
| Rational expectations | `expectation_rule: "perfect_foresight"` | Fixed-point iteration until realised = expected prices |
| Hotelling path | `model_approach: "hotelling"` | Prices rise at `r+ρ` per year; `λ` bisected to budget |
| Nash-Cournot | `model_approach: "nash_cournot"` | Strategic participants internalise price impact |
| CBAM liability | `eua_price`, `cbam_export_share` | Post-equilibrium border adjustment cost |
| Multi-jurisdiction CBAM | `cbam_jurisdictions[]` | Per-jurisdiction price gap liability |
| EUA ensemble | `eua_price_ensemble` | Fan-chart CBAM across multiple EUA forecasts |
| Scope 2 / indirect | `electricity_consumption`, `grid_emission_factor` | Indirect emissions and Scope 2 CBAM |
| Output-Based Allocation | `production_output`, `benchmark_emission_intensity` | OBA free allocation overrides ratio |
| BAU trajectory | `initial_emissions_trajectory` | Linearly interpolate BAU emissions per participant |
| Grid factor trajectory | `grid_emission_factor_trajectory` | Linearly interpolate grid intensity per participant |
| Sector-level caps | `sectors[]` with `cap_trajectory`, `auction_share_trajectory` | Derive total cap and free pool from per-sector definitions |
| Policy cap trajectory | `cap_trajectory` | Smoothly declining total cap without per-year repetition |
| Price floor/ceiling | `price_floor_trajectory`, `price_ceiling_trajectory` | Rising price bounds without per-year repetition |
| Free allocation phase-out | `free_allocation_trajectories[]` | Per-participant ratio phase-out trajectory |
| Market Stability Reserve | `msr_enabled: true` | Withhold/release allowances based on aggregate bank |
| Piecewise MAC | `abatement_type: "piecewise"`, `mac_blocks[]` | Step-function marginal abatement cost curve |
| Technology switching | `technology_options[]` | Endogenous technology choice via SLSQP portfolio optimisation |
| Auction design | `auction_reserve_price`, `minimum_bid_coverage` | Reserve price and minimum coverage rules |
| Calibration | `POST /api/calibrate` | Nelder-Mead fit of MAC slopes to observed prices |
| Batch sweep | `POST /api/batch-run` | Cartesian-product parameter sensitivity |
| CSV import | `POST /api/import-csv` | CSV table to ETS config JSON |
| Narrative summary | `POST /api/narrative` | Rule-based plain-language interpretation |
| Auction revenue tracker | auto-computed | Domestic retained, CBAM foregone, potential if KAU=EUA |

---

## Config Schema Quick Reference

### Scenario-level fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Scenario identifier |
| `model_approach` | `"competitive"` \| `"hotelling"` \| `"nash_cournot"` \| `"all"` | `"competitive"` | Price-formation mechanism |
| `discount_rate` | float | `0.04` | Annual discount rate `r` for Hotelling formula |
| `risk_premium` | float | `0.0` | Policy risk premium `ρ` added to `r` in Hotelling formula |
| `nash_strategic_participants` | string[] | `[]` | Participant names treated as strategic in Nash-Cournot |
| `msr_enabled` | bool | `false` | Enable Market Stability Reserve |
| `msr_upper_threshold` | float | `200.0` | Bank (Mt) above which withholding fires |
| `msr_lower_threshold` | float | `50.0` | Bank (Mt) below which release fires |
| `msr_withhold_rate` | float | `0.12` | Fraction of auction_offered withheld per year |
| `msr_release_rate` | float | `50.0` | Mt released per year from reserve |
| `msr_cancel_excess` | bool | `false` | Permanently cancel pool above `msr_cancel_threshold` |
| `msr_cancel_threshold` | float | `400.0` | Pool level (Mt) above which excess is cancelled |
| `cap_trajectory` | object | `{}` | Scenario-wide linearly declining total cap |
| `price_floor_trajectory` | object | `{}` | Linearly rising price floor |
| `price_ceiling_trajectory` | object | `{}` | Linearly rising price ceiling |
| `free_allocation_trajectories` | array | `[]` | Per-participant free ratio phase-out |
| `sectors` | array | `[]` | Sector objects with cap and auction share trajectories |
| `years` | array | required | Year config objects |

### Year-level fields

| Field | Type | Default | Description |
|---|---|---|---|
| `year` | string | required | Year label (e.g. `"2030"`) |
| `total_cap` | float | `0.0` | Annual emissions cap (Mt CO₂e) |
| `auction_mode` | `"explicit"` \| `"derive_from_cap"` | `"explicit"` | How auction volume is determined |
| `auction_offered` | float | `0.0` | Volume offered at auction (Mt) |
| `reserved_allowances` | float | `0.0` | Withheld from market; count toward cap |
| `cancelled_allowances` | float | `0.0` | Permanently retired; count toward cap |
| `auction_reserve_price` | float | `0.0` | Minimum clearing price |
| `minimum_bid_coverage` | float [0,1] | `0.0` | Min fraction of offered volume that must be bid |
| `unsold_treatment` | `"reserve"` \| `"cancel"` \| `"carry_forward"` | `"reserve"` | Disposition of unsold allowances |
| `price_lower_bound` | float | `0.0` | Price floor for equilibrium solver |
| `price_upper_bound` | float | `100.0` | Price ceiling for equilibrium solver |
| `banking_allowed` | bool | `false` | Allow surplus carry-forward |
| `borrowing_allowed` | bool | `false` | Allow deficit carry-back |
| `borrowing_limit` | float | `0.0` | Maximum borrow volume (Mt) |
| `expectation_rule` | string | `"next_year_baseline"` | Future price expectation method |
| `manual_expected_price` | float | `0.0` | Price used when `expectation_rule = "manual"` |
| `carbon_budget` | float | `0.0` | Cumulative budget for Hotelling bisection |
| `eua_price` | float | `0.0` | EU ETS reference price for CBAM |
| `eua_prices` | object | `{}` | Per-jurisdiction prices, e.g. `{"EU": 72, "UK": 58}` |
| `eua_price_ensemble` | object | `{}` | Named EUA forecasts for CBAM fan chart |
| `participants` | array | required | Participant config objects |

### Participant-level fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | required | Unique participant identifier |
| `sector_group` | string | `""` | Sector label for aggregated reporting |
| `sector_allocation_share` | float [0,1] | `0.0` | This participant's share of its sector's free pool |
| `initial_emissions` | float ≥ 0 | `0.0` | Gross BAU emissions (Mt CO₂e) |
| `initial_emissions_trajectory` | object | `{}` | Linearly interpolated BAU over years |
| `free_allocation_ratio` | float [0,1] | `0.0` | Share of initial emissions covered for free |
| `penalty_price` | float > 0 | `100.0` | Fine per uncovered tonne (₩/t) |
| `abatement_type` | `"linear"` \| `"piecewise"` \| `"threshold"` | `"linear"` | MAC model |
| `max_abatement` | float ≥ 0 | `0.0` | Maximum reducible emissions (Mt) |
| `cost_slope` | float > 0 | `1.0` | Slope `σ` of linear MAC (₩/t per Mt) |
| `threshold_cost` | float ≥ 0 | `0.0` | Switching price for threshold MAC |
| `mac_blocks` | array | `[]` | Piecewise MAC blocks (sorted by marginal_cost) |
| `production_output` | float ≥ 0 | `0.0` | Annual physical output (Mt product/yr) |
| `benchmark_emission_intensity` | float ≥ 0 | `0.0` | OBA benchmark (tCO₂/unit product) |
| `cbam_export_share` | float [0,1] | `0.0` | Fraction exported to single CBAM market |
| `cbam_coverage_ratio` | float [0,1] | `1.0` | Fraction of exports within CBAM scope |
| `cbam_jurisdictions` | array | `[]` | Multi-jurisdiction CBAM list |
| `electricity_consumption` | float ≥ 0 | `0.0` | Annual electricity use (MWh) |
| `grid_emission_factor` | float ≥ 0 | `0.0` | Grid carbon intensity (tCO₂/MWh) |
| `grid_emission_factor_trajectory` | object | `{}` | Linearly interpolated grid factor over years |
| `scope2_cbam_coverage` | float [0,1] | `0.0` | Fraction of indirect emissions in CBAM scope |
| `technology_options` | array | `[]` | Alternative production technologies |

---

## Solver Settings

Nine solver parameters, all set at the scenario level, control numerical precision and iteration limits across the three solvers.

| Parameter | Default | Controls |
|---|---|---|
| `solver_competitive_max_iters` | `25` | Maximum perfect-foresight fixed-point iterations before declaring convergence |
| `solver_competitive_tolerance` | `0.001` | Convergence threshold: max price change between iterations (₩/t) |
| `solver_hotelling_max_bisection_iters` | `80` | Maximum bisection steps when finding shadow price `λ` |
| `solver_hotelling_max_lambda_expansions` | `20` | Maximum attempts to expand the `[λ_low, λ_high]` bracket |
| `solver_hotelling_convergence_tol` | `0.0001` | Relative tolerance on cumulative emissions: `|Σ_e − budget| / budget` |
| `solver_nash_price_step` | `0.5` | Finite-difference step (₩/t) for estimating `dP/dQ` price impact |
| `solver_nash_max_iters` | `120` | Maximum Jacobi best-response iterations per year |
| `solver_nash_convergence_tol` | `0.001` | Convergence threshold: max abatement change (Mt) between iterations |
| `solver_penalty_price_multiplier` | `1.25` | Upper bracket = `max(penalty_price) × multiplier` for Brent's method |

---

## Analysis Tools

Four tools in `src/ets/analysis/` extend the core simulator with higher-level workflows.

### Model Calibration (`/api/calibrate`)

Fits `abatement_cost_slope` parameters for named participants to minimise MSE between modelled equilibrium prices and a set of observed historical prices. Uses Nelder-Mead optimisation (scipy).

**Request:** `POST /api/calibrate` with JSON body:

```json
{
  "config": { "scenarios": [...] },
  "observed_prices": { "2026": 18.5, "2027": 22.0, "2028": 25.5 },
  "participant_names": ["POSCO", "Hyundai Steel"],
  "initial_slopes": [6.5, 7.0],
  "max_iter": 500
}
```

**Response:** `calibrated_slopes`, `final_mse`, `iterations`, `success`, `modelled_prices`, `observed_prices`.

### Batch / Sensitivity Runner (`/api/batch-run`)

Sweeps one or more parameters over cartesian product of values and collects per-run summaries. Uses JSON-path notation with `[*]` wildcard for year arrays.

**Request:** `POST /api/batch-run`:

```json
{
  "config": { "scenarios": [...] },
  "sweeps": [
    { "path": "scenarios[0].years[*].eua_price", "values": [40, 60, 80, 100] },
    { "path": "scenarios[0].discount_rate", "values": [0.03, 0.04, 0.05] }
  ]
}
```

**Response:** `runs` (one per combination), `sweep_axes`, `n_runs`, `n_errors`.

### CSV Import (`/api/import-csv`)

Converts a CSV table (one row per participant per year) into a valid ETS config JSON. Required columns: `year`, `participant_name`. Optional columns match participant field names.

**Request:** `POST /api/import-csv` with `multipart/form-data` containing `file` field (CSV text) and optional `scenario_name`.

### Narrative Summary (`/api/narrative`)

Generates a plain-language interpretation of simulation results: price trend, cumulative abatement, CBAM exposure, and domestic auction revenue.

**Request:** `POST /api/narrative`:

```json
{
  "results": [ { "year": "2026", "summary": { "Equilibrium Carbon Price": 18500 } } ],
  "scenario_name": "K-ETS Baseline"
}
```

**Response:** `{ "narrative": "The equilibrium carbon price rises from ₩18,500/t in 2026 ..." }`

---

## GUI Walkthrough

### Step 1 — Scenario setup

Set `name`, `model_approach`, `discount_rate` (Hotelling), `risk_premium` (Hotelling), `nash_strategic_participants` (Nash). Enable MSR parameters if needed. All fields are in the collapsible **Scenario Settings** group.

### Step 2 — Year configuration

Each year is a collapsible panel. Set `total_cap`, `auction_mode`, `auction_offered`, price bounds, banking/borrowing flags, and `expectation_rule`. Collapsible groups within each year: **Auction Design**, **Price Bounds**, **Banking & Borrowing**, **Expectation Settings**, **CBAM / EUA Prices**.

### Step 3 — Participant configuration

Add participants via the **Add Participant** button. Collapsible groups per participant: **Emissions & Allocation**, **MAC / Abatement**, **CBAM Exposure**, **Scope 2 / Indirect**, **Output-Based Allocation (OBA)**, **Technology Options**.

The MAC block editor supports visual entry of piecewise step-function cost curves. Each block defines an `amount` (Mt CO₂e abatable at this cost) and `marginal_cost` (₩/t). Blocks must be entered in non-decreasing cost order.

The technology transition wizard guides creation of `technology_options` — alternative production modes with their own emission profiles, MAC curves, fixed adoption costs, and maximum activity shares.

### Step 4 — Run and explore

Click **Run Simulation**. The output panels show:

- **Scenario summary table**: one row per scenario-year with all aggregate statistics
- **Market clearing chart**: demand curve and equilibrium price for each year
- **Annual emissions trajectory**: abatement and residual emissions over time
- **Participant panel**: individual cost breakdown, CBAM liability, bank balances
- **Narrative**: plain-language interpretation (auto-generated)

---

## Output Columns Reference

### Participant results (one row per participant per year)

| Column | Description |
|---|---|
| `Scenario` | Scenario name |
| `Year` | Year label |
| `Participant` | Participant name |
| `Sector Group` | Sector label from `sector_group` |
| `Chosen Technology` | Active technology name or "Mixed Portfolio ..." |
| `Technology Mix` | Semicolon-separated `name:share` pairs |
| `Initial Emissions` | BAU gross emissions (Mt CO₂e) |
| `Free Allocation` | Free allowances received (Mt) |
| `Abatement` | Emissions reduced (Mt) |
| `Residual Emissions` | Post-abatement direct emissions (Mt) |
| `Allowance Buys` | Allowances purchased (Mt) |
| `Allowance Sells` | Allowances sold (Mt) |
| `Net Allowances Traded` | Buys minus sells (Mt); positive = net buyer |
| `Penalty Emissions` | Emissions not covered, subject to penalty (Mt) |
| `Starting Bank Balance` | Allowances carried in from prior year (Mt) |
| `Ending Bank Balance` | Allowances carried forward to next year (Mt) |
| `Banked Allowances` | `max(0, ending bank balance)` (Mt) |
| `Borrowed Allowances` | `max(0, -ending bank balance)` (Mt) |
| `Expected Future Price` | Price used for banking/borrowing decision (₩/t) |
| `Fixed Technology Cost` | Fixed adoption cost of chosen technology (₩M) |
| `Abatement Cost` | Variable cost of abatement (₩M) |
| `Allowance Cost` | Cost of purchased allowances at equilibrium price (₩M) |
| `Penalty Cost` | Fine for uncovered emissions (₩M) |
| `Sales Revenue` | Revenue from sold allowances (₩M) |
| `Total Compliance Cost` | Sum of costs minus sales revenue (₩M) |
| `EUA Price` | EU ETS reference price used for CBAM (€/t) |
| `CBAM Gap` | `max(0, EUA_price − P*)` (₩/t) |
| `CBAM Export Share` | Aggregate export share fraction |
| `CBAM Liable Emissions` | Residual emissions subject to CBAM (Mt) |
| `CBAM Liability` | Total CBAM border adjustment (₩M) |
| `Total Cost incl. CBAM` | Total Compliance Cost + CBAM Liability (₩M) |
| `Electricity Consumption` | Annual electricity use (MWh) |
| `Grid Emission Factor` | Grid carbon intensity (tCO₂/MWh) |
| `Indirect Emissions` | `electricity × grid_factor` (Mt CO₂e) |
| `Scope 2 CBAM Coverage` | Fraction of indirect emissions in CBAM scope |
| `Scope 2 CBAM Liability` | CBAM liability on indirect emissions (₩M) |
| `CBAM Liability (X)` | Per-jurisdiction CBAM when `cbam_jurisdictions` used |
| `CBAM Gap (X)` | Per-jurisdiction price gap |
| `CBAM Liability (source)` | EUA ensemble CBAM under named forecast |

### Scenario summary (one row per scenario-year)

| Column | Description |
|---|---|
| `Equilibrium Carbon Price` | Market-clearing price P* (₩/t) |
| `Total Abatement` | Sum across all participants (Mt) |
| `Total Allowance Buys / Sells` | Gross market volume (Mt) |
| `Total Penalty Emissions` | Uncovered emissions in penalty channel (Mt) |
| `Auction Offered / Sold` | Supply and actual clearing volume (Mt) |
| `Unsold Allowances` | Allowances below reserve price (Mt) |
| `Auction Coverage Ratio` | Sold / Offered |
| `Total Auction Revenue` | `P* × auction_sold` (₩M) |
| `Total Banked / Borrowed Allowances` | System-wide bank dynamics (Mt) |
| `MSR Withheld / Released / Reserve Pool` | MSR state when enabled (Mt) |
| `Total CBAM Liability` | System-wide border adjustment (₩M) |
| `Domestic Retained Revenue` | Auction revenue remaining in Korea (₩M) |
| `CBAM Foregone Revenue` | CBAM that flows to EU rather than Korea (₩M) |
| `Potential Revenue if KAU=EUA` | Domestic revenue if price equalled EUA (₩M) |
| `{Sector} Total Abatement` | Sector-group aggregate (Mt) |
| `{Sector} P10/P50/P90 Compliance Cost` | Distribution across participants in sector (₩M) |

---

## Documentation Index

| File | What it covers |
|---|---|
| `docs/algorithm-overview.md` | Three-layer architecture, all solvers (competitive, Hotelling, Nash), MSR, CBAM, validation rules, execution flow |
| `docs/data-model.md` | Every config field — type, default, validation, example |
| `docs/multi-year-simulation.md` | Banking, borrowing, expectation rules, BAU trajectory, grid factor trajectory, sector dynamics, auction revenue decomposition |
| `docs/oba-allocation.md` | Output-Based Allocation concept, formula, override hierarchy, worked steel example |
| `docs/sector-config.md` | Sector-level caps, auction share derivation, per-participant allocation from sector pool, worked two-participant example |
| `docs/analysis-tools.md` | Calibration, batch runner, CSV import, narrative — APIs, request/response schemas, algorithms |
| `docs/mac-abatement.md` | Linear, piecewise, and threshold MAC models with cost derivations |
| `docs/market-equilibrium.md` | Brent's method details, auction rules, bracketing procedure |
| `docs/technology-transition.md` | Technology options, SLSQP portfolio optimisation, fixed-cost switching |

---

## Project Structure

```
src/ets/
  participant/
    models.py          MarketParticipant, TechnologyOption, ComplianceOutcome
    compliance.py      Cost minimisation, abatement, banking, penalty logic
    technology.py      Technology-switching helpers
  market/
    core.py            CarbonMarket dataclass
    equilibrium.py     Brent's method root finder
    results.py         participant_results(), scenario_summary()
  config_io/
    normalize.py       Field normalisation and config-time validation
    builder.py         build_markets_from_config(), trajectory/OBA/sector derivation
    templates.py       Blank config scaffolding
  solvers/
    simulation.py      run_simulation(), competitive path, perfect-foresight iteration
    hotelling.py       Hotelling shadow-price bisection
    nash.py            Nash-Cournot best-response iteration
    expectations.py    derive_expected_prices(), four expectation rules
    msr.py             MSRState accumulator
  web/
    server.py          ThreadingHTTPServer launcher
    handlers.py        Route dispatch, dashboard payload builder
  analysis/
    calibration.py     calibrate_slopes() — Nelder-Mead MAC fitting
    batch.py           run_batch() — cartesian-product sweep
    csv_import.py      csv_to_config() — CSV to ETS config
    narrative.py       generate_narrative() — plain-language summary
  expectations.py      Shim → solvers/expectations (backward compat)
  msr.py               Shim → solvers/msr (backward compat)
  costs.py             linear_abatement_factory, piecewise_abatement_factory
  config.py            Path constants (EXAMPLES_DIR, USER_SCENARIOS_DIR, etc.)
  server.py            Shim → web/server (backward compat)
  participant.py       Shim → participant/ (backward compat)
  market.py            Shim → market/ (backward compat)

api/
  index.py             Vercel serverless shim — wraps WSGI app

frontend/
  src/
    app.jsx            Root component — tab routing
    components/
      Editor.jsx           Scenario builder — collapsible config panels
      AppViews.jsx          Output views coordinator
      AppShared.jsx         Shared layout, toolbar
      MarketChart.jsx       Demand curve and equilibrium price chart
      AnnualMarketChart.jsx Multi-year price trajectory chart
      AnnualEmissionsChart.jsx Emissions trajectory chart
      TrajectoryChart.jsx   Policy trajectory visualisation
      ParticipantPanel.jsx  Participant-level cost breakdown
      ParticipantMacChart.jsx MAC curve visualisation
      MarketYearGallery.jsx Year-gallery navigation
      GuideView.jsx         In-app user guide

examples/             Pre-built JSON scenario files
user-scenarios/       User-saved scenarios (runtime, gitignored)
docs/                 Extended documentation
```

---

## Limitations

- **Single commodity:** Only CO₂-equivalent emissions are modelled. Multi-pollutant or multi-sector general-equilibrium feedback is not captured.
- **Static abatement curves:** MAC parameters do not evolve endogenously. Technological learning curves must be specified explicitly via trajectories.
- **No financial intermediaries:** Banks, brokers, and speculative traders are not modelled. Banking is purely a compliance firm decision.
- **No macroeconomic feedback:** Carbon costs do not affect output prices, GDP, or sectoral output. The model is partial-equilibrium by design.
- **Calibration is single-scenario:** The `/api/calibrate` endpoint calibrates `abatement_cost_slope` for linear MAC only; piecewise blocks are not calibrated automatically.
- **Nash-Cournot convergence:** The Jacobi iteration may not converge for all market configurations; the solver logs a warning and uses its best approximation if the iteration limit is reached.
- **Integer compliance:** The model operates in continuous tonnes; compliance is not restricted to integer lots.
