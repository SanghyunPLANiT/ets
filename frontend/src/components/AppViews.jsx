function BuildView({
  scenario, yearObj, activeYear, onYearChange, addYear, removeYear,
  onRunBase, onRunEdited, hasEditedChanges, onSave, onUpdateYearSeries, validationIssues,
}) {
  const [seriesField, setSeriesField] = React.useState(null);
  const seriesFields = [
    { key: "total_cap", label: "Total cap" },
    { key: "auction_offered", label: "Auction offered" },
    { key: "reserved_allowances", label: "Reserved allowances" },
    { key: "cancelled_allowances", label: "Cancelled allowances" },
    { key: "auction_reserve_price", label: "Auction reserve price" },
    { key: "minimum_bid_coverage", label: "Minimum bid coverage" },
    { key: "price_lower_bound", label: "Price floor" },
    { key: "price_upper_bound", label: "Price ceiling" },
    { key: "borrowing_limit", label: "Borrowing limit" },
  ];
  return (
    <div className="wb">
      <ScenarioHero
        scenario={scenario}
        activeYear={activeYear}
        onYearChange={onYearChange}
        results={{}}
        primaryMetric={(
          <div className="panel hero-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Build</div>
                <h2>Scenario builder</h2>
                <p className="muted">Create or import a scenario, edit assumptions, then run directly from here.</p>
              </div>
            </div>
            <div className="hero-actions">
              <button className="ghost-btn" onClick={onRunBase}>Run loaded scenario</button>
              <button className={"ghost-btn on " + (hasEditedChanges ? "edited-btn" : "")} onClick={onRunEdited}>Run edited</button>
            </div>
          </div>
        )}
      />
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Market timeline</div>
            <h2>Review values across years</h2>
            <p className="muted">Click a market attribute to open a year-by-year editor for the whole scenario period.</p>
          </div>
        </div>
        <div className="review-grid">
          {seriesFields.map((field) => (
            <button key={field.key} className="review-item review-button" onClick={() => setSeriesField(field.key)}>
              <span className="review-label">{field.label}</span>
              <strong>{fmt.num(yearObj[field.key] || 0, 0)}</strong>
              <span className="muted">{scenario.years.map((year) => `${year.year}: ${fmt.num(year[field.key] || 0, 0)}`).join(" · ")}</span>
            </button>
          ))}
        </div>
      </section>
      <ValidationPanel issues={validationIssues} title="Build validation" />
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Build</div>
            <h2>Edit scenario inputs</h2>
            <p className="muted">Build from scratch, use templates, and edit year, participant, MAC, and technology assumptions.</p>
          </div>
        </div>
        <Editor scenario={scenario} year={yearObj} onSave={onSave} onAddYear={addYear} onRemoveYear={removeYear} onSelectYear={onYearChange} />
      </section>
      {seriesField && (
        <YearSeriesModal
          title={seriesFields.find((field) => field.key === seriesField)?.label || seriesField}
          field={seriesField}
          years={scenario.years}
          onClose={() => setSeriesField(null)}
          onSave={onUpdateYearSeries}
        />
      )}
    </div>
  );
}

