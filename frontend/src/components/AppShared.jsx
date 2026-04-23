import { useState as useS, useEffect as useE, useMemo as useM, useRef as useR } from "react";
import { fmt } from "./MarketChart.jsx";

const SERIES_FIELD_META = {
  total_cap: { label: "Total cap", step: 1, min: 0, format: (value) => fmt.num(value, 0) },
  auction_offered: { label: "Auction offered", step: 1, min: 0, format: (value) => fmt.num(value, 0) },
  reserved_allowances: { label: "Reserved allowances", step: 1, min: 0, format: (value) => fmt.num(value, 0) },
  cancelled_allowances: { label: "Cancelled allowances", step: 1, min: 0, format: (value) => fmt.num(value, 0) },
  auction_reserve_price: { label: "Auction reserve price", step: 1, min: 0, format: (value) => fmt.price(value) },
  minimum_bid_coverage: { label: "Minimum bid coverage", step: 0.05, min: 0, max: 2, format: (value) => fmt.num(value, 2) },
  price_lower_bound: { label: "Price floor", step: 1, min: 0, format: (value) => fmt.price(value) },
  price_upper_bound: { label: "Price ceiling", step: 1, min: 0, format: (value) => fmt.price(value) },
  borrowing_limit: { label: "Borrowing limit", step: 1, min: 0, format: (value) => fmt.num(value, 0) },
  manual_expected_price: { label: "Manual expected price", step: 1, min: 0, format: (value) => fmt.price(value) },
  initial_emissions: { label: "Initial emissions", step: 1, min: 0, format: (value) => fmt.num(value, 1) },
  free_allocation_ratio: { label: "Free allocation ratio", step: 0.05, min: 0, max: 1, format: (value) => fmt.num(value, 2) },
  penalty_price: { label: "Penalty price", step: 1, min: 0, format: (value) => fmt.price(value) },
  fixed_cost: { label: "Fixed cost", step: 1, min: 0, format: (value) => fmt.num(value, 0) },
  max_activity_share: { label: "Adoption share cap", step: 0.05, min: 0, max: 1, format: (value) => fmt.num(value, 2) },
};

function getSeriesFieldMeta(field) {
  return SERIES_FIELD_META[field] || {
    label: field.replaceAll("_", " "),
    step: 1,
    min: 0,
    format: (value) => fmt.num(value, 2),
  };
}

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
    expectation_rule: "next_year_baseline",
    manual_expected_price: 0,
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
      technology_mix: "",
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

function makeIssue(level, scope, message, target = null) {
  return { level, scope, message, target };
}

function validateMacBlocks(blocks, label, target = null) {
  const issues = [];
  if (!Array.isArray(blocks)) {
    issues.push(makeIssue("error", label, "MAC blocks must be provided as a list.", target));
    return issues;
  }
  let previousCost = -Infinity;
  blocks.forEach((block, index) => {
    const amount = Number(block?.amount ?? 0);
    const cost = Number(block?.marginal_cost ?? 0);
    if (!Number.isFinite(amount) || !Number.isFinite(cost)) {
      issues.push(makeIssue("error", label, `MAC block ${index + 1} must contain numeric amount and marginal cost.`, target));
      return;
    }
    if (amount < 0 || cost < 0) {
      issues.push(makeIssue("error", label, `MAC block ${index + 1} must be non-negative.`, target));
    }
    if (cost < previousCost) {
      issues.push(makeIssue("error", label, "MAC blocks must be ordered by non-decreasing marginal cost.", target));
    }
    previousCost = cost;
  });
  return issues;
}

function validateTechnology(option, scope, target = null) {
  const issues = [];
  if (!option?.name) issues.push(makeIssue("error", scope, "Technology option must have a name.", target));
  if (Number(option?.initial_emissions ?? 0) < 0) issues.push(makeIssue("error", scope, "Technology emissions must be non-negative.", target));
  if (Number(option?.free_allocation_ratio ?? 0) < 0 || Number(option?.free_allocation_ratio ?? 0) > 1) {
    issues.push(makeIssue("error", scope, "Technology free allocation ratio must be between 0 and 1.", target));
  }
  if (Number(option?.penalty_price ?? 0) <= 0) issues.push(makeIssue("error", scope, "Technology penalty price must be positive.", target));
  if (Number(option?.fixed_cost ?? 0) < 0) issues.push(makeIssue("error", scope, "Technology fixed cost must be non-negative.", target));
  if (Number(option?.max_activity_share ?? 1) < 0 || Number(option?.max_activity_share ?? 1) > 1) {
    issues.push(makeIssue("error", scope, "Technology adoption share cap must be between 0 and 1.", target));
  }
  if (option?.abatement_type === "piecewise" && !(option?.mac_blocks || []).length) {
    issues.push(makeIssue("error", scope, "Piecewise technology option requires MAC blocks.", target));
  }
  issues.push(...validateMacBlocks(option?.mac_blocks || [], scope, target));
  return issues;
}

