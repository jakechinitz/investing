/**
 * Monte Carlo Portfolio Simulation Engine
 *
 * Generates correlated fat-tailed return paths with:
 * - Student-t distributions for fat tails
 * - Volatility clustering (GARCH-like dynamics)
 * - Regime-dependent crisis behavior
 * - Leveraged product modeling (with beta slippage)
 * - Return-stacked product modeling (RSST, RSSB)
 * - Conditional simulation for filling missing history
 */

// ─── Seedable PRNG (Mulberry32) ───
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Random Distributions ───
function randn(rng) {
  let u, v, s;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

function gammaVariate(rng, shape) {
  // Marsaglia and Tsang's method for shape >= 1
  if (shape < 1) {
    return gammaVariate(rng, shape + 1) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      x = randn(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function studentT(rng, df) {
  if (df == null || df > 60) return randn(rng);
  const z = randn(rng);
  const chi2 = gammaVariate(rng, df / 2) * 2;
  const scaleFactor = Math.sqrt((df - 2) / df);
  return (z / Math.sqrt(chi2 / df)) * scaleFactor;
}

// ─── Cholesky Decomposition ───
function cholesky(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const val = matrix[i][i] - sum;
        L[i][j] = val > 0 ? Math.sqrt(val) : 0;
      } else {
        L[i][j] = L[j][j] > 0 ? (matrix[i][j] - sum) / L[j][j] : 0;
      }
    }
  }
  return L;
}

// ─── Base Asset Class Definitions ───
// mu = arithmetic expected return (must exceed target CAGR by ~sigma²/2 + crisis drag)
// Historical CAGR targets: SPY ~10%, QQQ ~12%, bonds ~4%, gold ~6%
const BASE_CLASSES = {
  us_equity: { mu: 0.115, sigma: 0.16, dfT: 8, crisisVol: 0.28, clusterMult: 1.15, clusterCap: 1.8 },
  us_tech: { mu: 0.14, sigma: 0.20, dfT: 7, crisisVol: 0.34, clusterMult: 1.15, clusterCap: 1.8 },
  us_small_cap: { mu: 0.13, sigma: 0.20, dfT: 7, crisisVol: 0.32, clusterMult: 1.15, clusterCap: 1.8 },
  intl_developed: { mu: 0.095, sigma: 0.17, dfT: 8, crisisVol: 0.26, clusterMult: 1.1, clusterCap: 1.6 },
  intl_emerging: { mu: 0.11, sigma: 0.22, dfT: 6, crisisVol: 0.32, clusterMult: 1.15, clusterCap: 1.8 },
  us_aggregate_bond: { mu: 0.045, sigma: 0.06, dfT: 20, crisisVol: 0.09, clusterMult: 1.05, clusterCap: 1.4 },
  us_long_treasury: { mu: 0.05, sigma: 0.15, dfT: 15, crisisVol: 0.20, clusterMult: 1.08, clusterCap: 1.6 },
  tips: { mu: 0.04, sigma: 0.06, dfT: 20, crisisVol: 0.08, clusterMult: 1.05, clusterCap: 1.4 },
  gold: { mu: 0.065, sigma: 0.15, dfT: 10, crisisVol: 0.20, clusterMult: 1.08, clusterCap: 1.5 },
  commodities: { mu: 0.045, sigma: 0.18, dfT: 7, crisisVol: 0.26, clusterMult: 1.1, clusterCap: 1.6 },
  real_estate: { mu: 0.10, sigma: 0.20, dfT: 8, crisisVol: 0.28, clusterMult: 1.15, clusterCap: 1.8 },
  crypto_major: { mu: 0.25, sigma: 0.60, dfT: 5, crisisVol: 0.80, clusterMult: 1.2, clusterCap: 2.0 },
  crypto_alt: { mu: 0.20, sigma: 0.75, dfT: 4, crisisVol: 0.90, clusterMult: 1.2, clusterCap: 2.0 },
  managed_futures: { mu: 0.06, sigma: 0.12, dfT: 15, crisisVol: 0.16, clusterMult: 1.05, clusterCap: 1.4 },
  cash: { mu: 0.04, sigma: 0.005, dfT: null, crisisVol: 0.005, clusterMult: 1.0, clusterCap: 1.0 },
};

// ─── Normal-Regime Correlation Matrix ───
// Order: us_equity, us_tech, us_small_cap, intl_developed, intl_emerging,
//        us_aggregate_bond, us_long_treasury, tips, gold, commodities,
//        real_estate, crypto_major, crypto_alt, managed_futures, cash
const CLASS_ORDER = [
  'us_equity', 'us_tech', 'us_small_cap', 'intl_developed', 'intl_emerging',
  'us_aggregate_bond', 'us_long_treasury', 'tips', 'gold', 'commodities',
  'real_estate', 'crypto_major', 'crypto_alt', 'managed_futures', 'cash',
];

const NORMAL_CORR = [
  // us_eq  tech   small  intl   em     agg    tlt    tips   gold   comm   reit   btc    altc   trend  cash
  [1.00,  0.90,  0.88,  0.80,  0.72,  -0.10, -0.25, 0.00,  0.05,  0.15,  0.65,  0.35,  0.30,  0.00,  0.00],  // us_equity
  [0.90,  1.00,  0.82,  0.75,  0.68,  -0.12, -0.28, -0.02, 0.02,  0.10,  0.58,  0.40,  0.35,  0.00,  0.00],  // us_tech
  [0.88,  0.82,  1.00,  0.75,  0.70,  -0.08, -0.20, 0.02,  0.05,  0.18,  0.70,  0.32,  0.28,  0.00,  0.00],  // us_small_cap
  [0.80,  0.75,  0.75,  1.00,  0.78,  -0.05, -0.18, 0.02,  0.10,  0.20,  0.60,  0.30,  0.25,  0.00,  0.00],  // intl_developed
  [0.72,  0.68,  0.70,  0.78,  1.00,  -0.02, -0.12, 0.05,  0.12,  0.28,  0.55,  0.32,  0.28,  0.00,  0.00],  // intl_emerging
  [-0.10, -0.12, -0.08, -0.05, -0.02, 1.00,  0.85,  0.70,  0.15,  0.00,  -0.05, -0.10, -0.08, 0.00,  0.00],  // us_agg_bond
  [-0.25, -0.28, -0.20, -0.18, -0.12, 0.85,  1.00,  0.55,  0.18,  -0.05, -0.12, -0.12, -0.10, 0.00,  0.00],  // us_long_treasury
  [0.00,  -0.02, 0.02,  0.02,  0.05,  0.70,  0.55,  1.00,  0.20,  0.15,  0.02,  -0.05, -0.03, 0.00,  0.00],  // tips
  [0.05,  0.02,  0.05,  0.10,  0.12,  0.15,  0.18,  0.20,  1.00,  0.25,  0.05,  0.20,  0.15,  0.05,  0.00],  // gold
  [0.15,  0.10,  0.18,  0.20,  0.28,  0.00,  -0.05, 0.15,  0.25,  1.00,  0.15,  0.15,  0.12,  0.05,  0.00],  // commodities
  [0.65,  0.58,  0.70,  0.60,  0.55,  -0.05, -0.12, 0.02,  0.05,  0.15,  1.00,  0.25,  0.20,  0.00,  0.00],  // real_estate
  [0.35,  0.40,  0.32,  0.30,  0.32,  -0.10, -0.12, -0.05, 0.20,  0.15,  0.25,  1.00,  0.85,  0.00,  0.00],  // crypto_major
  [0.30,  0.35,  0.28,  0.25,  0.28,  -0.08, -0.10, -0.03, 0.15,  0.12,  0.20,  0.85,  1.00,  0.00,  0.00],  // crypto_alt
  [0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.05,  0.05,  0.00,  0.00,  0.00,  1.00,  0.00],  // managed_futures
  [0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  1.00],  // cash
];

// ─── Crisis Regime Definitions ───
const CRISIS_REGIMES = {
  standard: {
    label: 'Standard (Deflationary)',
    description: 'Stocks crash, bonds rally, gold flat, trend positive',
    corrAdjust: {
      // During standard crisis: stocks drop, bonds become more negatively correlated (flight to safety)
      equityBondCorr: -0.45,
      equityGoldCorr: 0.10,
      equityTrendCorr: -0.15,
      bondReturnBoost: 0.035,   // Bonds rally in deflationary crisis (base 4.5% + 3.5% = 8%)
      goldReturnBoost: 0.02,
      trendReturnBoost: 0.10,
      cashRateOverride: 0.005,
    },
  },
  inflation: {
    label: 'Inflationary',
    description: 'Stocks crash, bonds crash, gold rallies, trend positive',
    corrAdjust: {
      equityBondCorr: 0.60,     // Stocks and bonds fall together
      equityGoldCorr: -0.15,    // Gold diverges from stocks
      equityTrendCorr: -0.15,
      bondReturnBoost: -0.15,   // Bonds crash
      goldReturnBoost: 0.12,    // Gold rallies
      trendReturnBoost: 0.10,
      cashRateOverride: 0.05,
    },
  },
  liquidity: {
    label: 'Liquidity Crisis',
    description: 'Everything correlated, everything drops except cash',
    corrAdjust: {
      equityBondCorr: 0.40,
      equityGoldCorr: 0.35,
      equityTrendCorr: 0.20,
      bondReturnBoost: -0.08,
      goldReturnBoost: -0.05,
      trendReturnBoost: 0.02,
      cashRateOverride: 0.00,
    },
  },
};

// ─── Build Sub-Correlation Matrix ───
function buildCorrelationMatrix(classIndices, regime, regimeWeights) {
  const n = classIndices.length;
  const matrix = Array.from({ length: n }, () => new Float64Array(n));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1.0;
      } else {
        matrix[i][j] = NORMAL_CORR[classIndices[i]][classIndices[j]];
      }
    }
  }

  // Apply crisis correlation adjustments (blended across regimes)
  if (regime === 'crisis' && regimeWeights) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const classI = CLASS_ORDER[classIndices[i]];
        const classJ = CLASS_ORDER[classIndices[j]];
        let corrAdj = 0;

        for (const [regimeName, weight] of Object.entries(regimeWeights)) {
          if (weight <= 0) continue;
          const r = CRISIS_REGIMES[regimeName];
          if (!r) continue;

          const isEquityI = isEquityClass(classI);
          const isEquityJ = isEquityClass(classJ);
          const isBondI = isBondClass(classI);
          const isBondJ = isBondClass(classJ);
          const isGoldI = classI === 'gold';
          const isGoldJ = classJ === 'gold';
          const isTrendI = classI === 'managed_futures';
          const isTrendJ = classJ === 'managed_futures';

          if ((isEquityI && isBondJ) || (isBondI && isEquityJ)) {
            corrAdj += weight * (r.corrAdjust.equityBondCorr - matrix[i][j]);
          } else if ((isEquityI && isGoldJ) || (isGoldI && isEquityJ)) {
            corrAdj += weight * (r.corrAdjust.equityGoldCorr - matrix[i][j]);
          } else if ((isEquityI && isTrendJ) || (isTrendI && isEquityJ)) {
            corrAdj += weight * (r.corrAdjust.equityTrendCorr - matrix[i][j]);
          } else if (isEquityI && isEquityJ) {
            // Equity correlations increase in crisis
            corrAdj += weight * Math.min(0.15, 0.95 - matrix[i][j]);
          }
        }

        matrix[i][j] += corrAdj;
        matrix[j][i] += corrAdj;
        // Clamp
        matrix[i][j] = Math.max(-0.99, Math.min(0.99, matrix[i][j]));
        matrix[j][i] = matrix[i][j];
      }
    }
  }

  return matrix;
}

