import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { ASSETS, ASSET_CATEGORIES } from '../data/assets.js';

const COLORS = [
  '#0f1419', '#1d9bf0', '#f4212e', '#00ba7c', '#f59e0b',
  '#7856ff', '#c026d3', '#14b8a6', '#ff7a00', '#1e40af',
  '#6b7280', '#ec4899', '#8b5cf6', '#ef4444', '#10b981',
];

function ActualReturnsPanel({
  returnData,
  metadata,
  errors,
  onFetchReturns,
  isFetching,
}) {
  const [showCumulative, setShowCumulative] = useState(true);
  const [visibleTickers, setVisibleTickers] = useState(null); // null = show all
  const [filterCategory, setFilterCategory] = useState('all');

  const hasData = returnData && Object.keys(returnData).length > 0;
  const allTickers = Object.keys(returnData || {});

  // Filter tickers by category
  const filteredTickers = useMemo(() => {
    if (filterCategory === 'all') return allTickers;
    return allTickers.filter((ticker) => {
      const asset = ASSETS.find((a) => a.ticker === ticker || a.id === ticker);
      return asset && asset.category === filterCategory;
    });
  }, [allTickers, filterCategory]);

  const displayTickers = visibleTickers
    ? filteredTickers.filter((t) => visibleTickers.has(t))
    : filteredTickers;

  // Build chart data
  const chartData = useMemo(() => {
    if (!hasData || displayTickers.length === 0) return [];

    const allDates = new Set();
    for (const ticker of displayTickers) {
      const data = returnData[ticker];
      if (data?.dates) for (const d of data.dates) allDates.add(d);
    }
    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) return [];

    if (showCumulative) {
      const cumulative = {};
      for (const ticker of displayTickers) {
        const data = returnData[ticker];
        if (!data?.dates) continue;
        cumulative[ticker] = { value: 1.0, dateMap: {} };
        for (let i = 0; i < data.dates.length; i++) {
          cumulative[ticker].value *= 1 + data.returns[i];
          cumulative[ticker].dateMap[data.dates[i]] = cumulative[ticker].value;
        }
      }
      return sortedDates.map((date) => {
        const point = { date };
        for (const ticker of displayTickers) {
          if (cumulative[ticker]) point[ticker] = cumulative[ticker].dateMap[date] || null;
        }
        return point;
      });
    } else {
      return sortedDates.map((date) => {
        const point = { date };
        for (const ticker of displayTickers) {
          const data = returnData[ticker];
          if (!data?.dates) continue;
          const idx = data.dates.indexOf(date);
          point[ticker] = idx >= 0 ? data.returns[idx] * 100 : null;
        }
        return point;
      });
    }
  }, [returnData, showCumulative, hasData, displayTickers]);

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

      let peak = 1, maxDD = 0, val = 1;
      for (const r of rets) {
        val *= 1 + r;
        if (val > peak) peak = val;
        const dd = (peak - val) / peak;
        if (dd > maxDD) maxDD = dd;
      }

      const asset = ASSETS.find((a) => a.ticker === ticker || a.id === ticker);
      stats[ticker] = {
        cagr, vol, maxDD: maxDD * 100, cumReturn, nMonths,
        nYears: nYears.toFixed(1),
        startDate: data.dates[0],
        endDate: data.dates[data.dates.length - 1],
        category: asset?.category || 'unknown',
        name: asset?.name || ticker,
      };
    }
    return stats;
  }, [returnData]);

  const toggleTicker = (ticker) => {
    setVisibleTickers((prev) => {
      if (prev === null) {
        // Currently showing all - switch to showing all except this one
        const next = new Set(filteredTickers);
        next.delete(ticker);
        return next;
      }
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next.size === 0 ? null : next;
    });
  };

  const showAllTickers = () => setVisibleTickers(null);
  const hideAllTickers = () => setVisibleTickers(new Set());

  const categories = ['all', ...Object.keys(ASSET_CATEGORIES)];

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Historical Returns</div>
          <div className="tab-description">
            {hasData
              ? `${allTickers.length} assets loaded from Yahoo Finance`
              : isFetching
              ? 'Loading historical data for all assets...'
              : 'Historical data auto-loads on startup'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={onFetchReturns}
            disabled={isFetching}
          >
            {isFetching ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5, borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />
                Fetching...
              </span>
            ) : 'Refresh Data'}
          </button>
        </div>
      </div>

      {/* Loading indicator */}
      {isFetching && !hasData && (
        <div className="loading-overlay">
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 2 }} />
          <span>Loading historical data for all {ASSETS.length} assets...</span>
        </div>
      )}

      {/* Category Filter */}
      {hasData && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`btn btn-secondary btn-sm ${filterCategory === cat ? 'active' : ''}`}
              onClick={() => { setFilterCategory(cat); setVisibleTickers(null); }}
            >
              {cat === 'all' ? 'All' : ASSET_CATEGORIES[cat] || cat}
            </button>
          ))}
        </div>
      )}

      {/* Chart */}
      {hasData && chartData.length > 0 && (
        <div className="chart-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <div className="chart-title">
              {showCumulative ? 'Cumulative Returns' : 'Monthly Returns'}
              {displayTickers.length < filteredTickers.length && ` (${displayTickers.length}/${filteredTickers.length} shown)`}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={showAllTickers}>Show All</button>
              <button className="btn btn-secondary btn-sm" onClick={hideAllTickers}>Hide All</button>
              <div className="toggle-group">
                <button className={`toggle-option ${showCumulative ? 'active' : ''}`} onClick={() => setShowCumulative(true)}>Cumulative</button>
                <button className={`toggle-option ${!showCumulative ? 'active' : ''}`} onClick={() => setShowCumulative(false)}>Monthly</button>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="date" fontSize={10} tick={{ fill: '#65676b' }} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => showCumulative ? `${v.toFixed(1)}x` : `${v.toFixed(0)}%`}
                fontSize={11} tick={{ fill: '#65676b' }} />
              <Tooltip formatter={(value, name) => [showCumulative ? `${value?.toFixed(3)}x` : `${value?.toFixed(2)}%`, name]}
                contentStyle={{ background: 'white', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
              <Legend />
              {displayTickers.map((ticker, i) => (
                <Line key={ticker} type="monotone" dataKey={ticker}
                  stroke={COLORS[i % COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>

          {/* Ticker toggles */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'var(--space-sm)' }}>
            {filteredTickers.map((ticker, i) => {
              const isVisible = visibleTickers === null || visibleTickers.has(ticker);
              return (
                <button key={ticker}
                  className="btn btn-sm"
                  style={{
                    padding: '2px 8px', fontSize: '0.6875rem',
                    background: isVisible ? COLORS[i % COLORS.length] + '20' : 'var(--bg-tertiary)',
                    color: isVisible ? COLORS[i % COLORS.length] : 'var(--text-muted)',
                    border: `1px solid ${isVisible ? COLORS[i % COLORS.length] + '40' : 'var(--border-color-light)'}`,
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                  }}
                  onClick={() => toggleTicker(ticker)}>
                  {ticker}
                </button>
              );
            })}
          </div>
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
                  <th>Asset</th><th>Name</th><th>Period</th><th>Months</th>
                  <th>CAGR</th><th>Volatility</th><th>Max DD</th><th>Total Return</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(assetStats)
                  .filter(([ticker]) => filterCategory === 'all' || assetStats[ticker].category === filterCategory)
                  .sort((a, b) => b[1].cagr - a[1].cagr)
                  .map(([ticker, s]) => (
                  <tr key={ticker}>
                    <td style={{ fontWeight: 600 }}>{ticker}</td>
                    <td className="text-cell" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.name}</td>
                    <td className="text-cell">{s.startDate} to {s.endDate}</td>
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
          <p style={{ margin: 0 }}>Historical data is loading automatically. Click "Refresh Data" if needed.</p>
        </div>
      )}
    </div>
  );
}

export default ActualReturnsPanel;
