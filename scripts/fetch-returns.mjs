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
 * Safety: never replaces a good snapshot with a bad one. If fewer than
 * MIN_SUCCESS_RATIO of tickers succeed, the existing file is kept and the
 * process exits 0 so a Yahoo outage cannot fail a deploy. Tickers that fail
 * this run keep their previous values from the existing snapshot.
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
const MIN_SUCCESS_RATIO = 0.5;

export async function buildSnapshot({
  assets = ASSETS,
  outPath = DEFAULT_OUT_PATH,
  concurrency = 2,
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
  log(`Fetching monthly returns for ${total} tickers (concurrency ${concurrency})...`);
  const { data, metadata, errors } = await fetchAllReturns(assets, {
    concurrency,
    useSnapshot: false,
    useCache: false,
    // Be patient and polite with Yahoo from a datacenter IP: pace requests and
    // retry 429s/hiccups with growing backoff rather than giving up quickly.
    interRequestDelayMs: 350,
    retryDelays: [2000, 5000, 12000],
    onProgress: (done, n, ticker) => {
      if (done % 10 === 0 || done === n) log(`  ${done}/${n} (${ticker})`);
    },
  });

  const ok = Object.keys(data).length;
  const ratio = total > 0 ? ok / total : 0;
  log(`Fetched ${ok}/${total} tickers (${(ratio * 100).toFixed(0)}%)`);
  for (const [t, msg] of Object.entries(errors)) log(`  x ${t}: ${msg}`);

  if (ratio < MIN_SUCCESS_RATIO) {
    log(
      `Below ${MIN_SUCCESS_RATIO * 100}% success - keeping existing snapshot` +
        (previous ? ` from ${previous.generatedAt}.` : ' (none exists).')
    );
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