function isEquityClass(cls) {
  return ['us_equity', 'us_tech', 'us_small_cap', 'intl_developed', 'intl_emerging', 'real_estate'].includes(cls);
}

function isBondClass(cls) {
  return ['us_aggregate_bond', 'us_long_treasury', 'tips'].includes(cls);
}

// ─── Blended Regime Parameters ───
function getBlendedCrisisParams(regimeWeights) {
  const params = { bondBoost: 0, goldBoost: 0, trendBoost: 0, cashRate: 0 };
  let totalWeight = 0;
  for (const [name, weight] of Object.entries(regimeWeights)) {
    if (weight <= 0 || !CRISIS_REGIMES[name]) continue;
    const r = CRISIS_REGIMES[name].corrAdjust;
    params.bondBoost += weight * r.bondReturnBoost;
    params.goldBoost += weight * r.goldReturnBoost;
    params.trendBoost += weight * r.trendReturnBoost;
    params.cashRate += weight * r.cashRateOverride;
    totalWeight += weight;
  }
  if (totalWeight > 0) {
    params.bondBoost /= totalWeight;
    params.goldBoost /= totalWeight;
    params.trendBoost /= totalWeight;
    params.cashRate /= totalWeight;
  }
  return params;
}

// ─── Main Simulation ───

