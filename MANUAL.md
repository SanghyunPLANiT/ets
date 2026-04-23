# ETS Framework Manual

## 1. What This Tool Is

This project is a user-configurable Emissions Trading System (ETS) simulator with:

- heterogeneous participants
- user-defined market rules by year
- free allocation and auctioning
- marginal abatement cost curves
- endogenous technology choice
- banking and borrowing across years
- browser-based scenario building

The model solves for the carbon price that clears the allowance market in each scenario-year.

The framework is designed for:

- policy scenario design
- comparative market analysis
- transparent experimentation
- structured teaching and stakeholder discussion

It is not yet a fully calibrated forecasting model for a real national ETS unless the user supplies real participant-level data and validates assumptions externally.

## 2. Where Everything Lives

Core backend:

- [src/ets/participant.py](/Users/sanghyun/github/particalequlibrium/src/ets/participant.py)
- [src/ets/market.py](/Users/sanghyun/github/particalequlibrium/src/ets/market.py)
- [src/ets/scenarios.py](/Users/sanghyun/github/particalequlibrium/src/ets/scenarios.py)
- [src/ets/simulation.py](/Users/sanghyun/github/particalequlibrium/src/ets/simulation.py)
- [src/ets/costs.py](/Users/sanghyun/github/particalequlibrium/src/ets/costs.py)

Web UI:

- [src/ets/webapp.py](/Users/sanghyun/github/particalequlibrium/src/ets/webapp.py)
- [frontend/src/app.jsx](/Users/sanghyun/github/particalequlibrium/frontend/src/app.jsx)
- [frontend/src/components/Editor.jsx](/Users/sanghyun/github/particalequlibrium/frontend/src/components/Editor.jsx)
- [frontend/public/styles.css](/Users/sanghyun/github/particalequlibrium/frontend/public/styles.css)

Entry points:

- [ets_framework.py](/Users/sanghyun/github/particalequlibrium/ets_framework.py)
- [run.command](/Users/sanghyun/github/particalequlibrium/run.command)

Examples:

- [examples/climate_solutions_transition_pathway.json](/Users/sanghyun/github/particalequlibrium/examples/climate_solutions_transition_pathway.json)
- [examples/climate_solutions_mac_pathway.json](/Users/sanghyun/github/particalequlibrium/examples/climate_solutions_mac_pathway.json)
- [examples/climate_solutions_technology_switching.json](/Users/sanghyun/github/particalequlibrium/examples/climate_solutions_technology_switching.json)
- [examples/climate_solutions_banking_borrowing.json](/Users/sanghyun/github/particalequlibrium/examples/climate_solutions_banking_borrowing.json)

Built frontend bundle:

- [frontend/dist](/Users/sanghyun/github/particalequlibrium/frontend/dist)

## 3. How To Run It

### Browser GUI

Run:

```bash
/Users/sanghyun/github/particalequlibrium/run.command
```

Or:

```bash
.venv/bin/python /Users/sanghyun/github/particalequlibrium/ets_framework.py --gui
```

### File-driven mode

```bash
.venv/bin/python /Users/sanghyun/github/particalequlibrium/ets_framework.py --config /Users/sanghyun/github/particalequlibrium/examples/climate_solutions_mac_pathway.json
```

### Export a blank template

```bash
.venv/bin/python /Users/sanghyun/github/particalequlibrium/ets_framework.py --export-template my_config.json
```

## 4. How To Use The GUI

The GUI is organized around:

- template loading
- scenario navigation
- the scenario workbench
- the step-by-step scenario builder
- output charts and diagnostics

### 4.1 Header Controls

At the top of the screen:

- `Load template`
  - loads a predefined example or blank config into the editor
  - this does not run the model
- `Add scenario`
  - creates a new scenario shell
- `Duplicate scenario`
  - copies the currently selected scenario
- `Remove scenario`
  - deletes the current scenario if more than one exists
- `Run scenario`
  - runs the currently loaded base scenario/template
- `Run edited`
  - runs the exact values currently visible in the editor
- `Compare all scenarios`
  - switches to scenario comparison view

Use `Run edited` after changing values in the builder.

### 4.2 Scenario Builder Steps

The builder has four steps.

#### Step 1. Scenario

Set:

