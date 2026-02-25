import React from 'react';
import { CRISIS_REGIMES } from '../engine/simulation.js';

function SimulationConfig({
  config,
  onConfigChange,
  onRunSimulation,
  isSimulating,
  selectedAssets,
}) {
  const totalWeight = selectedAssets.reduce((sum, a) => sum + a.weight, 0);
  const canRun = selectedAssets.length > 0 && totalWeight > 0 && !isSimulating;

  const updateConfig = (key, value) => {
    onConfigChange({ ...config, [key]: value });
  };

  const updateRegime = (regime, value) => {
    const val = parseFloat(value) || 0;
    const newWeights = { ...config.regimeWeights, [regime]: val };

    // Normalize: adjust other weights proportionally
    const others = Object.keys(newWeights).filter((k) => k !== regime);
    const otherSum = others.reduce((s, k) => s + newWeights[k], 0);
    const remaining = Math.max(0, 100 - val);

    if (otherSum > 0) {
      for (const k of others) {
        newWeights[k] = (newWeights[k] / otherSum) * remaining;
      }
    } else {
      // Distribute equally
      for (const k of others) {
        newWeights[k] = remaining / others.length;
      }
    }

    updateConfig('regimeWeights', newWeights);
  };

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Simulation Settings</div>
          <div className="tab-description">Configure Monte Carlo parameters and crash regimes</div>
        </div>
      </div>

      <div className="config-grid">
        {/* Simulation Parameters */}
        <div className="config-block">
          <div className="config-block-title">Parameters</div>

          <div className="config-row">
            <span className="config-label">Return Mode</span>
            <div className="toggle-group">
              <button
                className={`toggle-option ${config.mode === 'simulated' ? 'active' : ''}`}
                onClick={() => updateConfig('mode', 'simulated')}
              >
                Simulated
              </button>
              <button
                className={`toggle-option ${config.mode === 'actual' ? 'active' : ''}`}
                onClick={() => updateConfig('mode', 'actual')}
              >
                Actual
              </button>
              <button
                className={`toggle-option ${config.mode === 'hybrid' ? 'active' : ''}`}
                onClick={() => updateConfig('mode', 'hybrid')}
              >
                Hybrid
              </button>
            </div>
          </div>

          {config.mode === 'simulated' && (
            <>
              <div className="config-row">
                <span className="config-label">Simulation Paths</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <input
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                    value={config.nPaths}
                    onChange={(e) => updateConfig('nPaths', parseInt(e.target.value))}
                    style={{ width: 100, accentColor: 'var(--text-primary)' }}
                  />
                  <span className="config-value">{config.nPaths}</span>
                </div>
              </div>

              <div className="config-row">
                <span className="config-label">Time Horizon (years)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="5"
                    value={config.nYears}
                    onChange={(e) => updateConfig('nYears', parseInt(e.target.value))}
                    style={{ width: 100, accentColor: 'var(--text-primary)' }}
                  />
                  <span className="config-value">{config.nYears}yr</span>
                </div>
              </div>

              <div className="config-row">
                <span className="config-label">Random Seed</span>
                <input
                  type="number"
                  value={config.seed}
                  onChange={(e) => updateConfig('seed', parseInt(e.target.value) || 42)}
                  style={{ width: 70, textAlign: 'right' }}
                />
              </div>
            </>
          )}

          {config.mode === 'actual' && (
            <div style={{ padding: 'var(--space-sm) 0' }}>
              <p className="info-text" style={{ margin: 0 }}>
                Uses historical return data from Yahoo Finance. Portfolio will be backtested over the common
                available date range.
              </p>
            </div>
          )}

          {config.mode === 'hybrid' && (
            <>
              <div style={{ padding: 'var(--space-sm) 0' }}>
                <p className="info-text" style={{ margin: 0 }}>
                  Uses actual returns where available, with simulated fills for assets with shorter history.
                  Simulated fills are conditioned on other assets' actual performance.
                </p>
              </div>
              <div className="config-row">
                <span className="config-label">Simulation Paths (for fills)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <input
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                    value={config.nPaths}
                    onChange={(e) => updateConfig('nPaths', parseInt(e.target.value))}
                    style={{ width: 100, accentColor: 'var(--text-primary)' }}
                  />
                  <span className="config-value">{config.nPaths}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Crash Regimes */}
        <div className="config-block">
          <div className="config-block-title">Crash Regime Mix</div>
          <p className="info-text" style={{ marginBottom: 'var(--space-md)' }}>
            Define the probability-weighted mix of crisis behaviors. These affect how assets correlate
            and perform during market crashes.
          </p>

          <div className="regime-slider-group">
            {Object.entries(CRISIS_REGIMES).map(([key, regime]) => {
              const pct = config.regimeWeights[key] || 0;
              return (
                <div key={key}>
                  <div className="regime-slider-row">
                    <span className="regime-slider-label">{regime.label}</span>
                    <input
                      type="range"
                      className="regime-slider"
                      min="0"
                      max="100"
                      step="5"
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
      </div>

      {/* Run Button */}
      <button
        className={`run-button ${isSimulating ? 'running' : ''}`}
        onClick={onRunSimulation}
        disabled={!canRun}
      >
        {isSimulating ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', justifyContent: 'center' }}>
            <span className="spinner" style={{ borderTopColor: 'white', borderColor: 'rgba(255,255,255,0.3)' }} />
            Running Simulation...
          </span>
        ) : config.mode === 'simulated' ? (
          `Run Monte Carlo (${config.nPaths} paths, ${config.nYears}yr)`
        ) : config.mode === 'actual' ? (
          'Fetch & Backtest Historical Returns'
        ) : (
          'Run Hybrid Backtest + Simulation'
        )}
      </button>

      {!canRun && !isSimulating && selectedAssets.length === 0 && (
        <p className="info-text" style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
          Add assets in the Portfolio tab first
        </p>
      )}
    </div>
  );
}

export default SimulationConfig;