function validateParticipant(participant, yearLabel, yearValue) {
  const scope = `${yearLabel} · ${participant?.name || "Unnamed participant"}`;
  const participantTarget = {
    section: "build",
    step: "participants",
    year: String(yearValue),
    participantName: participant?.name || null,
  };
  const issues = [];
  if (!participant?.name) issues.push(makeIssue("error", scope, "Participant must have a name.", participantTarget));
  const emissions = Number(participant?.initial_emissions ?? 0);
  const freeRatio = Number(participant?.free_allocation_ratio ?? 0);
  const penalty = Number(participant?.penalty_price ?? 0);
  if (emissions < 0) issues.push(makeIssue("error", scope, "Initial emissions must be non-negative.", participantTarget));
  if (freeRatio < 0 || freeRatio > 1) issues.push(makeIssue("error", scope, "Free allocation ratio must be between 0 and 1.", participantTarget));
  if (penalty <= 0) issues.push(makeIssue("error", scope, "Penalty price must be positive.", participantTarget));
  if (participant?.abatement_type === "piecewise" && !(participant?.mac_blocks || []).length) {
    issues.push(makeIssue("error", scope, "Piecewise abatement requires MAC blocks.", participantTarget));
  }
  if ((participant?.technology_options || []).length > 0) {
    const techNames = new Set();
    participant.technology_options.forEach((option) => {
      const technologyTarget = {
        ...participantTarget,
        technologyName: option?.name || null,
      };
      if (techNames.has(option.name)) {
        issues.push(makeIssue("warning", scope, `Duplicate technology option name '${option.name}'.`, technologyTarget));
      }
      techNames.add(option.name);
      issues.push(...validateTechnology(option, `${scope} · ${option.name || "Unnamed technology"}`, technologyTarget));
    });
  }
  issues.push(...validateMacBlocks(participant?.mac_blocks || [], scope, participantTarget));
  return issues;
}

