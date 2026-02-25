/**
 * Asset Definitions
 *
 * Each asset maps to a base class model for simulation,
 * plus metadata for display, data fetching, and comparable assets.
 */

export const ASSET_CATEGORIES = {
  us_equity: 'US Equity',
  intl_equity: 'International Equity',
  bonds: 'Bonds',
  alternatives: 'Alternatives',
  crypto: 'Crypto',
  leveraged: 'Leveraged',
  return_stacked: 'Return Stacked',
  managed_futures: 'Managed Futures',
  cash: 'Cash / Short-Term',
};

export const ASSETS = [
  // ─── US Equity ───
  {
    id: 'SPY',
    ticker: 'SPY',
    name: 'S&P 500 ETF',
    category: 'us_equity',
    baseClass: 'us_equity',
    expenseRatio: 0.0009,
    inceptionDate: '1993-01-29',
    comparable: null,
    description: 'Tracks the S&P 500 index',
  },
  {
    id: 'QQQ',
    ticker: 'QQQ',
    name: 'Nasdaq 100 ETF',
    category: 'us_equity',
    baseClass: 'us_tech',
    expenseRatio: 0.002,
    inceptionDate: '1999-03-10',
    comparable: null,
    description: 'Tracks the Nasdaq-100 index',
  },
  {
    id: 'IWM',
    ticker: 'IWM',
    name: 'Russell 2000 ETF',
    category: 'us_equity',
    baseClass: 'us_small_cap',
    expenseRatio: 0.0019,
    inceptionDate: '2000-05-22',
    comparable: null,
    description: 'Tracks US small-cap stocks',
  },
  {
    id: 'VTI',
    ticker: 'VTI',
    name: 'Total US Stock Market',
    category: 'us_equity',
    baseClass: 'us_equity',
    expenseRatio: 0.0003,
    inceptionDate: '2001-05-24',
    comparable: 'SPY',
    description: 'Total US stock market exposure',
  },
  {
    id: 'VOO',
    ticker: 'VOO',
    name: 'Vanguard S&P 500',
    category: 'us_equity',
    baseClass: 'us_equity',
    expenseRatio: 0.0003,
    inceptionDate: '2010-09-07',
    comparable: 'SPY',
    description: 'Vanguard S&P 500 tracker',
  },

  // ─── International Equity ───
  {
    id: 'EFA',
    ticker: 'EFA',
    name: 'MSCI EAFE ETF',
    category: 'intl_equity',
    baseClass: 'intl_developed',
    expenseRatio: 0.0032,
    inceptionDate: '2001-08-14',
    comparable: null,
    description: 'Developed international markets ex-US & Canada',
  },
  {
    id: 'VWO',
    ticker: 'VWO',
    name: 'Emerging Markets ETF',
    category: 'intl_equity',
    baseClass: 'intl_emerging',
    expenseRatio: 0.0008,
    inceptionDate: '2005-03-04',
    comparable: 'EEM',
    description: 'FTSE Emerging Markets exposure',
  },
  {
    id: 'EEM',
    ticker: 'EEM',
    name: 'iShares Emerging Markets',
    category: 'intl_equity',
    baseClass: 'intl_emerging',
    expenseRatio: 0.0068,
    inceptionDate: '2003-04-07',
    comparable: null,
    description: 'MSCI Emerging Markets index',
  },
  {
    id: 'VXUS',
    ticker: 'VXUS',
    name: 'Total International Stock',
    category: 'intl_equity',
    baseClass: 'intl_developed',
    expenseRatio: 0.0007,
    inceptionDate: '2011-01-26',
    comparable: 'EFA',
    description: 'Total international stock market',
  },

  // ─── Bonds ───
  {
    id: 'AGG',
    ticker: 'AGG',
    name: 'US Aggregate Bond',
    category: 'bonds',
    baseClass: 'us_aggregate_bond',
    expenseRatio: 0.0003,
    inceptionDate: '2003-09-22',
    comparable: null,
    description: 'US investment-grade bond market',
  },
  {
    id: 'TLT',
    ticker: 'TLT',
    name: '20+ Year Treasury',
    category: 'bonds',
    baseClass: 'us_long_treasury',
    expenseRatio: 0.0015,
    inceptionDate: '2002-07-22',
    comparable: null,
    description: 'Long-term US Treasury bonds',
  },
  {
    id: 'IEF',
    ticker: 'IEF',
    name: '7-10 Year Treasury',
    category: 'bonds',
    baseClass: 'us_aggregate_bond',
    expenseRatio: 0.0015,
    inceptionDate: '2002-07-22',
    comparable: null,
    description: 'Intermediate-term US Treasury bonds',
  },
  {
    id: 'TIP',
    ticker: 'TIP',
    name: 'TIPS Bond ETF',
    category: 'bonds',
    baseClass: 'tips',
    expenseRatio: 0.0019,
    inceptionDate: '2003-12-04',
    comparable: null,
    description: 'Treasury Inflation-Protected Securities',
  },
  {
    id: 'SHY',
    ticker: 'SHY',
    name: '1-3 Year Treasury',
    category: 'bonds',
    baseClass: 'cash',
    expenseRatio: 0.0015,
    inceptionDate: '2002-07-22',
    comparable: null,
    description: 'Short-term US Treasury bonds',
  },
  {
    id: 'BND',
    ticker: 'BND',
    name: 'Total Bond Market',
    category: 'bonds',
    baseClass: 'us_aggregate_bond',
    expenseRatio: 0.0003,
    inceptionDate: '2007-04-03',
    comparable: 'AGG',
    description: 'Vanguard total bond market',
  },

  // ─── Alternatives ───
  {
    id: 'GLD',
    ticker: 'GLD',
    name: 'Gold ETF',
    category: 'alternatives',
    baseClass: 'gold',
    expenseRatio: 0.004,
    inceptionDate: '2004-11-18',
    comparable: null,
    description: 'Physical gold price tracker',
  },
  {
    id: 'IAU',
    ticker: 'IAU',
    name: 'iShares Gold Trust',
    category: 'alternatives',
    baseClass: 'gold',
    expenseRatio: 0.0025,
    inceptionDate: '2005-01-21',
    comparable: 'GLD',
    description: 'Physical gold price tracker',
  },
  {
    id: 'DBC',
    ticker: 'DBC',
    name: 'Commodity Index ETF',
    category: 'alternatives',
    baseClass: 'commodities',
    expenseRatio: 0.0087,
    inceptionDate: '2006-02-03',
    comparable: null,
    description: 'Diversified commodity futures',
  },
  {
    id: 'VNQ',
    ticker: 'VNQ',
    name: 'Real Estate ETF',
    category: 'alternatives',
    baseClass: 'real_estate',
    expenseRatio: 0.0012,
    inceptionDate: '2004-09-23',
    comparable: null,
    description: 'US real estate investment trusts',
  },

  // ─── Crypto ───
  {
    id: 'BTC',
    ticker: 'BTC-USD',
    name: 'Bitcoin',
    category: 'crypto',
    baseClass: 'crypto_major',
    expenseRatio: 0,
    inceptionDate: '2014-09-17',
    comparable: null,
    description: 'Bitcoin cryptocurrency',
  },
  {
    id: 'ETH',
    ticker: 'ETH-USD',
    name: 'Ethereum',
    category: 'crypto',
    baseClass: 'crypto_alt',
    expenseRatio: 0,
    inceptionDate: '2017-11-09',
    comparable: 'BTC-USD',
    description: 'Ethereum cryptocurrency',
  },
  {
    id: 'IBIT',
    ticker: 'IBIT',
    name: 'iShares Bitcoin Trust',
    category: 'crypto',
    baseClass: 'crypto_major',
    expenseRatio: 0.0025,
    inceptionDate: '2024-01-11',
    comparable: 'BTC-USD',
    description: 'Spot Bitcoin ETF',
  },

  // ─── Leveraged ───
  {
    id: 'UPRO',
    ticker: 'UPRO',
    name: '3x S&P 500',
    category: 'leveraged',
    baseClass: null,
    leverage: 3,
    underlying: 'us_equity',
    expenseRatio: 0.009,
    inceptionDate: '2009-06-25',
    comparable: null,
    description: '3x daily leveraged S&P 500',
  },
  {
    id: 'TQQQ',
    ticker: 'TQQQ',
    name: '3x Nasdaq 100',
    category: 'leveraged',
    baseClass: null,
    leverage: 3,
    underlying: 'us_tech',
    expenseRatio: 0.0086,
    inceptionDate: '2010-02-09',
    comparable: null,
    description: '3x daily leveraged Nasdaq-100',
  },
  {
    id: 'SSO',
    ticker: 'SSO',
    name: '2x S&P 500',
    category: 'leveraged',
    baseClass: null,
    leverage: 2,
    underlying: 'us_equity',
    expenseRatio: 0.0089,
    inceptionDate: '2006-06-19',
    comparable: null,
    description: '2x daily leveraged S&P 500',
  },
  {
    id: 'QLD',
    ticker: 'QLD',
    name: '2x Nasdaq 100',
    category: 'leveraged',
    baseClass: null,
    leverage: 2,
    underlying: 'us_tech',
    expenseRatio: 0.0095,
    inceptionDate: '2006-06-19',
    comparable: null,
    description: '2x daily leveraged Nasdaq-100',
  },

  // ─── Return Stacked ───
  {
    id: 'RSST',
    ticker: 'RSST',
    name: 'Return Stacked US Equity & Trend',
    category: 'return_stacked',
    baseClass: null,
    stackedComponents: ['us_equity', 'managed_futures'],
    expenseRatio: 0.0104,
    inceptionDate: '2023-09-27',
    comparable: null,
    description: '100% US equity + 100% trend-following overlay',
  },
  {
    id: 'RSSB',
    ticker: 'RSSB',
    name: 'Return Stacked Global Equity & Bonds',
    category: 'return_stacked',
    baseClass: null,
    stackedComponents: ['us_equity', 'us_aggregate_bond'],
    expenseRatio: 0.011,
    inceptionDate: '2023-09-27',
    comparable: null,
    description: '100% global equity + 100% bond overlay',
  },
  {
    id: 'RSBT',
    ticker: 'RSBT',
    name: 'Return Stacked Bonds & Trend',
    category: 'return_stacked',
    baseClass: null,
    stackedComponents: ['us_aggregate_bond', 'managed_futures'],
    expenseRatio: 0.0104,
    inceptionDate: '2023-09-27',
    comparable: null,
    description: '100% bonds + 100% trend-following overlay',
  },

  // ─── Managed Futures ───
  {
    id: 'DBMF',
    ticker: 'DBMF',
    name: 'Managed Futures Strategy',
    category: 'managed_futures',
    baseClass: 'managed_futures',
    expenseRatio: 0.0085,
    inceptionDate: '2019-05-08',
    comparable: null,
    description: 'Dynamic Beta managed futures replication',
  },
  {
    id: 'CTA',
    ticker: 'CTA',
    name: 'Simplify Managed Futures',
    category: 'managed_futures',
    baseClass: 'managed_futures',
    expenseRatio: 0.0075,
    inceptionDate: '2022-03-01',
    comparable: 'DBMF',
    description: 'Simplify managed futures strategy',
  },
  {
    id: 'KMLM',
    ticker: 'KMLM',
    name: 'KFA Mount Lucas Managed Futures',
    category: 'managed_futures',
    baseClass: 'managed_futures',
    expenseRatio: 0.009,
    inceptionDate: '2020-12-02',
    comparable: 'DBMF',
    description: 'Multi-asset trend following',
  },

  // ─── Cash / Short-Term ───
  {
    id: 'BIL',
    ticker: 'BIL',
    name: 'T-Bills ETF',
    category: 'cash',
    baseClass: 'cash',
    expenseRatio: 0.0014,
    inceptionDate: '2007-05-25',
    comparable: null,
    description: '1-3 month US Treasury bills',
  },
  {
    id: 'SHV',
    ticker: 'SHV',
    name: 'Short Treasury ETF',
    category: 'cash',
    baseClass: 'cash',
    expenseRatio: 0.0015,
    inceptionDate: '2007-01-05',
    comparable: null,
    description: 'Short-term US Treasury bonds',
  },
  {
    id: 'SGOV',
    ticker: 'SGOV',
    name: '0-3 Month Treasury',
    category: 'cash',
    baseClass: 'cash',
    expenseRatio: 0.0007,
    inceptionDate: '2020-05-26',
    comparable: 'BIL',
    description: 'Ultra-short Treasury bills',
  },
];

