import React, { useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

function ResultsDashboard({ results, mode }) {
  const isBacktest = mode === 'actual' || mode === 'hybrid';

  if (!results) {
    return (
      <div className="fade-in">
        <div className="tab-header">
          <div>
            <div className="tab-title">Results</div>
            <div className="tab-description">Run a simulation to see results</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">&#x1f4c8;</div>
          <p style={{ margin: 0 }}>Configure your portfolio and run a simulation from the Settings tab</p>
        </div>
      </div>
    );
  }

  if (results.error) {
    return (
      <div className="fade-in">
        <div className="tab-header">
          <div>
            <div className="tab-title">Results</div>
            <div className="tab-description">Error</div>
          </div>
        </div>
        <div className="card" style={{ color: 'var(--accent-danger)' }}>
          {results.error}
        </div>
      </div>
    );
  }

  // Monte Carlo results
  if (!isBacktest && results.percentilePaths) {
    return <MonteCarloResults results={results} />;
  }

  // Backtest results
  if (isBacktest && results.path) {
    return <BacktestResults results={results} />;
  }

  return null;
}

function MonteCarloResults({ results }) {
  const { percentilePaths, summary, nPaths, nYears, nMonths } = results;

  // Build fan chart data with banded areas for proper percentile rendering
  const fanData = useMemo(() => {
    const data = [];
    const step = Math.max(1, Math.floor(nMonths / 240));
    for (let m = 0; m <= nMonths; m += step) {
      const yr = m / 12;
      const p5 = percentilePaths.p5[m];
      const p10 = percentilePaths.p10[m];
      const p25 = percentilePaths.p25[m];
      const p50 = percentilePaths.p50[m];
      const p75 = percentilePaths.p75[m];
      const p90 = percentilePaths.p90[m];
      const p95 = percentilePaths.p95[m];
      data.push({
        year: yr,
        // Stacked band components
        base: p5,
        band_5_10: Math.max(0, p10 - p5),
        band_10_25: Math.max(0, p25 - p10),
        band_25_50: Math.max(0, p50 - p25),
        band_50_75: Math.max(0, p75 - p50),
        band_75_90: Math.max(0, p90 - p75),
        band_90_95: Math.max(0, p95 - p90),
        // Raw values for tooltip and median line
        p5, p10, p25, p50, p75, p90, p95,
      });
    }
    // Always include final month
    const lastYr = data[data.length - 1]?.year;
    if (lastYr !== nYears) {
      const p5 = percentilePaths.p5[nMonths];
      const p10 = percentilePaths.p10[nMonths];
      const p25 = percentilePaths.p25[nMonths];
      const p50 = percentilePaths.p50[nMonths];
      const p75 = percentilePaths.p75[nMonths];
      const p90 = percentilePaths.p90[nMonths];
      const p95 = percentilePaths.p95[nMonths];
      data.push({
        year: nYears,
        base: p5,
        band_5_10: Math.max(0, p10 - p5),
        band_10_25: Math.max(0, p25 - p10),
        band_25_50: Math.max(0, p50 - p25),
        band_50_75: Math.max(0, p75 - p50),
        band_75_90: Math.max(0, p90 - p75),
        band_90_95: Math.max(0, p95 - p90),
        p5, p10, p25, p50, p75, p90, p95,
      });
    }
    return data;
  }, [percentilePaths, nMonths, nYears]);

  // Build distribution data for terminal wealth
  const distData = useMemo(() => {
    const cagrs = [];
    for (let p = 0; p < results.paths.length; p++) {
      const fm = results.paths[p][nMonths];
      if (fm > 0) {
        cagrs.push((Math.pow(fm, 1 / nYears) - 1) * 100);
      }
    }
    cagrs.sort((a, b) => a - b);

    // Create histogram bins
    const min = Math.floor(cagrs[0] || -10);
    const max = Math.ceil(cagrs[cagrs.length - 1] || 30);
    const nBins = 40;
    const binWidth = (max - min) / nBins;
    const bins = [];
    for (let i = 0; i < nBins; i++) {
      const lo = min + i * binWidth;
      const hi = lo + binWidth;
      const count = cagrs.filter((c) => c >= lo && c < hi).length;
      bins.push({
        range: `${lo.toFixed(0)}%`,
        value: lo + binWidth / 2,
        count,
        pct: (count / cagrs.length) * 100,
      });
    }
    return bins;
  }, [results.paths, nMonths, nYears]);

  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '--');
  const fmtPct = (v, d = 1) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}%` : '--');

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Monte Carlo Results</div>
          <div className="tab-description">
            {nPaths.toLocaleString()} paths &middot; {nYears} year horizon
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: summary.cagr.median >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
            {fmtPct(summary.cagr.median)}
          </div>
          <div className="stat-label">Median CAGR</div>
          <div className="stat-range">5th: {fmtPct(summary.cagr.p5)} &middot; 95th: {fmtPct(summary.cagr.p95)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.vol.median)}%</div>
          <div className="stat-label">Median Volatility</div>
          <div className="stat-range">5th: {fmt(summary.vol.p5)}% &middot; 95th: {fmt(summary.vol.p95)}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--status-negative)' }}>
            -{fmt(summary.maxDD.median)}%
          </div>
          <div className="stat-label">Avg Max Drawdown</div>
          <div className="stat-range">Best 5%: -{fmt(summary.maxDD.p5)}% &middot; Worst 5%: -{fmt(summary.maxDD.p95)}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.sharpe.median, 2)}</div>
          <div className="stat-label">Median Sharpe</div>
          <div className="stat-range">5th: {fmt(summary.sharpe.p5, 2)} &middot; 95th: {fmt(summary.sharpe.p95, 2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.sortino.median, 2)}</div>
          <div className="stat-label">Median Sortino</div>
          <div className="stat-range">5th: {fmt(summary.sortino.p5, 2)} &middot; 95th: {fmt(summary.sortino.p95, 2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.finalMult.median, 2)}x</div>
          <div className="stat-label">Median Final Wealth</div>
          <div className="stat-range">5th: {fmt(summary.finalMult.p5, 2)}x &middot; 95th: {fmt(summary.finalMult.p95, 2)}x</div>
        </div>
      </div>

      {/* Fan Chart */}
      <div className="chart-container">
        <div className="chart-title">Portfolio Growth - Percentile Fan Chart</div>
        <div className="chart-legend">
          <div className="legend-item"><div className="legend-dot" style={{ background: 'rgba(29,155,240,0.15)' }} /> 5th-95th</div>
          <div className="legend-item"><div className="legend-dot" style={{ background: 'rgba(29,155,240,0.25)' }} /> 10th-90th</div>
          <div className="legend-item"><div className="legend-dot" style={{ background: 'rgba(29,155,240,0.4)' }} /> 25th-75th</div>
          <div className="legend-item"><div className="legend-dot" style={{ background: '#1d9bf0', width: 16, height: 2, borderRadius: 1 }} /> Median</div>
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={fanData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="year"
              tickFormatter={(v) => `${v}y`}
              fontSize={11}
              tick={{ fill: '#65676b' }}
            />
            <YAxis
              tickFormatter={(v) => `${v.toFixed(1)}x`}
              fontSize={11}
              tick={{ fill: '#65676b' }}
              domain={['auto', 'auto']}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div style={{
                    background: 'white', border: '1px solid rgba(0,0,0,0.15)',
                    borderRadius: 8, padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Year {label}</div>
                    <div style={{ color: '#65676b' }}>95th: {d.p95?.toFixed(2)}x</div>
                    <div style={{ color: '#65676b' }}>90th: {d.p90?.toFixed(2)}x</div>
                    <div style={{ color: '#65676b' }}>75th: {d.p75?.toFixed(2)}x</div>
                    <div style={{ color: '#1d9bf0', fontWeight: 600 }}>Median: {d.p50?.toFixed(2)}x</div>
                    <div style={{ color: '#65676b' }}>25th: {d.p25?.toFixed(2)}x</div>
                    <div style={{ color: '#65676b' }}>10th: {d.p10?.toFixed(2)}x</div>
                    <div style={{ color: '#65676b' }}>5th: {d.p5?.toFixed(2)}x</div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={1} stroke="rgba(0,0,0,0.2)" strokeDasharray="3 3" />
            {/* Stacked bands: invisible base + colored bands */}
            <Area type="monotone" dataKey="base" stackId="fan" fill="transparent" stroke="none" />
            <Area type="monotone" dataKey="band_5_10" stackId="fan" fill="rgba(29,155,240,0.08)" stroke="none" />
            <Area type="monotone" dataKey="band_10_25" stackId="fan" fill="rgba(29,155,240,0.13)" stroke="none" />
            <Area type="monotone" dataKey="band_25_50" stackId="fan" fill="rgba(29,155,240,0.22)" stroke="none" />
            <Area type="monotone" dataKey="band_50_75" stackId="fan" fill="rgba(29,155,240,0.22)" stroke="none" />
            <Area type="monotone" dataKey="band_75_90" stackId="fan" fill="rgba(29,155,240,0.13)" stroke="none" />
            <Area type="monotone" dataKey="band_90_95" stackId="fan" fill="rgba(29,155,240,0.08)" stroke="none" />
            {/* Median line on top */}
            <Line type="monotone" dataKey="p50" stroke="#1d9bf0" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* CAGR Distribution */}
      <div className="chart-container">
        <div className="chart-title">CAGR Distribution</div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={distData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="range"
              fontSize={10}
              tick={{ fill: '#65676b' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              fontSize={10}
              tick={{ fill: '#65676b' }}
            />
            <Tooltip
              formatter={(value) => [`${value.toFixed(1)}%`, 'Frequency']}
              contentStyle={{
                background: 'white',
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <ReferenceLine x={`${Math.round(summary.cagr.median)}%`} stroke="#1d9bf0" strokeWidth={2} />
            <Bar dataKey="pct" fill="rgba(29,155,240,0.4)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Percentile Table */}
      <div className="chart-container">
        <div className="chart-title">Detailed Percentile Breakdown</div>
        <table className="percentile-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>5th</th>
              <th>10th</th>
              <th>25th</th>
              <th>Median</th>
              <th>75th</th>
              <th>90th</th>
              <th>95th</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-cell">CAGR</td>
              <td>{fmtPct(summary.cagr.p5)}</td>
              <td>{fmtPct(summary.cagr.p10)}</td>
              <td>{fmtPct(summary.cagr.p25)}</td>
              <td style={{ fontWeight: 600 }}>{fmtPct(summary.cagr.median)}</td>
              <td>{fmtPct(summary.cagr.p75)}</td>
              <td>{fmtPct(summary.cagr.p90)}</td>
              <td>{fmtPct(summary.cagr.p95)}</td>
            </tr>
            <tr>
              <td className="text-cell">Volatility</td>
              <td>{fmt(summary.vol.p5)}%</td>
              <td>{fmt(summary.vol.p10)}%</td>
              <td>{fmt(summary.vol.p25)}%</td>
              <td style={{ fontWeight: 600 }}>{fmt(summary.vol.median)}%</td>
              <td>{fmt(summary.vol.p75)}%</td>
              <td>{fmt(summary.vol.p90)}%</td>
              <td>{fmt(summary.vol.p95)}%</td>
            </tr>
            <tr>
              <td className="text-cell">Max Drawdown</td>
              <td>-{fmt(summary.maxDD.p5)}%</td>
              <td>-{fmt(summary.maxDD.p10)}%</td>
              <td>-{fmt(summary.maxDD.p25)}%</td>
              <td style={{ fontWeight: 600 }}>-{fmt(summary.maxDD.median)}%</td>
              <td>-{fmt(summary.maxDD.p75)}%</td>
              <td>-{fmt(summary.maxDD.p90)}%</td>
              <td>-{fmt(summary.maxDD.p95)}%</td>
            </tr>
            <tr>
              <td className="text-cell">Sharpe Ratio</td>
              <td>{fmt(summary.sharpe.p5, 2)}</td>
              <td>{fmt(summary.sharpe.p10, 2)}</td>
              <td>{fmt(summary.sharpe.p25, 2)}</td>
              <td style={{ fontWeight: 600 }}>{fmt(summary.sharpe.median, 2)}</td>
              <td>{fmt(summary.sharpe.p75, 2)}</td>
              <td>{fmt(summary.sharpe.p90, 2)}</td>
              <td>{fmt(summary.sharpe.p95, 2)}</td>
            </tr>
            <tr>
              <td className="text-cell">Sortino Ratio</td>
              <td>{fmt(summary.sortino.p5, 2)}</td>
              <td>{fmt(summary.sortino.p10, 2)}</td>
              <td>{fmt(summary.sortino.p25, 2)}</td>
              <td style={{ fontWeight: 600 }}>{fmt(summary.sortino.median, 2)}</td>
              <td>{fmt(summary.sortino.p75, 2)}</td>
              <td>{fmt(summary.sortino.p90, 2)}</td>
              <td>{fmt(summary.sortino.p95, 2)}</td>
            </tr>
            <tr>
              <td className="text-cell">Final Wealth</td>
              <td>{fmt(summary.finalMult.p5, 2)}x</td>
              <td>{fmt(summary.finalMult.p10, 2)}x</td>
              <td>{fmt(summary.finalMult.p25, 2)}x</td>
              <td style={{ fontWeight: 600 }}>{fmt(summary.finalMult.median, 2)}x</td>
              <td>{fmt(summary.finalMult.p75, 2)}x</td>
              <td>{fmt(summary.finalMult.p90, 2)}x</td>
              <td>{fmt(summary.finalMult.p95, 2)}x</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BacktestResults({ results }) {
  const { path, dates, stats, dataAvailability, monthlyReturns } = results;

  const chartData = useMemo(() => {
    const data = [];
    const step = Math.max(1, Math.floor(path.length / 300));
    for (let i = 0; i < path.length; i += step) {
      data.push({
        date: dates[i] || `M${i}`,
        value: path[i],
      });
    }
    if (data[data.length - 1]?.date !== dates[dates.length - 1]) {
      data.push({
        date: dates[dates.length - 1],
        value: path[path.length - 1],
      });
    }
    return data;
  }, [path, dates]);

  // Monthly return distribution
  const drawdownData = useMemo(() => {
    const data = [];
    let peak = path[0];
    const step = Math.max(1, Math.floor(path.length / 300));
    for (let i = 0; i < path.length; i += step) {
      if (path[i] > peak) peak = path[i];
      const dd = peak > 0 ? ((path[i] - peak) / peak) * 100 : 0;
      data.push({
        date: dates[i] || `M${i}`,
        drawdown: dd,
      });
    }
    return data;
  }, [path, dates]);

  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '--');

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Historical Backtest Results</div>
          <div className="tab-description">
            {stats.startDate} to {stats.endDate} &middot; {stats.nYears} years
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: stats.cagr >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
            {stats.cagr >= 0 ? '+' : ''}{fmt(stats.cagr)}%
          </div>
          <div className="stat-label">CAGR</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(stats.vol)}%</div>
          <div className="stat-label">Volatility</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--status-negative)' }}>-{fmt(stats.maxDD)}%</div>
          <div className="stat-label">Max Drawdown</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(stats.sharpe, 2)}</div>
          <div className="stat-label">Sharpe Ratio</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(stats.sortino, 2)}</div>
          <div className="stat-label">Sortino Ratio</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(stats.finalMult, 2)}x</div>
          <div className="stat-label">Total Return</div>
        </div>
      </div>

      {/* Cumulative Return Chart */}
      <div className="chart-container">
        <div className="chart-title">Cumulative Portfolio Growth</div>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="date"
              fontSize={10}
              tick={{ fill: '#65676b' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => `${v.toFixed(1)}x`}
              fontSize={11}
              tick={{ fill: '#65676b' }}
            />
            <Tooltip
              formatter={(value) => [`${value.toFixed(3)}x`, 'Portfolio Value']}
              contentStyle={{
                background: 'white',
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
            />
            <ReferenceLine y={1} stroke="rgba(0,0,0,0.2)" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="value" stroke="#0f1419" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Drawdown Chart */}
      <div className="chart-container">
        <div className="chart-title">Drawdown</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={drawdownData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis
              dataKey="date"
              fontSize={10}
              tick={{ fill: '#65676b' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              fontSize={11}
              tick={{ fill: '#65676b' }}
            />
            <Tooltip
              formatter={(value) => [`${value.toFixed(1)}%`, 'Drawdown']}
              contentStyle={{
                background: 'white',
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area type="monotone" dataKey="drawdown" stroke="#f4212e" fill="rgba(244,33,46,0.1)" strokeWidth={1} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Data Availability */}
      {dataAvailability && Object.keys(dataAvailability).length > 0 && (
        <div className="chart-container">
          <div className="chart-title">Data Availability</div>
          <div className="data-status">
            {Object.entries(dataAvailability).map(([ticker, info]) => (
              <div key={ticker} className="data-status-row">
                <span className="data-status-ticker">{ticker}</span>
                <span className="data-status-info">
                  {info.available
                    ? `${info.startDate} to ${info.endDate} (${info.totalMonths} months)`
                    : 'No data available'}
                </span>
                <span className={`data-status-badge ${info.available ? 'available' : 'missing'}`}>
                  {info.available ? 'OK' : 'Missing'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ResultsDashboard;
