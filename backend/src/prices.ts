import {
  fetchYahooChart,
  fetchYahooQuotes,
  normalizeYahooSymbol,
  readRegularMarketPrice,
} from "./yahooFinance.js";

const cache = new Map<string, { price: number; at: number }>();
const TTL_MS = 90_000;
const COALESCE_MS = 40;

type CoalesceBatch = {
  symbols: Set<string>;
  waiters: Array<{
    want: string[];
    cached: Record<string, number | null>;
    resolve: (r: Record<string, number | null>) => void;
  }>;
};

let coalesceBatch: CoalesceBatch | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let flushChain: Promise<void> = Promise.resolve();

function readCache(ticker: string): number | null {
  const hit = cache.get(ticker);
  if (!hit || Date.now() - hit.at >= TTL_MS) return null;
  return hit.price;
}

function writeCache(ticker: string, price: number): void {
  cache.set(ticker, { price, at: Date.now() });
}

async function fetchPricesFromNetwork(symbols: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const s of symbols) out[s] = null;

  const batch = await fetchYahooQuotes(symbols);
  for (const s of symbols) {
    const px = batch[s];
    out[s] = px;
    if (px != null) writeCache(s, px);
  }

  const stillMissing = symbols.filter((s) => out[s] == null);
  for (const sym of stillMissing) {
    const json = await fetchYahooChart(sym, "range=1d&interval=1d");
    if (!json) continue;
    const price = readRegularMarketPrice(json);
    if (price == null) continue;
    out[sym] = price;
    writeCache(sym, price);
  }

  return out;
}

function hasPendingCoalesce(): boolean {
  return (coalesceBatch?.waiters.length ?? 0) > 0;
}

async function flushCoalescedBatch(): Promise<void> {
  coalesceTimer = null;
  const batch = coalesceBatch;
  coalesceBatch = null;
  if (!batch || batch.symbols.size === 0) return;

  const symbols = [...batch.symbols];
  let network: Record<string, number | null> = {};
  try {
    network = await fetchPricesFromNetwork(symbols);
  } catch (e) {
    console.error("Coalesced Yahoo price fetch failed:", e);
  }

  for (const waiter of batch.waiters) {
    const result: Record<string, number | null> = { ...waiter.cached };
    for (const sym of waiter.want) {
      result[sym] = network[sym] ?? waiter.cached[sym] ?? readCache(sym) ?? null;
    }
    waiter.resolve(result);
  }

  if (hasPendingCoalesce()) {
    scheduleCoalescedFlush();
  }
}

function scheduleCoalescedFlush(): void {
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    flushChain = flushChain.then(() => flushCoalescedBatch());
  }, COALESCE_MS);
}

/**
 * Fetch live USD prices for tickers. Concurrent calls within ~40ms are merged
 * into a single Yahoo batch (portfolio + watchlist on page load).
 */
export async function fetchPrices(tickers: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(tickers.map((t) => normalizeYahooSymbol(t)).filter(Boolean))];
  if (unique.length === 0) return {};

  const cached: Record<string, number | null> = {};
  const missing: string[] = [];
  for (const t of unique) {
    const hit = readCache(t);
    if (hit != null) cached[t] = hit;
    else missing.push(t);
  }

  if (missing.length === 0) {
    const out: Record<string, number | null> = {};
    for (const t of unique) out[t] = cached[t]!;
    return out;
  }

  return new Promise((resolve) => {
    if (!coalesceBatch) {
      coalesceBatch = { symbols: new Set(), waiters: [] };
    }
    for (const s of missing) coalesceBatch!.symbols.add(s);
    coalesceBatch!.waiters.push({
      want: unique,
      cached,
      resolve,
    });
    if (!coalesceTimer) {
      scheduleCoalescedFlush();
    }
  });
}

/** SGD per 1 USD (spot / last close). */
export async function fetchUsdSgdLive(): Promise<number | null> {
  const map = await fetchPrices(["USDSGD=X"]);
  return map["USDSGD=X"] ?? null;
}