/**
 * Get an asset definition by ID or ticker
 */
export function getAsset(idOrTicker) {
  return ASSETS.find((a) => a.id === idOrTicker || a.ticker === idOrTicker) || null;
}

/**
 * Search assets by query string (name, ticker, or category)
 */
export function searchAssets(query) {
  if (!query) return ASSETS;
  const q = query.toLowerCase();
  return ASSETS.filter(
    (a) =>
      a.ticker.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      (ASSET_CATEGORIES[a.category] || '').toLowerCase().includes(q)
  );
}

/**
 * Create a custom asset definition for an unknown ticker
 */
export function createCustomAsset(ticker, params = {}) {
  return {
    id: ticker,
    ticker: ticker,
    name: params.name || ticker,
    category: params.category || 'us_equity',
    baseClass: params.baseClass || 'us_equity',
    expenseRatio: params.expenseRatio || 0.005,
    inceptionDate: params.inceptionDate || '2020-01-01',
    comparable: params.comparable || 'SPY',
    description: params.description || `Custom asset: ${ticker}`,
    isCustom: true,
  };
}

/**
 * Get preset portfolio allocations
 */
export const PRESET_PORTFOLIOS = {
  classic_60_40: {
    name: 'Classic 60/40',
    description: '60% US stocks, 40% US bonds',
    assets: [
      { id: 'SPY', weight: 60 },
      { id: 'AGG', weight: 40 },
    ],
  },
  all_weather: {
    name: 'All Weather',
    description: 'Ray Dalio-inspired risk parity',
    assets: [
      { id: 'SPY', weight: 30 },
      { id: 'TLT', weight: 40 },
      { id: 'GLD', weight: 7.5 },
      { id: 'DBC', weight: 7.5 },
      { id: 'IEF', weight: 15 },
    ],
  },
  return_stacked: {
    name: 'Return Stacked',
    description: 'Leveraged return stacking strategy',
    assets: [
      { id: 'UPRO', weight: 40 },
      { id: 'RSST', weight: 28 },
      { id: 'RSSB', weight: 25 },
      { id: 'GLD', weight: 2 },
      { id: 'BTC', weight: 2 },
      { id: 'BIL', weight: 3 },
    ],
  },
  aggressive_growth: {
    name: 'Aggressive Growth',
    description: 'High-risk growth portfolio',
    assets: [
      { id: 'QQQ', weight: 40 },
      { id: 'SPY', weight: 25 },
      { id: 'IWM', weight: 10 },
      { id: 'VWO', weight: 10 },
      { id: 'BTC', weight: 10 },
      { id: 'GLD', weight: 5 },
    ],
  },
  market_only: {
    name: 'S&P 500 Only',
    description: '100% S&P 500 benchmark',
    assets: [{ id: 'SPY', weight: 100 }],
  },
  golden_butterfly: {
    name: 'Golden Butterfly',
    description: 'Modified permanent portfolio',
    assets: [
      { id: 'SPY', weight: 20 },
      { id: 'IWM', weight: 20 },
      { id: 'TLT', weight: 20 },
      { id: 'SHY', weight: 20 },
      { id: 'GLD', weight: 20 },
    ],
  },
};