/**
 * Run Monte Carlo simulation
 * @param {Object} config
 * @param {Array<Object>} config.assets - [{id, ticker, weight, baseClass, leverage, underlying, stackedComponents, expenseRatio}]
 * @param {number} config.nPaths - Number of simulation paths (default 1200)
 * @param {number} config.nYears - Simulation horizon in years (default 20)
 * @param {Object} config.regimeWeights - {standard: 0.7, inflation: 0.3, liquidity: 0.0} (must sum to 1)
 * @param {number} config.seed - Random seed (default 42)
 * @returns {Object} results
 */
const REBAL_PERIODS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

export function runMonteCarlo(config) {
  const {
    assets,
    nPaths = 1200,
    nYears = 20,
    regimeWeights = { standard: 1.0, inflation: 0.0, liquidity: 0.0 },
    seed = 42,
    rebalanceFreq = 'monthly',
  } = config;

  const rng = mulberry32(seed);
  const nMonths = nYears * 12;
  const dt = 1 / 12;

  // Determine unique base classes needed
  const baseClassSet = new Set();
  for (const asset of assets) {
    if (asset.baseClass) baseClassSet.add(asset.baseClass);
    if (asset.underlying) baseClassSet.add(asset.underlying);
    if (asset.stackedComponents) {
      for (const c of asset.stackedComponents) baseClassSet.add(c);
    }
  }
  baseClassSet.add('cash'); // Always need cash for borrowing costs
  const baseClasses = Array.from(baseClassSet);
  const classIndices = baseClasses.map((c) => CLASS_ORDER.indexOf(c));

  // Pre-compute Cholesky matrices
  const normalCorr = buildCorrelationMatrix(classIndices, 'normal', null);
  const crisisCorr = buildCorrelationMatrix(classIndices, 'crisis', regimeWeights);
  const L_normal = cholesky(normalCorr);
  const L_crisis = cholesky(crisisCorr);

  // Get crisis params
  const crisisParams = getBlendedCrisisParams(regimeWeights);

  const N = baseClasses.length;

  // Compute total portfolio weight for leverage/cash handling
  const totalWeightPct = assets.reduce((sum, a) => sum + a.weight, 0);
  const weightFraction = totalWeightPct / 100; // e.g., 1.5 for 150% allocation

  // Storage for all paths
  const allPaths = new Array(nPaths);
  const allStats = {
    finalMult: new Float64Array(nPaths),
    cagr: new Float64Array(nPaths),
    vol: new Float64Array(nPaths),
    maxDD: new Float64Array(nPaths),
    sharpe: new Float64Array(nPaths),
    sortino: new Float64Array(nPaths),
  };

  const rebalPeriod = REBAL_PERIODS[rebalanceFreq] || 1;

  for (let p = 0; p < nPaths; p++) {
    const path = new Float64Array(nMonths + 1);
    path[0] = 1.0;
    const portMonthlyRets = new Float64Array(nMonths);

    // Volatility state per base class
    const currentVols = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const bc = BASE_CLASSES[baseClasses[i]];
      currentVols[i] = bc.sigma * Math.sqrt(dt);
    }

    let crisisTimer = 0;

    // Rebalance tracking: cumulative growth per asset since last rebalance
    let assetCumGrowth = assets.map(() => 1.0);

    for (let m = 0; m < nMonths; m++) {
      if (path[m] <= 0) {
        path[m] = 0;
        for (let rm = m; rm <= nMonths; rm++) path[rm] = 0;
        break;
      }

      // Rebalance: reset drift weights to target
      if (rebalPeriod <= 1 || m === 0 || m % rebalPeriod === 0) {
        assetCumGrowth = assets.map(() => 1.0);
      }

      const inCrisis = crisisTimer > 0;
      const choleskyL = inCrisis ? L_crisis : L_normal;

      // Generate independent random draws
      const z = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const bc = BASE_CLASSES[baseClasses[i]];
        z[i] = studentT(rng, bc.dfT);
      }

      // Apply correlation via Cholesky
      const correlated = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let j = 0; j <= i; j++) {
          sum += choleskyL[i][j] * z[j];
        }
        correlated[i] = sum;
      }

      // Compute base class returns
      const baseReturns = {};
      const cashRate = inCrisis ? crisisParams.cashRate : BASE_CLASSES.cash.mu;
      const cashReturn = cashRate * dt;

      for (let i = 0; i < N; i++) {
        const className = baseClasses[i];
        const bc = BASE_CLASSES[className];

        if (className === 'cash') {
          baseReturns[className] = cashReturn;
          continue;
        }

        let vol = currentVols[i];
        let mu = bc.mu;

        // In crisis, apply regime-specific adjustments
        if (inCrisis) {
          vol = Math.max(vol, bc.crisisVol * Math.sqrt(dt));
          if (isBondClass(className)) {
            mu = bc.mu + crisisParams.bondBoost;
          } else if (className === 'gold') {
            mu = bc.mu + crisisParams.goldBoost;
          } else if (className === 'managed_futures') {
            mu = bc.mu + crisisParams.trendBoost;
          }
        }

        let ret = mu * dt + correlated[i] * vol;
        ret = Math.max(ret, -0.90);
        baseReturns[className] = ret;

        // Volatility clustering
        if (ret < -0.10) {
          currentVols[i] = Math.min(
            currentVols[i] * bc.clusterMult,
            bc.sigma * Math.sqrt(dt) * bc.clusterCap
          );
        } else {
          currentVols[i] = currentVols[i] * 0.85 + bc.sigma * Math.sqrt(dt) * 0.15;
        }
      }

      // Crisis detection: any equity class drops > 10% in a month
      let equityCrash = false;
      for (const cls of baseClasses) {
        if (isEquityClass(cls) && baseReturns[cls] < -0.10) {
          equityCrash = true;
          break;
        }
      }
      if (equityCrash) {
        crisisTimer = 6;
      } else if (crisisTimer > 0) {
        crisisTimer--;
      }

      // Compute per-asset returns from base class returns
      const assetReturns = [];
      for (let ai = 0; ai < assets.length; ai++) {
        const asset = assets[ai];
        let assetReturn;

        if (asset.leverage && asset.leverage !== 0 && asset.underlying) {
          // Use signed leverage throughout per Avellaneda & Zhang (2010):
          //   r_LETF = L*r - (L-1)*r_f - L(L-1)/2 * σ²
          // For L>0 (long): pays borrowing cost, moderate drag
          // For L<0 (inverse): earns interest on short proceeds, higher drag
          const L = asset.leverage;
          const underlyingRet = baseReturns[asset.underlying] || 0;
          const underlyingVol = currentVols[baseClasses.indexOf(asset.underlying)] || 0;
          const betaSlippage = 0.5 * L * (L - 1) * underlyingVol * underlyingVol;
          assetReturn =
            L * underlyingRet -
            (L - 1) * cashReturn -
            (asset.expenseRatio || 0) * dt -
            betaSlippage;
        } else if (asset.stackedComponents && asset.stackedComponents.length >= 2) {
          assetReturn = -cashReturn - (asset.expenseRatio || 0) * dt;
          for (const comp of asset.stackedComponents) {
            assetReturn += baseReturns[comp] || 0;
          }
        } else if (asset.baseClass) {
          assetReturn = (baseReturns[asset.baseClass] || 0) - (asset.expenseRatio || 0) * dt;
        } else {
          assetReturn = 0;
        }

        assetReturn = Math.max(assetReturn, -0.99);
        assetReturns.push(assetReturn);
      }

      // Compute portfolio return using effective (drifted) weights
      let portReturn = 0;
      let totalDrifted = 0;
      for (let ai = 0; ai < assets.length; ai++) {
        totalDrifted += (assets[ai].weight / 100) * assetCumGrowth[ai];
      }
      if (totalDrifted > 0) {
        for (let ai = 0; ai < assets.length; ai++) {
          const effWeight = (assets[ai].weight / 100) * assetCumGrowth[ai] / totalDrifted;
          portReturn += effWeight * assetReturns[ai];
        }
      }
      // Scale by target leverage/cash factor
      portReturn *= (weightFraction > 0 ? weightFraction : 1);

      // Adjust for leverage borrowing or cash allocation
      if (weightFraction > 1.001) {
        portReturn -= (weightFraction - 1) * cashReturn;
      } else if (weightFraction < 0.999 && weightFraction > 0) {
        portReturn += (1 - weightFraction) * cashReturn;
      }

      path[m + 1] = Math.max(0, path[m] * (1 + portReturn));
      portMonthlyRets[m] = portReturn;

      // Update drift tracking
      if (rebalPeriod > 1) {
        for (let ai = 0; ai < assets.length; ai++) {
          assetCumGrowth[ai] *= (1 + assetReturns[ai]);
        }
      }
    }

    allPaths[p] = path;
    const finalMult = path[nMonths];
    allStats.finalMult[p] = finalMult;
    allStats.cagr[p] = finalMult > 0 ? (Math.pow(finalMult, 1 / nYears) - 1) * 100 : -100;
    allStats.maxDD[p] = computeMaxDrawdown(path);

    // Monthly return statistics
    const rf = 0.04 / 12;
    const excess = portMonthlyRets.map((r) => r - rf);
    const meanExcess = mean(excess);
    const stdExcess = stddev(excess);
    // Sortino downside deviation: sqrt(sum of squared negative excess / N)
    const downsideSqSum = excess.reduce((s, e) => s + (e < 0 ? e * e : 0), 0);
    const stdDownside = excess.length > 0 ? Math.sqrt(downsideSqSum / excess.length) : 0;

    allStats.vol[p] = stddev(portMonthlyRets) * Math.sqrt(12) * 100;
    allStats.sharpe[p] = stdExcess > 0 ? (meanExcess / stdExcess) * Math.sqrt(12) : 0;
    allStats.sortino[p] = stdDownside > 0 ? (meanExcess / stdDownside) * Math.sqrt(12) : 0;
  }

  // Compute percentile paths for fan chart
  const percentilePaths = computePercentilePaths(allPaths, nMonths);

  // Compute summary statistics
  const summary = {
    cagr: computeDistStats(allStats.cagr),
    vol: computeDistStats(allStats.vol),
    maxDD: computeDistStats(allStats.maxDD),
    sharpe: computeDistStats(allStats.sharpe),
    sortino: computeDistStats(allStats.sortino),
    finalMult: computeDistStats(allStats.finalMult),
  };

  return {
    paths: allPaths,
    percentilePaths,
    summary,
    nPaths,
    nYears,
    nMonths,
  };
}

