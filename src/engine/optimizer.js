/**
 * Portfolio Optimizer Engine
 *
 * Supports: Max Sharpe, Max CAGR, Max Sortino, Risk Parity, Pareto Frontier
 * Modes: Simulated (analytical from asset class params) or Actual (from historical data)
 */

import { BASE_CLASSES, CLASS_ORDER } from './simulation.js';

// ─── Normal CDF Approximation ───
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327;
  const p =
    d *
    Math.exp(-0.5 * x * x) *
    (t *
      (0.31938153 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return x >= 0 ? 1 - p : p;
}

// ─── Seedable PRNG ───
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Get Effective Return/Volatility for Any Asset ───
// Accounts for leverage, stacking, expense ratios

const NORMAL_CORR_MATRIX = (() => {
  // Import the correlation matrix definition
  const m = [
    [1.0, 0.9, 0.88, 0.8, 0.72, -0.1, -0.25, 0.0, 0.05, 0.15, 0.65, 0.35, 0.3, 0.0, 0.0],
    [0.9, 1.0, 0.82, 0.75, 0.68, -0.12, -0.28, -0.02, 0.02, 0.1, 0.58, 0.4, 0.35, 0.0, 0.0],
    [0.88, 0.82, 1.0, 0.75, 0.7, -0.08, -0.2, 0.02, 0.05, 0.18, 0.7, 0.32, 0.28, 0.0, 0.0],
    [0.8, 0.75, 0.75, 1.0, 0.78, -0.05, -0.18, 0.02, 0.1, 0.2, 0.6, 0.3, 0.25, 0.0, 0.0],
    [0.72, 0.68, 0.7, 0.78, 1.0, -0.02, -0.12, 0.05, 0.12, 0.28, 0.55, 0.32, 0.28, 0.0, 0.0],
    [-0.1, -0.12, -0.08, -0.05, -0.02, 1.0, 0.85, 0.7, 0.15, 0.0, -0.05, -0.1, -0.08, 0.0, 0.0],
    [-0.25, -0.28, -0.2, -0.18, -0.12, 0.85, 1.0, 0.55, 0.18, -0.05, -0.12, -0.12, -0.1, 0.0, 0.0],
    [0.0, -0.02, 0.02, 0.02, 0.05, 0.7, 0.55, 1.0, 0.2, 0.15, 0.02, -0.05, -0.03, 0.0, 0.0],
    [0.05, 0.02, 0.05, 0.1, 0.12, 0.15, 0.18, 0.2, 1.0, 0.25, 0.05, 0.2, 0.15, 0.05, 0.0],
    [0.15, 0.1, 0.18, 0.2, 0.28, 0.0, -0.05, 0.15, 0.25, 1.0, 0.15, 0.15, 0.12, 0.05, 0.0],
    [0.65, 0.58, 0.7, 0.6, 0.55, -0.05, -0.12, 0.02, 0.05, 0.15, 1.0, 0.25, 0.2, 0.0, 0.0],
    [0.35, 0.4, 0.32, 0.3, 0.32, -0.1, -0.12, -0.05, 0.2, 0.15, 0.25, 1.0, 0.85, 0.0, 0.0],
    [0.3, 0.35, 0.28, 0.25, 0.28, -0.08, -0.1, -0.03, 0.15, 0.12, 0.2, 0.85, 1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.05, 0.0, 0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
  ];
  return m;
})();

function getAssetClasses(asset) {
  if (asset.baseClass && !asset.leverage && !asset.stackedComponents) return [asset.baseClass];
  if (asset.leverage && asset.underlying) return [asset.underlying];
  if (asset.stackedComponents && asset.stackedComponents.length > 0) return [...asset.stackedComponents];
  if (asset.baseClass) return [asset.baseClass];
  return ['us_equity'];
}

function getPrimaryClass(asset) {
  return getAssetClasses(asset)[0];
}

export function getEffectiveParams(asset) {
  const rf = 0.04;

  if (asset.baseClass && !asset.leverage && !asset.stackedComponents) {
    const bc = BASE_CLASSES[asset.baseClass];
    if (!bc) return { mu: 0.06, sigma: 0.15 };
    return {
      mu: bc.mu - (asset.expenseRatio || 0),
      sigma: bc.sigma,
    };
  }

  if (asset.leverage && asset.underlying) {
    const bc = BASE_CLASSES[asset.underlying];
    if (!bc) return { mu: 0.06, sigma: 0.15 };
    const L = asset.leverage;
    const betaSlippage = L * bc.sigma * bc.sigma;
    return {
      mu: L * bc.mu - (L - 1) * rf - (asset.expenseRatio || 0) - betaSlippage,
      sigma: L * bc.sigma,
    };
  }

  if (asset.stackedComponents && asset.stackedComponents.length >= 2) {
    const comps = asset.stackedComponents.map((c) => BASE_CLASSES[c]).filter(Boolean);
    if (comps.length < 2) return { mu: 0.06, sigma: 0.15 };

    let mu = -rf - (asset.expenseRatio || 0);
    for (const c of comps) mu += c.mu;

    let variance = 0;
    for (let i = 0; i < comps.length; i++) {
      variance += comps[i].sigma ** 2;
      for (let j = i + 1; j < comps.length; j++) {
        const ci = CLASS_ORDER.indexOf(asset.stackedComponents[i]);
        const cj = CLASS_ORDER.indexOf(asset.stackedComponents[j]);
        const corr = ci >= 0 && cj >= 0 ? NORMAL_CORR_MATRIX[ci][cj] : 0;
        variance += 2 * corr * comps[i].sigma * comps[j].sigma;
      }
    }
    return { mu, sigma: Math.sqrt(Math.max(0, variance)) };
  }

  return { mu: 0.06, sigma: 0.15 };
}

// ─── Correlation Between Two Assets ───

function getClassCorrelation(classA, classB) {
  const idxA = CLASS_ORDER.indexOf(classA);
  const idxB = CLASS_ORDER.indexOf(classB);
  if (idxA >= 0 && idxB >= 0) return NORMAL_CORR_MATRIX[idxA][idxB];
  return classA === classB ? 1.0 : 0.3;
}

// ─── Build Covariance Matrix (Simulated Mode) ───

// Compute covariance between two assets accounting for stacking and leverage
function computeAssetCovariance(assetI, assetJ) {
  const classesI = getAssetClasses(assetI);
  const classesJ = getAssetClasses(assetJ);

  // For stacked products: Cov(A+B, C+D) = Cov(A,C) + Cov(A,D) + Cov(B,C) + Cov(B,D)
  // For leveraged: Cov(L*A, B) = L * Cov(A, B)
  const leverageI = (assetI.leverage && assetI.leverage > 1) ? assetI.leverage : 1;
  const leverageJ = (assetJ.leverage && assetJ.leverage > 1) ? assetJ.leverage : 1;

  let totalCov = 0;
  for (const ci of classesI) {
    const bcI = BASE_CLASSES[ci];
    if (!bcI) continue;
    for (const cj of classesJ) {
      const bcJ = BASE_CLASSES[cj];
      if (!bcJ) continue;
      const corr = getClassCorrelation(ci, cj);
      totalCov += corr * bcI.sigma * bcJ.sigma;
    }
  }

  return totalCov * leverageI * leverageJ;
}

function buildSimCovMatrix(assets) {
  const n = assets.length;
  const params = assets.map(getEffectiveParams);
  const cov = Array.from({ length: n }, () => new Float64Array(n));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = computeAssetCovariance(assets[i], assets[j]);
    }
  }
  return { means: params.map((p) => p.mu), cov };
}

