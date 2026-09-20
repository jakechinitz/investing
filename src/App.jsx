import React, { useState, useCallback, useEffect, useRef } from 'react';
import Header from './components/Header.jsx';
import Sidebar, { TABS } from './components/Sidebar.jsx';
import SimulatePage from './components/SimulatePage.jsx';
import ActualReturnsPanel from './components/ActualReturnsPanel.jsx';
import Optimizer from './components/Optimizer.jsx';
import { runMonteCarlo, runBacktest, runBootstrapMonteCarlo } from './engine/simulation.js';
import { fetchAllReturns } from './data/fetchReturns.js';
import { ASSETS, PRESET_PORTFOLIOS, getAsset } from './data/assets.js';

// Fetch order for historical data: assets in the user's portfolios first, then
// preset-portfolio assets, then everything else. Combined with progressive
// rendering this makes the data people actually simulate with land in the
// first few seconds instead of somewhere in an 80-ticker queue.
function prioritizeAssets(all, portfolios) {
  const rank = new Map();
  const bump = (idOrTicker, r) => {
    const a = getAsset(idOrTicker);
    if (a && !rank.has(a.ticker)) rank.set(a.ticker, r);
  };
  for (const p of portfolios) for (const a of p.assets) bump(a.ticker || a.id, 0);
  for (const preset of Object.values(PRESET_PORTFOLIOS)) for (const a of preset.assets) bump(a.id, 1);
  // A prioritized asset's comparable fallback should be fetched just as early
  for (const a of all) if (a.comparable && rank.has(a.ticker)) bump(a.comparable, rank.get(a.ticker));
  return [...all].sort((a, b) => (rank.get(a.ticker) ?? 2) - (rank.get(b.ticker) ?? 2));
}