- scenario name
- scenario color
- scenario description

This is metadata, but it also affects labeling across charts and outputs.

#### Step 2. Market Rules

Set year-specific market rules:

- year label
- auction mode
- total cap
- auctioned allowances
- price floor
- price ceiling
- banking allowed
- borrowing allowed
- borrowing limit

Important:

- if `auction_mode = explicit`, the user sets `auctioned_allowances` directly
- if `auction_mode = derive_from_cap`, auction supply is derived from:
  - total cap
  - minus total free allocation

#### Step 3. Participants

For each participant, the user can define:

- name
- sector
- initial emissions
- free allocation ratio
- penalty price
- abatement type
- maximum abatement
- cost slope
- threshold cost
- MAC blocks
- technology options

This step now supports:

- `Add participant from template`
- visual MAC block editing
- transition wizard for technology pathways

#### Step 4. Review

Shows a compact review of:

- scenario metadata
- year settings
- participant count
- technology-option count
- intertemporal rules
- participant table with abatement model and technologies

Use this step as a pre-run validation pass.

### 4.3 Participant Templates

The builder provides starter templates such as:

- Steel Blast Furnace
- Steel Hydrogen DRI
- Coal Generator
- Renewable Generator
- Cement Kiln

These are illustrative defaults. They are not automatically empirical or policy-calibrated.

### 4.4 Visual MAC Editing

For a participant or technology:

- add MAC blocks
- set block amount
- set block marginal cost
- remove blocks
- load a starter block set

Each MAC block means:

- a fixed amount of abatement
- available at a fixed marginal cost

The raw text field remains available as:

`amount@cost; amount@cost`

Example:

`6@20; 8@55; 8@110`

### 4.5 Transition Wizard

The transition wizard is a guided frontend tool for building technology pathways.

It does not change the solver itself. It helps the user generate structured `technology_options` for a selected participant.

Workflow:

1. select a participant
2. open `Transition wizard`
3. choose an archetype
4. choose one or more replacement technologies
5. choose transition mode:
   - conservative
   - moderate
   - aggressive
6. preview incumbent and replacement options
7. apply the pathway

The wizard then writes technology options into the participant configuration.

### 4.6 Outputs

After running:

- equilibrium carbon price
- auction revenue
- total abatement
- allowance trading
- technology pathway across years
- participant-level outcomes
- annual equilibrium charts
- interactive market-clearing charts

## 5. Core Model Concepts

This model has four distinct decision layers.

### 5.1 Market Design Layer

Specified by policy inputs:

- total cap
- free allocation
- auctioned allowances
- price bounds
- banking/borrowing rules

This defines the institutional structure of the ETS.

### 5.2 Participant Compliance Layer

At a given carbon price, each participant decides how to comply.

The compliance problem includes:

- abatement
- allowance buying
- allowance selling
- penalty use
- banked allowances
- borrowed allowances

### 5.3 Technology Choice Layer

If a participant has multiple technology options, the model evaluates each option and chooses the lowest-cost one.

This is discrete technology choice, not incremental abatement inside a fixed technology.

### 5.4 Market Clearing Layer

After each participant responds to the carbon price, aggregate allowance demand is compared with auctioned supply. The equilibrium price is the price that makes the market clear.

## 6. Exact Economic Logic

### 6.1 Participant Emissions Accounting

For participant `i` under technology `j`:

- baseline emissions: `E_ij`
- abatement: `A_ij(p)`
- residual emissions:

`R_ij(p) = E_ij - A_ij(p)`

Free allocation is:

`F_ij = E_ij * alpha_ij`

where `alpha_ij` is the free allocation ratio.

### 6.2 Net Allowance Position

Ignoring banking and borrowing for the moment, net allowance demand is:

`D_ij(p) = R_ij(p) - F_ij`

Interpretation:

- `D_ij(p) > 0`: buy allowances
- `D_ij(p) < 0`: sell surplus allowances

### 6.3 Compliance Cost

For a chosen technology, the participant minimizes:

`Total Cost = Fixed Technology Cost + Abatement Cost + Allowance Cost + Penalty Cost - Sales Revenue - Bank Value`

where:

- `Allowance Cost = allowance_buys * carbon_price`
- `Penalty Cost = penalty_emissions * penalty_price`
- `Sales Revenue = allowance_sells * carbon_price`
- `Bank Value = expected_future_price * ending_bank_balance`

