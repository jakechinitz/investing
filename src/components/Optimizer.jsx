import React, { useState, useMemo, useCallback } from 'react';
import {
  ScatterChart, Scatter, LineChart, Line,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceDot, ReferenceLine,
} from 'recharts';
import { ASSETS, ASSET_CATEGORIES } from '../data/assets.js';
import { optimize, getEffectiveParams } from '../engine/optimizer.js';

const OBJECTIVES = [
  { id: 'sharpe', label: 'Max Sharpe', description: 'Maximize risk-adjusted return' },
  { id: 'cagr', label: 'Max CAGR', description: 'Maximize geometric growth rate' },
  { id: 'sortino', label: 'Max Sortino', description: 'Maximize downside risk-adjusted return' },
  { id: 'riskParity', label: 'Risk Parity', description: 'Equal risk contribution from each asset' },
  { id: 'pareto', label: 'Pareto Frontier', description: 'Explore the efficient frontier' },
];

const ASSET_COLORS = [
  '#0f1419', '#1d9bf0', '#f4212e', '#00ba7c', '#f59e0b',
  '#7856ff', '#c026d3', '#14b8a6', '#ff7a00', '#1e40af',
  '#6b7280', '#ec4899', '#8b5cf6', '#ef4444', '#10b981',
];

