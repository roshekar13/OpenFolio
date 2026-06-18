import { apiFetch } from "./http";

export class AuthError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

type AuthPayload = { user?: AuthUser; token?: string; error?: string; code?: string };

function parseAuthError(status: number, payload: AuthPayload, fallback: string): AuthError {
  if (payload.code === "EMAIL_NOT_FOUND" || status === 404) {
    return new AuthError("Email not recognized. Please register as a new user.", "EMAIL_NOT_FOUND");
  }
  if (payload.code === "WRONG_PASSWORD" || status === 401) {
    return new AuthError("Incorrect password. Please try again.", "WRONG_PASSWORD");
  }
  return new AuthError(typeof payload.error === "string" ? payload.error : fallback);
}

export type FundingSource = "dbs" | "bonus" | "proceeds" | "unspecified";

export type TransactionRow = {
  id: string;
  occurred_at: string;
  side: "buy" | "sell";
  ticker: string;
  name: string | null;
  quantity: number;
  price_usd: number;
  fx_sgd_per_usd: number;
  funding_source: FundingSource;
  fees_usd: number;
  notes: string | null;
};

export type Position = {
  ticker: string;
  name: string | null;
  shares: number;
  costBasisUsd: number;
  avgCostUsd: number;
  marketPriceUsd: number | null;
  marketValueUsd: number;
  marketValueSgd: number;
  pctOfPortfolio: number;
  xirr: number | null;
  weightedXirrContribution: number;
};

export type CapitalOverview = {
  dbsCapitalDeployedUsd: number;
  dbsCapitalDeployedSgd: number;
  bonusCapitalDeployedUsd: number;
  bonusCapitalDeployedSgd: number;
  recoveredCapitalFromSalesUsd: number;
  recoveredCapitalFromSalesSgd: number;
  totalRecycledCapitalUsd: number;
  totalRecycledCapitalSgd: number;
  totalUnrecycledCapitalUsd: number;
  totalUnrecycledCapitalSgd: number;
  totalInvestedCapitalUsd: number;
  totalInvestedCapitalSgd: number;
  currentPortfolioValueUsd: number;
  currentPortfolioValueSgd: number;
  netGainLossUsd: number;
  netGainLossSgd: number;
  portfolioXirr: number | null;
  /** Equal-weight mean of each open holding’s XIRR. */
  averageHoldingXirr: number | null;
  fxSgdPerUsdLatest: number;
};

export type PortfolioResponse = {
  capital: CapitalOverview;
  positions: Position[];
  prices: Record<string, number | null>;
  liveFxSgdPerUsd: number | null;
};

export type WatchlistItem = {
  ticker: string;
  priceUsd: number | null;
  change2wPct: number | null;
};

export type WatchlistResponse = {
  items: WatchlistItem[];
  max: number;
};

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  const r = await apiFetch("/api/portfolio");
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error("Failed to load portfolio");
  return r.json();
}

export async function fetchTransactions(): Promise<TransactionRow[]> {
  const r = await apiFetch("/api/transactions");
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error("Failed to load transactions");
  return r.json();
}

export async function fetchWatchlist(): Promise<WatchlistResponse> {
  const r = await apiFetch("/api/watchlist");
  if (r.status === 401) throw new Error("UNAUTHORIZED");
  if (!r.ok) throw new Error("Failed to load watchlist");
  return (await r.json()) as WatchlistResponse;
}

export async function putWatchlist(tickers: string[]): Promise<WatchlistResponse> {
  const r = await apiFetch("/api/watchlist", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  const j = (await r.json()) as { error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Could not save watchlist.");
  return j as WatchlistResponse;
}

export async function postTransaction(body: Record<string, unknown>): Promise<TransactionRow> {
  const r = await apiFetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error));
  return j as TransactionRow;
}

