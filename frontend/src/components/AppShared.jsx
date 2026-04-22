const { useState: useS, useEffect: useE } = React;

function makeBlankParticipant(index = 1) {
  return {
    name: `Participant ${index}`,
    sector: "Other",
    initial_emissions: 0,
    free_allocation_ratio: 0,
    penalty_price: 100,
    abatement_type: "linear",
    max_abatement: 0,
    cost_slope: 1,
    threshold_cost: 0,
    mac_blocks: [],
  };
}

function makeBlankYear(label = "2030") {
  return {
    year: String(label),
    total_cap: 0,
    auction_mode: "explicit",
    auction_offered: 0,
    reserved_allowances: 0,
    cancelled_allowances: 0,
    auction_reserve_price: 0,
    minimum_bid_coverage: 0,
    unsold_treatment: "reserve",
    price_lower_bound: 0,
    price_upper_bound: 100,
    banking_allowed: false,
    borrowing_allowed: false,
    borrowing_limit: 0,
    participants: [],
  };
}

function makeBlankScenario(index = 1) {
  return {
    id: `custom_scenario_${Date.now()}_${index}`,
    name: `New Scenario ${index}`,
    color: "#1f6f55",
    description: "Describe the policy design, participants, and transition logic for this scenario.",
    years: [makeBlankYear("2030")],
  };
}

function buildDraftResult(year) {
  const priceFloor = Number(year?.price_lower_bound ?? 0);
  const priceCeiling = Math.max(priceFloor + 1, Number(year?.price_upper_bound ?? 100));
  const participants = year?.participants || [];
  const q = year?.auction_mode === "explicit"
    ? Number(year?.auction_offered ?? year?.auctioned_allowances ?? 0)
    : Math.max(
        0,
        Number(year?.total_cap ?? 0) - participants.reduce(
          (sum, participant) =>
            sum + Number(participant.initial_emissions || 0) * Number(participant.free_allocation_ratio || 0),
          0
        ) - Number(year?.reserved_allowances ?? 0) - Number(year?.cancelled_allowances ?? 0)
      );
  const perParticipant = participants.map((participant) => {
    const initial = Number(participant.initial_emissions || 0);
    const free = initial * Number(participant.free_allocation_ratio || 0);
    const net = Math.max(0, initial - free);
    return {
      name: participant.name,
      initial,
      free,
      abatement: 0,
      residual: initial,
      net_trade: net,
      ratio: participant.free_allocation_ratio || 0,
      allowance_buys: net,
      allowance_sells: Math.max(0, free - initial),
      penalty_emissions: 0,
      abatement_cost: 0,
      allowance_cost: 0,
      penalty_cost: 0,
      sales_revenue: 0,
      total_compliance_cost: 0,
      sector: participant.sector || "Other",
    };
  });
  const baselineTotal = perParticipant.reduce((sum, participant) => sum + participant.net_trade, 0);
  return {
    price: null,
    Q: q,
    totalAbate: 0,
    totalTraded: baselineTotal,
    revenue: 0,
    perParticipant,
    demandCurve: [
      { p: priceFloor, total: baselineTotal, perPart: perParticipant.map((participant) => participant.net_trade) },
      { p: priceCeiling, total: baselineTotal, perPart: perParticipant.map((participant) => participant.net_trade) },
    ],
  };
}

function configsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildTechnologyPathway(scenario, results) {
  const years = (scenario?.years || []).map((year) => String(year.year));
  const rows = (scenario?.years?.[0]?.participants || []).map((participant) => {
    const pathway = years.map((year) => {
      const yearResult = results?.[scenario.name]?.[year];
      const match = yearResult?.perParticipant?.find((item) => item.name === participant.name);
      return match?.technology || "Base Technology";
    });
    return { participant: participant.name, pathway };
  });
  return { years, rows };
}

function describeUnsoldTreatment(value) {
  if (value === "carry_forward") return "Carry forward to next year";
  if (value === "cancel") return "Cancel unsold volume";
  return "Move unsold volume to reserve";
}

