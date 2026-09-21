/**
 * Historical Return Data Fetcher
 *
 * Data sources, in priority order:
 *   1. Prebuilt snapshot shipped with the site (public/data/returns.json),
 *      generated server-side in CI by scripts/fetch-returns.mjs. Same-origin,
 *      so no CORS and no third-party proxies are involved at page load.
 *   2. Browser cache (localStorage, 20h TTL) from a previous successful fetch.
 *   3. Live Yahoo Finance via CORS proxies — fail-fast timeouts, a per-proxy
 *      circuit breaker, bounded concurrency, and progressive delivery so
 *      whatever loads is shown immediately instead of after the slowest ticker.
 *
 * This module is import-safe in Node (no window/localStorage access unless
 * running in a browser) so the CI script can reuse the same fetch + parse code.
 */

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

const CORS_PROXIES = [
  { name: 'corsproxy.io', build: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
  { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { name: 'codetabs', build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
  { name: 'cors.lol', build: (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}` },
  { name: 'thingproxy', build: (url) => `https://thingproxy.freeboard.io/fetch/${url}` },
];

const FETCH_TIMEOUT_MS = 8000;          // per request attempt
const MAX_CONCURRENT = 6;               // simultaneous tickers
const RETRY_DELAYS_MS = [1500, 4000];   // two retries per ticker, alternating Yahoo host
const PROXY_TRIP_FAILURES = 4;          // consecutive hard failures (timeout/5xx/garbage) before a proxy is benched
const PROXY_COOLDOWN_MS = 60_000;       // how long a benched (dead/hanging) proxy sits out
const PROXY_RATE_LIMIT_COOLDOWN_MS = 15_000; // pause after a 429 before using that proxy again
const MAX_RATE_LIMIT_WAIT_MS = 15_000;  // longest we pause a ticker waiting for any proxy to un-throttle

const CACHE_KEY = 'investing:returns:v1';
const CACHE_TTL_MS = 20 * 60 * 60 * 1000;          // monthly data: refresh at most daily
const SNAPSHOT_FRESH_MS = 3 * 24 * 60 * 60 * 1000; // snapshot older than this is refreshed in background
const CACHE_WRITE_EVERY = 8;

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ─── Errors ───

/** Yahoo answered definitively that the symbol has no data; retrying elsewhere is pointless. */
export class SymbolError extends Error {
  constructor(ticker, message) {
    super(message);
    this.name = 'SymbolError';
    this.ticker = ticker;
  }
}

// ─── Small utils ───

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const headers = { Accept: 'application/json' };
  if (!isBrowser) headers['User-Agent'] = BROWSER_UA; // browsers ignore/forbid this header
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function yahooChartUrl(host, ticker, period1, period2) {
  return `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1mo`;
}

// ─── Per-proxy health ───
// Two distinct failure modes, handled differently:
//   * Rate-limited (HTTP 429): the proxy works but wants us to slow down. It is
//     throttled briefly; if EVERY proxy is throttled, the ticker pauses until the
//     first one un-throttles (bounded) rather than burning its attempts on 429s.
//   * Dead/hanging (timeout, 5xx, garbage): after a few consecutive failures the
//     proxy is benched so other tickers don't each pay an 8s timeout on it.
// A ticker is never left with nothing to try: if no proxy is healthy, the two
// closest to recovery are used anyway.

const proxyState = new Map(); // name -> { failures, benchedUntil, rateLimitedUntil }

function stateOf(proxy) {
  let s = proxyState.get(proxy.name);
  if (!s) { s = { failures: 0, benchedUntil: 0, rateLimitedUntil: 0 }; proxyState.set(proxy.name, s); }
  return s;
}
const recoveryTime = (p) => { const s = proxyState.get(p.name); return s ? Math.max(s.benchedUntil, s.rateLimitedUntil) : 0; };
const isHealthy = (p, now) => recoveryTime(p) <= now;

/** Proxies to try for one attempt, healthiest first; may pause if all are rate-limited. */
async function pickProxies() {
  let now = Date.now();
  let healthy = CORS_PROXIES.filter((p) => isHealthy(p, now));
  if (healthy.length === 0) {
    const throttled = CORS_PROXIES.map((p) => proxyState.get(p.name)?.rateLimitedUntil || 0).filter((t) => t > now);
    if (throttled.length > 0) {
      await sleep(Math.min(Math.min(...throttled) - now, MAX_RATE_LIMIT_WAIT_MS));
      now = Date.now();
      healthy = CORS_PROXIES.filter((p) => isHealthy(p, now));
    }
  }
  if (healthy.length > 0) {
    return healthy.sort((a, b) => (proxyState.get(a.name)?.failures || 0) - (proxyState.get(b.name)?.failures || 0));
  }
  // Everything is down: try the two closest to recovery rather than nothing.
  return [...CORS_PROXIES].sort((a, b) => recoveryTime(a) - recoveryTime(b)).slice(0, 2);
}

function proxyFailed(proxy, httpStatus) {
  const s = stateOf(proxy);
  if (httpStatus === 429) {
    s.rateLimitedUntil = Date.now() + PROXY_RATE_LIMIT_COOLDOWN_MS;
    return;
  }
  s.failures += 1;
  if (s.failures >= PROXY_TRIP_FAILURES) {
    s.benchedUntil = Date.now() + PROXY_COOLDOWN_MS;
    s.failures = 0;
  }
}

function proxySucceeded(proxy) {
  const s = stateOf(proxy);
  s.failures = 0;
  s.benchedUntil = 0;
  s.rateLimitedUntil = 0;
}

/** Exposed for tests / diagnostics. */
export function _resetProxyState() {
  proxyState.clear();
}

// ─── Yahoo chart fetch + parse ───

/**
 * Try direct, then each available proxy, once. Resolves to Yahoo chart JSON.
 * Throws SymbolError for a definitive "no such symbol"; otherwise throws the
 * last transport error.
 */
async function fetchChartOnce(ticker, period1, period2, host, useProxies = true) {
  const baseUrl = yahooChartUrl(host, ticker, period1, period2);
  const candidates = [{ name: 'direct', url: baseUrl, proxy: null }];
  if (useProxies) {
    for (const p of await pickProxies()) {
      candidates.push({ name: p.name, url: p.build(baseUrl), proxy: p });
    }
  }

  let lastError = null;
  for (const c of candidates) {
    try {
      const response = await fetchWithTimeout(c.url, FETCH_TIMEOUT_MS);
      if (!response.ok) {
        if (c.proxy) proxyFailed(c.proxy, response.status);
        lastError = new Error(`${c.name}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        if (c.proxy) proxyFailed(c.proxy);
        lastError = new Error(`${c.name}: non-JSON response`);
        continue;
      }
      if (json?.chart?.result?.[0]) {
        if (c.proxy) proxySucceeded(c.proxy);
        return json;
      }
      if (json?.chart?.error) {
        // The proxy worked; Yahoo itself says the symbol is bad.
        if (c.proxy) proxySucceeded(c.proxy);
        const err = json.chart.error;
        throw new SymbolError(ticker, err.description || err.code || 'Yahoo error');
      }
      if (c.proxy) proxyFailed(c.proxy);
      lastError = new Error(`${c.name}: empty chart result`);
    } catch (e) {
      if (e instanceof SymbolError) throw e;
      if (c.proxy) proxyFailed(c.proxy);
      const why = e?.name === 'AbortError' ? 'timeout' : (e?.cause?.code || e?.message || String(e));
      lastError = new Error(`${c.name}: ${why}`);
    }
  }
  throw lastError || new Error('No response');
}

/**
 * Convert a Yahoo chart JSON payload into our monthly return record.
 * Pure; exported so the CI snapshot script can reuse it.
 */
export function parseYahooChart(json, ticker) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${ticker}`);
  const timestamps = result.timestamp || [];
  const adjClose =
    result.indicators?.adjclose?.[0]?.adjclose ||
    result.indicators?.quote?.[0]?.close ||
    [];

  if (timestamps.length < 2 || adjClose.length < 2) {
    throw new Error(`Insufficient data for ${ticker}`);
  }

  const dates = [];
  const prices = [];
  const returns = [];

  for (let i = 0; i < timestamps.length; i++) {
    const price = adjClose[i];
    if (price == null || isNaN(price) || price <= 0) continue;

    const date = new Date(timestamps[i] * 1000);
    const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    // Yahoo occasionally emits two rows in one month (e.g. a partial current
    // month plus month-end); keep the latest price for that month.
    if (dates.length > 0 && dates[dates.length - 1] === dateStr) {
      prices[prices.length - 1] = price;
      if (returns.length > 0 && prices.length >= 2) {
        const prev = prices[prices.length - 2];
        returns[returns.length - 1] = (price - prev) / prev;
      }
      continue;
    }

    prices.push(price);
    dates.push(dateStr);
    if (prices.length >= 2) {
      const prev = prices[prices.length - 2];
      returns.push((price - prev) / prev);
    }
  }

  if (returns.length < 1) throw new Error(`Insufficient data for ${ticker}`);

  return {
    ticker,
    dates: dates.slice(1), // align with returns (first month has no return)
    prices: prices.slice(1),
    returns,
    startDate: dates[1] || dates[0],
    endDate: dates[dates.length - 1],
    totalMonths: returns.length,
  };
}

/**
 * Fetch monthly return data for one ticker from Yahoo Finance.
 * @param {string} ticker
 * @param {string|null} startDate - YYYY-MM-DD, or null for full history
 * @param {Object} [opts]
 * @param {number[]} [opts.retryDelays] - ms to wait before each retry (default two retries)
 * @param {boolean}  [opts.useProxies]  - try CORS proxies after the direct request (default true;
 *                                        server-side callers may disable, since proxies mostly
 *                                        reject or throttle non-browser clients)
 */
export async function fetchMonthlyReturns(ticker, startDate = null, { retryDelays = RETRY_DELAYS_MS, useProxies = true } = {}) {
  const period1 = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : 0;
  const period2 = Math.floor(Date.now() / 1000);

  let lastError = null;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    const host = YAHOO_HOSTS[attempt % YAHOO_HOSTS.length];
    try {
      const json = await fetchChartOnce(ticker, period1, period2, host, useProxies);
      return parseYahooChart(json, ticker);
    } catch (e) {
      lastError = e;
      if (e instanceof SymbolError) break;
    }
    if (attempt < retryDelays.length) await sleep(retryDelays[attempt]);
  }
  throw new Error(`Failed to fetch data for ${ticker}: ${lastError?.message || 'No data returned'}`);
}

// ─── Browser cache (localStorage) ───

function readCache() {
  if (!isBrowser) return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded or storage disabled — the cache is a convenience only.
  }
}

/** Compact record for storage: no prices, returns rounded to 8 significant digits. */
export function compactRecord(rec) {
  return {
    ticker: rec.ticker,
    dates: rec.dates,
    returns: rec.returns.map((r) => Number(Number(r).toPrecision(8))),
    startDate: rec.startDate,
    endDate: rec.endDate,
    totalMonths: rec.totalMonths,
  };
}

// ─── Prebuilt snapshot (public/data/returns.json) ───

async function loadSnapshot() {
  if (!isBrowser) return null;
  try {
    const env = import.meta.env;
    const base = (env && env.BASE_URL) || '/';
    const res = await fetchWithTimeout(`${base}data/returns.json`, FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object' || !json.data || !json.generatedAt) return null;
    return json;
  } catch {
    return null; // 404 page (HTML), network error, or malformed — fall through to live fetch
  }
}

// ─── Fetch everything ───

/**
 * Fetch returns for multiple assets, handling comparable fallbacks.
 *
 * @param {Array<Object>} assets - asset definitions ({ticker, comparable, ...})
 * @param {Object} [opts]
 * @param {number}   [opts.concurrency]   - simultaneous live fetches (default 4)
 * @param {Function} [opts.onProgress]    - (done, total, ticker) after each ticker settles
 * @param {Function} [opts.onData]        - ({data, metadata, errors}) whenever new data is
 *                                          available; called immediately with snapshot/cache
 *                                          hits and then progressively as live fetches land
 * @param {boolean}  [opts.useSnapshot]   - read the prebuilt snapshot (default true)
 * @param {boolean}  [opts.useCache]      - read/write the localStorage cache (default true)
 * @param {boolean}  [opts.forceRefresh]  - ignore cache, re-fetch even snapshot tickers,
 *                                          keeping snapshot data only as a fallback
 * @param {number}   [opts.interRequestDelayMs] - pause per worker between tickers (rate-limit
 *                                          courtesy; used by the CI snapshot script)
 * @param {number[]} [opts.retryDelays]   - per-ticker retry schedule (see fetchMonthlyReturns)
 * @param {boolean}  [opts.useProxies]    - try CORS proxies after direct (default true)
 * @returns {Promise<{data: Object, metadata: Object, errors: Object}>}
 */
export async function fetchAllReturns(assets, opts = {}) {
  const {
    concurrency = MAX_CONCURRENT,
    onProgress,
    onData,
    useSnapshot = true,
    useCache = true,
    forceRefresh = false,
    interRequestDelayMs = 0,
    retryDelays,
    useProxies = true,
  } = opts;

  const results = {};
  const metadata = {};
  const errors = {};

  // Throttled progressive delivery
  let emitTimer = null;
  let lastEmit = 0;
  const snapshotOf = () => ({ data: { ...results }, metadata: { ...metadata }, errors: { ...errors } });
  const emitNow = () => {
    if (emitTimer) { clearTimeout(emitTimer); emitTimer = null; }
    lastEmit = Date.now();
    onData?.(snapshotOf());
  };
  const scheduleEmit = () => {
    if (!onData || emitTimer) return;
    const wait = Math.max(0, 250 - (Date.now() - lastEmit));
    emitTimer = setTimeout(emitNow, wait);
  };

  // 1) Snapshot + 2) cache: satisfy what we can instantly
  const snap = useSnapshot ? await loadSnapshot() : null;
  const snapAge = snap ? Date.now() - Date.parse(snap.generatedAt) : Infinity;
  const snapFresh = Number.isFinite(snapAge) && snapAge < SNAPSHOT_FRESH_MS;
  const cache = useCache && !forceRefresh ? readCache() : {};
  const now = Date.now();

  const pending = [];
  for (const asset of assets) {
    const t = asset.ticker;
    const snapRec = snap?.data?.[t];
    const snapMeta = snap?.metadata?.[t];
    const cacheRec = cache[t];

    if (snapRec && snapFresh && !forceRefresh) {
      results[t] = snapRec;
      metadata[t] = { ...(snapMeta || {}), source: snapMeta?.source === 'comparable' ? 'comparable' : 'snapshot', snapshotAt: snap.generatedAt, dataStart: snapRec.startDate, dataEnd: snapRec.endDate, totalMonths: snapRec.totalMonths };
      continue;
    }
    if (cacheRec && cacheRec.savedAt && now - cacheRec.savedAt < CACHE_TTL_MS && cacheRec.record) {
      results[t] = cacheRec.record;
      metadata[t] = { ...(cacheRec.meta || {}), source: cacheRec.meta?.source === 'comparable' ? 'comparable' : 'cache', dataStart: cacheRec.record.startDate, dataEnd: cacheRec.record.endDate, totalMonths: cacheRec.record.totalMonths };
      continue;
    }
    if (snapRec) {
      // Stale snapshot: show it now, refresh live in the background
      results[t] = snapRec;
      metadata[t] = { ...(snapMeta || {}), source: 'snapshot', snapshotAt: snap.generatedAt, stale: true, dataStart: snapRec.startDate, dataEnd: snapRec.endDate, totalMonths: snapRec.totalMonths };
    }
    pending.push(asset);
  }

  if (Object.keys(results).length > 0) emitNow();
  if (pending.length === 0) {
    return snapshotOf();
  }

  // 3) Live fetch for the rest
  // Memoize per ticker so a comparable shared by many assets is fetched once,
  // and reuse anything we already hold from snapshot/cache.
  const inflight = new Map();
  const getTicker = (ticker) => {
    if (results[ticker] && !metadata[ticker]?.stale && !forceRefresh) return Promise.resolve(results[ticker]);
    if (!inflight.has(ticker)) inflight.set(ticker, fetchMonthlyReturns(ticker, null, { ...(retryDelays ? { retryDelays } : {}), useProxies }));
    return inflight.get(ticker);
  };

  let successesSinceWrite = 0;
  const persist = (force) => {
    if (!useCache) return;
    if (!force && successesSinceWrite < CACHE_WRITE_EVERY) return;
    successesSinceWrite = 0;
    writeCache(cache);
  };

  const record = (t, data, meta) => {
    results[t] = data;
    metadata[t] = meta;
    delete errors[t];
    cache[t] = { savedAt: Date.now(), record: compactRecord(data), meta };
    successesSinceWrite += 1;
    persist(false);
    scheduleEmit();
  };

  const fetchOne = async (asset) => {
    const t = asset.ticker;
    try {
      const data = await getTicker(t);
      record(t, data, { source: 'direct', dataStart: data.startDate, dataEnd: data.endDate, totalMonths: data.totalMonths });
    } catch (e) {
      const primaryMsg = e?.message || String(e);
      if (asset.comparable) {
        try {
          const compData = await getTicker(asset.comparable);
          record(t, compData, {
            source: 'comparable',
            comparableTicker: asset.comparable,
            dataStart: compData.startDate,
            dataEnd: compData.endDate,
            totalMonths: compData.totalMonths,
            note: `Using ${asset.comparable} as comparable proxy for ${t}`,
          });
          return;
        } catch (e2) {
          if (!results[t]) errors[t] = `${primaryMsg}; comparable (${asset.comparable}) also failed: ${e2?.message || e2}`;
        }
      } else if (!results[t]) {
        errors[t] = primaryMsg;
      }
      if (results[t] && metadata[t]) {
        // Keep the stale snapshot value, but note that the refresh failed
        metadata[t] = { ...metadata[t], refreshError: primaryMsg };
      }
      scheduleEmit();
    }
  };

  const queue = [...pending];
  let done = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const asset = queue.shift();
      await fetchOne(asset);
      done += 1;
      onProgress?.(done, pending.length, asset.ticker);
      if (interRequestDelayMs > 0 && queue.length > 0) await sleep(interRequestDelayMs);
    }
  };
  const nWorkers = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: nWorkers }, worker));

  persist(true);
  emitNow();
  return snapshotOf();
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

  const earliestAvailable = Object.values(startDates).sort()[0];
  const gaps = {};
  for (const ticker of tickers) {
    if (startDates[ticker] && startDates[ticker] !== latestStart) {
      gaps[ticker] = {
        hasGap: startDates[ticker] > earliestAvailable,
        assetStart: startDates[ticker],
        earliestAvailable,
        missingMonths: monthDiff(earliestAvailable, startDates[ticker]),
      };
    }
  }

  return { commonStart: latestStart, commonEnd: earliestEnd, startDates, endDates, gaps };
}

function monthDiff(dateA, dateB) {
  const [yA, mA] = dateA.split('-').map(Number);
  const [yB, mB] = dateB.split('-').map(Number);
  return (yB - yA) * 12 + (mB - mA);
}
