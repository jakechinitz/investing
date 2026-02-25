/**
 * Historical Return Data Fetcher
 *
 * Fetches monthly price data from Yahoo Finance via CORS proxies,
 * computes monthly returns, and handles comparable asset fallbacks.
 */

const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

/**
 * Fetch monthly price data from Yahoo Finance
 * @param {string} ticker - Yahoo Finance ticker symbol
 * @param {string} startDate - Start date (YYYY-MM-DD) or null for max
 * @returns {Object} {dates: string[], prices: number[], returns: number[]}
 */
export async function fetchMonthlyReturns(ticker, startDate = null) {
  const period1 = startDate
    ? Math.floor(new Date(startDate).getTime() / 1000)
    : 0;
  const period2 = Math.floor(Date.now() / 1000);

  const baseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1mo`;

  let data = null;
  let lastError = null;

  // Try direct first, then CORS proxies
  const urls = [baseUrl, ...CORS_PROXIES.map((proxy) => proxy(baseUrl))];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      data = await response.json();
      if (data?.chart?.result?.[0]) break;
      data = null;
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  if (!data?.chart?.result?.[0]) {
    throw new Error(
      `Failed to fetch data for ${ticker}: ${lastError?.message || 'No data returned'}`
    );
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const adjClose =
    result.indicators?.adjclose?.[0]?.adjclose ||
    result.indicators?.quote?.[0]?.close ||
    [];

  if (timestamps.length < 2 || adjClose.length < 2) {
    throw new Error(`Insufficient data for ${ticker}`);
  }

  // Convert to monthly returns
  const dates = [];
  const prices = [];
  const returns = [];

  for (let i = 0; i < timestamps.length; i++) {
    const price = adjClose[i];
    if (price == null || isNaN(price) || price <= 0) continue;

    const date = new Date(timestamps[i] * 1000);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    prices.push(price);
    dates.push(dateStr);

    if (prices.length >= 2) {
      const prevPrice = prices[prices.length - 2];
      returns.push((price - prevPrice) / prevPrice);
    }
  }

  // Returns array is 1 shorter than dates/prices (first month has no return)
  return {
    ticker,
    dates: dates.slice(1), // Align with returns
    prices: prices.slice(1),
    returns,
    startDate: dates[1] || dates[0],
    endDate: dates[dates.length - 1],
    totalMonths: returns.length,
  };
}

/**
 * Fetch returns for multiple assets, handling comparable fallbacks
 * @param {Array<Object>} assets - Asset definitions from assets.js
 * @returns {Object} {[ticker]: {dates, returns, ...}, metadata: {}}
 */
export async function fetchAllReturns(assets) {
  const results = {};
  const metadata = {};
  const errors = {};

  // First pass: try to fetch each asset
  const fetchPromises = assets.map(async (asset) => {
    try {
      const data = await fetchMonthlyReturns(asset.ticker);
      results[asset.ticker] = data;
      metadata[asset.ticker] = {
        source: 'direct',
        dataStart: data.startDate,
        dataEnd: data.endDate,
        totalMonths: data.totalMonths,
      };
    } catch (e) {
      errors[asset.ticker] = e.message;

      // Try comparable asset
      if (asset.comparable) {
        try {
          const compData = await fetchMonthlyReturns(asset.comparable);
          results[asset.ticker] = compData;
          metadata[asset.ticker] = {
            source: 'comparable',
            comparableTicker: asset.comparable,
            dataStart: compData.startDate,
            dataEnd: compData.endDate,
            totalMonths: compData.totalMonths,
            note: `Using ${asset.comparable} as comparable proxy for ${asset.ticker}`,
          };
        } catch (e2) {
          errors[asset.ticker] = `${e.message}; comparable (${asset.comparable}) also failed: ${e2.message}`;
        }
      }
    }
  });

  await Promise.all(fetchPromises);

  return { data: results, metadata, errors };
}

/**
 * Analyze data availability across multiple assets
 * @param {Object} returnData - {[ticker]: {dates, returns}}
 * @returns {Object} availability analysis
 */
export function analyzeDataAvailability(returnData) {
  const tickers = Object.keys(returnData);
  if (tickers.length === 0) return { commonStart: null, commonEnd: null, gaps: {} };

  let latestStart = '0000-00';
  let earliestEnd = '9999-99';
  const startDates = {};
  const endDates = {};

  for (const ticker of tickers) {
    const data = returnData[ticker];
    if (!data || !data.dates || data.dates.length === 0) continue;
    startDates[ticker] = data.dates[0];
    endDates[ticker] = data.dates[data.dates.length - 1];
    if (data.dates[0] > latestStart) latestStart = data.dates[0];
    if (data.dates[data.dates.length - 1] < earliestEnd)
      earliestEnd = data.dates[data.dates.length - 1];
  }

  // Identify assets with shorter history
  const gaps = {};
  for (const ticker of tickers) {
    if (startDates[ticker] && startDates[ticker] > latestStart.slice(0, 7)) {
      // This is actually fine, latestStart is the constraint
    }
    if (startDates[ticker] && startDates[ticker] !== latestStart) {
      gaps[ticker] = {
        hasGap: startDates[ticker] > Object.values(startDates).sort()[0],
        assetStart: startDates[ticker],
        earliestAvailable: Object.values(startDates).sort()[0],
        missingMonths: monthDiff(Object.values(startDates).sort()[0], startDates[ticker]),
      };
    }
  }

  return {
    commonStart: latestStart,
    commonEnd: earliestEnd,
    startDates,
    endDates,
    gaps,
  };
}

function monthDiff(dateA, dateB) {
  const [yA, mA] = dateA.split('-').map(Number);
  const [yB, mB] = dateB.split('-').map(Number);
  return (yB - yA) * 12 + (mB - mA);
}
