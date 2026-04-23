import { useMemo, useState } from "react";
import { fmt } from "./MarketChart.jsx";

function AnnualMetricPanel({ title, unitLabel, color, type, rows, metricKey, onSelectYear }) {
  const W = 720;
  const H = 172;
  const PAD = { t: 18, r: 22, b: 38, l: 76 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const [hoverIndex, setHoverIndex] = useState(null);

  const maxValue = useMemo(() => {
    const peak = Math.max(...rows.map((row) => Number(row[metricKey] || 0)), 1);
    return peak * 1.1;
  }, [rows, metricKey]);

  const xs = (index) => {
    const n = Math.max(1, rows.length - 1);
    return PAD.l + (index / n) * iw;
  };
  const ys = (value) => PAD.t + ih - (Number(value || 0) / maxValue) * ih;

  const tickValues = [0, maxValue / 2, maxValue];
  const linePath = rows
    .map((row, index) => `${index === 0 ? "M" : "L"}${xs(index)},${ys(row[metricKey])}`)
    .join(" ");

  return (
    <div className="annual-metric-card">
      <div className="annual-metric-head">
        <div>
          <div className="annual-metric-title">{title}</div>
          <div className="annual-metric-unit">{unitLabel}</div>
        </div>
        <div className="annual-metric-legend">
          <span className="annual-swatch" style={{ background: color }}></span>
          <span>{type === "line" ? "Trend" : "Level by year"}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart annual-metric-chart">
        {tickValues.map((tick, index) => (
          <g key={`${title}-tick-${index}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={ys(tick)} y2={ys(tick)} className="gridline subtle" />
            <text x={PAD.l - 10} y={ys(tick)} className="axis-label annual-axis-label" textAnchor="end" dy="0.32em">
              {unitLabel === "$/tCO2" ? fmt.price(tick) : unitLabel === "Mt CO2" ? `${fmt.num(tick, 1)} Mt` : fmt.money(tick)}
            </text>
          </g>
        ))}

        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} className="axis" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih} className="axis" />

        {rows.map((row, index) => (
          <g key={`${title}-year-${row.year}`}>
            <line x1={xs(index)} x2={xs(index)} y1={PAD.t} y2={PAD.t + ih} className="gridline subtle" />
            <text x={xs(index)} y={H - 10} className="axis-label annual-axis-label" textAnchor="middle">
              {row.year}
            </text>
          </g>
        ))}

        {type === "line" ? (
          <>
            <path d={linePath} fill="none" stroke={color} strokeWidth="3" />
            {rows.map((row, index) => (
              <g key={`${title}-point-${row.year}`}>
                <circle cx={xs(index)} cy={ys(row[metricKey])} r="5" fill={color} />
                <rect
                  x={xs(index) - 22}
                  y={PAD.t}
                  width="44"
                  height={ih}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onClick={() => onSelectYear?.(row.year)}
                  style={{ cursor: "pointer" }}
                />
              </g>
            ))}
          </>
        ) : (
          rows.map((row, index) => {
            const y = ys(row[metricKey]);
            return (
              <g key={`${title}-bar-${row.year}`}>
                <rect
                  x={xs(index) - 20}
                  y={y}
                  width="40"
                  height={PAD.t + ih - y}
                  rx="4"
                  fill={color}
                  fillOpacity="0.82"
                />
                <rect
                  x={xs(index) - 24}
                  y={PAD.t}
                  width="48"
                  height={ih}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onClick={() => onSelectYear?.(row.year)}
                  style={{ cursor: "pointer" }}
                />
              </g>
            );
          })
        )}

        {hoverIndex != null && rows[hoverIndex] && (
          <g transform={`translate(${Math.min(xs(hoverIndex) + 14, W - 168)},${PAD.t + 8})`}>
            <rect width="154" height="42" rx="6" className="hover-tip" />
            <text x="10" y="16" className="hover-tip-text">{rows[hoverIndex].year}</text>
            <text x="10" y="31" className="hover-tip-text muted">
              {unitLabel === "$/tCO2"
                ? `Price ${fmt.price(rows[hoverIndex][metricKey])}`
                : unitLabel === "Mt CO2"
                  ? `Abatement ${fmt.num(rows[hoverIndex][metricKey], 1)} Mt`
                  : `Revenue ${fmt.money(rows[hoverIndex][metricKey])}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export function AnnualMarketChart({ scenario, results, onSelectYear }) {
  const rows = useMemo(
    () =>
      (scenario?.years || []).map((year) => {
        const result = results?.[scenario.name]?.[String(year.year)] || {};
        return {
          year: String(year.year),
          price: Number(result.price ?? 0),
          totalAbate: Number(result.totalAbate ?? 0),
          revenue: Number(result.revenue ?? 0),
        };
      }),
    [scenario, results]
  );

  return (
    <div className="annual-metric-grid">
      <AnnualMetricPanel
        title="Equilibrium carbon price"
        unitLabel="$/tCO2"
        color="#1f6f55"
        type="line"
        rows={rows}
        metricKey="price"
        onSelectYear={onSelectYear}
      />
      <AnnualMetricPanel
        title="Total abatement"
        unitLabel="Mt CO2"
        color="#2f6f8f"
        type="bar"
        rows={rows}
        metricKey="totalAbate"
        onSelectYear={onSelectYear}
      />
      <AnnualMetricPanel
        title="Auction revenue"
        unitLabel="$"
        color="#8a5a2c"
        type="bar"
        rows={rows}
        metricKey="revenue"
        onSelectYear={onSelectYear}
      />
    </div>
  );
}