// ─── Build Covariance Matrix (Actual Mode) ───

function buildActualCovMatrix(assets, returnData) {
  const n = assets.length;

  // Find common dates
  const dateSets = assets.map((a) => {
    const d = returnData[a.ticker || a.id];
    return d ? new Set(d.dates) : new Set();
  });

  const allDates = new Set();
  for (const ds of dateSets) for (const d of ds) allDates.add(d);
  const sortedDates = Array.from(allDates).sort();

  // Keep only dates where ALL assets have data
  const commonDates = sortedDates.filter((d) => dateSets.every((ds) => ds.has(d)));
  if (commonDates.length < 12) {
    // Fall back to simulated parameters if insufficient data
    return buildSimCovMatrix(assets);
  }

  // Extract return vectors
  const returnVecs = assets.map((a) => {
    const d = returnData[a.ticker || a.id];
    if (!d) return commonDates.map(() => 0);
    return commonDates.map((date) => {
      const idx = d.dates.indexOf(date);
      return idx >= 0 ? d.returns[idx] : 0;
    });
  });

  const T = commonDates.length;

  // Annualized means
  const means = returnVecs.map((rets) => {
    const sum = rets.reduce((s, r) => s + r, 0);
    return (sum / T) * 12;
  });

  // Annualized covariance
  const monthlyMeans = returnVecs.map((rets) => rets.reduce((s, r) => s + r, 0) / T);
  const cov = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (returnVecs[i][t] - monthlyMeans[i]) * (returnVecs[j][t] - monthlyMeans[j]);
      }
      cov[i][j] = (sum / (T - 1)) * 12;
    }
  }

  return { means, cov, commonDates, nMonths: T };
}

