/**
 * Yahoo Finance access for server-side use (Render, local API).
 * Datacenter IPs require a session cookie + crumb; batch quotes reduce rate limits.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const SESSION_TTL_MS = 30 * 60 * 1000;
const QUOTE_CHUNK = 20;
const CHART_CONCURRENCY = 4;

type YahooSession = { cookie: string; crumb: string; at: number };

let sessionCache: YahooSession | null = null;
let sessionPromise: Promise<YahooSession> | null = null;
let chartActive = 0;
const chartWaiters: Array<() => void> = [];

function collectSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookieHeaderFromSetCookies(setCookies: string[]): string {
  return setCookies.map((c) => c.split(";")[0]?.trim()).filter(Boolean).join("; ");
}

async function fetchYahooSession(): Promise<YahooSession> {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    redirect: "manual",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  });

  let cookies = cookieHeaderFromSetCookies(collectSetCookies(cookieRes));

  if ((cookieRes.status === 301 || cookieRes.status === 302) && !cookies) {
    const location = cookieRes.headers.get("location");
    if (location) {
      const next = await fetch(location, {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      cookies = cookieHeaderFromSetCookies(collectSetCookies(next));
    }
  }

  if (!cookies) {
    throw new Error("Yahoo Finance session cookie unavailable.");
  }

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/plain",
      Cookie: cookies,
    },
  });

  if (!crumbRes.ok) {
    throw new Error(`Yahoo Finance crumb request failed (${crumbRes.status}).`);
  }

  const crumb = (await crumbRes.text()).trim();
  if (!crumb) {
    throw new Error("Yahoo Finance returned an empty crumb.");
  }

  return { cookie: cookies, crumb, at: Date.now() };
}

async function getYahooSession(force = false): Promise<YahooSession> {
  if (force) {
    sessionCache = null;
    sessionPromise = null;
  }

  const now = Date.now();
  if (!force && sessionCache && now - sessionCache.at < SESSION_TTL_MS) {
    return sessionCache;
  }
  if (!force && sessionPromise) return sessionPromise;

  sessionPromise = fetchYahooSession()
    .then((session) => {
      sessionCache = session;
      return session;
    })
    .finally(() => {
      sessionPromise = null;
    });

  return sessionPromise;
}

/** Pre-warm Yahoo session before a batch of market requests. */
export async function warmYahooSession(): Promise<boolean> {
  try {
    await getYahooSession(false);
    return true;
  } catch (e) {
    console.error("Yahoo session warm-up failed:", e);
    return false;
  }
}

export function normalizeYahooSymbol(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

export type YahooChartJson = {
  chart?: {
    error?: { description?: string };
    result?: {
      meta?: { regularMarketPrice?: number; symbol?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

type YahooQuoteResponse = {
  quoteResponse?: {
    error?: { description?: string } | null;
    result?: { symbol?: string; regularMarketPrice?: number }[] | null;
  };
};

async function acquireChartSlot(): Promise<void> {
  if (chartActive < CHART_CONCURRENCY) {
    chartActive++;
    return;
  }
  await new Promise<void>((resolve) => chartWaiters.push(resolve));
  chartActive++;
}

function releaseChartSlot(): void {
  chartActive--;
  const next = chartWaiters.shift();
  if (next) next();
}

async function yahooGet(url: string, session: YahooSession): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
      Cookie: session.cookie,
    },
  });
}

/** Batch live quotes — one HTTP call for many symbols (preferred for portfolio/watchlist). */
export async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  const out: Record<string, number | null> = {};
  for (const sym of unique) out[sym] = null;
  if (unique.length === 0) return out;

  const fetchChunk = async (chunk: string[], forceSession: boolean): Promise<void> => {
    const session = await getYahooSession(forceSession);
    const symbolsParam = chunk.map(encodeURIComponent).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsParam}&crumb=${encodeURIComponent(session.crumb)}`;
    const res = await yahooGet(url, session);
    if (res.status === 401 || res.status === 403 || !res.ok) {
      throw new Error(`Yahoo quote request failed (${res.status}).`);
    }
    const json = (await res.json()) as YahooQuoteResponse;
    if (json.quoteResponse?.error) {
      throw new Error(String(json.quoteResponse.error.description ?? "Yahoo quote error."));
    }
    for (const row of json.quoteResponse?.result ?? []) {
      const sym = normalizeYahooSymbol(row.symbol ?? "");
      const px = row.regularMarketPrice;
      if (sym && typeof px === "number" && Number.isFinite(px)) {
        out[sym] = px;
      }
    }
  };

  try {
    for (let i = 0; i < unique.length; i += QUOTE_CHUNK) {
      await fetchChunk(unique.slice(i, i + QUOTE_CHUNK), false);
    }
  } catch (firstErr) {
    console.warn("Yahoo quote batch failed, retrying with fresh session:", firstErr);
    sessionCache = null;
    try {
      for (let i = 0; i < unique.length; i += QUOTE_CHUNK) {
        await fetchChunk(unique.slice(i, i + QUOTE_CHUNK), true);
      }
    } catch (retryErr) {
      console.error("Yahoo quote batch retry failed:", retryErr);
    }
  }

  return out;
}

/** Fetch Yahoo chart JSON with cookie + crumb (historical / 2-week momentum). */
export async function fetchYahooChart(symbolPath: string, query: string): Promise<YahooChartJson | null> {
  const sym = encodeURIComponent(normalizeYahooSymbol(symbolPath));

  const attempt = async (forceSession: boolean): Promise<YahooChartJson | null> => {
    await acquireChartSlot();
    try {
      const session = await getYahooSession(forceSession);
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?${query}&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await yahooGet(url, session);
      if (res.status === 401 || res.status === 403 || !res.ok) return null;
      return (await res.json()) as YahooChartJson;
    } catch {
      return null;
    } finally {
      releaseChartSlot();
    }
  };

  let json = await attempt(false);
  if (json?.chart?.error || !json?.chart?.result?.length) {
    sessionCache = null;
    json = await attempt(true);
  }
  if (json?.chart?.error || !json?.chart?.result?.length) return null;
  return json;
}

export function readRegularMarketPrice(json: YahooChartJson): number | null {
  const meta = json.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof meta === "number" && Number.isFinite(meta)) return meta;
  const close = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    ?.filter((x): x is number => x != null && Number.isFinite(x))
    .pop();
  return typeof close === "number" ? close : null;
}

export function readDailyCloses(json: YahooChartJson): { t: number[]; c: (number | null)[] } | null {
  const r = json.chart?.result?.[0];
  const t = r?.timestamp;
  const c = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(t) || !Array.isArray(c) || t.length === 0) return null;
  return { t, c };
}

export function resetYahooSessionCache(): void {
  sessionCache = null;
  sessionPromise = null;
}
