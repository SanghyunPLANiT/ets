// Components for the Clearing dashboard.
// IEA / Our World in Data institutional aesthetic — serif display, grotesk body, sparse grid, honest ticks.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---------- Utility ----------
const fmt = {
  price: (v) => (v == null || !isFinite(v) ? "—" : "$" + v.toFixed(2)),
  int: (v) => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString()),
  num: (v, d = 1) => (v == null || !isFinite(v) ? "—" : Number(v).toFixed(d)),
  money: (v) => (v == null || !isFinite(v) ? "—" : "$" + Math.round(v).toLocaleString()),
  signed: (v) => {
    if (v == null || !isFinite(v)) return "—";
    const s = Math.round(v).toLocaleString();
    return v > 0 ? "+" + s : s;
  },
};

const SECTOR_COLORS = {
  Industry: "#8a5a2c",
  Power: "#2f6f8f",
  Other: "#6a6458",
};

// ---------- Market-clearing chart ----------
// Supply/demand plot. Axes: X = carbon price, Y = allowances.
// Demand curve: total net demand as price varies.
// Supply line: horizontal at Q (auctioned allowances). Draggable.
// Stacked mode: show per-participant demand stacked.
function MarketChart({ year, result, stacked, onDragSupply, sectorColors }) {
  const W = 680, H = 420;
  const PAD = { t: 28, r: 24, b: 44, l: 56 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const curve = useMemo(() => result.demandCurve || [], [result]);
  const xMin = year.price_lower_bound ?? 0;
  const xMax = year.price_upper_bound ?? 250;

  // Y domain
  const yMax = Math.max(
    result.Q * 1.4,
    ...curve.map(pt => pt.total),
    10,
  );
  const yMin = Math.min(0, ...curve.map(pt => pt.total));

  const xs = (p) => PAD.l + ((p - xMin) / (xMax - xMin)) * iw;
  const ys = (a) => PAD.t + ih - ((a - yMin) / (yMax - yMin)) * ih;

  const xTicks = 6, yTicks = 5;
  const xTickVals = Array.from({ length: xTicks }, (_, i) => xMin + (xMax - xMin) * (i / (xTicks - 1)));
  const yTickVals = Array.from({ length: yTicks }, (_, i) => yMin + (yMax - yMin) * (i / (yTicks - 1)));

  // Curves
  const totalPath = curve.map((pt, i) => `${i === 0 ? "M" : "L"}${xs(pt.p)},${ys(pt.total)}`).join(" ");

  // Stacked bands per-participant (only positive contributions).
  const stackBands = useMemo(() => {
    if (!stacked) return [];
    const parts = year.participants || [];
    // Compute cumulative at each p
    const bands = parts.map(() => []);
    for (const pt of curve) {
      let cum = 0;
      const per = pt.perPart;
      for (let i = 0; i < parts.length; i++) {
        const v = per[i];
        const start = cum;
        cum += v;
        bands[i].push({ p: pt.p, y0: start, y1: cum });
      }
    }
    return parts.map((part, i) => {
      const pts = bands[i];
      const top = pts.map((q, k) => `${k === 0 ? "M" : "L"}${xs(q.p)},${ys(q.y1)}`).join(" ");
      const bot = [...pts].reverse().map(q => `L${xs(q.p)},${ys(q.y0)}`).join(" ");
      return { part, d: `${top} ${bot} Z`, color: sectorColors[part.sector] || "#888" };
    });
  }, [stacked, curve, year.participants]);

  // Drag supply line.
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const onMouseDown = (e) => {
    setDragging(true);
    updateFromY(e);
  };
  const updateFromY = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    const a = yMin + (yMax - yMin) * ((PAD.t + ih - sy) / ih);
    const clamped = Math.max(yMin, Math.min(yMax, a));
    onDragSupply?.(clamped);
  };
  useEffect(() => {
    if (!dragging) return;
    const mv = (e) => updateFromY(e);
    const up = () => setDragging(false);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [dragging]);

  // Hover probe
  const [hoverP, setHoverP] = useState(null);
  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const p = xMin + (xMax - xMin) * ((sx - PAD.l) / iw);
    if (p >= xMin && p <= xMax) setHoverP(p);
    else setHoverP(null);
  };

  const hoverPoint = hoverP == null || !curve.length
    ? null
    : curve.reduce((best, point) =>
        Math.abs(point.p - hoverP) < Math.abs(best.p - hoverP) ? point : best
      );
  const hoverTotal = hoverPoint ? hoverPoint.total : null;

  return (
    <div className="chart-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="chart"
        onMouseMove={onMove} onMouseLeave={() => setHoverP(null)}>
        {/* grid */}
        {yTickVals.map((v, i) => (
          <g key={"yg" + i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={ys(v)} y2={ys(v)} className="gridline" />
            <text x={PAD.l - 10} y={ys(v)} className="axis-label" textAnchor="end" dy="0.32em">{fmt.int(v)}</text>
          </g>
        ))}
        {xTickVals.map((v, i) => (
          <g key={"xg" + i}>
            <line x1={xs(v)} x2={xs(v)} y1={PAD.t} y2={H - PAD.b} className="gridline subtle" />
            <text x={xs(v)} y={H - PAD.b + 18} className="axis-label" textAnchor="middle">${fmt.num(v, 0)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="axis" />

        {/* axis titles */}
        <text x={W / 2} y={H - 8} className="axis-title" textAnchor="middle">Carbon price ($/tCO₂)</text>
        <text transform={`translate(16, ${PAD.t + ih / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">Allowances (Mt CO₂)</text>

        {/* stacked bands */}
        {stacked && stackBands.map((b, i) => (
          <path key={"sb" + i} d={b.d} fill={b.color} fillOpacity="0.22" stroke="none" />
        ))}

        {/* total demand */}
        <path d={totalPath} className="demand-line" />

        {/* supply line (draggable) */}
        <g className={"supply" + (dragging ? " dragging" : "")}
           onMouseDown={onMouseDown} style={{ cursor: "ns-resize" }}>
          <line x1={PAD.l} x2={W - PAD.r} y1={ys(result.Q)} y2={ys(result.Q)} className="supply-line" />
          <rect x={W - PAD.r - 8} y={ys(result.Q) - 10} width="8" height="20" className="supply-grip" />
        </g>

        {/* equilibrium */}
        {result.price != null && isFinite(result.price) && (
          <g>
            <line x1={xs(result.price)} x2={xs(result.price)} y1={ys(result.Q)} y2={H - PAD.b}
                  className="eq-guide" strokeDasharray="2 3" />
            <circle cx={xs(result.price)} cy={ys(result.Q)} r="6" className="eq-dot" />
          </g>
        )}

        {/* hover probe */}
        {hoverP != null && (
          <g className="hover">
            <line x1={xs(hoverP)} x2={xs(hoverP)} y1={PAD.t} y2={H - PAD.b} className="hover-line" />
            <circle cx={xs(hoverP)} cy={ys(hoverTotal)} r="3.5" className="hover-dot" />
            <g transform={`translate(${xs(hoverP) + 10},${ys(hoverTotal) - 12})`}>
              <rect width="148" height="38" rx="4" className="hover-tip" />
              <text x="10" y="15" className="hover-tip-text">${fmt.num(hoverP, 2)} /tCO₂</text>
              <text x="10" y="30" className="hover-tip-text muted">{fmt.num(hoverTotal, 1)} Mt demanded</text>
            </g>
          </g>
        )}
      </svg>
      <div className="chart-legend">
        <span><i className="sw demand"></i>Aggregate net demand</span>
        <span><i className="sw supply"></i>Auctioned supply (drag to explore)</span>
        {stacked && (year.participants || []).map((p, i) => (
          <span key={i}><i className="sw" style={{ background: (sectorColors[p.sector] || '#888') }}></i>{p.name}</span>
        ))}
      </div>
    </div>
  );
}

window.MarketChart = MarketChart;
window.SECTOR_COLORS = SECTOR_COLORS;
window.fmt = fmt;