// ─── Portfolio Evaluation ───

function evaluatePortfolio(weights, means, cov, rf = 0.04) {
  const n = weights.length;

  let expectedReturn = 0;
  for (let i = 0; i < n; i++) expectedReturn += weights[i] * means[i];

  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * cov[i][j];
    }
  }

  const vol = Math.sqrt(Math.max(0, variance));
  const excess = expectedReturn - rf;
  const sharpe = vol > 0 ? excess / vol : 0;

  // Geometric return approximation (CAGR)
  const cagr = expectedReturn - 0.5 * variance;

  // Sortino approximation (using semi-deviation for normal distribution)
  let sortino = 0;
  if (vol > 0) {
    const z = excess / vol;
    const probBelow = normalCDF(-z);
    if (probBelow > 0.001) {
      const semiDev = vol * Math.sqrt(probBelow);
      sortino = excess / semiDev;
    } else {
      sortino = sharpe * 3; // Approximate upper bound
    }
  }

  return {
    expectedReturn: expectedReturn * 100,
    cagr: cagr * 100,
    vol: vol * 100,
    sharpe,
    sortino,
    variance,
  };
}

// ─── Random Weight Generation ───

function randomWeights(n, rng, minW = 0, maxW = 1) {
  const weights = new Float64Array(n);

  // Dirichlet-like: generate exponential random variables
  let total = 0;
  for (let i = 0; i < n; i++) {
    weights[i] = -Math.log(Math.max(1e-10, rng()));
    total += weights[i];
  }

  // Normalize to sum to 1
  for (let i = 0; i < n; i++) weights[i] /= total;

  // Apply constraints with iterative projection
  for (let iter = 0; iter < 10; iter++) {
    let needsProjection = false;
    for (let i = 0; i < n; i++) {
      if (weights[i] < minW) {
        weights[i] = minW;
        needsProjection = true;
      }
      if (weights[i] > maxW) {
        weights[i] = maxW;
        needsProjection = true;
      }
    }
    if (!needsProjection) break;
    // Renormalize
    const sum = weights.reduce((s, w) => s + w, 0);
    if (sum > 0) for (let i = 0; i < n; i++) weights[i] /= sum;
  }

  return weights;
}

// ─── Perturbation Around a Point ───

function perturbWeights(base, rng, scale = 0.05, minW = 0, maxW = 1) {
  const n = base.length;
  const weights = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    weights[i] = base[i] + (rng() - 0.5) * 2 * scale;
    weights[i] = Math.max(minW, Math.min(maxW, weights[i]));
  }

  // Renormalize
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum > 0) for (let i = 0; i < n; i++) weights[i] /= sum;

  return weights;
}

// ─── Risk Parity Optimization ───