// ─── Helper Statistics ───

function mean(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    sum += d * d;
  }
  return Math.sqrt(sum / (arr.length - 1));
}

function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function computeMaxDrawdown(path) {
  let peak = path[0];
  let maxDD = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i] > peak) peak = path[i];
    const dd = peak > 0 ? (peak - path[i]) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function computeDistStats(values) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return {
    p5: percentile(sorted, 5),
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    mean: mean(sorted),
  };
}

function computePercentilePaths(allPaths, nMonths) {
  const nPaths = allPaths.length;
  const result = {
    p5: new Float64Array(nMonths + 1),
    p10: new Float64Array(nMonths + 1),
    p25: new Float64Array(nMonths + 1),
    p50: new Float64Array(nMonths + 1),
    p75: new Float64Array(nMonths + 1),
    p90: new Float64Array(nMonths + 1),
    p95: new Float64Array(nMonths + 1),
  };

  const temp = new Float64Array(nPaths);
  for (let m = 0; m <= nMonths; m++) {
    for (let p = 0; p < nPaths; p++) {
      temp[p] = allPaths[p][m];
    }
    temp.sort();
    result.p5[m] = percentile(temp, 5);
    result.p10[m] = percentile(temp, 10);
    result.p25[m] = percentile(temp, 25);
    result.p50[m] = percentile(temp, 50);
    result.p75[m] = percentile(temp, 75);
    result.p90[m] = percentile(temp, 90);
    result.p95[m] = percentile(temp, 95);
  }

  return result;
}