function App() {
  const [activeTab, setActiveTab] = useState('simulate');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isFetchingReturns, setIsFetchingReturns] = useState(false);

  // Multi-portfolio state
  const [portfolios, setPortfolios] = useState([
    { id: 1, name: 'Portfolio 1', assets: [] },
  ]);
  const [activePortfolioId, setActivePortfolioId] = useState(1);

  // Simulation config
  const [simConfig, setSimConfig] = useState({
    mode: 'simulated',
    nPaths: 1200,
    nYears: 20,
    seed: 42,
    regimeWeights: { standard: 70, inflation: 20, liquidity: 10 },
    rebalanceFreq: 'monthly',
    extendWithHybrid: false,
    bootstrapFillMissing: false,
    customStartDate: '',
    customEndDate: '',
  });

  // Results: map of portfolioId -> results
  const [simResults, setSimResults] = useState({});

  // Actual returns data (shared across everything)
  const [returnData, setReturnData] = useState({});
  const [returnMetadata, setReturnMetadata] = useState({});
  const [returnErrors, setReturnErrors] = useState({});

  // Apply a (possibly partial) batch of fetched return data to state
  const applyReturnBatch = useCallback(({ data, metadata, errors }) => {
    setReturnData(data);
    setReturnMetadata(metadata);
    setReturnErrors(errors);
  }, []);

  // Auto-fetch historical data for ALL assets on mount
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const fetchAll = async () => {
      setIsFetchingReturns(true);
      try {
        // Render progressively: snapshot/cache hits appear instantly, live
        // fetches land one by one instead of waiting for the slowest ticker.
        const final = await fetchAllReturns(prioritizeAssets(ASSETS, portfolios), { onData: applyReturnBatch });
        applyReturnBatch(final);
      } catch (err) {
        console.error('Auto-fetch error:', err);
      } finally {
        setIsFetchingReturns(false);
      }
    };
    fetchAll();
  }, []);

  // Clear results when simulation mode changes to avoid format mismatch crashes
  const prevModeRef = useRef(simConfig.mode);
  useEffect(() => {
    if (prevModeRef.current !== simConfig.mode) {
      setSimResults({});
      prevModeRef.current = simConfig.mode;
    }
  }, [simConfig.mode]);

  // Header stats - detect result format from actual data, not config mode
  const activeResults = simResults[activePortfolioId];
  const headerStats = activeResults && !activeResults.error
    ? activeResults.summary
      ? {
          cagr: activeResults.summary.cagr?.median,
          vol: activeResults.summary.vol?.median,
          maxDD: activeResults.summary.maxDD?.median,
          sharpe: activeResults.summary.sharpe?.median,
        }
      : activeResults.stats
        ? {
            cagr: activeResults.stats.cagr,
            vol: activeResults.stats.vol,
            maxDD: activeResults.stats.maxDD,
            sharpe: activeResults.stats.sharpe,
          }
        : null
    : null;

  // ─── Run Simulation for all populated portfolios ───
  const handleRunSimulation = useCallback(async () => {
    const populatedPortfolios = portfolios.filter(
      (p) => p.assets.length > 0 && p.assets.some((a) => a.weight > 0)
    );
    if (populatedPortfolios.length === 0) return;

    setIsSimulating(true);
    setSimResults({});

    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const results = {};

      for (const portfolio of populatedPortfolios) {
        const totalRegimeWeight = Object.values(simConfig.regimeWeights).reduce((s, v) => s + v, 0);
        const normalizedRegimes = {};
        for (const [k, v] of Object.entries(simConfig.regimeWeights)) {
          normalizedRegimes[k] = totalRegimeWeight > 0 ? v / totalRegimeWeight : 0;
        }

        if (simConfig.mode === 'simulated') {
          results[portfolio.id] = runMonteCarlo({
            assets: portfolio.assets,
            nPaths: simConfig.nPaths,
            nYears: simConfig.nYears,
            regimeWeights: normalizedRegimes,
            seed: simConfig.seed + portfolio.id - 1,
            rebalanceFreq: simConfig.rebalanceFreq,
          });
        } else if (simConfig.mode === 'bootstrap') {
          let currentReturnData = returnData;
          if (Object.keys(currentReturnData).length === 0) {
            setIsFetchingReturns(true);
            const { data, metadata, errors } = await fetchAllReturns(portfolio.assets);
            currentReturnData = data;
            setReturnData(data);
            setReturnMetadata(metadata);
            setReturnErrors(errors);
            setIsFetchingReturns(false);
          }

          results[portfolio.id] = runBootstrapMonteCarlo({
            assets: portfolio.assets,
            returnData: currentReturnData,
            nPaths: simConfig.nPaths,
            nYears: simConfig.nYears,
            blockSize: 12,
            seed: simConfig.seed + portfolio.id - 1,
            fillMissing: simConfig.bootstrapFillMissing,
            regimeWeights: normalizedRegimes,
          });
        } else {
          // Actual or Hybrid
          let currentReturnData = returnData;
          if (Object.keys(currentReturnData).length === 0) {
            setIsFetchingReturns(true);
            const { data, metadata, errors } = await fetchAllReturns(portfolio.assets);
            currentReturnData = data;
            setReturnData(data);
            setReturnMetadata(metadata);
            setReturnErrors(errors);
            setIsFetchingReturns(false);
          }

          // For hybrid mode, always use fillMissing=true
          // For actual mode, use fillMissing if extendWithHybrid is enabled
          const useFillMissing = simConfig.mode === 'hybrid' || simConfig.extendWithHybrid;

          results[portfolio.id] = runBacktest({
            assets: portfolio.assets,
            returnData: currentReturnData,
            fillMissing: useFillMissing,
            regimeWeights: normalizedRegimes,
            rebalanceFreq: simConfig.rebalanceFreq,
            customStartDate: simConfig.customStartDate || null,
            customEndDate: simConfig.customEndDate || null,
            seed: simConfig.seed + portfolio.id - 1,
          });
        }
      }

      setSimResults(results);
    } catch (err) {
      console.error('Simulation error:', err);
      setSimResults({ [populatedPortfolios[0].id]: { error: err.message } });
    } finally {
      setIsSimulating(false);
    }
  }, [portfolios, simConfig, returnData]);

  // ─── Fetch Returns (manual trigger) ───
  const handleFetchReturns = useCallback(async () => {
    setIsFetchingReturns(true);
    try {
      // Manual refresh bypasses the browser cache and re-fetches live,
      // keeping snapshot values as a fallback for anything that fails.
      const final = await fetchAllReturns(prioritizeAssets(ASSETS, portfolios), { onData: applyReturnBatch, forceRefresh: true });
      applyReturnBatch(final);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setIsFetchingReturns(false);
    }
  }, [portfolios, applyReturnBatch]);

  // ─── Apply optimizer weights to a specific portfolio ───
  const handleApplyWeightsToPortfolio = useCallback((assets, portfolioId) => {
    setPortfolios((prev) =>
      prev.map((p) =>
        p.id === portfolioId ? { ...p, assets } : p
      )
    );
    setActivePortfolioId(portfolioId);
    setActiveTab('simulate');
  }, []);

  // ─── Render Tab Content ───
  const renderTabContent = () => {
    switch (activeTab) {
      case 'simulate':
        return (
          <SimulatePage
            portfolios={portfolios}
            activePortfolioId={activePortfolioId}
            onPortfoliosChange={setPortfolios}
            onActivePortfolioChange={setActivePortfolioId}
            simConfig={simConfig}
            onConfigChange={setSimConfig}
            onRunSimulation={handleRunSimulation}
            isSimulating={isSimulating}
            simResults={simResults}
            returnData={returnData}
          />
        );
      case 'optimizer':
        return (
          <Optimizer
            returnData={returnData}
            portfolios={portfolios}
            onApplyWeightsToPortfolio={handleApplyWeightsToPortfolio}
          />
        );
      case 'historical':
        return (
          <ActualReturnsPanel
            returnData={returnData}
            metadata={returnMetadata}
            errors={returnErrors}
            onFetchReturns={handleFetchReturns}
            isFetching={isFetchingReturns}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Header stats={headerStats} isSimulating={isSimulating} />

      <div className="app-layout">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="main-content">
          <div className="tab-content">
            {renderTabContent()}
          </div>
        </main>
      </div>

      {/* Mobile tab bar */}
      <div className="mobile-tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`mobile-tab-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="mobile-tab-icon">{tab.icon}</span>
            <span className="mobile-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
