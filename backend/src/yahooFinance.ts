/**
 * Yahoo Finance access for server-side use (Render, local API).
 * Datacenter IPs require cookie + crumb. All outbound calls are serialized
 * to avoid session races and rate-limit flakes.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const SESSION_TTL_MS = 25 * 60 * 1000;
const QUOTE_CHUNK = 20;
const MAX_ATTEMPTS = 3;

type YahooSession = { cookie: string; crumb: string; at: number };

let sessionCache: YahooSession | null = null;
let sessionRefresh: Promise<YahooSession> | null = null;

/** Serialize every Yahoo HTTP call so sessions are never used concurrently. */
let yahooChain: Promise<unknown> = Promise.resolve();

function withYahooLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = yahooChain.then(fn, fn);
  yahooChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const attempts: Array<() => Promise<string>> = [
    async () => {
      const res = await fetch("https://fc.yahoo.com", {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      let cookies = cookieHeaderFromSetCookies(collectSetCookies(res));
      if ((res.status === 301 || res.status === 302) && !cookies) {
        const location = res.headers.get("location");
        if (location) {
          const next = await fetch(location, {
            redirect: "manual",
            headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
          });
          cookies = cookieHeaderFromSetCookies(collectSetCookies(next));
        }
      }
      if (!cookies) throw new Error("no cookie from fc.yahoo.com");
      return cookies;
    },
    async () => {
      const res = await fetch("https://finance.yahoo.com", {
        redirect: "follow",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      });
      const cookies = cookieHeaderFromSetCookies(collectSetCookies(res));
      if (!cookies) throw new Error("no cookie from finance.yahoo.com");
      return cookies;
    },
  ];

  let cookies = "";
  let lastErr: unknown;
  for (const tryCookie of attempts) {
    try {
      cookies = await tryCookie();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!cookies) {
    throw new Error(`Yahoo Finance session cookie unavailable: ${lastErr}`);
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

function invalidateSession(): void {
  sessionCache = null;
}

async function getYahooSession(): Promise<YahooSession> {
  const now = Date.now();
  if (sessionCache && now - sessionCache.at < SESSION_TTL_MS) {
    return sessionCache;
  }
  if (!sessionRefresh) {
    sessionRefresh = fetchYahooSession()
      .then((session) => {
        sessionCache = session;
        return session;
      })
      .finally(() => {
        sessionRefresh = null;
      });
  }
  return sessionRefresh;
}

/** Pre-warm Yahoo session (call on server start and periodically). */
export async function warmYahooSession(): Promise<boolean> {
  try {
    await withYahooLock(() => getYahooSession());
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
      meta?: {
        regularMarketPrice?: number;
        symbol?: string;
        currency?: string;
        shortName?: string;
        longName?: string;
      };
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

async function yahooGet(url: string, session: YahooSession): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "application/json",
      Cookie: session.cookie,
    },
  });
}

function applyQuoteRows(
  out: Record<string, number | null>,
  json: YahooQuoteResponse
): void {
  for (const row of json.quoteResponse?.result ?? []) {
    const sym = normalizeYahooSymbol(row.symbol ?? "");
    const px = row.regularMarketPrice;
    if (sym && typeof px === "number" && Number.isFinite(px)) {
      out[sym] = px;
    }
  }
}

async function fetchQuoteChunk(
  chunk: string[],
  session: YahooSession
): Promise<YahooQuoteResponse> {
  const symbolsParam = chunk.map(encodeURIComponent).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsParam}&crumb=${encodeURIComponent(session.crumb)}`;
  const res = await yahooGet(url, session);
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Yahoo auth failed (${res.status}).`);
  }
  if (res.status === 429) {
    throw new Error("Yahoo rate limited (429).");
  }
  if (!res.ok) {
    throw new Error(`Yahoo quote request failed (${res.status}).`);
  }
  const json = (await res.json()) as YahooQuoteResponse;
  if (json.quoteResponse?.error) {
    throw new Error(String(json.quoteResponse.error.description ?? "Yahoo quote error."));
  }
  return json;
}

/** Batch live quotes — one HTTP call per chunk, serialized globally. */
export async function fetchYahooQuotes(symbols: string[]): Promise<Record<string, number | null>> {
  return withYahooLock(() => fetchYahooQuotesLocked(symbols));
}

async function fetchYahooQuotesLocked(symbols: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(symbols.map(normalizeYahooSymbol).filter(Boolean))];
  const out: Record<string, number | null> = {};
  for (const sym of unique) out[sym] = null;
  if (unique.length === 0) return out;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      invalidateSession();
      await sleep(400 * attempt);
    }

    try {
      const session = await getYahooSession();
      for (let i = 0; i < unique.length; i += QUOTE_CHUNK) {
        const chunk = unique.slice(i, i + QUOTE_CHUNK);
        const json = await fetchQuoteChunk(chunk, session);
        applyQuoteRows(out, json);
      }

      const got = unique.filter((s) => out[s] != null).length;
      if (got > 0) return out;
      throw new Error("Yahoo quote batch returned no prices.");
    } catch (e) {
      console.warn(`Yahoo quote attempt ${attempt + 1}/${MAX_ATTEMPTS} failed:`, e);
      if (attempt === MAX_ATTEMPTS - 1) {
        console.error("Yahoo quote batch exhausted retries.");
      }
    }
  }

  return out;
}

/** Fetch Yahoo chart JSON (historical / 2-week momentum), serialized globally. */
export async function fetchYahooChart(symbolPath: string, query: string): Promise<YahooChartJson | null> {
  return withYahooLock(() => fetchYahooChartLocked(symbolPath, query));
}

async function fetchYahooChartLocked(symbolPath: string, query: string): Promise<YahooChartJson | null> {
  const sym = encodeURIComponent(normalizeYahooSymbol(symbolPath));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      invalidateSession();
      await sleep(400 * attempt);
    }

    try {
      const session = await getYahooSession();
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${sym}?${query}&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await yahooGet(url, session);
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new Error(`Yahoo chart auth/rate (${res.status}).`);
      }
      if (!res.ok) {
        throw new Error(`Yahoo chart failed (${res.status}).`);
      }
      const json = (await res.json()) as YahooChartJson;
      if (json.chart?.error || !json.chart?.result?.length) {
        throw new Error(json.chart?.error?.description ?? "empty chart result");
      }
      return json;
    } catch (e) {
      console.warn(`Yahoo chart ${symbolPath} attempt ${attempt + 1}/${MAX_ATTEMPTS}:`, e);
    }
  }

  return null;
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
  sessionRefresh = null;
}