export async function patchTransaction(
  id: string,
  body: Record<string, unknown>
): Promise<TransactionRow> {
  const r = await apiFetch(`/api/transactions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error));
  return j as TransactionRow;
}

export type CsvImportPreviewRow = {
  rowIndex: number;
  occurredAt: string;
  side: "buy" | "sell";
  ticker: string;
  name: string | null;
  quantity: number;
  priceUsd: number;
  fxSgdPerUsd: number;
  fundingSource: FundingSource;
  feesUsd: number;
  notes: string | null;
};

export type CsvImportPreview = {
  rowCount: number;
  rows: CsvImportPreviewRow[];
  ledgerOk: boolean;
  ledgerError: string | null;
};

export async function postTransactionsImportPreview(csv: string): Promise<CsvImportPreview> {
  const r = await apiFetch("/api/transactions/import/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  const j = (await r.json()) as CsvImportPreview & { errors?: string[]; error?: string };
  if (!r.ok) {
    if (Array.isArray(j.errors)) throw new Error(j.errors.join("\n"));
    throw new Error(typeof j.error === "string" ? j.error : "Import preview failed.");
  }
  return j;
}

export async function postTransactionsImportCommit(csv: string): Promise<{ inserted: number }> {
  const r = await apiFetch("/api/transactions/import/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  const j = (await r.json()) as { inserted?: number; errors?: string[]; error?: string };
  if (!r.ok) {
    if (Array.isArray(j.errors)) throw new Error(j.errors.join("\n"));
    throw new Error(typeof j.error === "string" ? j.error : "Import failed.");
  }
  if (typeof j.inserted !== "number") throw new Error("Invalid import response.");
  return { inserted: j.inserted };
}

export async function deleteTransaction(id: string): Promise<void> {
  const r = await apiFetch(`/api/transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (r.status === 204) return;
  let msg = `Delete failed (${r.status}).`;
  try {
    const j = (await r.json()) as { error?: string };
    if (typeof j.error === "string") msg = j.error;
  } catch {
    /* ignore */
  }
  throw new Error(msg);
}

export async function postBulkDeleteTransactions(ids: string[]): Promise<{ deleted: number }> {
  const r = await apiFetch("/api/transactions/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  const j = (await r.json()) as { deleted?: number; error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Bulk delete failed.");
  if (typeof j.deleted !== "number") throw new Error("Invalid bulk delete response.");
  return { deleted: j.deleted };
}

export async function fetchAnalyticsModelPolicy(): Promise<string> {
  const r = await apiFetch("/api/analytics/model-policy");
  const j = (await r.json()) as { policy?: string; error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Could not load model policy.");
  if (typeof j.policy !== "string") throw new Error("Invalid model policy response.");
  return j.policy;
}

export type AnalyticsReportKind = "portfolio_analysis" | "investment_ideas";

export type AnalyticsReportSummary = {
  id: string;
  kind: AnalyticsReportKind;
  createdAt: string;
  preview: string;
};

export type AnalyticsReportDetail = AnalyticsReportSummary & {
  body: string;
};

export async function fetchAnalyticsReports(kind?: AnalyticsReportKind): Promise<AnalyticsReportSummary[]> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  const r = await apiFetch(`/api/analytics/reports${q}`);
  const j = (await r.json()) as { reports?: AnalyticsReportSummary[]; error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Could not load reports.");
  return j.reports ?? [];
}

export async function fetchAnalyticsReport(
  id: string
): Promise<{ report: AnalyticsReportDetail; previous: AnalyticsReportDetail | null }> {
  const r = await apiFetch(`/api/analytics/reports/${encodeURIComponent(id)}`);
  const j = (await r.json()) as {
    report?: AnalyticsReportDetail;
    previous?: AnalyticsReportDetail | null;
    error?: string;
  };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Report not found.");
  if (!j.report) throw new Error("Invalid report response.");
  return { report: j.report, previous: j.previous ?? null };
}

export async function deleteAnalyticsReport(id: string): Promise<void> {
  const r = await apiFetch(`/api/analytics/reports/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (r.status === 204) return;
  const j = (await r.json()) as { error?: string };
  throw new Error(typeof j.error === "string" ? j.error : "Could not delete report.");
}

export async function postAnalyzePortfolio(): Promise<{ analysis: string; reportId: string }> {
  const r = await apiFetch("/api/analytics/analyze-portfolio", { method: "POST" });
  const j = (await r.json()) as { analysis?: string; reportId?: string; error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Portfolio analysis failed.");
  if (typeof j.analysis !== "string" || typeof j.reportId !== "string") {
    throw new Error("Invalid analysis response.");
  }
  return { analysis: j.analysis, reportId: j.reportId };
}

export async function postInvestmentIdeas(): Promise<{ ideas: string; reportId: string }> {
  const r = await apiFetch("/api/analytics/investment-ideas", { method: "POST" });
  const j = (await r.json()) as { ideas?: string; reportId?: string; error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Investment ideas request failed.");
  if (typeof j.ideas !== "string" || typeof j.reportId !== "string") {
    throw new Error("Invalid ideas response.");
  }
  return { ideas: j.ideas, reportId: j.reportId };
}

export type TradeDateQuoteResponse = {
  ticker: string;
  tradeDate: string;
  priceUsd: number;
  fxSgdPerUsd: number;
  priceBarUtc: string;
  fxBarUtc: string;
  occurredAt: string;
  dataProvider: string;
};

export async function fetchTradeDateQuote(
  ticker: string,
  tradeDate: string
): Promise<TradeDateQuoteResponse> {
  const q = new URLSearchParams({ ticker: ticker.trim(), date: tradeDate.trim() });
  const r = await apiFetch(`/api/market/trade-date-quote?${q.toString()}`);
  const j = (await r.json()) as { error?: string };
  if (!r.ok) {
    throw new Error(typeof j.error === "string" ? j.error : "Could not resolve market data for that date.");
  }
  return j as TradeDateQuoteResponse;
}

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  needsDisplayName: boolean;
  themePreference: "dark" | "light";
};

export async function fetchAuthMe(): Promise<{ user: AuthUser | null }> {
  const r = await apiFetch("/api/auth/me");
  if (!r.ok) throw new Error("Session check failed.");
  const j = (await r.json()) as { user?: AuthUser | null };
  if (!j.user) return { user: null };
  const u = j.user;
  return {
    user: {
      ...u,
      themePreference: u.themePreference === "light" ? "light" : "dark",
    },
  };
}

export async function postAuthLogin(
  email: string,
  password: string
): Promise<{ user: AuthUser; token: string }> {
  const r = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = (await r.json()) as AuthPayload;
  if (!r.ok) throw parseAuthError(r.status, j, "Sign in failed.");
  if (!j.user || !j.token) throw new Error("Invalid sign-in response.");
  return { user: j.user, token: j.token };
}

export async function postAuthRegister(
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: AuthUser; token: string }> {
  const r = await apiFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: displayName || undefined }),
  });
  const j = (await r.json()) as AuthPayload;
  if (!r.ok) throw new AuthError(typeof j.error === "string" ? j.error : "Could not create account.");
  if (!j.user || !j.token) throw new Error("Invalid registration response.");
  return { user: j.user, token: j.token };
}

export async function postAuthLogout(): Promise<void> {
  const r = await apiFetch("/api/auth/logout", { method: "POST" });
  if (!r.ok) throw new Error("Sign out failed.");
}

export async function patchAuthMe(body: { displayName?: string; theme?: "dark" | "light" }): Promise<AuthUser> {
  const r = await apiFetch("/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { user?: AuthUser; error?: string };
  if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Could not update profile.");
  if (!j.user) throw new Error("Invalid profile response.");
  return j.user;
}

export async function patchAuthDisplayName(displayName: string): Promise<AuthUser> {
  return patchAuthMe({ displayName });
}