// ─── Backtest with Actual Returns ───

/**
 * Run backtest using actual historical returns
 * @param {Object} config
 * @param {Array<Object>} config.assets - [{id, ticker, weight}]
 * @param {Object} config.returnData - {ticker: {dates: [], returns: []}}
 * @param {boolean} config.fillMissing - Whether to simulate missing history
 * @param {Object} config.regimeWeights - For simulating missing data
 * @returns {Object} backtest results
 */
export function runBacktest(config) {
  const { assets, returnData, fillMissing = false, regimeWeights, rebalanceFreq = 'monthly',
          customStartDate = null, customEndDate = null } = config;

  // Find the common date range
  let allDates = new Set();
  const assetDates = {};
  for (const asset of assets) {
    const data = returnData[asset.ticker];
    if (!data) continue;
    assetDates[asset.ticker] = new Set(data.dates);
    for (const d of data.dates) allDates.add(d);
  }

  let sortedDates = Array.from(allDates).sort();
  if (sortedDates.length === 0) {
    return { error: 'No data available for selected assets' };
  }

  // Apply custom date filters if provided
  if (customStartDate) {
    sortedDates = sortedDates.filter((d) => d >= customStartDate);
  }
  if (customEndDate) {
    sortedDates = sortedDates.filter((d) => d <= customEndDate);
  }
  if (sortedDates.length === 0) {
    return { error: 'No data in selected date range' };
  }

  // Find earliest date where all assets have data (or use fill)
  let startIdx = 0;
  if (!fillMissing) {
    // Find the latest start date across all assets
    for (const asset of assets) {
      const data = returnData[asset.ticker];
      if (!data || data.dates.length === 0) continue;
      const assetStart = data.dates[0];
      const idx = sortedDates.indexOf(assetStart);
      if (idx > startIdx) startIdx = idx;
    }
  }

  const dates = sortedDates.slice(startIdx);
  const nMonths = dates.length;

  // Compute total portfolio weight for leverage/cash handling
  const totalWeightPct = assets.reduce((sum, a) => sum + a.weight, 0);
  const weightFraction = totalWeightPct / 100;

  // Historical cash rate approximation (annualized, by era)
  // We'll use a simple lookup based on date for more realistic borrowing costs
  const getHistoricalCashRate = (date) => {
    const year = parseInt(date.substring(0, 4));
    if (year <= 2001) return 0.05;       // ~5% fed funds 1998-2001
    if (year <= 2004) return 0.015;      // ~1.5% post dot-com
    if (year <= 2007) return 0.045;      // ~4.5% pre-GFC
    if (year <= 2015) return 0.002;      // ~0.2% ZIRP era
    if (year <= 2018) return 0.02;       // ~2% rate hike cycle
    if (year <= 2021) return 0.002;      // ~0.2% COVID ZIRP
    if (year <= 2022) return 0.03;       // ~3% early hike cycle
    return 0.05;                          // ~5% 2023+
  };

  // Build portfolio path
  const path = new Float64Array(nMonths + 1);
  path[0] = 1.0;
  const monthlyRets = new Float64Array(nMonths);
  const dataAvailability = {};

  for (const asset of assets) {
    const data = returnData[asset.ticker];
    if (!data) {
      dataAvailability[asset.ticker] = { available: false, startDate: null, endDate: null };
      continue;
    }
    dataAvailability[asset.ticker] = {
      available: true,
      startDate: data.dates[0],
      endDate: data.dates[data.dates.length - 1],
      totalMonths: data.dates.length,
    };
  }

  const rebalPeriod = REBAL_PERIODS[rebalanceFreq] || 1;
  let assetCumGrowth = assets.map(() => 1.0);

  for (let m = 0; m < nMonths; m++) {
    const date = dates[m];

    // Rebalance at target intervals
    if (rebalPeriod <= 1 || m === 0 || m % rebalPeriod === 0) {
      assetCumGrowth = assets.map(() => 1.0);
    }

    // Compute per-asset returns
    const assetReturns = [];
    for (const asset of assets) {
      const data = returnData[asset.ticker];
      let assetReturn;

      if (data) {
        const dateIdx = data.dates.indexOf(date);
        if (dateIdx >= 0) {
          assetReturn = data.returns[dateIdx];
        } else if (fillMissing) {
          assetReturn = simulateMissingReturn(asset, date, assets, returnData, regimeWeights);
        } else {
          assetReturn = 0;
        }
      } else {
        assetReturn = 0;
      }
      assetReturns.push(assetReturn);
    }

    // Compute portfolio return using effective (drifted) weights
    let portReturn = 0;
    let totalDrifted = 0;
    for (let ai = 0; ai < assets.length; ai++) {
      totalDrifted += (assets[ai].weight / 100) * assetCumGrowth[ai];
    }
    if (totalDrifted > 0) {
      for (let ai = 0; ai < assets.length; ai++) {
        const effWeight = (assets[ai].weight / 100) * assetCumGrowth[ai] / totalDrifted;
        portReturn += effWeight * assetReturns[ai];
      }
    }
    portReturn *= (weightFraction > 0 ? weightFraction : 1);

    // Adjust for portfolio-level leverage or cash allocation
    const monthlyCashReturn = getHistoricalCashRate(date) / 12;
    if (weightFraction > 1.001) {
      portReturn -= (weightFraction - 1) * monthlyCashReturn;
    } else if (weightFraction < 0.999 && weightFraction > 0) {
      portReturn += (1 - weightFraction) * monthlyCashReturn;
    }

    path[m + 1] = Math.max(0, path[m] * (1 + portReturn));
    monthlyRets[m] = portReturn;

    // Update drift tracking
    if (rebalPeriod > 1) {
      for (let ai = 0; ai < assets.length; ai++) {
        assetCumGrowth[ai] *= (1 + assetReturns[ai]);
      }
    }
  }

  const nYears = nMonths / 12;
  const finalMult = path[nMonths];
  const rf = 0.04 / 12;
  const excess = Array.from(monthlyRets).map((r) => r - rf);
  const meanExcess = mean(excess);
  const stdExcess = stddev(excess);
  // Sortino downside deviation: sqrt(sum of squared negative excess / N)
  const downsideSqSum = excess.reduce((s, e) => s + (e < 0 ? e * e : 0), 0);
  const stdDownside = excess.length > 0 ? Math.sqrt(downsideSqSum / excess.length) : 0;

  // Compute a start date that sorts before all data dates
  const firstDate = dates[0]; // e.g. '2000-02-01'
  const startDateObj = new Date(firstDate);
  startDateObj.setMonth(startDateObj.getMonth() - 1);
  const startDateStr = startDateObj.toISOString().slice(0, 10);

  // Track which dates used simulated (filled) data
  const simulatedDateFlags = fillMissing ? dates.map((date) => {
    for (const asset of assets) {
      const data = returnData[asset.ticker];
      if (!data) continue;
      if (!data.dates.includes(date)) return true;
    }
    return false;
  }) : null;

  return {
    path: Array.from(path),
    dates: [startDateStr, ...dates],
    monthlyReturns: Array.from(monthlyRets),
    dataAvailability,
    simulatedDateFlags: simulatedDateFlags ? [false, ...simulatedDateFlags] : null,
    stats: {
      cagr: nYears > 0 && finalMult > 0 ? (Math.pow(finalMult, 1 / nYears) - 1) * 100 : -100,
      vol: stddev(monthlyRets) * Math.sqrt(12) * 100,
      maxDD: computeMaxDrawdown(path),
      sharpe: stdExcess > 0 ? (meanExcess / stdExcess) * Math.sqrt(12) : 0,
      sortino: stdDownside > 0 ? (meanExcess / stdDownside) * Math.sqrt(12) : 0,
      finalMult,
      nYears: nYears.toFixed(1),
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    },
  };
}

