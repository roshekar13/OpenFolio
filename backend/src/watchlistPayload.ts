import type { Db } from "mongodb";
import { fetchPrices } from "./prices.js";
import { fetchWatchlistPreviewChart } from "./priceChart.js";
import { listWatchlistTickers } from "./mongo/watchlist.js";

export async function loadWatchlistPayload(
  db: Db,
  userId: string,
  priceMap?: Record<string, number | null>
): Promise<{
  items: {
    ticker: string;
    name: string | null;
    priceUsd: number | null;
    changePct: number | null;
    chartCloses: number[];
  }[];
  max: number;
}> {
  const tickers = await listWatchlistTickers(db, userId);
  const prices = priceMap ?? (await fetchPrices(tickers));

  const items: {
    ticker: string;
    name: string | null;
    priceUsd: number | null;
    changePct: number | null;
    chartCloses: number[];
  }[] = [];

  for (const ticker of tickers) {
    const upper = ticker.trim().toUpperCase();
    const chart = await fetchWatchlistPreviewChart(ticker);
    items.push({
      ticker: upper,
      name: chart.name,
      priceUsd: prices[upper] ?? null,
      changePct: chart.changePct,
      chartCloses: chart.closes,
    });
  }

  return { items, max: 4 };
}
