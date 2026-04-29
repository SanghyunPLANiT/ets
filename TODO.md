# ETS Model TODO

Items are grouped by theme. Checked items are complete. Unchecked items are pending.

---

## Infrastructure

- [x] Backend modular sub-package restructuring: split `src/ets/` into `participant/`, `market/`, `config_io/`, `solvers/`, `web/` sub-packages; backward-compat shims kept at old flat paths

---

## Core economic modelling

- [x] Replace reduced-form abatement with firm-level compliance optimisation
- [x] Separate compliance into three channels: abate, buy allowances, pay penalty
- [x] Add richer per-participant result outputs (abatement cost, allowance cost, penalty cost, total)
- [x] Replace `cost_slope`-only linear MAC with explicit piecewise MAC blocks
- [x] Support discrete technology-switch decisions (blast furnace → hydrogen DRI, etc.)
- [x] Add banking and borrowing of allowances across years
- [x] Add configurable expectation-formation rules (myopic, next_year_baseline, perfect_foresight, manual)
- [x] Add Hotelling Rule solver (shadow price bisection over carbon budget)
- [x] Add Nash-Cournot strategic equilibrium (best-response iteration)
- [x] Add Market Stability Reserve (MSR) — withhold/release based on aggregate bank
- [x] Add CBAM liability calculation (post-equilibrium, export-share weighted)
- [x] Hotelling risk premium (`risk_premium` param ρ): price path `P(t) = λ·(1+r+ρ)^t`
- [ ] Output-based allocation (OBA): participant emissions scale with production output; free allocation tied to actual output × benchmark rather than fixed baseline — required for carbon leakage sectors (steel, petrochemical)
- [ ] Participant-specific BAU emissions trajectory: allow each participant to define a multi-year baseline emissions path (e.g. from NDC or 11th Power Plan projections) without setting `initial_emissions` manually per year

---

## Policy mechanisms

- [x] Price floor, price ceiling, reserve price, minimum bid coverage, unsold treatment
- [x] Free-allocation phase-out auto-calculator: scenario-level `free_allocation_trajectories`; linearly interpolates `free_allocation_ratio` per participant per year
- [x] Policy trajectory constraints: `cap_trajectory`, `price_floor_trajectory`, `price_ceiling_trajectory` — linearly interpolated scenario-level overrides
- [x] Multi-jurisdiction CBAM: `cbam_jurisdictions` array on participant; `eua_prices` dict per year; per-jurisdiction liability columns
- [x] Sector grouping: `sector_group` on participants; sector-level aggregated rows in scenario summary
- [x] Sector-level auction revenue attribution: proportional by allowance buys (`{sg} Auction Revenue Share`)
- [ ] Benchmark-based free allocation: move beyond `free_allocation_ratio`; compute free allocation from product benchmark × production volume (required for 4th allocation plan modelling)
- [ ] Additional trade policy jurisdictions as built-in sensitivity: UK CBAM (2026 implementation timeline), US CBAM (legislative draft), Japan GX-ETS — pre-built scenario templates with jurisdiction-specific parameters rather than requiring manual `cbam_jurisdictions` config
- [ ] KAU–EUA price convergence scenario helper: shortcut to configure a scenario where domestic price ramps toward EUA level over a specified timeline (common policy question for K-ETS Phase 4)
- [ ] Auction revenue reinvestment tracker: distinguish revenue captured domestically (available for green transition fund) vs. foregone revenue that shifts to EU under CBAM — key output for the K-ETS Phase 4 policy narrative

---

## Multi-year dynamics

- [x] Policy trajectory constraints across years: `cap_trajectory`, `price_floor_trajectory`, `price_ceiling_trajectory`
- [ ] BAU trajectory auto-generation: per-sector automatic Business-as-Usual emissions path generation (11th Power Plan / NDC baseline); currently requires manual entry per year
- [ ] Grid emission factor trajectory: allow `grid_emission_factor` to follow a year-by-year or trajectory-based path (linked to 11th Power Plan power sector decarbonisation schedule) — affects Scope 2 emissions and CBAM exposure over time
- [ ] Expected future price logic — replace the `next_year_baseline` heuristic with a proper dynamic expectations module (e.g. adaptive/learning expectations)