/**
 * Simulate a missing return for an asset using conditional distribution
 * Based on other assets' actual returns and known correlations
 */
function simulateMissingReturn(asset, date, allAssets, returnData, regimeWeights) {
  // Collect actual returns from other assets at this date
  const observedReturns = [];
  const observedClasses = [];

  for (const other of allAssets) {
    if (other.ticker === asset.ticker) continue;
    const data = returnData[other.ticker];
    if (!data) continue;
    const idx = data.dates.indexOf(date);
    if (idx >= 0) {
      observedReturns.push(data.returns[idx]);
      observedClasses.push(other.baseClass || 'us_equity');
    }
  }

  if (observedReturns.length === 0) {
    // No other data available, use unconditional mean
    const bc = BASE_CLASSES[asset.baseClass || 'us_equity'];
    return bc.mu / 12;
  }

  // Conditional mean: E[X|Y] = mu_X + Sigma_XY * Sigma_YY^{-1} * (Y - mu_Y)
  const assetClass = asset.baseClass || 'us_equity';
  const bc = BASE_CLASSES[assetClass];
  const assetClassIdx = CLASS_ORDER.indexOf(assetClass);

  // Simple approximation: weighted average of correlations * observed deviations
  let conditionalShift = 0;
  for (let i = 0; i < observedReturns.length; i++) {
    const otherClassIdx = CLASS_ORDER.indexOf(observedClasses[i]);
    const corr = NORMAL_CORR[assetClassIdx][otherClassIdx];
    const otherBC = BASE_CLASSES[observedClasses[i]];
    const otherExpected = otherBC.mu / 12;
    const otherVol = otherBC.sigma / Math.sqrt(12);
    const deviation = (observedReturns[i] - otherExpected) / (otherVol || 1);
    conditionalShift += corr * deviation;
  }
  conditionalShift /= observedReturns.length;

  const expectedReturn = bc.mu / 12;
  const vol = bc.sigma / Math.sqrt(12);

  return expectedReturn + conditionalShift * vol;
}