function buildAuctionPathway(scenario, results) {
  const years = (scenario?.years || []).map((year) => String(year.year));
  const rows = years.map((year) => {
    const run = results?.[scenario.name]?.[year] || null;
    const yearConfig = (scenario?.years || []).find((item) => String(item.year) === year) || {};
    return {
      year,
      offered: Number(run?.auctionOffered ?? yearConfig.auction_offered ?? 0),
      sold: Number(run?.auctionSold ?? 0),
      unsold: Number(run?.unsoldAllowances ?? 0),
      coverageRatio: Number(run?.auctionCoverageRatio ?? 1),
      reservePrice: Number(yearConfig.auction_reserve_price ?? 0),
      minimumBidCoverage: Number(yearConfig.minimum_bid_coverage ?? 0),
      unsoldTreatment: String(yearConfig.unsold_treatment ?? "reserve"),
      reserved: Number(yearConfig.reserved_allowances ?? 0),
      cancelled: Number(yearConfig.cancelled_allowances ?? 0),
    };
  });
  return { years, rows };
}

function makeIssue(level, scope, message) {
  return { level, scope, message };
}

function validateMacBlocks(blocks, label) {
  const issues = [];
  if (!Array.isArray(blocks)) {
    issues.push(makeIssue("error", label, "MAC blocks must be provided as a list."));
    return issues;
  }
  let previousCost = -Infinity;
  blocks.forEach((block, index) => {
    const amount = Number(block?.amount ?? 0);
    const cost = Number(block?.marginal_cost ?? 0);
    if (!Number.isFinite(amount) || !Number.isFinite(cost)) {
      issues.push(makeIssue("error", label, `MAC block ${index + 1} must contain numeric amount and marginal cost.`));
      return;
    }
    if (amount < 0 || cost < 0) {
      issues.push(makeIssue("error", label, `MAC block ${index + 1} must be non-negative.`));
    }
    if (cost < previousCost) {
      issues.push(makeIssue("error", label, "MAC blocks must be ordered by non-decreasing marginal cost."));
    }
    previousCost = cost;
  });
  return issues;
}

function validateTechnology(option, scope) {
  const issues = [];
  if (!option?.name) issues.push(makeIssue("error", scope, "Technology option must have a name."));
  if (Number(option?.initial_emissions ?? 0) < 0) issues.push(makeIssue("error", scope, "Technology emissions must be non-negative."));
  if (Number(option?.free_allocation_ratio ?? 0) < 0 || Number(option?.free_allocation_ratio ?? 0) > 1) {
    issues.push(makeIssue("error", scope, "Technology free allocation ratio must be between 0 and 1."));
  }
  if (Number(option?.penalty_price ?? 0) <= 0) issues.push(makeIssue("error", scope, "Technology penalty price must be positive."));
  if (Number(option?.fixed_cost ?? 0) < 0) issues.push(makeIssue("error", scope, "Technology fixed cost must be non-negative."));
  if (option?.abatement_type === "piecewise" && !(option?.mac_blocks || []).length) {
    issues.push(makeIssue("error", scope, "Piecewise technology option requires MAC blocks."));
  }
  issues.push(...validateMacBlocks(option?.mac_blocks || [], scope));
  return issues;
}

function validateParticipant(participant, yearLabel) {
  const scope = `${yearLabel} · ${participant?.name || "Unnamed participant"}`;
  const issues = [];
  if (!participant?.name) issues.push(makeIssue("error", scope, "Participant must have a name."));
  const emissions = Number(participant?.initial_emissions ?? 0);
  const freeRatio = Number(participant?.free_allocation_ratio ?? 0);
  const penalty = Number(participant?.penalty_price ?? 0);
  if (emissions < 0) issues.push(makeIssue("error", scope, "Initial emissions must be non-negative."));
  if (freeRatio < 0 || freeRatio > 1) issues.push(makeIssue("error", scope, "Free allocation ratio must be between 0 and 1."));
  if (penalty <= 0) issues.push(makeIssue("error", scope, "Penalty price must be positive."));
  if (participant?.abatement_type === "piecewise" && !(participant?.mac_blocks || []).length) {
    issues.push(makeIssue("error", scope, "Piecewise abatement requires MAC blocks."));
  }
  if ((participant?.technology_options || []).length > 0) {
    const techNames = new Set();
    participant.technology_options.forEach((option) => {
      if (techNames.has(option.name)) {
        issues.push(makeIssue("warning", scope, `Duplicate technology option name '${option.name}'.`));
      }
      techNames.add(option.name);
      issues.push(...validateTechnology(option, `${scope} · ${option.name || "Unnamed technology"}`));
    });
  }
  issues.push(...validateMacBlocks(participant?.mac_blocks || [], scope));
  return issues;
}