function Optimizer({ returnData, onApplyWeights }) {
  const [included, setIncluded] = useState(() => {
    const defaultSet = new Set();
    ['SPY', 'AGG', 'TLT', 'GLD', 'VNQ', 'VWO'].forEach((id) => defaultSet.add(id));
    return defaultSet;
  });
  const [objective, setObjective] = useState('sharpe');
  const [mode, setMode] = useState('simulated');
  const [minWeight, setMinWeight] = useState(0);
  const [maxWeight, setMaxWeight] = useState(50);
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedFrontierIdx, setSelectedFrontierIdx] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState(new Set(Object.keys(ASSET_CATEGORIES)));

  // Group assets by category
  const groupedAssets = useMemo(() => {
    const groups = {};
    for (const asset of ASSETS) {
      const cat = asset.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(asset);
    }
    return groups;
  }, []);

  const includedAssets = useMemo(
    () => ASSETS.filter((a) => included.has(a.id)),
    [included]
  );

  const toggleAsset = (id) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (category) => {
    const catAssets = groupedAssets[category] || [];
    const allIncluded = catAssets.every((a) => included.has(a.id));
    setIncluded((prev) => {
      const next = new Set(prev);
      for (const a of catAssets) {
        if (allIncluded) next.delete(a.id);
        else next.add(a.id);
      }
      return next;
    });
  };

  const toggleCategoryExpanded = (category) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  // Run optimization
  const handleOptimize = useCallback(async () => {
    if (includedAssets.length < 2) return;
    setIsRunning(true);
    setResults(null);
    setSelectedFrontierIdx(null);

    await new Promise((r) => setTimeout(r, 50));

    try {
      const result = optimize({
        assets: includedAssets,
        objective,
        mode,
        returnData,
        minWeight: minWeight / 100,
        maxWeight: maxWeight / 100,
        seed: 42,
      });
      setResults(result);
    } catch (err) {
      console.error('Optimization error:', err);
      setResults({ error: err.message });
    } finally {
      setIsRunning(false);
    }
  }, [includedAssets, objective, mode, returnData, minWeight, maxWeight]);

  // Apply weights to portfolio
  const handleApply = (weights, assets) => {
    if (!onApplyWeights || !weights || !assets) return;
    const portfolioAssets = assets.map((a, i) => ({
      ...a,
      weight: Math.round(weights[i] * 1000) / 10,
    })).filter((a) => a.weight > 0.1);
    onApplyWeights(portfolioAssets);
  };

  // Get currently displayed weights (either direct result or selected frontier point)
  const displayResult = useMemo(() => {
    if (!results) return null;
    if (results.error) return null;

    if (objective === 'pareto') {
      if (selectedFrontierIdx != null && results.frontier?.[selectedFrontierIdx]) {
        return results.frontier[selectedFrontierIdx];
      }
      return results.maxSharpe || null;
    }

    return results;
  }, [results, objective, selectedFrontierIdx]);

  const displayWeights = displayResult?.weights;
  const displayMetrics = displayResult?.metrics || displayResult;

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Portfolio Optimizer</div>
          <div className="tab-description">
            Find optimal weights for your selected assets
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 'var(--space-lg)' }}>
        {/* Left Panel: Asset Selection */}
        <div>
          <div className="config-block" style={{ marginBottom: 'var(--space-md)' }}>
            <div className="config-block-title">
              Include Assets ({included.size})
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {Object.entries(groupedAssets).map(([category, catAssets]) => {
                const allChecked = catAssets.every((a) => included.has(a.id));
                const someChecked = catAssets.some((a) => included.has(a.id));
                const isExpanded = expandedCategories.has(category);

                return (
                  <div key={category} style={{ marginBottom: 4 }}>
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        fontSize: '0.6875rem', fontWeight: 600,
                        color: 'var(--text-muted)', textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                        onChange={() => toggleCategory(category)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span onClick={() => toggleCategoryExpanded(category)} style={{ flex: 1 }}>
                        {ASSET_CATEGORIES[category] || category}
                        <span style={{ fontWeight: 400, marginLeft: 4 }}>
                          ({catAssets.filter((a) => included.has(a.id)).length}/{catAssets.length})
                        </span>
                      </span>
                      <span onClick={() => toggleCategoryExpanded(category)} style={{ fontSize: '0.75rem' }}>
                        {isExpanded ? '\u25B4' : '\u25BE'}
                      </span>
                    </div>
                    {isExpanded && catAssets.map((asset) => (
                      <label
                        key={asset.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '3px 8px 3px 24px', cursor: 'pointer',
                          fontSize: '0.8125rem',
                          color: included.has(asset.id) ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={included.has(asset.id)}
                          onChange={() => toggleAsset(asset.id)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 48, fontSize: '0.75rem' }}>
                          {asset.ticker}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{asset.name}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Constraints */}
          <div className="config-block">
            <div className="config-block-title">Constraints</div>
            <div className="config-row">
              <span className="config-label">Min Weight</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number" min="0" max="50" step="1"
                  value={minWeight}
                  onChange={(e) => setMinWeight(Math.max(0, Math.min(50, parseInt(e.target.value) || 0)))}
                  style={{ width: 50, textAlign: 'right' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>%</span>
              </div>
            </div>
            <div className="config-row">
              <span className="config-label">Max Weight</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number" min="5" max="100" step="5"
                  value={maxWeight}
                  onChange={(e) => setMaxWeight(Math.max(5, Math.min(100, parseInt(e.target.value) || 100)))}
                  style={{ width: 50, textAlign: 'right' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Objective + Results */}
        <div>
          {/* Mode Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Data Source:</span>
            <div className="toggle-group">
              <button
                className={`toggle-option ${mode === 'simulated' ? 'active' : ''}`}
                onClick={() => setMode('simulated')}
              >
                Simulated
              </button>
              <button
                className={`toggle-option ${mode === 'actual' ? 'active' : ''}`}
                onClick={() => setMode('actual')}
              >
                Actual
              </button>
            </div>
            {mode === 'actual' && Object.keys(returnData).length === 0 && (
              <span className="warning-text">Fetch returns in the Historical tab first</span>
            )}
          </div>

          {/* Objective Selector */}
          <div className="config-block" style={{ marginBottom: 'var(--space-md)' }}>
            <div className="config-block-title">Optimization Objective</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {OBJECTIVES.map((obj) => (
                <button
                  key={obj.id}
                  className={`btn btn-secondary btn-sm ${objective === obj.id ? 'active' : ''}`}
                  onClick={() => { setObjective(obj.id); setResults(null); setSelectedFrontierIdx(null); }}
                  title={obj.description}
                >
                  {obj.label}
                </button>
              ))}
            </div>
            <p className="info-text" style={{ marginTop: 'var(--space-sm)' }}>
              {OBJECTIVES.find((o) => o.id === objective)?.description}
            </p>
          </div>

          {/* Run Button */}
          <button
            className={`run-button ${isRunning ? 'running' : ''}`}
            onClick={handleOptimize}
            disabled={isRunning || includedAssets.length < 2}
            style={{ marginTop: 0, marginBottom: 'var(--space-lg)' }}
          >
            {isRunning ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', justifyContent: 'center' }}>
                <span className="spinner" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />
                Optimizing ({includedAssets.length} assets)...
              </span>
            ) : (
              `Optimize ${includedAssets.length} Assets`
            )}
          </button>

          {/* Error */}
          {results?.error && (
            <div className="card" style={{ color: 'var(--accent-danger)', marginBottom: 'var(--space-md)' }}>
              {results.error}
            </div>
          )}

          {/* Pareto Frontier Chart */}
          {results && objective === 'pareto' && results.frontier && (
            <ParetoChart
              results={results}
              selectedIdx={selectedFrontierIdx}
              onSelectPoint={setSelectedFrontierIdx}
            />
          )}

          {/* Optimal Weights */}
          {displayWeights && displayWeights.length > 0 && (
            <div className="chart-container">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                <div className="chart-title">
                  {objective === 'pareto'
                    ? selectedFrontierIdx != null ? 'Selected Portfolio Weights' : 'Max Sharpe Portfolio Weights'
                    : 'Optimal Weights'}
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleApply(displayWeights, results.assets || includedAssets)}
                >
                  Apply to Portfolio
                </button>
              </div>

              <WeightChart
                weights={displayWeights}
                assets={results.assets || includedAssets}
              />
            </div>
          )}

          {/* Metrics */}
          {displayMetrics && !results?.error && (
            <MetricsDisplay metrics={displayMetrics} />
          )}

          {/* Asset expected params table */}
          {!results && includedAssets.length >= 2 && (
            <div className="chart-container">
              <div className="chart-title">Asset Parameters ({mode === 'simulated' ? 'Model-Based' : 'From Actual Data'})</div>
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Expected Return</th>
                    <th>Volatility</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {includedAssets.map((a) => {
                    const p = getEffectiveParams(a);
                    return (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{a.ticker}</td>
                        <td style={{ color: p.mu >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
                          {(p.mu * 100).toFixed(1)}%
                        </td>
                        <td>{(p.sigma * 100).toFixed(1)}%</td>
                        <td className="text-cell" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {a.leverage ? `${a.leverage}x Leveraged` : a.stackedComponents ? 'Stacked' : 'Direct'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-Components ───

function WeightChart({ weights, assets }) {
  const data = assets
    .map((a, i) => ({
      ticker: a.ticker || a.id,
      name: a.name,
      weight: Math.round(weights[i] * 1000) / 10,
    }))
    .filter((d) => d.weight > 0.1)
    .sort((a, b) => b.weight - a.weight);

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v) => `${v}%`}
            fontSize={11}
            tick={{ fill: '#65676b' }}
          />
          <YAxis
            type="category"
            dataKey="ticker"
            fontSize={11}
            tick={{ fill: '#0f1419', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
            width={55}
          />
          <Tooltip
            formatter={(value, name, { payload }) => [`${value.toFixed(1)}%`, payload.name]}
            contentStyle={{
              background: 'white', border: '1px solid rgba(0,0,0,0.15)',
              borderRadius: 8, fontSize: 12,
            }}
          />
          <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Weight table */}
      <table style={{ marginTop: 'var(--space-sm)' }}>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.ticker}>
              <td style={{ fontWeight: 600 }}>{d.ticker}</td>
              <td>{d.weight.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricsDisplay({ metrics }) {
  const m = metrics;
  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '--');

  return (
    <div className="stats-grid" style={{ marginTop: 'var(--space-md)' }}>
      <div className="stat-card">
        <div className="stat-value" style={{ color: (m.cagr || m.expectedReturn) >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
          {m.cagr != null ? `${m.cagr >= 0 ? '+' : ''}${fmt(m.cagr)}%` : `${fmt(m.expectedReturn)}%`}
        </div>
        <div className="stat-label">{m.cagr != null ? 'CAGR' : 'Expected Return'}</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{fmt(m.vol)}%</div>
        <div className="stat-label">Volatility</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{fmt(m.sharpe, 2)}</div>
        <div className="stat-label">Sharpe Ratio</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{fmt(m.sortino, 2)}</div>
        <div className="stat-label">Sortino Ratio</div>
      </div>
    </div>
  );
}

function ParetoChart({ results, selectedIdx, onSelectPoint }) {
  const { frontier, cloud, maxSharpe, minVol, maxCagr, riskParity, equalWeight } = results;

  const frontierData = frontier.map((p, i) => ({
    vol: p.vol,
    cagr: p.cagr,
    sharpe: p.sharpe,
    idx: i,
  }));

  // Custom dot renderer for the frontier line
  const renderDot = (props) => {
    const { cx, cy, payload } = props;
    const isSelected = payload.idx === selectedIdx;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={isSelected ? 6 : 3}
        fill={isSelected ? '#1d9bf0' : '#0f1419'}
        stroke={isSelected ? '#0f1419' : 'none'}
        strokeWidth={isSelected ? 2 : 0}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelectPoint(payload.idx)}
      />
    );
  };

  return (
    <div className="chart-container" style={{ marginBottom: 'var(--space-md)' }}>
      <div className="chart-title">Efficient Frontier</div>
      <div className="chart-legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ background: 'rgba(0,0,0,0.08)' }} /> All Portfolios
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#0f1419' }} /> Frontier
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#1d9bf0', width: 10, height: 10 }} /> Max Sharpe
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#00ba7c', width: 10, height: 10 }} /> Min Vol
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#f59e0b', width: 10, height: 10 }} /> Risk Parity
        </div>
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis
            dataKey="vol"
            name="Volatility"
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            fontSize={11}
            tick={{ fill: '#65676b' }}
            label={{ value: 'Volatility (%)', position: 'bottom', offset: -5, fontSize: 11, fill: '#65676b' }}
          />
          <YAxis
            dataKey="cagr"
            name="CAGR"
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            fontSize={11}
            tick={{ fill: '#65676b' }}
            label={{ value: 'CAGR (%)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: '#65676b' }}
          />
          <Tooltip
            formatter={(value, name) => [`${value.toFixed(2)}%`, name]}
            contentStyle={{
              background: 'white', border: '1px solid rgba(0,0,0,0.15)',
              borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)',
            }}
          />
          {/* Cloud of all portfolios */}
          <Scatter data={cloud} fill="rgba(0,0,0,0.06)" shape="circle" legendType="none" isAnimationActive={false}>
            {cloud.map((_, i) => (
              <Cell key={i} r={1.5} />
            ))}
          </Scatter>
          {/* Efficient frontier line */}
          <Scatter
            data={frontierData}
            fill="#0f1419"
            shape={renderDot}
            line={{ stroke: '#0f1419', strokeWidth: 1.5 }}
            legendType="none"
            isAnimationActive={false}
          />
          {/* Special points */}
          {maxSharpe && (
            <ReferenceDot
              x={maxSharpe.vol} y={maxSharpe.cagr}
              r={8} fill="#1d9bf0" stroke="#0f1419" strokeWidth={2}
              label={{ value: 'Sharpe', fontSize: 10, position: 'top' }}
            />
          )}
          {minVol && (
            <ReferenceDot
              x={minVol.vol} y={minVol.cagr}
              r={7} fill="#00ba7c" stroke="#0f1419" strokeWidth={2}
              label={{ value: 'Min Vol', fontSize: 10, position: 'left' }}
            />
          )}
          {riskParity && (
            <ReferenceDot
              x={riskParity.vol} y={riskParity.cagr}
              r={7} fill="#f59e0b" stroke="#0f1419" strokeWidth={2}
              label={{ value: 'RP', fontSize: 10, position: 'right' }}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      <p className="info-text" style={{ marginTop: 'var(--space-sm)', textAlign: 'center' }}>
        Click on frontier points to view their weight allocations
      </p>
    </div>
  );
}

export default Optimizer;
