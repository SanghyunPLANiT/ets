# Particle Equilibrium — ETS Simulator

A web-based **Emissions Trading System (ETS) simulator** that computes carbon market equilibria across multiple years, scenarios, and participant types. The solver is built on SciPy numerical methods; the frontend is React/Vite. Deployed on Vercel.

**Live app:** https://ets.vercel.app

---

## What it does

1. **Configure** a carbon market — cap trajectory, auction design, price bounds, participant abatement curves, technology options, banking/borrowing rules.
2. **Solve** for the equilibrium carbon price in each year using Brent's root-finding method.
3. **Simulate** multi-year pathways with intertemporal banking, borrowing, and four expectation-formation rules including rational expectations (perfect foresight).
4. **Compare** multiple policy scenarios side by side.

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/algorithm-overview.md](docs/algorithm-overview.md) | The three-layer computational architecture and how the layers compose |
| [docs/mac-abatement.md](docs/mac-abatement.md) | Marginal Abatement Cost models — linear, piecewise, threshold — maths, code, examples |
| [docs/technology-transition.md](docs/technology-transition.md) | Endogenous technology choice, mixed portfolio optimisation, transition pathways |
| [docs/market-equilibrium.md](docs/market-equilibrium.md) | Brent's method equilibrium solver, auction mechanics, price bounds, edge cases |
| [docs/multi-year-simulation.md](docs/multi-year-simulation.md) | Banking, borrowing, expectation rules, perfect foresight fixed-point iteration, rational expectations equilibrium |
| [docs/data-model.md](docs/data-model.md) | Full JSON config schema, every field's type / default / validation, minimal and full examples |

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

## Local development

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

## Build & deploy

```bash
cd frontend && npm run build
cp public/styles.css dist/styles.css
cd ..
vercel --prod
```
