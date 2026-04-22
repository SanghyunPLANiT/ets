function buildMacSeries(participant) {
  if (!participant) return { type: "none", points: [], maxAbatement: 0, maxCost: 0 };

  if (participant.abatement_type === "piecewise") {
    const blocks = participant.mac_blocks || [];
    let cumulative = 0;
    const points = [{ x: 0, y: 0 }];
    for (const block of blocks) {
      const amount = Number(block.amount || 0);
      const marginalCost = Number(block.marginal_cost || 0);
      points.push({ x: cumulative, y: marginalCost });
      cumulative += amount;
      points.push({ x: cumulative, y: marginalCost });
    }
    return {
      type: "piecewise",
      points,
      maxAbatement: cumulative,
      maxCost: Math.max(0, ...blocks.map((block) => Number(block.marginal_cost || 0))),
    };
  }

  if (participant.abatement_type === "threshold") {
    const maxAbatement = Number(participant.max_abatement || 0);
    const threshold = Number(participant.threshold_cost || 0);
    return {
      type: "threshold",
      points: [
        { x: 0, y: threshold },
        { x: maxAbatement, y: threshold },
      ],
      maxAbatement,
      maxCost: threshold,
    };
  }

  const maxAbatement = Number(participant.max_abatement || 0);
  const slope = Number(participant.cost_slope || 0);
  return {
    type: "linear",
    points: [
      { x: 0, y: 0 },
      { x: maxAbatement, y: maxAbatement * slope },
    ],
    maxAbatement,
    maxCost: maxAbatement * slope,
  };
}

function ParticipantMacChart({ participant, outcome, carbonPrice }) {
  if (!participant || !outcome) {
    return (
      <div className="mac-empty">
        Select a participant to inspect its marginal abatement cost schedule.
      </div>
    );
  }

  const W = 560, H = 280;
  const PAD = { t: 18, r: 22, b: 42, l: 52 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const mac = buildMacSeries(participant);
  const achievedAbatement = Number(outcome.abatement || 0);
  const xMax = Math.max(1, mac.maxAbatement, achievedAbatement);
  const yMax = Math.max(
    10,
    mac.maxCost,
    Number(carbonPrice || 0),
    ...(mac.points || []).map((point) => point.y)
  );
  const xs = (value) => PAD.l + (value / xMax) * iw;
  const ys = (value) => PAD.t + ih - (value / yMax) * ih;

  let path = "";
  if (mac.type === "piecewise") {
    path = mac.points.map((point, index) => `${index === 0 ? "M" : "L"}${xs(point.x)},${ys(point.y)}`).join(" ");
  } else {
    path = mac.points.map((point, index) => `${index === 0 ? "M" : "L"}${xs(point.x)},${ys(point.y)}`).join(" ");
  }

  const xTickVals = Array.from({ length: 5 }, (_, index) => (xMax * index) / 4);
  const yTickVals = Array.from({ length: 5 }, (_, index) => (yMax * index) / 4);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        {yTickVals.map((value, index) => (
          <g key={`mac-y-${index}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={ys(value)} y2={ys(value)} className="gridline" />
            <text x={PAD.l - 10} y={ys(value)} className="axis-label" textAnchor="end" dy="0.32em">
              {fmt.num(value, 0)}
            </text>
          </g>
        ))}
        {xTickVals.map((value, index) => (
          <g key={`mac-x-${index}`}>
            <line x1={xs(value)} x2={xs(value)} y1={PAD.t} y2={H - PAD.b} className="gridline subtle" />
            <text x={xs(value)} y={H - PAD.b + 18} className="axis-label" textAnchor="middle">
              {fmt.num(value, 0)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="axis" />
        <text x={W / 2} y={H - 8} className="axis-title" textAnchor="middle">Abatement (Mt CO₂)</text>
        <text transform={`translate(16, ${PAD.t + ih / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">
          Marginal cost ($/tCO₂)
        </text>

        {carbonPrice != null && isFinite(carbonPrice) && (
          <line x1={PAD.l} x2={W - PAD.r} y1={ys(carbonPrice)} y2={ys(carbonPrice)} className="mac-price-line" />
        )}
        <path d={path} className="mac-line" fill="none" />
        <circle cx={xs(achievedAbatement)} cy={ys(Number(carbonPrice || 0))} r="5" className="eq-dot" />
      </svg>
      <div className="chart-legend">
        <span><i className="sw mac"></i>Participant MAC</span>
        <span><i className="sw supply"></i>Carbon price</span>
        <span><i className="sw demand"></i>Chosen abatement</span>
      </div>
      <div className="mac-meta">
        <div><span className="label">Type</span><span className="val">{participant.abatement_type}</span></div>
        <div><span className="label">Chosen abatement</span><span className="val">{fmt.num(achievedAbatement, 2)}</span></div>
        <div><span className="label">Carbon price</span><span className="val">{fmt.price(carbonPrice)}</span></div>
      </div>
      <p className="muted mac-note">
        Sample MAC values in the example files are illustrative, not calibrated to empirical plant-level data.
      </p>
    </div>
  );
}

window.ParticipantMacChart = ParticipantMacChart;
