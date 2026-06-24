import type { Db } from "mongodb";
import { fetchPrices } from "./prices.js";
import { fetchOneMonthReturnPct } from "./momentum.js";
import { listWatchlistTickers } from "./mongo/watchlist.js";

export type WatchlistItemPayload = {
  ticker: string;
  priceUsd: number | null;
  change1moPct: number | null;
};

/** Prices only — 1M change is loaded separately so portfolio quotes are not blocked. */
export async function loadWatchlistPayload(
  db: Db,
  userId: string,
  priceMap?: Record<string, number | null>
): Promise<{ items: WatchlistItemPayload[]; max: number }> {
  const tickers = await listWatchlistTickers(db, userId);
  const prices = priceMap ?? (await fetchPrices(tickers));

  const items = tickers.map((ticker) => {
    const upper = ticker.trim().toUpperCase();
    return {
      ticker: upper,
      priceUsd: prices[upper] ?? null,
      change1moPct: null,
    };
  });

  return { items, max: 4 };
}

/** 1-month return per watchlist ticker (serialized Yahoo chart calls). */
export async function loadWatchlistMomentum(
  db: Db,
  userId: string
): Promise<Record<string, number | null>> {
  const tickers = await listWatchlistTickers(db, userId);
  const out: Record<string, number | null> = {};
  for (const ticker of tickers) {
    const upper = ticker.trim().toUpperCase();
    out[upper] = await fetchOneMonthReturnPct(ticker);
  }
  return out;
}

/** Full watchlist snapshot for analytics prompts (includes 1M change). */
export async function loadWatchlistPayloadWithMomentum(
  db: Db,
  userId: string,
  priceMap?: Record<string, number | null>
): Promise<{ items: WatchlistItemPayload[]; max: number }> {
  const base = await loadWatchlistPayload(db, userId, priceMap);
  const momentum = await loadWatchlistMomentum(db, userId);
  return {
    max: base.max,
    items: base.items.map((item) => ({
      ...item,
      change1moPct: momentum[item.ticker] ?? null,
    })),
  };
}
