import React from 'react';

function Header({ stats, isSimulating }) {
  const formatPct = (v) => {
    if (v == null) return '--';
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  };

  const getColor = (v, invert = false) => {
    if (v == null) return 'var(--text-muted)';
    const isGood = invert ? v < 0 : v > 0;
    return isGood ? 'var(--status-positive)' : v === 0 ? 'var(--text-muted)' : 'var(--status-negative)';
  };

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <div className="logo-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="logo-text">Portfolio Simulator</div>
        </div>

        {stats && (
          <div className="header-stats">
            <div className="header-stat">
              <span className="header-stat-value" style={{ color: getColor(stats.cagr) }}>
                {formatPct(stats.cagr)}
              </span>
              <span className="header-stat-label">Med CAGR</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-value" style={{ color: 'var(--text-primary)' }}>
                {stats.vol != null ? `${stats.vol.toFixed(1)}%` : '--'}
              </span>
              <span className="header-stat-label">Vol</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-value" style={{ color: getColor(stats.maxDD, true) }}>
                {stats.maxDD != null ? `-${stats.maxDD.toFixed(1)}%` : '--'}
              </span>
              <span className="header-stat-label">Max DD</span>
            </div>
            <div className="header-stat">
              <span className="header-stat-value" style={{ color: getColor(stats.sharpe) }}>
                {stats.sharpe != null ? stats.sharpe.toFixed(2) : '--'}
              </span>
              <span className="header-stat-label">Sharpe</span>
            </div>
          </div>
        )}
      </div>

      <div className="header-right">
        <div className={`sim-badge ${isSimulating ? 'running' : ''}`}>
          <span className="sim-badge-dot" />
          <span>{isSimulating ? 'Simulating...' : 'Ready'}</span>
        </div>
      </div>
    </header>
  );
}

export default Header;