function validateScenario(scenario) {
  const issues = [];
  if (!scenario) return issues;
  if (!scenario.name) issues.push(makeIssue("error", "Scenario", "Scenario must have a name."));
  if (!(scenario.years || []).length) issues.push(makeIssue("error", "Scenario", "Scenario must contain at least one year."));
  const seenYears = new Set();
  (scenario.years || []).forEach((year) => {
    const yearLabel = String(year?.year || "Unnamed year");
    if (seenYears.has(yearLabel)) issues.push(makeIssue("error", `Year ${yearLabel}`, "Duplicate year label."));
    seenYears.add(yearLabel);
    const participants = year?.participants || [];
    if (!participants.length) issues.push(makeIssue("warning", `Year ${yearLabel}`, "This year has no participants."));
    const lower = Number(year?.price_lower_bound ?? 0);
    const upper = Number(year?.price_upper_bound ?? 0);
    if (upper <= lower) issues.push(makeIssue("error", `Year ${yearLabel}`, "Price ceiling must be greater than price floor."));
    if (year?.borrowing_allowed && Number(year?.borrowing_limit ?? 0) <= 0) {
      issues.push(makeIssue("warning", `Year ${yearLabel}`, "Borrowing is enabled but borrowing limit is zero."));
    }
    if (Number(year?.auction_reserve_price ?? 0) < 0) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Auction reserve price must be non-negative."));
    }
    if (Number(year?.minimum_bid_coverage ?? 0) < 0 || Number(year?.minimum_bid_coverage ?? 0) > 1) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Minimum bid coverage must be between 0 and 1."));
    }
    if (!["reserve", "cancel", "carry_forward"].includes(String(year?.unsold_treatment ?? "reserve"))) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Unsold treatment must be reserve, cancel, or carry_forward."));
    }
    const freeAllocation = participants.reduce(
      (sum, participant) => sum + Number(participant?.initial_emissions ?? 0) * Number(participant?.free_allocation_ratio ?? 0),
      0
    );
    const auctioned = Number(year?.auction_offered ?? year?.auctioned_allowances ?? 0);
    const reserved = Number(year?.reserved_allowances ?? 0);
    const cancelled = Number(year?.cancelled_allowances ?? 0);
    const totalCap = Number(year?.total_cap ?? 0);
    if (year?.auction_mode === "explicit") {
      const allowanceSupply = freeAllocation + auctioned + reserved + cancelled;
      if (allowanceSupply - totalCap > 1e-6) {
        issues.push(makeIssue("error", `Year ${yearLabel}`, `Free allocation + auction offered + reserved + cancelled allowances (${allowanceSupply.toFixed(2)}) exceeds total cap (${totalCap.toFixed(2)}).`));
      } else if (totalCap - allowanceSupply > 1e-6) {
        issues.push(makeIssue("warning", `Year ${yearLabel}`, `Configured supply buckets leave ${(totalCap - allowanceSupply).toFixed(2)} allowances unallocated within the cap.`));
      }
    }
    if (reserved > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Reserved allowances remove ${reserved.toFixed(2)} allowances from current-year circulation.`));
    if (cancelled > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Cancelled allowances permanently retire ${cancelled.toFixed(2)} allowances from the cap.`));
    if ((year?.auction_reserve_price ?? 0) > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Auction reserve price is set at ${Number(year.auction_reserve_price).toFixed(2)}.`));
    if ((year?.minimum_bid_coverage ?? 0) > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Minimum bid coverage is set at ${(Number(year.minimum_bid_coverage) * 100).toFixed(0)}% of auction volume.`));
    const names = new Set();
    participants.forEach((participant) => {
      if (names.has(participant.name)) {
        issues.push(makeIssue("error", `Year ${yearLabel}`, `Duplicate participant name '${participant.name}'.`));
      }
      names.add(participant.name);
      issues.push(...validateParticipant(participant, `Year ${yearLabel}`));
    });
  });
  if (!issues.length) issues.push(makeIssue("note", "Scenario", "No validation issues detected for the active scenario."));
  return issues;
}

