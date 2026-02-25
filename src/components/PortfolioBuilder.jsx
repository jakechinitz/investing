import React, { useState, useMemo } from 'react';
import { ASSETS, ASSET_CATEGORIES, searchAssets, PRESET_PORTFOLIOS, getAsset } from '../data/assets.js';

function PortfolioBuilder({ selectedAssets, onAssetsChange }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showPresets, setShowPresets] = useState(false);

  const filteredAssets = useMemo(() => searchAssets(searchQuery), [searchQuery]);
  const selectedIds = new Set(selectedAssets.map((a) => a.id));
  const totalWeight = selectedAssets.reduce((sum, a) => sum + a.weight, 0);

  const addAsset = (asset) => {
    if (selectedIds.has(asset.id)) return;
    onAssetsChange([...selectedAssets, { ...asset, weight: 0 }]);
  };

  const removeAsset = (id) => {
    onAssetsChange(selectedAssets.filter((a) => a.id !== id));
  };

  const updateWeight = (id, weight) => {
    const w = Math.max(0, Math.min(100, parseFloat(weight) || 0));
    onAssetsChange(selectedAssets.map((a) => (a.id === id ? { ...a, weight: w } : a)));
  };

  const loadPreset = (presetKey) => {
    const preset = PRESET_PORTFOLIOS[presetKey];
    if (!preset) return;
    const newAssets = preset.assets.map((pa) => {
      const def = getAsset(pa.id);
      return def ? { ...def, weight: pa.weight } : null;
    }).filter(Boolean);
    onAssetsChange(newAssets);
    setShowPresets(false);
  };

  const equalizeWeights = () => {
    if (selectedAssets.length === 0) return;
    const w = Math.round((100 / selectedAssets.length) * 100) / 100;
    onAssetsChange(selectedAssets.map((a) => ({ ...a, weight: w })));
  };

  // Group filtered assets by category
  const groupedAssets = useMemo(() => {
    const groups = {};
    for (const asset of filteredAssets) {
      const cat = asset.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(asset);
    }
    return groups;
  }, [filteredAssets]);

  return (
    <div className="fade-in">
      <div className="tab-header">
        <div>
          <div className="tab-title">Portfolio Builder</div>
          <div className="tab-description">Select assets and assign weights for your portfolio</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowPresets(!showPresets)}>
            {showPresets ? 'Hide Presets' : 'Presets'}
          </button>
          {selectedAssets.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={equalizeWeights}>
              Equalize
            </button>
          )}
        </div>
      </div>

      {/* Preset Portfolios */}
      {showPresets && (
        <div className="section">
          <div className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Preset Portfolios</div>
          <div className="preset-grid">
            {Object.entries(PRESET_PORTFOLIOS).map(([key, preset]) => (
              <button key={key} className="preset-card" onClick={() => loadPreset(key)}>
                <div className="preset-card-name">{preset.name}</div>
                <div className="preset-card-desc">{preset.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
        {/* Asset Search */}
        <div className="section">
          <div className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Available Assets</div>
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

        {/* Selected Assets & Weights */}
        <div className="section">
          <div className="section-header">
            <div className="section-title">Portfolio Weights</div>
            {selectedAssets.length > 0 && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => onAssetsChange([])}
              >
                Clear All
              </button>
            )}
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
                      max="100"
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
                  Portfolio is under-allocated. Remaining {(100 - totalWeight).toFixed(1)}% will be held as cash.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PortfolioBuilder;
