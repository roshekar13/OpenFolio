import { fetchYahooChart, normalizeYahooSymbol, readDailyCloses, type YahooChartJson } from "./yahooFinance.js";

export type PriceChartRange = "1w" | "1mo" | "6mo" | "ytd";

export type PriceChartData = {
  name: string | null;
  changePct: number | null;
  closes: number[];
};

const MAX_SPARKLINE_POINTS = 64;

const RANGE_LABELS: Record<PriceChartRange, string> = {
  "1w": "1 week",
  "1mo": "1 month",
  "6mo": "6 months",
  ytd: "YTD",
};

export function priceChartRangeLabel(range: PriceChartRange): string {
  return RANGE_LABELS[range];
}

function chartQueryForRange(range: PriceChartRange): string {
  const now = Math.floor(Date.now() / 1000);
  if (range === "1w") {
    return `period1=${now - 7 * 86400}&period2=${now}&interval=1d`;
  }
  const yahooRange = { "1mo": "1mo", "6mo": "6mo", ytd: "ytd" }[range];
  return `range=${yahooRange}&interval=1d`;
}

function readChartMetaName(json: YahooChartJson): string | null {
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const long = meta.longName?.trim();
  if (long) return long;
  const short = meta.shortName?.trim();
  return short || null;
}

function downsampleSeries(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i / (maxPoints - 1)) * (values.length - 1));
    out.push(values[idx]!);
  }
  return out;
}

/** Daily closes and period return from Yahoo Finance chart API. */
export async function fetchPriceChartData(ticker: string, range: PriceChartRange): Promise<PriceChartData> {
  const sym = normalizeYahooSymbol(ticker);
  if (!sym) return { name: null, changePct: null, closes: [] };

  const json = await fetchYahooChart(sym, chartQueryForRange(range));
  if (!json) return { name: null, changePct: null, closes: [] };

  const name = readChartMetaName(json);
  const series = readDailyCloses(json);
  if (!series) return { name, changePct: null, closes: [] };

  const closes = series.c.filter((x): x is number => x != null && Number.isFinite(x));
  if (closes.length < 2) {
    return { name, changePct: null, closes: downsampleSeries(closes, MAX_SPARKLINE_POINTS) };
  }

  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  const changePct = first === 0 ? null : (last - first) / first;

  return {
    name,
    changePct,
    closes: downsampleSeries(closes, MAX_SPARKLINE_POINTS),
  };
}

/** Watchlist row preview uses 1-month range. */
export async function fetchWatchlistPreviewChart(ticker: string): Promise<PriceChartData> {
  return fetchPriceChartData(ticker, "1mo");
}

export function isPriceChartRange(value: string): value is PriceChartRange {
  return value === "1w" || value === "1mo" || value === "6mo" || value === "ytd";
}