function riskParityOptimize(cov) {
  const n = cov.length;
  let weights = new Float64Array(n).fill(1 / n);

  for (let iter = 0; iter < 200; iter++) {
    // Compute marginal risk contributions
    const sigmaW = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sigmaW[i] += cov[i][j] * weights[j];
      }
    }

    let portVar = 0;
    for (let i = 0; i < n; i++) portVar += weights[i] * sigmaW[i];
    if (portVar <= 0) break;
    const portVol = Math.sqrt(portVar);

    // Risk contribution: RC_i = w_i * (Sigma*w)_i / portVol
    const rc = new Float64Array(n);
    for (let i = 0; i < n; i++) rc[i] = (weights[i] * sigmaW[i]) / portVol;

    const targetRC = portVol / n;

    // Update weights
    const newWeights = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      newWeights[i] = rc[i] > 0 ? weights[i] * (targetRC / rc[i]) : weights[i];
      newWeights[i] = Math.max(1e-6, newWeights[i]);
      total += newWeights[i];
    }
    for (let i = 0; i < n; i++) weights[i] = newWeights[i] / total;
  }

  return weights;
}

// ─── Single-Objective Optimization ───

function objectiveFunction(weights, means, cov, objective, rf = 0.04) {
  const metrics = evaluatePortfolio(weights, means, cov, rf);
  switch (objective) {
    case 'sharpe':
      return metrics.sharpe;
    case 'cagr':
      return metrics.cagr;
    case 'sortino':
      return metrics.sortino;
    default:
      return metrics.sharpe;
  }
}

function optimizeSingle(assets, means, cov, objective, config = {}) {
  const { nTrials = 30000, nRefine = 10000, minWeight = 0, maxWeight = 1, seed = 42 } = config;
  const rng = mulberry32(seed);
  const n = assets.length;
  const rf = 0.04;

  // Phase 1: Random search
  let bestScore = -Infinity;
  let bestWeights = new Float64Array(n).fill(1 / n);
  const topK = [];

  for (let t = 0; t < nTrials; t++) {
    const w = randomWeights(n, rng, minWeight, maxWeight);
    const score = objectiveFunction(w, means, cov, objective, rf);
    if (score > bestScore) {
      bestScore = score;
      bestWeights = w.slice();
    }
    // Track top 20
    if (topK.length < 20 || score > topK[topK.length - 1].score) {
      topK.push({ score, weights: w.slice() });
      topK.sort((a, b) => b.score - a.score);
      if (topK.length > 20) topK.pop();
    }
  }

  // Phase 2: Refine around top candidates
  const refinePerCandidate = Math.floor(nRefine / Math.min(topK.length, 10));
  for (let k = 0; k < Math.min(topK.length, 10); k++) {
    for (let r = 0; r < refinePerCandidate; r++) {
      const scale = 0.03 * (1 - r / refinePerCandidate) + 0.002;
      const w = perturbWeights(topK[k].weights, rng, scale, minWeight, maxWeight);
      const score = objectiveFunction(w, means, cov, objective, rf);
      if (score > bestScore) {
        bestScore = score;
        bestWeights = w.slice();
      }
    }
  }

  const metrics = evaluatePortfolio(bestWeights, means, cov, rf);
  return { weights: Array.from(bestWeights), metrics, objective };
}

// ─── Efficient Frontier (Pareto) ───

