import {
  fetchYahooChart,
  fetchYahooQuotes,
  normalizeYahooSymbol,
  readRegularMarketPrice,
  warmYahooSession,
} from "./yahooFinance.js";

const cache = new Map<string, { price: number; at: number }>();
const TTL_MS = 60_000;

function readCache(ticker: string): number | null {
  const hit = cache.get(ticker);
  if (!hit || Date.now() - hit.at >= TTL_MS) return null;
  return hit.price;
}

function writeCache(ticker: string, price: number): void {
  cache.set(ticker, { price, at: Date.now() });
}

export async function fetchUsdPrice(ticker: string): Promise<number | null> {
  const upper = normalizeYahooSymbol(ticker);
  if (!upper) return null;
  const cached = readCache(upper);
  if (cached != null) return cached;

  const batch = await fetchYahooQuotes([upper]);
  const fromBatch = batch[upper];
  if (fromBatch != null) {
    writeCache(upper, fromBatch);
    return fromBatch;
  }

  const json = await fetchYahooChart(upper, "range=1d&interval=1d");
  if (!json) return null;
  const price = readRegularMarketPrice(json);
  if (price == null) return null;
  writeCache(upper, price);
  return price;
}

export async function fetchPrices(tickers: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(tickers.map((t) => normalizeYahooSymbol(t)).filter(Boolean))];
  const out: Record<string, number | null> = {};
  const missing: string[] = [];

  for (const t of unique) {
    const cached = readCache(t);
    if (cached != null) {
      out[t] = cached;
    } else {
      missing.push(t);
    }
  }

  if (missing.length === 0) return out;

  await warmYahooSession();
  const batch = await fetchYahooQuotes(missing);
  for (const t of missing) {
    const px = batch[t] ?? null;
    out[t] = px;
    if (px != null) writeCache(t, px);
  }

  const stillMissing = missing.filter((t) => out[t] == null);
  if (stillMissing.length > 0) {
    await Promise.all(
      stillMissing.map(async (t) => {
        out[t] = await fetchUsdPrice(t);
      })
    );
  }

  return out;
}

/** SGD per 1 USD (spot / last close). */
export async function fetchUsdSgdLive(): Promise<number | null> {
  return fetchUsdPrice("USDSGD=X");
}
