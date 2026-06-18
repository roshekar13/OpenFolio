import type { Db } from "mongodb";
import { fetchPrices } from "./prices.js";
import { fetchTwoWeekReturnPct } from "./momentum.js";
import { listWatchlistTickers } from "./mongo/watchlist.js";

export async function loadWatchlistPayload(
  db: Db,
  userId: string
): Promise<{
  items: { ticker: string; priceUsd: number | null; change2wPct: number | null }[];
  max: number;
}> {
  const tickers = await listWatchlistTickers(db, userId);
  const priceMap = await fetchPrices(tickers);
  const items = await Promise.all(
    tickers.map(async (ticker) => {
      const upper = ticker.trim().toUpperCase();
      const change2wPct = await fetchTwoWeekReturnPct(ticker);
      return {
        ticker: upper,
        priceUsd: priceMap[upper] ?? null,
        change2wPct,
      };
    })
  );
  return { items, max: 4 };
}
