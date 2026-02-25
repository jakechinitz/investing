import React from 'react';

const TABS = [
  { id: 'portfolio', icon: '\u{1F4CA}', label: 'Portfolio' },
  { id: 'settings', icon: '\u{2699}\uFE0F', label: 'Settings' },
  { id: 'results', icon: '\u{1F4C8}', label: 'Results' },
  { id: 'historical', icon: '\u{1F4DC}', label: 'Historical' },
];

function Sidebar({ activeTab, onTabChange }) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="sidebar-item-icon">{tab.icon}</span>
            <span className="sidebar-item-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <div className="sidebar-divider" />
        <div style={{ padding: '8px 12px', margin: '0 8px 12px' }}>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Monte Carlo Engine</span>
            <span>Fat-tailed + Regime-aware</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export { TABS };
export default Sidebar;
