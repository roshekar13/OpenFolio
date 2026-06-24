import type { Db } from "mongodb";
import { fetchPrices } from "./prices.js";
import { fetchTwoWeekReturnPct } from "./momentum.js";
import { listWatchlistTickers } from "./mongo/watchlist.js";

export async function loadWatchlistPayload(
  db: Db,
  userId: string,
  priceMap?: Record<string, number | null>
): Promise<{
  items: { ticker: string; priceUsd: number | null; change2wPct: number | null }[];
  max: number;
}> {
  const tickers = await listWatchlistTickers(db, userId);
  const prices = priceMap ?? (await fetchPrices(tickers));

  const items: { ticker: string; priceUsd: number | null; change2wPct: number | null }[] = [];
  for (const ticker of tickers) {
    const upper = ticker.trim().toUpperCase();
    const change2wPct = await fetchTwoWeekReturnPct(ticker);
    items.push({
      ticker: upper,
      priceUsd: prices[upper] ?? null,
      change2wPct,
    });
  }

  return { items, max: 4 };
}
