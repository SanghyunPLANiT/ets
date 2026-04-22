// Annual trajectory — equilibrium price across years, with abatement + revenue as secondary layers.
const { useMemo: useMemo2 } = React;

function TrajectoryChart({ scenarios, results, highlightScenario, onHoverYear }) {
  const W = 680, H = 340;
  const PAD = { t: 28, r: 130, b: 40, l: 52 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  // Collect all years across scenarios.
  const allYears = useMemo2(() => {
    const set = new Set();
    scenarios.forEach(s => s.years.forEach(y => set.add(String(y.year))));
    return [...set].sort();
  }, [scenarios]);

  // x: index based on allYears
  const xs = (y) => {
    const i = allYears.indexOf(String(y));
    const n = Math.max(1, allYears.length - 1);
    return PAD.l + (i / n) * iw;
  };

  const maxPrice = useMemo2(() => {
    let m = 50;
    for (const s of scenarios) {
      for (const y of s.years) {
        const r = results[s.name]?.[String(y.year)];
        if (r && isFinite(r.price)) m = Math.max(m, r.price);
      }
    }
    return Math.ceil(m / 25) * 25;
  }, [scenarios, results]);

  const ys = (p) => PAD.t + ih - (p / maxPrice) * ih;

  const yTickVals = Array.from({ length: 5 }, (_, i) => (maxPrice * i) / 4);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        {yTickVals.map((v, i) => (
          <g key={"yt" + i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={ys(v)} y2={ys(v)} className="gridline" />
            <text x={PAD.l - 10} y={ys(v)} className="axis-label" textAnchor="end" dy="0.32em">${fmt.num(v, 0)}</text>
          </g>
        ))}
        {allYears.map((y, i) => (
          <g key={"xt" + i}>
            <line x1={xs(y)} x2={xs(y)} y1={PAD.t} y2={H - PAD.b} className="gridline subtle" />
            <text x={xs(y)} y={H - PAD.b + 18} className="axis-label" textAnchor="middle">{y}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="axis" />
        <text transform={`translate(16, ${PAD.t + ih / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">Equilibrium price ($/tCO₂)</text>

        {/* lines */}
        {scenarios.map((s) => {
          const pts = s.years.map(y => {
            const r = results[s.name]?.[String(y.year)];
            return r && isFinite(r.price) ? { x: xs(y.year), y: ys(r.price), year: y.year, price: r.price } : null;
          }).filter(Boolean);
          if (pts.length < 1) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
          const muted = highlightScenario && highlightScenario !== s.name;
          return (
            <g key={s.id} className={"trajectory " + (muted ? "muted" : "")}>
              <path d={d} stroke={s.color} fill="none" strokeWidth={muted ? 1.4 : 2.2} />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={muted ? 3 : 4.5} fill={s.color} stroke="#fff" strokeWidth="1.5" />
                  {!muted && (
                    <text x={p.x} y={p.y - 10} className="point-label" textAnchor="middle" fill={s.color}>
                      ${fmt.num(p.price, 0)}
                    </text>
                  )}
                </g>
              ))}
              {/* end label */}
              {!muted && pts.length > 0 && (
                <text x={pts[pts.length - 1].x + 8} y={pts[pts.length - 1].y} className="line-label"
                      dy="0.32em" fill={s.color}>{s.name}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
window.TrajectoryChart = TrajectoryChart;
