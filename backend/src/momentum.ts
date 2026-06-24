import { fetchYahooChart, normalizeYahooSymbol } from "./yahooFinance.js";

/** Approximate 1-month total return from daily closes (first vs last bar in window). */
export async function fetchOneMonthReturnPct(ticker: string): Promise<number | null> {
  const sym = normalizeYahooSymbol(ticker);
  if (!sym) return null;
  const json = await fetchYahooChart(sym, "range=1mo&interval=1d");
  if (!json) return null;
  const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return null;
  const nums = closes.filter((x): x is number => x != null && Number.isFinite(x));
  if (nums.length < 2) return null;
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (first === 0) return null;
  return (last - first) / first;
}

/** Approximate 2-week total return from daily closes (first vs last bar in window). */
export async function fetchTwoWeekReturnPct(ticker: string): Promise<number | null> {
  const sym = normalizeYahooSymbol(ticker);
  if (!sym) return null;
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 14 * 86400;
  const json = await fetchYahooChart(sym, `period1=${period1}&period2=${now}&interval=1d`);
  if (!json) return null;
  const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return null;
  const nums = closes.filter((x): x is number => x != null && Number.isFinite(x));
  if (nums.length < 2) return null;
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (first === 0) return null;
  return (last - first) / first;
}
