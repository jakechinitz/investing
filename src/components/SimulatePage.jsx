import React, { useState, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from 'recharts';
import { ASSETS, ASSET_CATEGORIES, searchAssets, PRESET_PORTFOLIOS, getAsset } from '../data/assets.js';
import { CRISIS_REGIMES } from '../engine/simulation.js';

const PORTFOLIO_COLORS = [
  '#0f1419', '#1d9bf0', '#f4212e', '#00ba7c', '#f59e0b',
  '#7856ff', '#c026d3', '#14b8a6', '#ff7a00', '#1e40af',
];

const MAX_PORTFOLIOS = 10;

function SimulatePage({
  portfolios,
  activePortfolioId,
  onPortfoliosChange,
  onActivePortfolioChange,
  simConfig,
  onConfigChange,
  onRunSimulation,
  isSimulating,
  simResults,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [leverageAcknowledged, setLeverageAcknowledged] = useState({});

  const activePortfolio = portfolios.find((p) => p.id === activePortfolioId) || portfolios[0];
  const selectedAssets = activePortfolio?.assets || [];
  const selectedIds = new Set(selectedAssets.map((a) => a.id));
  const totalWeight = selectedAssets.reduce((sum, a) => sum + a.weight, 0);

  // Compute leverage info per portfolio
  const portfolioLeverageInfo = useMemo(() => {
    const info = {};
    for (const p of portfolios) {
      const tw = p.assets.reduce((sum, a) => sum + a.weight, 0);
      const hasAssets = p.assets.length > 0 && p.assets.some((a) => a.weight > 0);
      if (!hasAssets) {
        info[p.id] = { totalWeight: 0, isLeveraged: false, isUnderAllocated: false, leveragePct: 0, cashPct: 0 };
      } else if (tw > 100.1) {
        info[p.id] = { totalWeight: tw, isLeveraged: true, isUnderAllocated: false, leveragePct: tw - 100, cashPct: 0 };
      } else if (tw < 99.9) {
        info[p.id] = { totalWeight: tw, isLeveraged: false, isUnderAllocated: true, leveragePct: 0, cashPct: 100 - tw };
      } else {
        info[p.id] = { totalWeight: tw, isLeveraged: false, isUnderAllocated: false, leveragePct: 0, cashPct: 0 };
      }
    }
    return info;
  }, [portfolios]);

  // Check if any leveraged portfolio lacks acknowledgment
  const leveragedPortfoliosNeedingAck = useMemo(() => {
    return portfolios.filter((p) => {
      const info = portfolioLeverageInfo[p.id];
      return info?.isLeveraged && !leverageAcknowledged[p.id];
    });
  }, [portfolios, portfolioLeverageInfo, leverageAcknowledged]);

  const toggleLeverageAck = (portfolioId) => {
    setLeverageAcknowledged((prev) => ({ ...prev, [portfolioId]: !prev[portfolioId] }));
  };

  const filteredAssets = useMemo(() => searchAssets(searchQuery), [searchQuery]);
  const groupedAssets = useMemo(() => {
    const groups = {};
    for (const asset of filteredAssets) {
      const cat = asset.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(asset);
    }
    return groups;
  }, [filteredAssets]);

  // ─── Portfolio Mutations ───
  const updateActiveAssets = useCallback((newAssets) => {
    onPortfoliosChange(
      portfolios.map((p) =>
        p.id === activePortfolioId ? { ...p, assets: newAssets } : p
      )
    );
  }, [portfolios, activePortfolioId, onPortfoliosChange]);

  const addAsset = (asset) => {
    if (selectedIds.has(asset.id)) return;
    updateActiveAssets([...selectedAssets, { ...asset, weight: 0 }]);
  };

  const removeAsset = (id) => {
    updateActiveAssets(selectedAssets.filter((a) => a.id !== id));
  };

  const updateWeight = (id, weight) => {
    const w = Math.max(0, Math.min(200, parseFloat(weight) || 0));
    updateActiveAssets(selectedAssets.map((a) => (a.id === id ? { ...a, weight: w } : a)));
  };

  const equalizeWeights = () => {
    if (selectedAssets.length === 0) return;
    const w = Math.round((100 / selectedAssets.length) * 100) / 100;
    updateActiveAssets(selectedAssets.map((a) => ({ ...a, weight: w })));
  };

  const addAllAssets = () => {
    const newAssets = ASSETS.filter((a) => !selectedIds.has(a.id)).map((a) => ({ ...a, weight: 0 }));
    updateActiveAssets([...selectedAssets, ...newAssets]);
  };

  const loadPreset = (presetKey) => {
    const preset = PRESET_PORTFOLIOS[presetKey];
    if (!preset) return;
    const newAssets = preset.assets
      .map((pa) => {
        const def = getAsset(pa.id);
        return def ? { ...def, weight: pa.weight } : null;
      })
      .filter(Boolean);
    updateActiveAssets(newAssets);
  };

  // ─── Portfolio Tab Management ───
  const addPortfolio = () => {
    if (portfolios.length >= MAX_PORTFOLIOS) return;
    const newId = Math.max(...portfolios.map((p) => p.id)) + 1;
    onPortfoliosChange([...portfolios, { id: newId, name: `Portfolio ${newId}`, assets: [] }]);
    onActivePortfolioChange(newId);
  };

  const removePortfolio = (id) => {
    if (portfolios.length <= 1) return;
    const remaining = portfolios.filter((p) => p.id !== id);
    onPortfoliosChange(remaining);
    if (activePortfolioId === id) {
      onActivePortfolioChange(remaining[0].id);
    }
  };

  // ─── Settings ───
  const updateConfig = (key, value) => {
    onConfigChange({ ...simConfig, [key]: value });
  };

  const updateRegime = (regime, value) => {
    const val = parseFloat(value) || 0;
    const newWeights = { ...simConfig.regimeWeights, [regime]: val };
    const others = Object.keys(newWeights).filter((k) => k !== regime);
    const otherSum = others.reduce((s, k) => s + newWeights[k], 0);
    const remaining = Math.max(0, 100 - val);
    if (otherSum > 0) {
      for (const k of others) newWeights[k] = (newWeights[k] / otherSum) * remaining;
    } else {
      for (const k of others) newWeights[k] = remaining / others.length;
    }
    updateConfig('regimeWeights', newWeights);
  };

  const anyPortfolioHasAssets = portfolios.some((p) => p.assets.length > 0 && p.assets.some((a) => a.weight > 0));

  // ─── Results ───
  const hasResults = simResults && Object.keys(simResults).length > 0;
  const resultsArray = hasResults
    ? Object.entries(simResults)
        .map(([id, r]) => {
          const port = portfolios.find((p) => String(p.id) === String(id));
          return { id, name: port?.name || `Portfolio ${id}`, results: r, color: PORTFOLIO_COLORS[(parseInt(id) - 1) % PORTFOLIO_COLORS.length] };
        })
        .filter((r) => r.results && !r.results.error)
    : [];

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Portfolio Simulator</div>
          <div className="tab-description">Build portfolios, configure simulations, and compare results</div>
        </div>
      </div>

      {/* ─── Presets (Always Visible) ─── */}
      <div className="section">
        <div className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Quick Presets</div>
        <div className="preset-grid">
          {Object.entries(PRESET_PORTFOLIOS).map(([key, preset]) => (
            <button key={key} className="preset-card" onClick={() => loadPreset(key)}>
              <div className="preset-card-name">{preset.name}</div>
              <div className="preset-card-desc">{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Portfolio Tabs ─── */}
      <div className="portfolio-tabs-bar">
        {portfolios.map((p) => {
          const levInfo = portfolioLeverageInfo[p.id];
          return (
            <div
              key={p.id}
              className={`portfolio-tab ${p.id === activePortfolioId ? 'active' : ''}`}
            >
              <button
                className="portfolio-tab-btn"
                onClick={() => onActivePortfolioChange(p.id)}
                style={{ color: PORTFOLIO_COLORS[(p.id - 1) % PORTFOLIO_COLORS.length] }}
              >
                <span
                  className="portfolio-tab-dot"
                  style={{ background: PORTFOLIO_COLORS[(p.id - 1) % PORTFOLIO_COLORS.length] }}
                />
                {p.name}
                {p.assets.length > 0 && (
                  <span className="portfolio-tab-count">{p.assets.length}</span>
                )}
              </button>
              {levInfo?.isLeveraged && (
                <span className="portfolio-tab-leverage" title={`${levInfo.totalWeight.toFixed(1)}% total allocation = ${levInfo.leveragePct.toFixed(1)}% leverage`}>
                  {levInfo.leveragePct.toFixed(0)}% lev
                </span>
              )}
              {levInfo?.isUnderAllocated && (
                <span className="portfolio-tab-cash" title={`${levInfo.totalWeight.toFixed(1)}% allocated, ${levInfo.cashPct.toFixed(1)}% defaults to cash`}>
                  {levInfo.cashPct.toFixed(0)}% cash
                </span>
              )}
              {portfolios.length > 1 && (
                <button
                  className="portfolio-tab-remove"
                  onClick={(e) => { e.stopPropagation(); removePortfolio(p.id); }}
                  title="Remove portfolio"
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
        {portfolios.length < MAX_PORTFOLIOS && (
          <button className="portfolio-tab-add" onClick={addPortfolio}>
            + Add Portfolio
          </button>
        )}
      </div>

      {/* ─── Portfolio Builder ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
        {/* Available Assets */}
        <div className="section">
          <div className="section-header">
            <div className="section-title">Available Assets</div>
            <button className="btn btn-secondary btn-sm" onClick={addAllAssets}>
              Add All
            </button>
          </div>
          <input
            className="search-input"
            type="text"
            placeholder="Search by ticker, name, or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ marginBottom: 'var(--space-sm)' }}
          />
          <div className="asset-list">
            {Object.entries(groupedAssets).map(([category, assets]) => (
              <React.Fragment key={category}>
                <div style={{
                  padding: '4px 12px',
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}>
                  {ASSET_CATEGORIES[category] || category}
                </div>
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    className={`asset-item ${selectedIds.has(asset.id) ? 'selected' : ''}`}
                    onClick={() => addAsset(asset)}
                    disabled={selectedIds.has(asset.id)}
                  >
                    <div className="asset-item-left">
                      <span className="asset-ticker">{asset.ticker}</span>
                      <span className="asset-name">{asset.name}</span>
                    </div>
                    {selectedIds.has(asset.id) ? (
                      <span className="badge badge-positive" style={{ fontSize: '0.5625rem' }}>Added</span>
                    ) : (
                      <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>+</span>
                    )}
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Portfolio Weights */}
        <div className="section">
          <div className="section-header">
            <div className="section-title">
              {activePortfolio?.name || 'Portfolio'} Weights
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              {selectedAssets.length > 0 && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={equalizeWeights}>
                    Equalize
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => updateActiveAssets([])}>
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          {selectedAssets.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <div className="empty-state-icon">+</div>
              <p style={{ margin: 0, fontSize: '0.875rem' }}>
                Select assets from the left panel or load a preset
              </p>
            </div>
          ) : (
            <>
              <div className="selected-assets">
                {selectedAssets.map((asset) => (
                  <div key={asset.id} className="weight-row">
                    <span className="weight-row-ticker">{asset.ticker || asset.id}</span>
                    <span className="weight-row-name">{asset.name}</span>
                    <input
                      type="range"
                      className="weight-slider"
                      min="0"
                      max="100"
                      step="0.5"
                      value={asset.weight}
                      onChange={(e) => updateWeight(asset.id, e.target.value)}
                    />
                    <input
                      type="number"
                      className="weight-input"
                      min="0"
                      max="200"
                      step="0.5"
                      value={asset.weight}
                      onChange={(e) => updateWeight(asset.id, e.target.value)}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>%</span>
                    <button className="weight-remove" onClick={() => removeAsset(asset.id)} title="Remove">
                      &times;
                    </button>
                  </div>
                ))}
              </div>

              <div className="weight-total">
                <span>Total Weight</span>
                <span className={`weight-total-value ${
                  Math.abs(totalWeight - 100) < 0.1 ? 'exact' : totalWeight > 100 ? 'over' : 'under'
                }`}>
                  {totalWeight.toFixed(1)}%
                </span>
              </div>

              {totalWeight > 100.1 && (
                <div className="warning-text" style={{ marginTop: 'var(--space-sm)' }}>
                  Portfolio is over-allocated (leveraged). This is intentional for return-stacking strategies.
                </div>
              )}
              {totalWeight < 99.9 && totalWeight > 0 && (
                <div className="info-text" style={{ marginTop: 'var(--space-sm)' }}>
                  Remaining {(100 - totalWeight).toFixed(1)}% will be held as cash.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Settings (Collapsible) ─── */}
      <div className="config-block" style={{ marginBottom: 'var(--space-lg)' }}>
        <div
          className="config-block-title"
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={() => setShowSettings(!showSettings)}
        >
          <span>Simulation Settings</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {simConfig.mode === 'simulated'
              ? `Simulated (${simConfig.nPaths} paths, ${simConfig.nYears}yr)`
              : simConfig.mode === 'actual'
              ? 'Actual (Historical)'
              : simConfig.mode === 'bootstrap'
              ? `Bootstrap MC (${simConfig.nPaths} paths, ${simConfig.nYears}yr)`
              : 'Hybrid'}
            {' '}{showSettings ? '\u25B4' : '\u25BE'}
          </span>
        </div>

        {showSettings && (
          <div style={{ marginTop: 'var(--space-md)' }}>
            <div className="config-grid">
              <div>
                <div className="config-row">
                  <span className="config-label">Return Mode</span>
                  <div className="toggle-group">
                    {['simulated', 'actual', 'hybrid', 'bootstrap'].map((mode) => (
                      <button
                        key={mode}
                        className={`toggle-option ${simConfig.mode === mode ? 'active' : ''}`}
                        onClick={() => updateConfig('mode', mode)}
                      >
                        {mode === 'simulated' ? 'Simulated' : mode === 'actual' ? 'Actual' : mode === 'hybrid' ? 'Hybrid' : 'Bootstrap MC'}
                      </button>
                    ))}
                  </div>
                </div>

                {(simConfig.mode === 'simulated' || simConfig.mode === 'bootstrap') && (
                  <>
                    <div className="config-row">
                      <span className="config-label">Simulation Paths</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <input type="range" min="100" max="5000" step="100" value={simConfig.nPaths}
                          onChange={(e) => updateConfig('nPaths', parseInt(e.target.value))}
                          style={{ width: 100, accentColor: 'var(--text-primary)' }}
                        />
                        <span className="config-value">{simConfig.nPaths}</span>
                      </div>
                    </div>
                    <div className="config-row">
                      <span className="config-label">Time Horizon (years)</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <input type="range" min="5" max="50" step="5" value={simConfig.nYears}
                          onChange={(e) => updateConfig('nYears', parseInt(e.target.value))}
                          style={{ width: 100, accentColor: 'var(--text-primary)' }}
                        />
                        <span className="config-value">{simConfig.nYears}yr</span>
                      </div>
                    </div>
                    {simConfig.mode === 'simulated' && (
                      <div className="config-row">
                        <span className="config-label">Random Seed</span>
                        <input type="number" value={simConfig.seed}
                          onChange={(e) => updateConfig('seed', parseInt(e.target.value) || 42)}
                          style={{ width: 70, textAlign: 'right' }}
                        />
                      </div>
                    )}
                  </>
                )}

                {simConfig.mode === 'actual' && (
                  <div style={{ padding: 'var(--space-sm) 0' }}>
                    <p className="info-text" style={{ margin: 0 }}>
                      Backtests using historical Yahoo Finance data over the common date range.
                    </p>
                  </div>
                )}
                {simConfig.mode === 'hybrid' && (
                  <div style={{ padding: 'var(--space-sm) 0' }}>
                    <p className="info-text" style={{ margin: 0 }}>
                      Actual returns where available; simulated fills conditioned on other assets for gaps.
                    </p>
                  </div>
                )}
                {simConfig.mode === 'bootstrap' && (
                  <div style={{ padding: 'var(--space-sm) 0' }}>
                    <p className="info-text" style={{ margin: 0 }}>
                      Block-bootstrap Monte Carlo: randomly samples 12-month blocks from actual history to generate synthetic paths.
                      Requires fetching historical data first (done automatically).
                    </p>
                  </div>
                )}
              </div>

              {/* Crash Regimes (only for simulated mode) */}
              {simConfig.mode === 'simulated' && (
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
                    Crash Regime Mix
                  </div>
                  <div className="regime-slider-group">
                    {Object.entries(CRISIS_REGIMES).map(([key, regime]) => {
                      const pct = simConfig.regimeWeights[key] || 0;
                      return (
                        <div key={key}>
                          <div className="regime-slider-row">
                            <span className="regime-slider-label">{regime.label}</span>
                            <input type="range" className="regime-slider"
                              min="0" max="100" step="5"
                              value={Math.round(pct)}
                              onChange={(e) => updateRegime(key, e.target.value)}
                            />
                            <span className="regime-slider-value">{Math.round(pct)}%</span>
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: 120, marginBottom: 'var(--space-sm)' }}>
                            {regime.description}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Leverage Acknowledgment ─── */}
      {leveragedPortfoliosNeedingAck.length > 0 && (
        <div className="leverage-ack-block">
          <div className="leverage-ack-title">Leverage Confirmation Required</div>
          <p className="leverage-ack-desc">
            The following portfolio(s) have allocations exceeding 100%, implying margin leverage.
            Leveraged returns will include a borrowing cost (cash rate on the excess allocation).
          </p>
          {leveragedPortfoliosNeedingAck.map((p) => {
            const levInfo = portfolioLeverageInfo[p.id];
            return (
              <label key={p.id} className="leverage-ack-checkbox">
                <input
                  type="checkbox"
                  checked={!!leverageAcknowledged[p.id]}
                  onChange={() => toggleLeverageAck(p.id)}
                />
                <span>
                  <strong>{p.name}</strong> &mdash; {levInfo.totalWeight.toFixed(1)}% allocated ({levInfo.leveragePct.toFixed(1)}% leverage)
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* ─── Run Button ─── */}
      <button
        className={`run-button ${isSimulating ? 'running' : ''}`}
        onClick={onRunSimulation}
        disabled={!anyPortfolioHasAssets || isSimulating || leveragedPortfoliosNeedingAck.length > 0}
        style={{ marginBottom: 'var(--space-xl)' }}
      >
        {isSimulating ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', justifyContent: 'center' }}>
            <span className="spinner" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />
            Running Simulation...
          </span>
        ) : leveragedPortfoliosNeedingAck.length > 0 ? (
          'Acknowledge Leverage to Run Simulation'
        ) : simConfig.mode === 'simulated' ? (
          `Run Monte Carlo (${simConfig.nPaths} paths, ${simConfig.nYears}yr) for ${portfolios.filter((p) => p.assets.length > 0).length} Portfolio(s)`
        ) : simConfig.mode === 'actual' ? (
          `Backtest ${portfolios.filter((p) => p.assets.length > 0).length} Portfolio(s)`
        ) : simConfig.mode === 'bootstrap' ? (
          `Run Bootstrap MC (${simConfig.nPaths} paths, ${simConfig.nYears}yr) for ${portfolios.filter((p) => p.assets.length > 0).length} Portfolio(s)`
        ) : (
          `Run Hybrid for ${portfolios.filter((p) => p.assets.length > 0).length} Portfolio(s)`
        )}
      </button>

      {!anyPortfolioHasAssets && !isSimulating && (
        <p className="info-text" style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
          Add assets and set weights in at least one portfolio to run a simulation
        </p>
      )}

      {/* ─── Results ─── */}
      {hasResults && <ResultsSection resultsArray={resultsArray} simConfig={simConfig} />}
    </div>
  );
}

// ─── Results Section ───

function ResultsSection({ resultsArray, simConfig }) {
  const isBacktest = simConfig.mode === 'actual' || simConfig.mode === 'hybrid';
  const isBootstrap = simConfig.mode === 'bootstrap';
  const isMonteCarlo = simConfig.mode === 'simulated' || isBootstrap;

  if (resultsArray.length === 0) return null;

  // Check for errors
  const errors = resultsArray.filter((r) => r.results?.error);
  if (errors.length > 0) {
    return (
      <div className="card" style={{ color: 'var(--accent-danger)', marginBottom: 'var(--space-md)' }}>
        {errors.map((e) => <div key={e.id}>{e.name}: {e.results.error}</div>)}
      </div>
    );
  }

  if (isMonteCarlo) {
    return <MonteCarloComparison resultsArray={resultsArray} isBootstrap={isBootstrap} />;
  }

  if (isBacktest) {
    return <BacktestComparison resultsArray={resultsArray} />;
  }

  return null;
}

// ─── Monte Carlo Comparison ───

function MonteCarloComparison({ resultsArray, isBootstrap }) {
  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '--');
  const fmtPct = (v, d = 1) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}%` : '--');

  return (
    <div>
      <div className="tab-header" style={{ marginTop: 'var(--space-lg)' }}>
        <div>
          <div className="tab-title">{isBootstrap ? 'Bootstrap Monte Carlo' : 'Monte Carlo'} Results</div>
          <div className="tab-description">
            {resultsArray.length > 1
              ? `Comparing ${resultsArray.length} portfolios`
              : `${resultsArray[0].results.nPaths?.toLocaleString()} paths, ${resultsArray[0].results.nYears} year horizon`}
          </div>
        </div>
      </div>

      {/* Summary comparison table */}
      {resultsArray.length > 1 && (
        <div className="chart-container">
          <div className="chart-title">Portfolio Comparison</div>
          <table>
            <thead>
              <tr>
                <th>Portfolio</th>
                <th>Median CAGR</th>
                <th>5th CAGR</th>
                <th>Volatility</th>
                <th>Max DD</th>
                <th>Sharpe</th>
                <th>Sortino</th>
                <th>Final Wealth</th>
              </tr>
            </thead>
            <tbody>
              {resultsArray.map(({ id, name, results, color }) => (
                <tr key={id}>
                  <td className="text-cell" style={{ fontWeight: 600, color }}>{name}</td>
                  <td style={{ color: results.summary.cagr.median >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
                    {fmtPct(results.summary.cagr.median)}
                  </td>
                  <td>{fmtPct(results.summary.cagr.p5)}</td>
                  <td>{fmt(results.summary.vol.median)}%</td>
                  <td style={{ color: 'var(--status-negative)' }}>-{fmt(results.summary.maxDD.median)}%</td>
                  <td>{fmt(results.summary.sharpe.median, 2)}</td>
                  <td>{fmt(results.summary.sortino.median, 2)}</td>
                  <td>{fmt(results.summary.finalMult.median, 2)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-portfolio details */}
      {resultsArray.map(({ id, name, results, color }) => (
        <MonteCarloDetail key={id} name={name} results={results} color={color} showHeader={resultsArray.length > 1} />
      ))}
    </div>
  );
}

function MonteCarloDetail({ name, results, color, showHeader }) {
  const { percentilePaths, summary, nPaths, nYears, nMonths } = results;

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
        year: yr, base: p5,
        band_5_10: Math.max(0, p10 - p5), band_10_25: Math.max(0, p25 - p10),
        band_25_50: Math.max(0, p50 - p25), band_50_75: Math.max(0, p75 - p50),
        band_75_90: Math.max(0, p90 - p75), band_90_95: Math.max(0, p95 - p90),
        p5, p10, p25, p50, p75, p90, p95,
      });
    }
    const lastYr = data[data.length - 1]?.year;
    if (lastYr !== nYears) {
      const m = nMonths;
      const p5 = percentilePaths.p5[m], p10 = percentilePaths.p10[m], p25 = percentilePaths.p25[m];
      const p50 = percentilePaths.p50[m], p75 = percentilePaths.p75[m], p90 = percentilePaths.p90[m], p95 = percentilePaths.p95[m];
      data.push({
        year: nYears, base: p5,
        band_5_10: Math.max(0, p10 - p5), band_10_25: Math.max(0, p25 - p10),
        band_25_50: Math.max(0, p50 - p25), band_50_75: Math.max(0, p75 - p50),
        band_75_90: Math.max(0, p90 - p75), band_90_95: Math.max(0, p95 - p90),
        p5, p10, p25, p50, p75, p90, p95,
      });
    }
    return data;
  }, [percentilePaths, nMonths, nYears]);

  const distData = useMemo(() => {
    const cagrs = [];
    for (let p = 0; p < results.paths.length; p++) {
      const fm = results.paths[p][nMonths];
      if (fm > 0) cagrs.push((Math.pow(fm, 1 / nYears) - 1) * 100);
    }
    cagrs.sort((a, b) => a - b);
    const min = Math.floor(cagrs[0] || -10);
    const max = Math.ceil(cagrs[cagrs.length - 1] || 30);
    const nBins = 40;
    const binWidth = (max - min) / nBins;
    const bins = [];
    for (let i = 0; i < nBins; i++) {
      const lo = min + i * binWidth;
      const count = cagrs.filter((c) => c >= lo && c < lo + binWidth).length;
      bins.push({ range: `${lo.toFixed(0)}%`, value: lo + binWidth / 2, count, pct: (count / cagrs.length) * 100 });
    }
    return bins;
  }, [results.paths, nMonths, nYears]);

  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '--');
  const fmtPct = (v, d = 1) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}%` : '--');

  return (
    <div>
      {showHeader && (
        <h3 style={{ margin: 'var(--space-lg) 0 var(--space-md)', color, borderBottom: `2px solid ${color}`, paddingBottom: 'var(--space-sm)' }}>
          {name} &mdash; {nPaths.toLocaleString()} paths, {nYears}yr
        </h3>
      )}

      {/* Stats Grid */}
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
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--status-negative)' }}>-{fmt(summary.maxDD.median)}%</div>
          <div className="stat-label">Avg Max Drawdown</div>
          <div className="stat-range">Worst 5%: -{fmt(summary.maxDD.p95)}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.sharpe.median, 2)}</div>
          <div className="stat-label">Median Sharpe</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.sortino.median, 2)}</div>
          <div className="stat-label">Median Sortino</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmt(summary.finalMult.median, 2)}x</div>
          <div className="stat-label">Median Final Wealth</div>
        </div>
      </div>

      {/* Fan Chart */}
      <div className="chart-container">
        <div className="chart-title">Portfolio Growth - Percentile Fan Chart</div>
        <div className="chart-legend">
          <div className="legend-item"><div className="legend-dot" style={{ background: 'rgba(29,155,240,0.15)' }} /> 5th-95th</div>
          <div className="legend-item"><div className="legend-dot" style={{ background: 'rgba(29,155,240,0.25)' }} /> 10th-90th</div>
          <div className="legend-item"><div className="legend-dot" style={{ background: 'rgba(29,155,240,0.4)' }} /> 25th-75th</div>
          <div className="legend-item"><div className="legend-dot" style={{ background: color, width: 16, height: 2, borderRadius: 1 }} /> Median</div>
        </div>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={fanData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="year" tickFormatter={(v) => `${v}y`} fontSize={11} tick={{ fill: '#65676b' }} />
            <YAxis tickFormatter={(v) => `${v.toFixed(1)}x`} fontSize={11} tick={{ fill: '#65676b' }} domain={['auto', 'auto']} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div style={{ background: 'white', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Year {d.year?.toFixed(1)}</div>
                  <div style={{ color: '#65676b' }}>95th: {d.p95?.toFixed(2)}x</div>
                  <div style={{ color: '#65676b' }}>75th: {d.p75?.toFixed(2)}x</div>
                  <div style={{ color, fontWeight: 600 }}>Median: {d.p50?.toFixed(2)}x</div>
                  <div style={{ color: '#65676b' }}>25th: {d.p25?.toFixed(2)}x</div>
                  <div style={{ color: '#65676b' }}>5th: {d.p5?.toFixed(2)}x</div>
                </div>
              );
            }} />
            <ReferenceLine y={1} stroke="rgba(0,0,0,0.2)" strokeDasharray="3 3" />
            <Area type="monotone" dataKey="base" stackId="fan" fill="transparent" stroke="none" />
            <Area type="monotone" dataKey="band_5_10" stackId="fan" fill="rgba(29,155,240,0.08)" stroke="none" />
            <Area type="monotone" dataKey="band_10_25" stackId="fan" fill="rgba(29,155,240,0.13)" stroke="none" />
            <Area type="monotone" dataKey="band_25_50" stackId="fan" fill="rgba(29,155,240,0.22)" stroke="none" />
            <Area type="monotone" dataKey="band_50_75" stackId="fan" fill="rgba(29,155,240,0.22)" stroke="none" />
            <Area type="monotone" dataKey="band_75_90" stackId="fan" fill="rgba(29,155,240,0.13)" stroke="none" />
            <Area type="monotone" dataKey="band_90_95" stackId="fan" fill="rgba(29,155,240,0.08)" stroke="none" />
            <Line type="monotone" dataKey="p50" stroke={color} strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* CAGR Distribution */}
      <div className="chart-container">
        <div className="chart-title">CAGR Distribution</div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={distData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="range" fontSize={10} tick={{ fill: '#65676b' }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} fontSize={10} tick={{ fill: '#65676b' }} />
            <Tooltip formatter={(value) => [`${value.toFixed(1)}%`, 'Frequency']}
              contentStyle={{ background: 'white', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, fontSize: 12 }} />
            <ReferenceLine x={`${Math.round(summary.cagr.median)}%`} stroke={color} strokeWidth={2} />
            <Bar dataKey="pct" fill={`${color}66`} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Percentile Table */}
      <div className="chart-container">
        <div className="chart-title">Detailed Percentile Breakdown</div>
        <table className="percentile-table">
          <thead>
            <tr>
              <th>Metric</th><th>5th</th><th>10th</th><th>25th</th><th>Median</th><th>75th</th><th>90th</th><th>95th</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'CAGR', data: summary.cagr, f: fmtPct },
              { label: 'Volatility', data: summary.vol, f: (v) => `${fmt(v)}%` },
              { label: 'Max Drawdown', data: summary.maxDD, f: (v) => `-${fmt(v)}%` },
              { label: 'Sharpe', data: summary.sharpe, f: (v) => fmt(v, 2) },
              { label: 'Sortino', data: summary.sortino, f: (v) => fmt(v, 2) },
              { label: 'Final Wealth', data: summary.finalMult, f: (v) => `${fmt(v, 2)}x` },
            ].map(({ label, data, f }) => (
              <tr key={label}>
                <td className="text-cell">{label}</td>
                <td>{f(data.p5)}</td><td>{f(data.p10)}</td><td>{f(data.p25)}</td>
                <td style={{ fontWeight: 600 }}>{f(data.median)}</td>
                <td>{f(data.p75)}</td><td>{f(data.p90)}</td><td>{f(data.p95)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Backtest Comparison ───

function BacktestComparison({ resultsArray }) {
  const fmt = (v, d = 1) => (v != null ? v.toFixed(d) : '--');

  // Build combined chart data
  const combinedChartData = useMemo(() => {
    const allDates = new Set();
    for (const { results } of resultsArray) {
      if (results.dates) results.dates.forEach((d) => allDates.add(d));
    }
    const sortedDates = Array.from(allDates).sort();
    return sortedDates.map((date) => {
      const point = { date };
      for (const { id, results } of resultsArray) {
        const idx = results.dates?.indexOf(date);
        if (idx >= 0 && idx < results.path?.length) {
          point[`port_${id}`] = results.path[idx];
        }
      }
      return point;
    });
  }, [resultsArray]);

  return (
    <div>
      <div className="tab-header" style={{ marginTop: 'var(--space-lg)' }}>
        <div>
          <div className="tab-title">Historical Backtest Results</div>
          <div className="tab-description">
            {resultsArray.length > 1 ? `Comparing ${resultsArray.length} portfolios` : ''}
          </div>
        </div>
      </div>

      {/* Comparison Table */}
      {resultsArray.length > 1 && (
        <div className="chart-container">
          <div className="chart-title">Portfolio Comparison</div>
          <table>
            <thead>
              <tr><th>Portfolio</th><th>Period</th><th>CAGR</th><th>Vol</th><th>Max DD</th><th>Sharpe</th><th>Sortino</th><th>Total</th></tr>
            </thead>
            <tbody>
              {resultsArray.map(({ id, name, results, color }) => (
                <tr key={id}>
                  <td className="text-cell" style={{ fontWeight: 600, color }}>{name}</td>
                  <td className="text-cell">{results.stats.startDate} - {results.stats.endDate}</td>
                  <td style={{ color: results.stats.cagr >= 0 ? 'var(--status-positive)' : 'var(--status-negative)' }}>
                    {results.stats.cagr >= 0 ? '+' : ''}{fmt(results.stats.cagr)}%
                  </td>
                  <td>{fmt(results.stats.vol)}%</td>
                  <td style={{ color: 'var(--status-negative)' }}>-{fmt(results.stats.maxDD)}%</td>
                  <td>{fmt(results.stats.sharpe, 2)}</td>
                  <td>{fmt(results.stats.sortino, 2)}</td>
                  <td>{fmt(results.stats.finalMult, 2)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-portfolio stats */}
      {resultsArray.map(({ id, name, results, color }) => {
        const { stats } = results;
        return (
          <div key={id}>
            {resultsArray.length > 1 && (
              <h3 style={{ margin: 'var(--space-lg) 0 var(--space-md)', color, borderBottom: `2px solid ${color}`, paddingBottom: 'var(--space-sm)' }}>
                {name} &mdash; {stats.startDate} to {stats.endDate}
              </h3>
            )}
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
          </div>
        );
      })}

      {/* Combined growth chart */}
      <div className="chart-container">
        <div className="chart-title">Cumulative Portfolio Growth</div>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={combinedChartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
            <XAxis dataKey="date" fontSize={10} tick={{ fill: '#65676b' }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => `${v?.toFixed(1)}x`} fontSize={11} tick={{ fill: '#65676b' }} />
            <Tooltip contentStyle={{ background: 'white', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
            <ReferenceLine y={1} stroke="rgba(0,0,0,0.2)" strokeDasharray="3 3" />
            {resultsArray.map(({ id, name, color }) => (
              <Line key={id} type="monotone" dataKey={`port_${id}`} name={name} stroke={color} strokeWidth={1.5} dot={false} connectNulls />
            ))}
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Data availability for first portfolio */}
      {resultsArray[0]?.results?.dataAvailability && (
        <div className="chart-container">
          <div className="chart-title">Data Availability</div>
          <div className="data-status">
            {Object.entries(resultsArray[0].results.dataAvailability).map(([ticker, info]) => (
              <div key={ticker} className="data-status-row">
                <span className="data-status-ticker">{ticker}</span>
                <span className="data-status-info">
                  {info.available ? `${info.startDate} to ${info.endDate} (${info.totalMonths} months)` : 'No data'}
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

export default SimulatePage;