This cost formulation is implemented in [ets/participant.py](/Users/sanghyun/github/particalequlibrium/ets/participant.py), especially:

- `_abatement_cost(...)`
- `_total_compliance_cost(...)`
- `_optimize_for_technology(...)`
- `optimize_compliance(...)`

### 6.4 Technology Choice

If the participant has `K` candidate technologies, the model solves:

`j* = argmin_j Total Cost_j(p)`

This means:

- each technology defines its own emissions and cost structure
- the participant chooses the cheapest technology at the current carbon price

This is a discrete minimum-cost selection problem, not a mixed portfolio model.

### 6.5 Banking and Borrowing

The model carries allowance balances across years.

For each participant:

- `starting_bank_balance`
- `ending_bank_balance`

If the participant has surplus allowances:

- it may bank them if banking is allowed and future price is attractive

If the participant has a shortage:

- it may borrow up to a limit if borrowing is allowed and future price logic supports doing so

Important:

- the current implementation uses a heuristic future price proxy
- it does not yet solve a full rational-expectations dynamic program

That is one of the most important remaining modeling limitations.

## 7. Abatement Representations

The model currently supports three abatement structures.

### 7.1 Linear

Used for smooth, reduced-form response.

Marginal abatement cost rises proportionally with abatement.

If the cost function is linear in slope form, total abatement cost behaves like:

`C(A) = 0.5 * s * A^2`

where `s` is the cost slope.

Interpretation:

- low slope = cheap response
- high slope = expensive response

### 7.2 Threshold

Used for stylized on/off response.

Abatement activates only if the carbon price crosses a threshold cost.

This is useful for:

- simple retrofit triggers
- policy teaching examples
- coarse step-change behavior

### 7.3 Piecewise MAC Blocks

Used for explicit marginal abatement cost curves.

Example:

`[{amount: 6, marginal_cost: 20}, {amount: 8, marginal_cost: 55}, {amount: 8, marginal_cost: 110}]`

Interpretation:

- first 6 units of abatement cost 20 each
- next 8 cost 55 each
- next 8 cost 110 each

Total abatement cost is piecewise linear:

`C(A) = sum_b mc_b * used_b`

This representation is often the best compromise between transparency and realism in this project.

## 8. MACC vs Technology Transition

These are related, but not identical.

### MACC

A marginal abatement cost curve describes abatement inside a technology or operating regime.

Question answered:

- how much can this technology abate at each marginal cost?

### Technology Transition

Technology transition chooses between technologies.

Question answered:

- should the participant keep the incumbent technology or switch to another one?

Example:

- MACC within blast furnace:
  - process efficiency
  - blending
  - operational changes
- technology transition:
  - blast furnace to hydrogen DRI

So:

- MACC = within-technology response
- technology transition = across-technology choice

## 9. Market-Clearing Algorithm

### 9.1 Equation

Let:

- `Q` = auctioned allowances
- `D_i(p)` = participant `i` net allowance demand at carbon price `p`

Then the clearing condition is:

`f(p) = sum_i D_i(p) - Q`

The equilibrium price `p*` satisfies:

`f(p*) = 0`

### 9.2 Interpretation

- if `f(p) > 0`, firms demand more allowances than are auctioned
  - price must rise
- if `f(p) < 0`, firms demand fewer allowances than are auctioned
  - price must fall

### 9.3 Numerical Method

The solver uses `scipy.optimize.root_scalar` with Brent’s method in [ets/market.py](/Users/sanghyun/github/particalequlibrium/ets/market.py).

Why this method:

- one-dimensional root problem
- robust under nonlinear demand response
- no derivative required
- standard for scalar equilibrium calculation

### 9.4 Bracketing Logic

The market starts with:

- `price_lower_bound`
- `price_upper_bound`

If the root is not bracketed, the upper bound is expanded iteratively until:

- a sign change is found, or
- a failure condition is hit

### 9.5 Solver Flow

For a given trial price `p`:

1. each participant solves its compliance problem
2. if technologies exist, the cheapest technology is chosen
3. net allowance demand is computed
4. all participant demands are summed
5. auction supply is subtracted
6. Brent’s method updates the price bracket