function generateFrontier(assets, means, cov, config = {}) {
  const { nTrials = 50000, minWeight = 0, maxWeight = 1, seed = 42, nPoints = 40 } = config;
  const rng = mulberry32(seed);
  const n = assets.length;
  const rf = 0.04;

  // Generate many random portfolios
  const allPortfolios = [];
  for (let t = 0; t < nTrials; t++) {
    const w = randomWeights(n, rng, minWeight, maxWeight);
    const metrics = evaluatePortfolio(w, means, cov, rf);
    allPortfolios.push({ weights: Array.from(w), ...metrics });
  }

  // Also include equal-weight and risk parity
  const eqW = new Float64Array(n).fill(1 / n);
  const eqMetrics = evaluatePortfolio(eqW, means, cov, rf);
  allPortfolios.push({ weights: Array.from(eqW), ...eqMetrics });

  const rpW = riskParityOptimize(cov);
  const rpMetrics = evaluatePortfolio(rpW, means, cov, rf);
  allPortfolios.push({ weights: Array.from(rpW), ...rpMetrics });

  // Find the efficient frontier: bin by vol, keep max CAGR per bin
  const vols = allPortfolios.map((p) => p.vol);
  const minVol = Math.min(...vols);
  const maxVol = Math.max(...vols);
  const binWidth = (maxVol - minVol) / nPoints;

  const bins = new Array(nPoints).fill(null);
  for (const p of allPortfolios) {
    const binIdx = Math.min(nPoints - 1, Math.floor((p.vol - minVol) / binWidth));
    if (bins[binIdx] === null || p.cagr > bins[binIdx].cagr) {
      bins[binIdx] = p;
    }
  }

  // Extract frontier (upper envelope)
  const frontier = [];
  let maxReturn = -Infinity;
  for (const p of bins.filter(Boolean)) {
    if (p.cagr >= maxReturn - 0.01) {
      frontier.push(p);
      if (p.cagr > maxReturn) maxReturn = p.cagr;
    }
  }

  // Find special portfolios
  let maxSharpePort = frontier[0];
  let minVolPort = frontier[0];
  let maxCagrPort = frontier[0];
  for (const p of frontier) {
    if (p.sharpe > maxSharpePort.sharpe) maxSharpePort = p;
    if (p.vol < minVolPort.vol) minVolPort = p;
    if (p.cagr > maxCagrPort.cagr) maxCagrPort = p;
  }

  // Include the cloud of all portfolios (sampled) for scatter plot
  const cloud = [];
  const cloudStep = Math.max(1, Math.floor(allPortfolios.length / 2000));
  for (let i = 0; i < allPortfolios.length; i += cloudStep) {
    cloud.push({
      vol: allPortfolios[i].vol,
      cagr: allPortfolios[i].cagr,
      sharpe: allPortfolios[i].sharpe,
    });
  }

  return {
    frontier,
    cloud,
    maxSharpe: maxSharpePort,
    minVol: minVolPort,
    maxCagr: maxCagrPort,
    riskParity: { weights: Array.from(rpW), ...rpMetrics },
    equalWeight: { weights: Array.from(eqW), ...eqMetrics },
  };
}

// ─── Main Optimizer Entry Point ───

/**
 * @param {Object} config
 * @param {Array} config.assets - Assets to optimize over
 * @param {string} config.objective - 'sharpe' | 'cagr' | 'sortino' | 'riskParity' | 'pareto'
 * @param {string} config.mode - 'simulated' | 'actual'
 * @param {Object} config.returnData - Historical return data (for actual mode)
 * @param {number} config.minWeight - Min weight per asset (0-1)
 * @param {number} config.maxWeight - Max weight per asset (0-1)
 * @param {number} config.seed
 * @returns {Object} optimization results
 */
export function optimize(config) {
  const {
    assets,
    objective = 'sharpe',
    mode = 'simulated',
    returnData = {},
    minWeight = 0,
    maxWeight = 1,
    seed = 42,
  } = config;

  if (assets.length === 0) return { error: 'No assets selected' };
  if (assets.length === 1) {
    const w = [1];
    const { means, cov } = buildSimCovMatrix(assets);
    const metrics = evaluatePortfolio(w, means, cov);
    return { objective, weights: w, metrics, assets };
  }

  // Build parameters
  const { means, cov } =
    mode === 'actual' && Object.keys(returnData).length > 0
      ? buildActualCovMatrix(assets, returnData)
      : buildSimCovMatrix(assets);

  const optConfig = { minWeight, maxWeight, seed };

  if (objective === 'riskParity') {
    const weights = riskParityOptimize(cov);
    const metrics = evaluatePortfolio(weights, means, cov);
    return {
      objective,
      weights: Array.from(weights),
      metrics,
      assets,
      mode,
    };
  }

  if (objective === 'pareto') {
    const frontierResult = generateFrontier(assets, means, cov, optConfig);
    return {
      objective,
      ...frontierResult,
      assets,
      mode,
    };
  }

  // Single objective optimization
  const result = optimizeSingle(assets, means, cov, objective, optConfig);
  return {
    ...result,
    assets,
    mode,
  };
}

export { buildSimCovMatrix, buildActualCovMatrix, evaluatePortfolio, getClassCorrelation };