// ─── Bootstrap Monte Carlo ───

/**
 * Run block-bootstrap Monte Carlo simulation using actual historical data.
 * Randomly samples contiguous blocks of returns from history to build synthetic paths.
 *
 * @param {Object} config
 * @param {Array<Object>} config.assets - [{id, ticker, weight}]
 * @param {Object} config.returnData - {ticker: {dates, returns}}
 * @param {number} config.nPaths - Number of simulation paths (default 1000)
 * @param {number} config.nYears - Simulation horizon in years (default 20)
 * @param {number} config.blockSize - Block size in months for bootstrap (default 12)
 * @param {number} config.seed - Random seed (default 42)
 * @returns {Object} results (same format as runMonteCarlo)
 */
export function runBootstrapMonteCarlo(config) {
  const {
    assets,
    returnData,
    nPaths = 1000,
    nYears = 20,
    blockSize = 12,
    seed = 42,
  } = config;

  const rng = mulberry32(seed);
  const nMonths = nYears * 12;

  // Build aligned return matrix: for each month index, we have the portfolio return
  // First, find common dates across all assets that have data
  const allDates = new Set();
  const assetDateSets = {};
  for (const asset of assets) {
    const data = returnData[asset.ticker];
    if (!data?.dates) continue;
    assetDateSets[asset.ticker] = new Set(data.dates);
    for (const d of data.dates) allDates.add(d);
  }

  const sortedDates = Array.from(allDates).sort();

  // Compute total portfolio weight for leverage/cash handling
  const totalWeightPct = assets.reduce((sum, a) => sum + a.weight, 0);
  const weightFraction = totalWeightPct / 100;

  // Historical cash rate approximation (annualized, by era)
  const getHistoricalCashRate = (date) => {
    const year = parseInt(date.substring(0, 4));
    if (year <= 2001) return 0.05;
    if (year <= 2004) return 0.015;
    if (year <= 2007) return 0.045;
    if (year <= 2015) return 0.002;
    if (year <= 2018) return 0.02;
    if (year <= 2021) return 0.002;
    if (year <= 2022) return 0.03;
    return 0.05;
  };

  // For each date, compute portfolio monthly return
  // Use the assets that have data at that date
  const portfolioReturns = [];
  for (const date of sortedDates) {
    let portReturn = 0;
    let totalWeightUsed = 0;

    for (const asset of assets) {
      const data = returnData[asset.ticker];
      if (!data?.dates) continue;
      const dateIdx = data.dates.indexOf(date);
      if (dateIdx < 0) continue;

      portReturn += (asset.weight / 100) * data.returns[dateIdx];
      totalWeightUsed += asset.weight;
    }

    if (totalWeightUsed > 0) {
      // Adjust for portfolio-level leverage or cash allocation
      const monthlyCashReturn = getHistoricalCashRate(date) / 12;
      if (weightFraction > 1.001) {
        portReturn -= (weightFraction - 1) * monthlyCashReturn;
      } else if (weightFraction < 0.999 && weightFraction > 0) {
        portReturn += (1 - weightFraction) * monthlyCashReturn;
      }
      portfolioReturns.push(portReturn);
    }
  }

  const totalHistMonths = portfolioReturns.length;
  if (totalHistMonths < blockSize) {
    return { error: `Insufficient historical data: only ${totalHistMonths} months available, need at least ${blockSize}` };
  }

  // Storage for all paths
  const allPaths = new Array(nPaths);
  const allStats = {
    finalMult: new Float64Array(nPaths),
    cagr: new Float64Array(nPaths),
    vol: new Float64Array(nPaths),
    maxDD: new Float64Array(nPaths),
    sharpe: new Float64Array(nPaths),
    sortino: new Float64Array(nPaths),
  };

  for (let p = 0; p < nPaths; p++) {
    const path = new Float64Array(nMonths + 1);
    path[0] = 1.0;
    const pathMonthlyRets = new Float64Array(nMonths);

    let currentMonth = 0;

    while (currentMonth < nMonths) {
      // Pick a random start index for this block
      const maxStart = totalHistMonths - blockSize;
      const startIdx = Math.floor(rng() * (maxStart + 1));

      for (let b = 0; b < blockSize && currentMonth < nMonths; b++) {
        const monthRet = portfolioReturns[startIdx + b];
        path[currentMonth + 1] = Math.max(0, path[currentMonth] * (1 + monthRet));
        pathMonthlyRets[currentMonth] = monthRet;
        currentMonth++;

        if (path[currentMonth] <= 0) break;
      }

      if (path[currentMonth] <= 0) {
        // Zero out remaining
        for (let rm = currentMonth + 1; rm <= nMonths; rm++) path[rm] = 0;
        break;
      }
    }

    allPaths[p] = path;
    const finalMult = path[nMonths];
    allStats.finalMult[p] = finalMult;
    allStats.cagr[p] = finalMult > 0 ? (Math.pow(finalMult, 1 / nYears) - 1) * 100 : -100;
    allStats.maxDD[p] = computeMaxDrawdown(path);

    const rf = 0.04 / 12;
    const excess = pathMonthlyRets.map((r) => r - rf);
    const meanExcess = mean(excess);
    const stdExcess = stddev(excess);
    // Sortino downside deviation: sqrt(sum of squared negative excess / N)
    const downsideSqSum = excess.reduce((s, e) => s + (e < 0 ? e * e : 0), 0);
    const stdDownside = excess.length > 0 ? Math.sqrt(downsideSqSum / excess.length) : 0;

    allStats.vol[p] = stddev(pathMonthlyRets) * Math.sqrt(12) * 100;
    allStats.sharpe[p] = stdExcess > 0 ? (meanExcess / stdExcess) * Math.sqrt(12) : 0;
    allStats.sortino[p] = stdDownside > 0 ? (meanExcess / stdDownside) * Math.sqrt(12) : 0;
  }

  // Compute percentile paths
  const percentilePaths = computePercentilePaths(allPaths, nMonths);

  // Compute summary statistics
  const summary = {
    cagr: computeDistStats(allStats.cagr),
    vol: computeDistStats(allStats.vol),
    maxDD: computeDistStats(allStats.maxDD),
    sharpe: computeDistStats(allStats.sharpe),
    sortino: computeDistStats(allStats.sortino),
    finalMult: computeDistStats(allStats.finalMult),
  };

  return {
    paths: allPaths,
    percentilePaths,
    summary,
    nPaths,
    nYears,
    nMonths,
    histMonthsUsed: totalHistMonths,
    blockSize,
  };
}

// ─── Exports ───
export { BASE_CLASSES, CLASS_ORDER, CRISIS_REGIMES };
