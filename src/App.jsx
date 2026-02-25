import React, { useState, useCallback } from 'react';
import Header from './components/Header.jsx';
import Sidebar, { TABS } from './components/Sidebar.jsx';
import PortfolioBuilder from './components/PortfolioBuilder.jsx';
import SimulationConfig from './components/SimulationConfig.jsx';
import ResultsDashboard from './components/ResultsDashboard.jsx';
import ActualReturnsPanel from './components/ActualReturnsPanel.jsx';
import Optimizer from './components/Optimizer.jsx';
import { runMonteCarlo, runBacktest } from './engine/simulation.js';
import { fetchAllReturns } from './data/fetchReturns.js';

function App() {
  const [activeTab, setActiveTab] = useState('portfolio');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isFetchingReturns, setIsFetchingReturns] = useState(false);

  // Portfolio state
  const [selectedAssets, setSelectedAssets] = useState([]);

  // Simulation config
  const [simConfig, setSimConfig] = useState({
    mode: 'simulated',
    nPaths: 1200,
    nYears: 20,
    seed: 42,
    regimeWeights: { standard: 70, inflation: 20, liquidity: 10 },
  });

  // Results
  const [simResults, setSimResults] = useState(null);

  // Actual returns data
  const [returnData, setReturnData] = useState({});
  const [returnMetadata, setReturnMetadata] = useState({});
  const [returnErrors, setReturnErrors] = useState({});

  // Header stats (from most recent simulation)
  const headerStats = simResults && !simResults.error
    ? simConfig.mode === 'simulated'
      ? {
          cagr: simResults.summary?.cagr?.median,
          vol: simResults.summary?.vol?.median,
          maxDD: simResults.summary?.maxDD?.median,
          sharpe: simResults.summary?.sharpe?.median,
        }
      : simResults.stats
        ? {
            cagr: simResults.stats.cagr,
            vol: simResults.stats.vol,
            maxDD: simResults.stats.maxDD,
            sharpe: simResults.stats.sharpe,
          }
        : null
    : null;

  // ─── Run Simulation ───
  const handleRunSimulation = useCallback(async () => {
    if (selectedAssets.length === 0) return;
    setIsSimulating(true);
    setSimResults(null);

    // Use setTimeout to allow UI to update before heavy computation
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      if (simConfig.mode === 'simulated') {
        // Normalize regime weights to 0-1
        const totalRegimeWeight = Object.values(simConfig.regimeWeights).reduce((s, v) => s + v, 0);
        const normalizedRegimes = {};
        for (const [k, v] of Object.entries(simConfig.regimeWeights)) {
          normalizedRegimes[k] = totalRegimeWeight > 0 ? v / totalRegimeWeight : 0;
        }

        const results = runMonteCarlo({
          assets: selectedAssets,
          nPaths: simConfig.nPaths,
          nYears: simConfig.nYears,
          regimeWeights: normalizedRegimes,
          seed: simConfig.seed,
        });
        setSimResults(results);
      } else {
        // Actual or Hybrid mode - need to fetch returns first
        let currentReturnData = returnData;
        if (Object.keys(currentReturnData).length === 0) {
          setIsFetchingReturns(true);
          const { data, metadata, errors } = await fetchAllReturns(selectedAssets);
          currentReturnData = data;
          setReturnData(data);
          setReturnMetadata(metadata);
          setReturnErrors(errors);
          setIsFetchingReturns(false);
        }

        const totalRegimeWeight = Object.values(simConfig.regimeWeights).reduce((s, v) => s + v, 0);
        const normalizedRegimes = {};
        for (const [k, v] of Object.entries(simConfig.regimeWeights)) {
          normalizedRegimes[k] = totalRegimeWeight > 0 ? v / totalRegimeWeight : 0;
        }

        const results = runBacktest({
          assets: selectedAssets,
          returnData: currentReturnData,
          fillMissing: simConfig.mode === 'hybrid',
          regimeWeights: normalizedRegimes,
        });
        setSimResults(results);
      }

      setActiveTab('results');
    } catch (err) {
      console.error('Simulation error:', err);
      setSimResults({ error: err.message });
      setActiveTab('results');
    } finally {
      setIsSimulating(false);
    }
  }, [selectedAssets, simConfig, returnData]);

  // ─── Fetch Returns ───
  const handleFetchReturns = useCallback(async () => {
    if (selectedAssets.length === 0) return;
    setIsFetchingReturns(true);
    try {
      const { data, metadata, errors } = await fetchAllReturns(selectedAssets);
      setReturnData(data);
      setReturnMetadata(metadata);
      setReturnErrors(errors);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setIsFetchingReturns(false);
    }
  }, [selectedAssets]);

  // ─── Render Tab Content ───
  const renderTabContent = () => {
    switch (activeTab) {
      case 'portfolio':
        return (
          <PortfolioBuilder
            selectedAssets={selectedAssets}
            onAssetsChange={setSelectedAssets}
          />
        );
      case 'optimizer':
        return (
          <Optimizer
            returnData={returnData}
            onApplyWeights={(assets) => {
              setSelectedAssets(assets);
              setActiveTab('portfolio');
            }}
          />
        );
      case 'settings':
        return (
          <SimulationConfig
            config={simConfig}
            onConfigChange={setSimConfig}
            onRunSimulation={handleRunSimulation}
            isSimulating={isSimulating}
            selectedAssets={selectedAssets}
          />
        );
      case 'results':
        return (
          <ResultsDashboard
            results={simResults}
            mode={simConfig.mode}
          />
        );
      case 'historical':
        return (
          <ActualReturnsPanel
            selectedAssets={selectedAssets}
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