This repeats until the market-clearing residual is effectively zero.

## 10. Multi-Year Simulation Algorithm

The simulation is sequential by scenario.

Implemented in [ets/simulation.py](/Users/sanghyun/github/particalequlibrium/ets/simulation.py).

### 10.1 Ordering

For each scenario:

1. years are sorted
2. a baseline equilibrium price is computed for each year
3. bank balances are initialized
4. each year is solved in sequence

### 10.2 Intertemporal Heuristic

For year `t`, expected future price is approximated using the next year’s baseline equilibrium price.

This expected future price influences:

- whether surplus allowances are banked
- whether shortages are borrowed

This is useful, but still a simplification.

### 10.3 Carry-Forward State

After solving year `t`, the ending bank of each participant becomes the starting bank for year `t+1`.

That means the model has path dependence across years.

## 11. Data Structure

The config structure is:

```json
{
  "scenarios": [
    {
      "name": "Scenario name",
      "years": [
        {
          "year": "2030",
          "total_cap": 100,
          "auction_mode": "explicit",
          "auctioned_allowances": 40,
          "price_lower_bound": 0,
          "price_upper_bound": 250,
          "banking_allowed": true,
          "borrowing_allowed": false,
          "borrowing_limit": 0,
          "participants": [
            {
              "name": "Steelworks",
              "initial_emissions": 100,
              "free_allocation_ratio": 0.8,
              "penalty_price": 250,
              "abatement_type": "piecewise",
              "max_abatement": 22,
              "cost_slope": 1,
              "threshold_cost": 0,
              "mac_blocks": [
                { "amount": 6, "marginal_cost": 20 },
                { "amount": 8, "marginal_cost": 55 }
              ],
              "technology_options": []
            }
          ]
        }
      ]
    }
  ]
}
```

Technology options have the same internal structure as participants plus:

- `fixed_cost`

## 12. How To Interpret Outputs

### Equilibrium Carbon Price

The price at which participant net demand equals auctioned supply.

### Total Abatement

The sum of abatement chosen by all participants in that year.

### Allowance Buys and Sells

These show market positions:

- buys = compliance deficit
- sells = surplus position

Participants can all be net buyers if the government auction is the balancing seller.

### Total Auction Revenue

Government auction revenue:

`price * auctioned_allowances`

### Chosen Technology

For participants with technology options, this shows which technology minimized compliance cost in equilibrium.

### Banked / Borrowed Allowances

These show how intertemporal flexibility is being used across years.

## 13. Important Limitations

Current limitations:

- no strategic bidding
- no market power
- no endogenous expectations model
- no mixed technology shares inside one participant
- no explicit production/output decision
- no full empirical calibration
- technology switching is discrete single-choice, not partial capacity adoption

These are important when interpreting results.

## 14. Recommended Workflow For Users

Recommended sequence:

1. load a template
2. duplicate the scenario
3. adjust market rules by year
4. add or edit participants
5. edit MAC blocks
6. use the transition wizard for technology pathways
7. run edited scenario
8. inspect price, technology pathway, and allowance positions
9. compare scenarios
10. export outputs from `outputs`

## 15. What To Improve Next

The next most important scientific upgrade is:

`replace the current future-price heuristic with an explicit expectations model`

Reason:

- banking and borrowing now matter materially
- the current model uses the next year’s baseline equilibrium as a proxy for expected future price
- that is useful, but it is not a proper dynamic expectations framework

A stronger next version would:

- model expected future prices explicitly
- iterate expectations and realized prices together
- support more defensible banking and borrowing behavior

After that, the next strong upgrade would be:

`capacity-constrained multi-technology adoption within one participant`

That would allow:

- one incumbent technology
- multiple alternatives
- partial conversion shares
- gradual transition rather than single winner-takes-all technology choice

## 16. Short Summary

This framework currently does four things well:

- user-defined ETS scenario building
- transparent equilibrium price calculation
- explicit MAC-based compliance behavior
- discrete technology switching with multi-year bank/borrow dynamics

Its biggest remaining conceptual weakness is not market clearing itself. The market-clearing logic is sound. The biggest weakness is intertemporal expectations: banking and borrowing still rely on a simplified future-price proxy rather than a fully endogenous expectations system.