function validateScenario(scenario) {
  const issues = [];
  if (!scenario) return issues;
  if (!scenario.name) issues.push(makeIssue("error", "Scenario", "Scenario must have a name.", { section: "build", step: "scenario" }));
  if (!(scenario.years || []).length) issues.push(makeIssue("error", "Scenario", "Scenario must contain at least one year.", { section: "build", step: "scenario" }));
  const seenYears = new Set();
  (scenario.years || []).forEach((year) => {
    const yearLabel = String(year?.year || "Unnamed year");
    const yearTarget = { section: "build", step: "market", year: yearLabel };
    if (seenYears.has(yearLabel)) issues.push(makeIssue("error", `Year ${yearLabel}`, "Duplicate year label.", yearTarget));
    seenYears.add(yearLabel);
    const participants = year?.participants || [];
    if (!participants.length) issues.push(makeIssue("warning", `Year ${yearLabel}`, "This year has no participants.", yearTarget));
    const lower = Number(year?.price_lower_bound ?? 0);
    const upper = Number(year?.price_upper_bound ?? 0);
    if (upper <= lower) issues.push(makeIssue("error", `Year ${yearLabel}`, "Price ceiling must be greater than price floor.", yearTarget));
    if (year?.borrowing_allowed && Number(year?.borrowing_limit ?? 0) <= 0) {
      issues.push(makeIssue("warning", `Year ${yearLabel}`, "Borrowing is enabled but borrowing limit is zero.", yearTarget));
    }
    const expectationRule = String(year?.expectation_rule ?? "next_year_baseline");
    if (!["myopic", "next_year_baseline", "perfect_foresight", "manual"].includes(expectationRule)) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Expectation rule must be myopic, next_year_baseline, perfect_foresight, or manual.", yearTarget));
    }
    if (Number(year?.manual_expected_price ?? 0) < 0) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Manual expected price must be non-negative.", yearTarget));
    }
    if (expectationRule === "manual" && Number(year?.manual_expected_price ?? 0) <= 0) {
      issues.push(makeIssue("warning", `Year ${yearLabel}`, "Manual expectation is selected but manual expected price is zero.", yearTarget));
    }
    if (Number(year?.auction_reserve_price ?? 0) < 0) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Auction reserve price must be non-negative.", yearTarget));
    }
    if (Number(year?.minimum_bid_coverage ?? 0) < 0 || Number(year?.minimum_bid_coverage ?? 0) > 1) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Minimum bid coverage must be between 0 and 1.", yearTarget));
    }
    if (!["reserve", "cancel", "carry_forward"].includes(String(year?.unsold_treatment ?? "reserve"))) {
      issues.push(makeIssue("error", `Year ${yearLabel}`, "Unsold treatment must be reserve, cancel, or carry_forward.", yearTarget));
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
        issues.push(makeIssue("error", `Year ${yearLabel}`, `Free allocation + auction offered + reserved + cancelled allowances (${allowanceSupply.toFixed(2)}) exceeds total cap (${totalCap.toFixed(2)}).`, yearTarget));
      } else if (totalCap - allowanceSupply > 1e-6) {
        issues.push(makeIssue("warning", `Year ${yearLabel}`, `Configured supply buckets leave ${(totalCap - allowanceSupply).toFixed(2)} allowances unallocated within the cap.`, yearTarget));
      }
    }
    if (reserved > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Reserved allowances remove ${reserved.toFixed(2)} allowances from current-year circulation.`, yearTarget));
    if (cancelled > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Cancelled allowances permanently retire ${cancelled.toFixed(2)} allowances from the cap.`, yearTarget));
    if ((year?.auction_reserve_price ?? 0) > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Auction reserve price is set at ${Number(year.auction_reserve_price).toFixed(2)}.`, yearTarget));
    if ((year?.minimum_bid_coverage ?? 0) > 0) issues.push(makeIssue("note", `Year ${yearLabel}`, `Minimum bid coverage is set at ${(Number(year.minimum_bid_coverage) * 100).toFixed(0)}% of auction volume.`, yearTarget));
    if (expectationRule === "manual") issues.push(makeIssue("note", `Year ${yearLabel}`, `Manual expected future price is set at ${Number(year.manual_expected_price ?? 0).toFixed(2)}.`, yearTarget));
    if (expectationRule === "perfect_foresight") issues.push(makeIssue("note", `Year ${yearLabel}`, "Perfect foresight expectations are active for this year.", yearTarget));
    const names = new Set();
    participants.forEach((participant) => {
      if (names.has(participant.name)) {
        issues.push(makeIssue("error", `Year ${yearLabel}`, `Duplicate participant name '${participant.name}'.`, {
          section: "build",
          step: "participants",
          year: yearLabel,
          participantName: participant?.name || null,
        }));
      }
      names.add(participant.name);
      issues.push(...validateParticipant(participant, `Year ${yearLabel}`, yearLabel));
    });
  });
  if (!issues.length) issues.push(makeIssue("note", "Scenario", "No validation issues detected for the active scenario.", { section: "validation" }));
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

function ValidationPanel({ issues, title = "Validation", onNavigateIssue = null }) {
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
          <button
            key={`${issue.scope}-${issue.message}-${index}`}
            className={`validation-item ${issue.level} ${issue.target ? "clickable" : ""}`}
            onClick={() => issue.target && onNavigateIssue?.(issue)}
            disabled={!issue.target}
            type="button"
          >
            <div className="validation-item-head">
              <span className={`validation-dot ${issue.level}`}></span>
              <strong>{issue.scope}</strong>
              {issue.target ? <span className="validation-jump">Open</span> : null}
            </div>
            <div className="validation-message">{issue.message}</div>
          </button>
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
    { id: "validation", label: "Validation" },
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

function SeriesTrajectoryEditor({ years, draft, setDraft, meta }) {
  const svgRef = useR(null);
  const [dragYear, setDragYear] = useS(null);
  const W = 820;
  const H = 280;
  const PAD = { t: 24, r: 24, b: 46, l: 64 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const orderedYears = useM(() => (years || []).map((year) => String(year.year)), [years]);
  const values = orderedYears.map((year) => Number(draft[year] ?? 0));
  const minValue = meta.min ?? Math.min(0, ...values);
  const rawMax = Math.max(...values, minValue + 1);
  const maxValue = Math.max(
    meta.max ?? 0,
    minValue + (meta.max != null ? 0 : rawMax * (rawMax <= 1 ? 1.1 : 1.15))
  );
  const domainMax = maxValue <= minValue ? minValue + 1 : maxValue;
  const xAt = (index) => PAD.l + (orderedYears.length <= 1 ? innerW / 2 : (index / (orderedYears.length - 1)) * innerW);
  const yAt = (value) => {
    const ratio = (Number(value ?? 0) - minValue) / (domainMax - minValue);
    return PAD.t + innerH - Math.max(0, Math.min(1, ratio)) * innerH;
  };
  const updateFromPointer = (event) => {
    if (!dragYear || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const ratio = 1 - (y - PAD.t) / innerH;
    const unclamped = minValue + Math.max(0, Math.min(1, ratio)) * (domainMax - minValue);
    const next = meta.step && meta.step < 1
      ? Math.round(unclamped / meta.step) * meta.step
      : Math.round(unclamped / (meta.step || 1)) * (meta.step || 1);
    const clamped = Math.max(meta.min ?? -Infinity, Math.min(meta.max ?? Infinity, Number(next.toFixed(4))));
    setDraft((current) => ({ ...current, [dragYear]: clamped }));
  };
  useE(() => {
    if (!dragYear) return undefined;
    const handleMove = (event) => updateFromPointer(event);
    const handleUp = () => setDragYear(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragYear, minValue, domainMax, meta.step, meta.min, meta.max]);
  const tickValues = Array.from({ length: 5 }, (_, index) => minValue + ((domainMax - minValue) * index) / 4);
  const path = orderedYears
    .map((year, index) => `${index === 0 ? "M" : "L"}${xAt(index)},${yAt(draft[year])}`)
    .join(" ");

  return (
    <div className="series-chart-panel">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="series-chart"
        onMouseMove={updateFromPointer}
      >
        {tickValues.map((tick, index) => (
          <g key={`tick-${index}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yAt(tick)} y2={yAt(tick)} className="gridline" />
            <text x={PAD.l - 10} y={yAt(tick)} className="axis-label" textAnchor="end" dy="0.32em">
              {meta.format(tick)}
            </text>
          </g>
        ))}
        {orderedYears.map((year, index) => (
          <g key={year}>
            <line x1={xAt(index)} x2={xAt(index)} y1={PAD.t} y2={H - PAD.b} className="gridline subtle" />
            <text x={xAt(index)} y={H - PAD.b + 18} className="axis-label" textAnchor="middle">
              {year}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="axis" />
        <path d={path} className="series-line" />
        {orderedYears.map((year, index) => (
          <g key={`point-${year}`}>
            <circle
              cx={xAt(index)}
              cy={yAt(draft[year])}
              r="6"
              className={"series-point " + (dragYear === year ? "dragging" : "")}
              onMouseDown={() => setDragYear(year)}
            />
            <text x={xAt(index)} y={yAt(draft[year]) - 12} className="point-label" textAnchor="middle">
              {meta.format(draft[year])}
            </text>
          </g>
        ))}
      </svg>
      <div className="series-chart-help">
        <span>Drag a point to edit the value for that year.</span>
        <span>The table view remains available for precise entry.</span>
      </div>
    </div>
  );
}

function YearSeriesModal({ title, field, years, onClose, onSave, values, description, step, min, max }) {
  const meta = {
    ...getSeriesFieldMeta(field),
    ...(step != null ? { step } : {}),
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
  };
  const [viewMode, setViewMode] = useS("chart");
  const [draft, setDraft] = useS(() =>
    Object.fromEntries((years || []).map((year) => [String(year.year), values?.[String(year.year)] ?? year[field] ?? 0]))
  );
  useE(() => {
    setDraft(Object.fromEntries((years || []).map((year) => [String(year.year), values?.[String(year.year)] ?? year[field] ?? 0])));
  }, [field, years, values]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card modal-card-wide" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">Year series editor</div>
            <h2>{title}</h2>
            <p className="muted">{description || "Edit this value across the full scenario period using either a chart or a table."}</p>
          </div>
          <button className="ghost-btn" onClick={onClose}>Close</button>
        </div>
        <div className="series-editor-head">
          <div className="seg">
            <button className={viewMode === "chart" ? "on" : ""} onClick={() => setViewMode("chart")}>Chart</button>
            <button className={viewMode === "table" ? "on" : ""} onClick={() => setViewMode("table")}>Table</button>
          </div>
          <div className="series-editor-meta">
            <span>Field: {meta.label}</span>
            <span>Step: {meta.step}</span>
          </div>
        </div>
        {viewMode === "chart" ? (
          <SeriesTrajectoryEditor years={years} draft={draft} setDraft={setDraft} meta={meta} />
        ) : (
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
                        step={meta.step}
                        min={meta.min}
                        max={meta.max}
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
        )}
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

export {
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
  getSeriesFieldMeta,
  };