function KPI({ label, value, sub, tone }) {
  return (
    <div className={"kpi" + (tone ? " tone-" + tone : "")}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function ValidationPanel({ issues, title = "Validation" }) {
  const counts = {
    error: issues.filter((issue) => issue.level === "error").length,
    warning: issues.filter((issue) => issue.level === "warning").length,
    note: issues.filter((issue) => issue.level === "note").length,
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Validation</div>
          <h2>{title}</h2>
          <p className="muted">Pre-run checks on the active scenario configuration.</p>
        </div>
        <div className="validation-summary">
          <span className="validation-pill error">{counts.error} errors</span>
          <span className="validation-pill warning">{counts.warning} warnings</span>
          <span className="validation-pill note">{counts.note} notes</span>
        </div>
      </div>
      <div className="validation-list">
        {issues.map((issue, index) => (
          <div key={`${issue.scope}-${issue.message}-${index}`} className={`validation-item ${issue.level}`}>
            <div className="validation-item-head">
              <span className={`validation-dot ${issue.level}`}></span>
              <strong>{issue.scope}</strong>
            </div>
            <div className="validation-message">{issue.message}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuctionDiagnosticsPanel({ yearObj, result }) {
  const offered = Number(result?.auctionOffered ?? yearObj?.auction_offered ?? 0);
  const sold = Number(result?.auctionSold ?? 0);
  const unsold = Number(result?.unsoldAllowances ?? 0);
  const coverage = Number(result?.auctionCoverageRatio ?? 1);
  const reservePrice = Number(yearObj?.auction_reserve_price ?? 0);
  const minCoverage = Number(yearObj?.minimum_bid_coverage ?? 0);
  const treatment = String(yearObj?.unsold_treatment ?? "reserve");
  const bindingRule =
    unsold > 0 && reservePrice > 0
      ? "Reserve price constrained auction sales in this year."
      : unsold > 0 && minCoverage > 0
        ? "Minimum bid coverage constrained auction sales in this year."
        : unsold > 0
          ? "Auction supply was not fully absorbed in this year."
          : "Auction volume was fully sold in this year.";
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Auction</div>
          <h2>Current-year auction outcome</h2>
          <p className="muted">How offered allowances translated into sold volume, unsold volume, and policy treatment in {yearObj?.year}.</p>
        </div>
      </div>
      <div className="review-grid auction-review-grid">
        <div className="review-item"><span className="review-label">Auction offered</span><strong>{fmt.num(offered, 0)}</strong></div>
        <div className="review-item"><span className="review-label">Auction sold</span><strong>{fmt.num(sold, 0)}</strong></div>
        <div className="review-item"><span className="review-label">Unsold allowances</span><strong>{fmt.num(unsold, 0)}</strong></div>
        <div className="review-item"><span className="review-label">Coverage ratio</span><strong>{fmt.num(coverage * 100, 0)}%</strong></div>
        <div className="review-item"><span className="review-label">Reserve price</span><strong>{fmt.price(reservePrice)}</strong></div>
        <div className="review-item"><span className="review-label">Minimum bid coverage</span><strong>{fmt.num(minCoverage * 100, 0)}%</strong></div>
        <div className="review-item review-item-wide"><span className="review-label">Unsold treatment</span><strong>{describeUnsoldTreatment(treatment)}</strong></div>
        <div className="review-item review-item-wide"><span className="review-label">Interpretation</span><strong>{bindingRule}</strong></div>
      </div>
    </div>
  );
}

function AuctionPathwayPanel({ scenario, results }) {
  const auctionPathway = buildAuctionPathway(scenario, results);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Auction pathway</div>
          <h2>Offered, sold, and unsold allowances across years</h2>
          <p className="muted">Tracks the auction flow and the rule set that governs unsold volumes in each year of this scenario.</p>
        </div>
      </div>
      <div className="pathway-table-wrap">
        <table className="pathway-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Offered</th>
              <th>Sold</th>
              <th>Unsold</th>
              <th>Coverage</th>
              <th>Reserve price</th>
              <th>Min coverage</th>
              <th>Unsold treatment</th>
            </tr>
          </thead>
          <tbody>
            {auctionPathway.rows.map((row) => (
              <tr key={row.year}>
                <td>{row.year}</td>
                <td>{fmt.num(row.offered, 0)}</td>
                <td>{fmt.num(row.sold, 0)}</td>
                <td>{fmt.num(row.unsold, 0)}</td>
                <td>{fmt.num(row.coverageRatio * 100, 0)}%</td>
                <td>{fmt.price(row.reservePrice)}</td>
                <td>{fmt.num(row.minimumBidCoverage * 100, 0)}%</td>
                <td>{describeUnsoldTreatment(row.unsoldTreatment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Header({
  scenarios,
  templates,
  activeId,
  onSelectScenario,
  activeSection,
  onSelectSection,
  onLoadTemplate,
  onAddScenario,
  onDuplicateScenario,
  onRemoveScenario,
  status,
}) {
  const [selectedTemplate, setSelectedTemplate] = useS(templates?.[0]?.id || "blank");
  const sections = [
    { id: "build", label: "Build" },
    { id: "model", label: "Model" },
    { id: "analysis", label: "Analysis" },
    { id: "scenario", label: "Scenario" },
  ];
  useE(() => {
    if (templates.length && !templates.some((item) => item.id === selectedTemplate)) {
      setSelectedTemplate(templates[0].id);
    }
  }, [templates]);

  return (
    <header className="hdr">
      <div className="hdr-top">
        <div className="hdr-brand">
          <div className="mark">
            <svg viewBox="0 0 40 40" width="28" height="28">
              <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M4 26 Q14 22 20 20 T36 14" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="4" x2="36" y1="20" y2="20" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"/>
              <circle cx="20" cy="20" r="3" fill="currentColor"/>
            </svg>
          </div>
          <div>
            <div className="brand-title">Clearing</div>
            <div className="brand-sub">{status}</div>
          </div>
        </div>
        <div className="hdr-actions">
          <nav className="hdr-sections">
            {sections.map((section) => (
              <button
                key={section.id}
                className={"section-tab " + (activeSection === section.id ? "on" : "")}
                onClick={() => onSelectSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      {activeSection === "build" && (
        <div className="hdr-tools">
          <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <button className="ghost-btn" onClick={() => onLoadTemplate(selectedTemplate)}>Load template</button>
          <button className="ghost-btn" onClick={onAddScenario}>Add scenario</button>
          <button className="ghost-btn" onClick={onDuplicateScenario}>Duplicate scenario</button>
          <button className="ghost-btn danger-btn" onClick={onRemoveScenario} disabled={scenarios.length <= 1}>Remove scenario</button>
        </div>
      )}
      <nav className="hdr-scenarios">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            className={"pill-btn " + (activeId === scenario.id ? "on" : "")}
            onClick={() => onSelectScenario(scenario.id)}
            style={{ "--c": scenario.color }}
          >
            <i className="sw" style={{ background: scenario.color }}></i>{scenario.name}
          </button>
        ))}
      </nav>
    </header>
  );
}

function ScenarioHero({ scenario, activeYear, onYearChange, results, primaryMetric = null, secondaryMetric = null }) {
  const resByYear = results?.[scenario.name] || {};
  return (
    <section className="wb-hero">
      <div className="scenario-meta">
        <div className="eyebrow">Scenario</div>
        <h1 style={{ color: scenario.color }}>{scenario.name}</h1>
        <p className="lede">{scenario.description}</p>
        <div className="year-strip">
          {scenario.years.map((year) => (
            <button
              key={year.year}
              className={"ystep " + (String(year.year) === String(activeYear) ? "on" : "")}
              onClick={() => onYearChange(String(year.year))}
            >
              <div className="yv">{year.year}</div>
              <div className="yp">{fmt.price(resByYear[String(year.year)]?.price)}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="hero-side">
        {primaryMetric}
        {secondaryMetric}
      </div>
    </section>
  );
}

function YearSeriesModal({ title, field, years, onClose, onSave }) {
  const [draft, setDraft] = useS(() =>
    Object.fromEntries((years || []).map((year) => [String(year.year), year[field] ?? 0]))
  );
  useE(() => {
    setDraft(Object.fromEntries((years || []).map((year) => [String(year.year), year[field] ?? 0])));
  }, [field, years]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Year series editor</div>
            <h2>{title}</h2>
            <p className="muted">Set the value for each year in the selected scenario, then save the full series.</p>
          </div>
          <button className="ghost-btn" onClick={onClose}>Close</button>
        </div>
        <div className="pathway-table-wrap">
          <table className="pathway-table">
            <thead>
              <tr><th>Year</th><th>Value</th></tr>
            </thead>
            <tbody>
              {(years || []).map((year) => (
                <tr key={year.year}>
                  <td>{year.year}</td>
                  <td>
                    <input
                      className="text"
                      type="number"
                      value={draft[String(year.year)]}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        [String(year.year)]: Number(event.target.value),
                      }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hero-actions">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="ghost-btn on" onClick={() => { onSave(field, draft); onClose(); }}>Save series</button>
        </div>
      </div>
    </div>
  );
}

function MiniMarket({ year, result }) {
  const W = 280, H = 120;
  const PAD = { t: 10, r: 10, b: 22, l: 30 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const curve = result.demandCurve || [];
  const xMin = year.price_lower_bound ?? 0;
  const xMax = year.price_upper_bound ?? 250;
  const yMax = Math.max(result.Q * 1.4, ...curve.map((point) => point.total), 10);
  const yMin = Math.min(0, ...curve.map((point) => point.total));
  const xs = (p) => PAD.l + ((p - xMin) / (xMax - xMin)) * iw;
  const ys = (a) => PAD.t + ih - ((a - yMin) / (yMax - yMin)) * ih;
  const d = curve.map((point, index) => `${index === 0 ? "M" : "L"}${xs(point.p)},${ys(point.total)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mini-chart">
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis"/>
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="axis"/>
      <line x1={PAD.l} x2={W - PAD.r} y1={ys(result.Q)} y2={ys(result.Q)} className="supply-line"/>
      <path d={d} className="demand-line"/>
      {isFinite(result.price) && (
        <>
          <line x1={xs(result.price)} x2={xs(result.price)} y1={ys(result.Q)} y2={H - PAD.b} className="eq-guide" strokeDasharray="2 2"/>
          <circle cx={xs(result.price)} cy={ys(result.Q)} r="4" className="eq-dot"/>
        </>
      )}
    </svg>
  );
}

function Tweaks({ open, state, setState }) {
  if (!open) return null;
  const set = (patch) => {
    const next = { ...state, ...patch };
    setState(next);
    window.parent?.postMessage({ type: "__edit_mode_set_keys", edits: patch }, "*");
  };
  return (
    <div className="tweaks">
      <div className="tweaks-head">Tweaks</div>
      <label><span>Theme</span>
        <div className="seg">
          <button className={state.dark ? "" : "on"} onClick={() => set({ dark: false })}>Light</button>
          <button className={state.dark ? "on" : ""} onClick={() => set({ dark: true })}>Dark</button>
        </div>
      </label>
      <label><span>Chart style</span>
        <div className="seg">
          {["institutional", "editorial", "terminal"].map((key) => (
            <button key={key} className={state.chartStyle === key ? "on" : ""} onClick={() => set({ chartStyle: key })}>{key}</button>
          ))}
        </div>
      </label>
      <label><span>Density</span>
        <div className="seg">
          {["comfortable", "compact"].map((key) => (
            <button key={key} className={state.density === key ? "on" : ""} onClick={() => set({ density: key })}>{key}</button>
          ))}
        </div>
      </label>
    </div>
  );
}

function slugify(value) {
  return String(value).toLowerCase().replaceAll(" ", "_");
}

Object.assign(window, {
  makeBlankParticipant,
  makeBlankYear,
  makeBlankScenario,
  buildDraftResult,
  configsEqual,
  buildTechnologyPathway,
  describeUnsoldTreatment,
  buildAuctionPathway,
  makeIssue,
  validateMacBlocks,
  validateTechnology,
  validateParticipant,
  validateScenario,
  KPI,
  ValidationPanel,
  AuctionDiagnosticsPanel,
  AuctionPathwayPanel,
  Header,
  ScenarioHero,
  YearSeriesModal,
  MiniMarket,
  Tweaks,
  slugify,
});
