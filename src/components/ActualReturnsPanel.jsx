import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const COLORS = [
  '#0f1419', '#1d9bf0', '#f4212e', '#00ba7c', '#f59e0b',
  '#7856ff', '#c026d3', '#14b8a6', '#ff7a00', '#1e40af',
];

function ActualReturnsPanel({
  selectedAssets,
  returnData,
  metadata,
  errors,
  onFetchReturns,
  isFetching,
}) {
  const [showCumulative, setShowCumulative] = useState(true);

  const hasData = returnData && Object.keys(returnData).length > 0;

  // Build chart data
  const chartData = useMemo(() => {
    if (!hasData) return [];

    // Find common dates
    const allDates = new Set();
    for (const data of Object.values(returnData)) {
      if (data?.dates) {
        for (const d of data.dates) allDates.add(d);
      }
    }
    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) return [];

    if (showCumulative) {
      // Cumulative return chart
      const cumulative = {};
      for (const [ticker, data] of Object.entries(returnData)) {
        if (!data?.dates) continue;
        cumulative[ticker] = { value: 1.0, dateMap: {} };
        for (let i = 0; i < data.dates.length; i++) {
          cumulative[ticker].value *= 1 + data.returns[i];
          cumulative[ticker].dateMap[data.dates[i]] = cumulative[ticker].value;
        }
      }

      return sortedDates.map((date) => {
        const point = { date };
        for (const [ticker, cum] of Object.entries(cumulative)) {
          point[ticker] = cum.dateMap[date] || null;
        }
        return point;
      });
    } else {
      // Monthly return chart
      return sortedDates.map((date) => {
        const point = { date };
        for (const [ticker, data] of Object.entries(returnData)) {
          if (!data?.dates) continue;
          const idx = data.dates.indexOf(date);
          point[ticker] = idx >= 0 ? data.returns[idx] * 100 : null;
        }
        return point;
      });
    }
  }, [returnData, showCumulative, hasData]);

  // Compute per-asset stats
  const assetStats = useMemo(() => {
    const stats = {};
    for (const [ticker, data] of Object.entries(returnData || {})) {
      if (!data?.returns || data.returns.length === 0) continue;
      const rets = data.returns;
      const nMonths = rets.length;
      const nYears = nMonths / 12;
      const cumReturn = rets.reduce((acc, r) => acc * (1 + r), 1);
      const cagr = nYears > 0 ? (Math.pow(cumReturn, 1 / nYears) - 1) * 100 : 0;

      const mean = rets.reduce((s, r) => s + r, 0) / nMonths;
      const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (nMonths - 1);
      const vol = Math.sqrt(variance) * Math.sqrt(12) * 100;

      let peak = 1;
      let maxDD = 0;
      let val = 1;
      for (const r of rets) {
        val *= 1 + r;
        if (val > peak) peak = val;
        const dd = (peak - val) / peak;
        if (dd > maxDD) maxDD = dd;
      }

      stats[ticker] = {
        cagr,
        vol,
        maxDD: maxDD * 100,
        cumReturn,
        nMonths,
        nYears: nYears.toFixed(1),
        startDate: data.dates[0],
        endDate: data.dates[data.dates.length - 1],
      };
    }
    return stats;
  }, [returnData]);

  const tickers = Object.keys(returnData || {});

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Historical Returns</div>
          <div className="tab-description">Actual return data fetched from Yahoo Finance</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={onFetchReturns}
            disabled={isFetching || selectedAssets.length === 0}
          >
            {isFetching ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5, borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />
                Fetching...
              </span>
            ) : (
              'Fetch Returns'
            )}
          </button>
        </div>
      </div>

      {/* Data Availability */}
      {(metadata || errors) && (
        <div className="section">
          <div className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Data Status</div>
          <div className="data-status">
            {selectedAssets.map((asset) => {
              const ticker = asset.ticker || asset.id;
              const meta = metadata?.[ticker];
              const error = errors?.[ticker];
              const data = returnData?.[ticker];

              return (
                <div key={ticker} className="data-status-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <span className="data-status-ticker">{ticker}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{asset.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    {data && (
                      <span className="data-status-info">
                        {data.startDate} to {data.endDate} ({data.totalMonths} mo)
                      </span>
                    )}
                    {meta?.source === 'comparable' && (
                      <span className="data-status-badge comparable" title={meta.note}>
                        Proxy: {meta.comparableTicker}
                      </span>
                    )}
                    {data && meta?.source !== 'comparable' && (
                      <span className="data-status-badge available">OK</span>
                    )}
                    {error && !data && (
                      <span className="data-status-badge missing" title={error}>
                        Error
                      </span>
                    )}
                    {!data && !error && !isFetching && (
                      <span className="data-status-badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                        Not fetched
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Chart */}
      {hasData && chartData.length > 0 && (
        <div className="chart-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <div className="chart-title">
              {showCumulative ? 'Cumulative Returns' : 'Monthly Returns'}
            </div>
            <div className="toggle-group">
              <button
                className={`toggle-option ${showCumulative ? 'active' : ''}`}
                onClick={() => setShowCumulative(true)}
              >
                Cumulative
              </button>
              <button
                className={`toggle-option ${!showCumulative ? 'active' : ''}`}
                onClick={() => setShowCumulative(false)}
              >
                Monthly
              </button>
            </div>
          </div>
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
                tickFormatter={(v) =>
                  showCumulative ? `${v.toFixed(1)}x` : `${v.toFixed(0)}%`
                }
                fontSize={11}
                tick={{ fill: '#65676b' }}
              />
              <Tooltip
                formatter={(value, name) => [
                  showCumulative ? `${value?.toFixed(3)}x` : `${value?.toFixed(2)}%`,
                  name,
                ]}
                contentStyle={{
                  background: 'white',
                  border: '1px solid rgba(0,0,0,0.15)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <Legend />
              {tickers.map((ticker, i) => (
                <Line
                  key={ticker}
                  type="monotone"
                  dataKey={ticker}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-Asset Stats Table */}
      {Object.keys(assetStats).length > 0 && (
        <div className="chart-container">
          <div className="chart-title">Individual Asset Statistics</div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Period</th>
                  <th>Months</th>
                  <th>CAGR</th>
                  <th>Volatility</th>
                  <th>Max DD</th>
                  <th>Total Return</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(assetStats).map(([ticker, s]) => (
                  <tr key={ticker}>
                    <td style={{ fontWeight: 600 }}>{ticker}</td>
                    <td>{s.startDate} to {s.endDate}</td>
                    <td>{s.nMonths}</td>
                    <td style={{ color: s.cagr >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
                      {s.cagr >= 0 ? '+' : ''}{s.cagr.toFixed(1)}%
                    </td>
                    <td>{s.vol.toFixed(1)}%</td>
                    <td style={{ color: 'var(--status-negative)' }}>-{s.maxDD.toFixed(1)}%</td>
                    <td>{s.cumReturn.toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasData && !isFetching && (
        <div className="empty-state">
          <div className="empty-state-icon">&#x1f4dc;</div>
          <p style={{ margin: 0 }}>
            {selectedAssets.length === 0
              ? 'Add assets in the Portfolio tab, then fetch returns here'
              : 'Click "Fetch Returns" to load historical data from Yahoo Finance'}
          </p>
        </div>
      )}
    </div>
  );
}

export default ActualReturnsPanel;