function ModelView({
  scenario, yearObj, activeYear, onYearChange, selPart, setSelPart, onRunBase, onRunEdited, hasEditedChanges, validationIssues,
}) {
  const selectedIndex = selPart == null ? 0 : selPart;
  const selectedParticipant = yearObj.participants?.[selectedIndex] || null;
  const freeAllocation = (yearObj.participants || []).reduce(
    (sum, participant) => sum + Number(participant.initial_emissions || 0) * Number(participant.free_allocation_ratio || 0),
    0
  );
  const unallocatedAllowances = Math.max(
    0,
    Number(yearObj.total_cap || 0)
      - freeAllocation
      - Number(yearObj.auction_offered || 0)
      - Number(yearObj.reserved_allowances || 0)
      - Number(yearObj.cancelled_allowances || 0)
  );
  return (
    <div className="wb">
      <ScenarioHero
        scenario={scenario}
        activeYear={activeYear}
        onYearChange={onYearChange}
        results={{}}
        primaryMetric={(
          <div className="panel hero-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Model</div>
                <h2>Review built model</h2>
                <p className="muted">Inspect the scenario structure before running: market rules, participants, MACs, and technology pathways.</p>
              </div>
            </div>
            <div className="hero-actions">
              <button className="ghost-btn" onClick={onRunBase}>Run loaded scenario</button>
              <button className={"ghost-btn on " + (hasEditedChanges ? "edited-btn" : "")} onClick={onRunEdited}>Run edited</button>
            </div>
          </div>
        )}
      />
      <section className="wb-grid">
        <ValidationPanel issues={validationIssues} title="Model validation" />
        <div className="panel">
          <div className="panel-head">
            <div><div className="eyebrow">Market</div><h2>Year {yearObj.year} market definition</h2></div>
          </div>
          <div className="review-grid">
            <div className="review-item"><span className="review-label">Auction mode</span><strong>{yearObj.auction_mode}</strong></div>
            <div className="review-item"><span className="review-label">Total cap</span><strong>{fmt.num(yearObj.total_cap || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Auction offered</span><strong>{fmt.num(yearObj.auction_offered || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Reserved allowances</span><strong>{fmt.num(yearObj.reserved_allowances || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Cancelled allowances</span><strong>{fmt.num(yearObj.cancelled_allowances || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Unallocated allowances</span><strong>{fmt.num(unallocatedAllowances, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Auction reserve price</span><strong>{fmt.num(yearObj.auction_reserve_price || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Minimum bid coverage</span><strong>{fmt.num(yearObj.minimum_bid_coverage || 0, 2)}</strong></div>
            <div className="review-item"><span className="review-label">Unsold treatment</span><strong>{yearObj.unsold_treatment || "reserve"}</strong></div>
            <div className="review-item"><span className="review-label">Price bounds</span><strong>{fmt.num(yearObj.price_lower_bound || 0, 0)} to {fmt.num(yearObj.price_upper_bound || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Banking</span><strong>{yearObj.banking_allowed ? "enabled" : "disabled"}</strong></div>
            <div className="review-item"><span className="review-label">Borrowing</span><strong>{yearObj.borrowing_allowed ? `enabled (${fmt.num(yearObj.borrowing_limit || 0, 0)})` : "disabled"}</strong></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="eyebrow">Participants</div><h2>Configured participants</h2></div></div>
          <div className="pathway-table-wrap">
            <table className="pathway-table">
              <thead><tr><th>Participant</th><th>Sector</th><th>Emissions</th><th>Abatement</th><th>Technology options</th></tr></thead>
              <tbody>
                {(yearObj.participants || []).map((participant, index) => (
                  <tr key={`${participant.name}-${index}`} onClick={() => setSelPart(index)}>
                    <td>{participant.name}</td><td>{participant.sector || "Other"}</td><td>{fmt.num(participant.initial_emissions || 0, 0)}</td><td>{participant.abatement_type}</td><td>{(participant.technology_options || []).length || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="wb-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Auction design</div>
              <h2>How this year’s auction is configured</h2>
              <p className="muted">These settings control whether offered allowances are fully sold and what happens to unsold volume.</p>
            </div>
          </div>
          <div className="review-grid auction-review-grid">
            <div className="review-item"><span className="review-label">Auction offered</span><strong>{fmt.num(yearObj.auction_offered || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Reserve price</span><strong>{fmt.price(yearObj.auction_reserve_price || 0)}</strong></div>
            <div className="review-item"><span className="review-label">Minimum bid coverage</span><strong>{fmt.num((yearObj.minimum_bid_coverage || 0) * 100, 0)}%</strong></div>
            <div className="review-item"><span className="review-label">Reserved allowances</span><strong>{fmt.num(yearObj.reserved_allowances || 0, 0)}</strong></div>
            <div className="review-item"><span className="review-label">Cancelled allowances</span><strong>{fmt.num(yearObj.cancelled_allowances || 0, 0)}</strong></div>
            <div className="review-item review-item-wide"><span className="review-label">Unsold treatment</span><strong>{describeUnsoldTreatment(yearObj.unsold_treatment || "reserve")}</strong></div>
            <div className="review-item review-item-wide"><span className="review-label">Mechanism</span><strong>Offered auction volume only becomes market supply if it clears the reserve-price and bid-coverage rules for the year.</strong></div>
          </div>
        </div>
        <AuctionPathwayPanel scenario={scenario} results={{}} />
      </section>
      <section className="wb-grid">
        <div className="panel">
          <div className="panel-head">
            <div><div className="eyebrow">MAC</div><h2>Selected participant MAC</h2></div>
            <div className="panel-controls">
              <select value={selectedIndex} onChange={(event) => setSelPart(Number(event.target.value))}>
                {(yearObj.participants || []).map((participant, index) => (
                  <option key={`${participant.name}-${index}`} value={index}>{participant.name}</option>
                ))}
              </select>
            </div>
          </div>
          <ParticipantMacChart participant={selectedParticipant} outcome={null} carbonPrice={null} />
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="eyebrow">Technology</div><h2>Technology pathway setup</h2></div></div>
          <div className="pathway-table-wrap">
            <table className="pathway-table">
              <thead><tr><th>Technology</th><th>Emissions</th><th>Free ratio</th><th>Fixed cost</th></tr></thead>
              <tbody>
                {((selectedParticipant?.technology_options || []).length ? selectedParticipant.technology_options : [{
                  name: "Base Technology",
                  initial_emissions: selectedParticipant?.initial_emissions || 0,
                  free_allocation_ratio: selectedParticipant?.free_allocation_ratio || 0,
                  fixed_cost: 0,
                }]).map((option, index) => (
                  <tr key={`${option.name}-${index}`}>
                    <td>{option.name}</td><td>{fmt.num(option.initial_emissions || 0, 1)}</td><td>{fmt.num(option.free_allocation_ratio || 0, 2)}</td><td>{fmt.num(option.fixed_cost || 0, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function AnalysisView({
  scenario, yearObj, activeYear, onYearChange, result, results, scenarios, stacked,
  onToggleStacked, dragSupply, selPart, setSelPart, analysis,
}) {
  const yearKeys = scenario.years.map((year) => String(year.year));
  const resByYear = results[scenario.name] || {};
  const idx = yearKeys.indexOf(String(activeYear));
  const prevYear = idx > 0 ? yearKeys[idx - 1] : null;
  const prevResult = prevYear ? resByYear[prevYear] : null;
  const delta = (current, previous) => previous == null ? null : current - previous;
  const selectedIndex = selPart == null ? 0 : selPart;
  const selectedParticipant = yearObj.participants?.[selectedIndex] || null;
  const selectedOutcome = result.perParticipant?.[selectedIndex] || null;
  const technologyPathway = buildTechnologyPathway(scenario, results);
  return (
    <div className="wb">
      <ScenarioHero
        scenario={scenario}
        activeYear={activeYear}
        onYearChange={onYearChange}
        results={results}
        primaryMetric={(
          <div className="kpis">
            <KPI label="Equilibrium price" value={fmt.price(result.price)} sub={prevResult ? `${delta(result.price, prevResult.price) >= 0 ? "▲" : "▼"} ${fmt.num(Math.abs(delta(result.price, prevResult.price)), 2)} vs ${prevYear}` : "base year"} tone="primary" />
            <KPI label="Auction revenue" value={fmt.money(result.revenue)} sub={`${fmt.int(result.Q)} allowances × ${fmt.price(result.price)}`}/>
            <KPI label="Abatement" value={`${fmt.num(result.totalAbate, 0)} Mt`} sub={prevResult ? `${delta(result.totalAbate, prevResult.totalAbate) >= 0 ? "▲" : "▼"} ${fmt.num(Math.abs(delta(result.totalAbate, prevResult.totalAbate)), 1)} Mt` : "—"}/>
            <KPI label="Allowances traded" value={fmt.num(result.totalTraded, 0)} sub="between buyers & sellers"/>
          </div>
        )}
      />
      <section className="wb-grid">
        <div className="panel panel-chart">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Figure 1</div>
              <h2>Market clearing · {yearObj.year}</h2>
              <p className="muted">Where aggregate net participant demand meets auction supply entering the market. Drag the supply line to edit offered volume, then rerun the model.</p>
            </div>
            <div className="toggles">
              <button className={"toggle " + (stacked ? "on" : "")} onClick={onToggleStacked}>Stack by participant</button>
            </div>
          </div>
          <MarketChart year={yearObj} result={result} stacked={stacked} onDragSupply={dragSupply} sectorColors={SECTOR_COLORS} />
        </div>
        <div className="panel panel-trajectory">
          <div className="panel-head">
            <div><div className="eyebrow">Figure 2</div><h2>Price trajectory across scenarios</h2><p className="muted">How this scenario compares against the others over time.</p></div>
          </div>
          <TrajectoryChart scenarios={scenarios} results={results} highlightScenario={scenario.name} />
        </div>
      </section>
      <section className="wb-grid">
        <AuctionDiagnosticsPanel yearObj={yearObj} result={result} />
        <div className="panel">
          <div className="panel-head">
            <div><div className="eyebrow">Auction rules</div><h2>What determined the auction outcome</h2><p className="muted">The current year’s auction mechanics and any policy frictions affecting supply available to the allowance market.</p></div>
          </div>
          <ul className="analysis-list">
            <li>Reserve price: {yearObj.auction_reserve_price > 0 ? `auction sales cannot clear below ${fmt.price(yearObj.auction_reserve_price)}.` : "no separate reserve price is active."}</li>
            <li>Minimum bid coverage: {yearObj.minimum_bid_coverage > 0 ? `at least ${fmt.num(yearObj.minimum_bid_coverage * 100, 0)}% of offered volume must be covered by bids.` : "no bid-coverage threshold is active."}</li>
            <li>Unsold treatment: {describeUnsoldTreatment(yearObj.unsold_treatment || "reserve")}.</li>
            <li>Reserved allowances: {fmt.num(yearObj.reserved_allowances || 0, 0)} are held out of circulation before market clearing.</li>
            <li>Cancelled allowances: {fmt.num(yearObj.cancelled_allowances || 0, 0)} are permanently removed from the annual cap.</li>
          </ul>
        </div>
      </section>
      <section className="panel panel-parts">
        <div className="panel-head"><div><div className="eyebrow">Figure 3</div><h2>Participant drilldown · {yearObj.year}</h2></div></div>
        <ParticipantPanel year={yearObj} result={result} selectedIdx={selPart} onSelectParticipant={(index) => setSelPart(index === selPart ? null : index)} sectorColors={SECTOR_COLORS} />
      </section>
      <section className="wb-grid">
        <div className="panel">
          <div className="panel-head">
            <div><div className="eyebrow">Figure 4</div><h2>Selected participant MAC</h2><p className="muted">Marginal abatement cost schedule for {selectedParticipant?.name || "the selected participant"} at {yearObj.year}.</p></div>
            <div className="panel-controls">
              <select value={selectedIndex} onChange={(event) => setSelPart(Number(event.target.value))}>
                {(yearObj.participants || []).map((participant, index) => (
                  <option key={`${participant.name}-${index}`} value={index}>{participant.name}</option>
                ))}
              </select>
            </div>
          </div>
          <ParticipantMacChart participant={selectedParticipant} outcome={selectedOutcome} carbonPrice={result.price} />
        </div>
        <div className="panel">
          <div className="panel-head"><div><div className="eyebrow">Analysis</div><h2>Model interpretation</h2></div></div>
          <ul className="analysis-list">
            {analysis.filter((item) => item.includes(scenario.name)).map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      </section>
      <section className="wb-grid">
        <div className="panel">
          <div className="panel-head">
            <div><div className="eyebrow">Figure 5</div><h2>Annual market pathway</h2><p className="muted">Interactive annual trajectory of equilibrium price, abatement, and auction revenue for this scenario.</p></div>
          </div>
          <AnnualMarketChart scenario={scenario} results={results} onSelectYear={onYearChange} />
        </div>
        <div className="panel panel-note">
          <div className="panel-head"><div><div className="eyebrow">Calibration</div><h2>About the sample MACs</h2></div></div>
          <p className="muted">The participant MACs bundled in the example scenarios are demonstration inputs. They are economically coherent, but they are not calibrated sector estimates.</p>
          <p className="muted">For policy analysis, treat them as placeholders until you replace them with engineering, benchmarking, or observed-firm data for the selected participant.</p>
        </div>
      </section>
      <AuctionPathwayPanel scenario={scenario} results={results} />
      <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">Technology pathway</div><h2>Chosen technologies across years</h2><p className="muted">The annual technology selected by the optimization for each participant in this scenario.</p></div></div>
        <div className="pathway-table-wrap">
          <table className="pathway-table">
            <thead><tr><th>Participant</th>{technologyPathway.years.map((year) => <th key={year}>{year}</th>)}</tr></thead>
            <tbody>
              {technologyPathway.rows.map((row) => (
                <tr key={row.participant}>
                  <td>{row.participant}</td>
                  {row.pathway.map((technology, index) => (
                    <td key={`${row.participant}-${technologyPathway.years[index]}`}>{technology}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><div className="eyebrow">Figure 6</div><h2>Year-by-year market views</h2><p className="muted">Interactive small-multiple market views for each year. Click a card to jump to that year.</p></div></div>
        <MarketYearGallery scenario={scenario} results={results} activeYear={activeYear} onSelectYear={onYearChange} />
      </section>
      <footer className="foot">
        <span>Numerical method · Brent root finding in Python</span><span>·</span>
        <span>Source of truth · backend model in <code>ets/participant.py</code> and <code>ets/market.py</code></span><span>·</span>
        <span>Inputs are editable in the UI; rerun the scenario to refresh results</span>
      </footer>
    </div>
  );
}

function Compare({ scenarios, results, activeYear, onYear }) {
  const allYears = [...new Set(scenarios.flatMap((scenario) => scenario.years.map((year) => String(year.year))))].sort();
  return (
    <div className="cmp">
      <div className="cmp-head">
        <div>
          <div className="eyebrow">Side-by-side</div>
          <h1>Three futures, one market</h1>
          <p className="lede">Equilibrium outcomes for each scenario in {activeYear}. The scarcer the cap, the higher the price.</p>
        </div>
        <div className="year-picker">
          {allYears.map((year) => (
            <button key={year} className={"pill-btn " + (year === activeYear ? "on" : "")} onClick={() => onYear(year)}>{year}</button>
          ))}
        </div>
      </div>
      <div className="cmp-grid">
        {scenarios.map((scenario) => {
          const year = scenario.years.find((item) => String(item.year) === String(activeYear));
          if (!year) return null;
          const result = results[scenario.name]?.[String(year.year)];
          if (!result) return null;
          return (
            <div key={scenario.id} className="cmp-card" style={{ "--c": scenario.color }}>
              <div className="cmp-card-head"><i className="sw" style={{ background: scenario.color }}></i><h3>{scenario.name}</h3></div>
              <div className="cmp-big"><div className="cmp-price">{fmt.price(result.price)}</div><div className="cmp-sub">per tCO₂ · {activeYear}</div></div>
              <div className="cmp-kpis">
                <div><div className="lbl">Abatement</div><div className="val">{fmt.num(result.totalAbate, 0)} Mt</div></div>
                <div><div className="lbl">Auction revenue</div><div className="val">{fmt.money(result.revenue)}</div></div>
                <div><div className="lbl">Auction sold</div><div className="val">{fmt.int(result.Q)}</div></div>
              </div>
              <MiniMarket year={year} result={result} />
              <div className="cmp-parts">
                {result.perParticipant.map((participant, index) => (
                  <div key={index} className="cmp-prow">
                    <span className="n">{participant.name}</span>
                    <span className={"v " + (participant.net_trade > 0 ? "buy" : participant.net_trade < 0 ? "sell" : "")}>
                      {participant.net_trade > 0 ? "buys " : participant.net_trade < 0 ? "sells " : ""}
                      {fmt.num(Math.abs(participant.net_trade), 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel cmp-trajectory">
        <div className="panel-head"><div><div className="eyebrow">Trajectory</div><h2>Price path to {allYears[allYears.length - 1]}</h2></div></div>
        <TrajectoryChart scenarios={scenarios} results={results} />
      </div>
    </div>
  );
}

Object.assign(window, { BuildView, ModelView, AnalysisView, Compare });
