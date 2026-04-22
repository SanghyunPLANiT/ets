function MarketYearGallery({ scenario, results, activeYear, onSelectYear }) {
  const rows = (scenario?.years || []).map((year) => ({
    year: String(year.year),
    yearConfig: year,
    result: results?.[scenario.name]?.[String(year.year)],
  })).filter((row) => row.result);

  return (
    <div className="chart-gallery">
      {rows.map((row) => (
        <button
          key={row.year}
          className={"chart-card chart-card-export chart-card-button " + (String(activeYear) === row.year ? "on" : "")}
          onClick={() => onSelectYear?.(row.year)}
        >
          <div className="chart-card-head">
            <span className="chart-card-kicker">Year {row.year}</span>
            <span className="chart-card-tag">Interactive</span>
          </div>
          <MiniMarket year={row.yearConfig} result={row.result} />
          <figcaption className="chart-card-caption">
            Price {fmt.price(row.result.price)} · Sold {fmt.int(row.result.auctionSold)} · Unsold {fmt.int(row.result.unsoldAllowances)}
          </figcaption>
        </button>
      ))}
    </div>
  );
}

window.MarketYearGallery = MarketYearGallery;
