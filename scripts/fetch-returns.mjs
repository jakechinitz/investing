#!/usr/bin/env node
/**
 * Build public/data/returns.json — a snapshot of monthly returns for every
 * asset, fetched server-side from Yahoo Finance (no browser CORS limits, no
 * third-party proxies). The site loads this file first, so page load does not
 * depend on flaky free CORS proxies.
 *
 * Runs in CI before `vite build` (see .github/workflows/deploy.yml) and daily
 * via .github/workflows/refresh-data.yml.
 *
 * Safety: a run can only ADD or REFRESH tickers, never remove them — tickers
 * that fail this run keep their previous values from the existing snapshot.
 * If nothing at all could be fetched the existing file is left untouched.
 * Exit code is 0 regardless so a Yahoo outage cannot fail a deploy.
 *
 * Always writes public/data/snapshot-status.json describing the run (counts,
 * per-ticker errors) so failures in CI can be diagnosed from the repo itself.
 *
 * Usage: node scripts/fetch-returns.mjs [--strict]
 *   --strict   exit non-zero when nothing was written
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ASSETS } from '../src/data/assets.js';
import { fetchAllReturns, compactRecord } from '../src/data/fetchReturns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_PATH = resolve(__dirname, '../public/data/returns.json');
export const DEFAULT_STATUS_PATH = resolve(__dirname, '../public/data/snapshot-status.json');

// Yahoo throttles a datacenter IP that fires ~90 requests in a couple of
// minutes (first CI run: 62/92 succeeded). From a server, the CORS proxies are
// nearly useless (403 without a browser Origin, 429, timeouts) and each miss
// costs an 8s timeout, so: go direct, slowly, and sweep the failures again
// after a pause. Proxies only on the final pass as a last resort.
export const DEFAULT_PASSES = [
  { label: 'direct',        useProxies: false, concurrency: 1, interRequestDelayMs: 900,  retryDelays: [4000, 10000],  pauseBeforeMs: 0 },
  { label: 'direct-retry',  useProxies: false, concurrency: 1, interRequestDelayMs: 1500, retryDelays: [10000, 20000], pauseBeforeMs: 45000 },
  { label: 'direct-retry2', useProxies: false, concurrency: 1, interRequestDelayMs: 2000, retryDelays: [15000, 30000], pauseBeforeMs: 60000 },
  { label: 'with-proxies',  useProxies: true,  concurrency: 1, interRequestDelayMs: 1000, retryDelays: [5000],         pauseBeforeMs: 30000 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buildSnapshot({
  assets = ASSETS,
  outPath = DEFAULT_OUT_PATH,
  statusPath = DEFAULT_STATUS_PATH,
  passes = DEFAULT_PASSES,
  log = console.log,
  now = () => new Date(),
} = {}) {
  let previous = null;
  try {
    previous = JSON.parse(await readFile(outPath, 'utf8'));
  } catch {
    previous = null; // first run
  }

  const total = assets.length;
  const data = {};
  const metadata = {};
  let errors = {};
  let remaining = [...assets];
  const passLog = [];

  for (let i = 0; i < passes.length && remaining.length > 0; i++) {
    const pass = passes[i];
    if (pass.pauseBeforeMs > 0) {
      log(`Pausing ${Math.round(pass.pauseBeforeMs / 1000)}s before pass "${pass.label}" (${remaining.length} tickers left)...`);
      await sleep(pass.pauseBeforeMs);
    }
    log(`Pass ${i + 1}/${passes.length} "${pass.label}": ${remaining.length} tickers, concurrency ${pass.concurrency}, ${pass.interRequestDelayMs}ms pacing, proxies ${pass.useProxies ? 'on' : 'off'}`);
    const t0 = Date.now();
    const res = await fetchAllReturns(remaining, {
      concurrency: pass.concurrency,
      useSnapshot: false,
      useCache: false,
      useProxies: pass.useProxies,
      interRequestDelayMs: pass.interRequestDelayMs,
      retryDelays: pass.retryDelays,
      onProgress: (done, n, ticker) => {
        if (done % 10 === 0 || done === n) log(`  ${done}/${n} (${ticker})`);
      },
    });
    let got = 0;
    for (const [t, rec] of Object.entries(res.data)) {
      if (!data[t]) got += 1;
      data[t] = rec;
      metadata[t] = res.metadata[t];
    }
    errors = res.errors;
    remaining = remaining.filter((a) => !data[a.ticker]);
    passLog.push({ pass: pass.label, fetched: got, remaining: remaining.length, seconds: Math.round((Date.now() - t0) / 1000) });
    log(`  -> +${got} fetched, ${remaining.length} still missing (${passLog.at(-1).seconds}s)`);
  }

  const ok = Object.keys(data).length;
  const ratio = total > 0 ? ok / total : 0;
  log(`Fetched ${ok}/${total} tickers (${(ratio * 100).toFixed(0)}%)`);
  for (const [t, msg] of Object.entries(errors)) log(`  x ${t}: ${msg}`);

  const writeStatus = async (extra) => {
    if (!statusPath) return;
    const status = {
      ranAt: now().toISOString(),
      fetched: ok,
      total,
      snapshotTickers: null,
      ...extra,
      passes: passLog,
      errors,
      node: process.version,
    };
    await mkdir(dirname(statusPath), { recursive: true });
    await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n');
  };

  if (ok === 0) {
    log('Nothing fetched - keeping existing snapshot' + (previous ? ` from ${previous.generatedAt}.` : ' (none exists).'));
    await writeStatus({ written: false, reason: 'no tickers fetched', snapshotTickers: previous ? Object.keys(previous.data || {}).length : 0 });
    return { written: false, ok, total, errors };
  }

  const outData = {};
  const outMeta = {};
  const outErrors = {};
  let carried = 0;
  for (const asset of assets) {
    const t = asset.ticker;
    if (data[t]) {
      outData[t] = compactRecord(data[t]);
      outMeta[t] = metadata[t];
    } else if (previous?.data?.[t]) {
      outData[t] = previous.data[t];
      outMeta[t] = { ...(previous.metadata?.[t] || {}), carriedFrom: previous.generatedAt, lastError: errors[t] };
      carried += 1;
    } else {
      outErrors[t] = errors[t] || 'no data';
    }
  }

  const snapshot = {
    generatedAt: now().toISOString(),
    source: 'Yahoo Finance v8 chart API, monthly adjusted close',
    data: outData,
    metadata: outMeta,
    errors: outErrors,
  };

  await mkdir(dirname(outPath), { recursive: true });
  const body = JSON.stringify(snapshot);
  await writeFile(outPath, body);
  await writeStatus({ written: true, carried, snapshotTickers: Object.keys(outData).length, bytes: Buffer.byteLength(body) });
  log(
    `Wrote ${outPath}: ${Object.keys(outData).length} tickers` +
      (carried ? ` (${carried} carried over from previous snapshot)` : '') +
      `, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB`
  );
  return { written: true, ok, total, carried, errors: outErrors };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const strict = process.argv.includes('--strict');
  buildSnapshot()
    .then((r) => {
      if (strict && !r.written) process.exit(1);
    })
    .catch((e) => {
      console.error('Snapshot build failed:', e);
      process.exit(strict ? 1 : 0);
    });
}