---

## Calibration and data

- [ ] Model calibration tool: fit MACC parameters to reproduce historically observed KAU prices (2015–2025); output calibrated `cost_slope` or piecewise MAC blocks per sector
- [ ] Import workflow: load participant and year data from CSV or structured table (avoid manual JSON editing for large datasets)
- [ ] Facility-level cost distribution analysis: within a sector, use individual facility panel data to generate a distribution of compliance costs rather than a single aggregate MACC — supports the proposal's 3-month deliverable on cost distribution analysis
- [x] Validation rules: duplicate participant names, penalty < floor, cap < supply (post-trajectory)

---

## Analysis and sensitivity

- [ ] Batch/sensitivity runner: run N parameter combinations automatically (e.g. sweep over cap tightening rates, CBAM coverage ratios, EUA price paths); output price and cost distributions
- [x] EUA ensemble / fan chart: `eua_price_ensemble` dict per year (EC / Enerdata / BNEF); per-source CBAM liability columns in participant results
- [x] Indirect emissions (Scope 2): `electricity_consumption` + `grid_emission_factor` + `scope2_cbam_coverage`; `Indirect Emissions` and `Scope 2 CBAM Liability` in results
- [ ] Sub-sector decomposition: split a `sector_group` into sub-sectors (e.g. steel → integrated/EAF/special; petrochemical → NCC/BTX/polymer) with separate MACCs — enables within-sector heterogeneity analysis as proposed in the 6-month research plan

---

## UX and outputs

- [x] Side-by-side scenario comparison charts
- [x] Visual MAC block editor
- [x] Technology transition wizard with archetypes
- [ ] Scope 2 / indirect emissions display in participant results panel (backend computes it; frontend does not yet show it)
- [ ] Spreadsheet conveniences: duplicate row, paste from clipboard, CSV import/export per table, inline validation highlighting
- [ ] Automatic narrative summaries: plain-language interpretation of price path, compliance cost, CBAM exposure by scenario — important for policy reports

---

## Summary table — pending items

| Item | Effort | Criticality | What's needed |
|---|---|---|---|
| Output-based allocation (OBA) | Large | High — required for carbon leakage sector modelling | Production output field per participant; allocation = benchmark × output |
| BAU trajectory auto-generation | Medium | High — eliminates manual entry per year | Per-participant emissions path from NDC/11th Power Plan data |
| Grid emission factor trajectory | Small | Medium | Same trajectory pattern as `cap_trajectory`; add `grid_emission_factor_trajectory` field |
| Model calibration tool | Large | High for empirical work | Optimise MACC params to match historical KAU price series |
| Batch/sensitivity runner | Medium | High for policy analysis | Parameterised sweep + result aggregation |
| Sub-sector decomposition | Medium | Medium — proposal 6-month item | Nested sector_group structure; sub-sector MACCs |
| Facility-level cost distribution | Medium | Medium — proposal 3-month deliverable | Facility panel → within-sector cost distribution |
| Additional trade jurisdictions (UK/US/Japan) | Small | Medium | Pre-built example scenarios; no new backend needed |
| KAU–EUA convergence scenario helper | Small | Medium | Config shortcut to ramp domestic price toward EUA |
| Auction revenue reinvestment tracker | Small | Medium — key policy metric | Split `Total Auction Revenue` into domestic-retained vs. CBAM-foregone |
| Import workflow (CSV) | Medium | Medium | CSV → JSON config conversion tool |
| Benchmark-based free allocation | Large | High for Phase 4 modelling | Product benchmark × output replaces ratio-based allocation |
| Scope 2 display in frontend | Small | Low — data already computed | Wire `Indirect Emissions` and `Scope 2 CBAM Liability` to results table |
| Expected price dynamic module | Medium | Low — theoretical improvement | Adaptive/learning expectations as alternative to `next_year_baseline` |
| Automatic narrative summaries | Large | Low — reporting convenience | NLP/template-based plain-language summaries |
| Spreadsheet conveniences | Medium | Low — UX polish | CSV import/export, duplicate row, clipboard paste |
