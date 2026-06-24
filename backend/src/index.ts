import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import { nanoid } from "nanoid";
import { z } from "zod";
import { connectDb, getDb } from "./db.js";
import type { TransactionRow } from "./portfolio.js";
import { buildPortfolio } from "./portfolio.js";
import { fetchPrices, fetchUsdSgdLive } from "./prices.js";
import { validateLedger, validateRecycledFunding } from "./validate.js";
import { buildAnalyticsBundle } from "./analyticsBundle.js";
import { buildInvestmentIdeasInput } from "./investmentIdeasPayload.js";
import { INVESTMENT_IDEAS_SYSTEM_INSTRUCTION } from "./investmentIdeasPrompt.js";
import { geminiGenerateText, getGeminiAnalyticsModelPolicy } from "./gemini.js";
import { loadWatchlistPayload } from "./watchlistPayload.js";
import { registerAuthRoutes, requireAuth } from "./auth.js";
import {
  parseTransactionsCsv,
  validateImportAgainstLedger,
  csvImportRowToTransactionRow,
} from "./csvImport.js";
import {
  saveAnalyticsReport,
  listAnalyticsReports,
  getAnalyticsReport,
  getPreviousAnalyticsReport,
  deleteAnalyticsReport,
} from "./mongo/analyticsReports.js";
import {
  bulkDeleteTransactions,
  deleteTransaction,
  getUserTransaction,
  insertTransaction,
  insertTransactionsBatch,
  listUserTransactions,
  updateTransaction,
} from "./mongo/transactions.js";
import { replaceWatchlist } from "./mongo/watchlist.js";
import {
  lookupEquityCloseOnTradeDate,
  lookupUsdSgdOnTradeDate,
  occurredAtFromTradeDateYmd,
  validateTradeCalendarDate,
} from "./historicalQuotes.js";
import { fetchPriceChartData, isPriceChartRange } from "./priceChart.js";
import { loadServerEnv } from "./loadEnv.js";
import {
  corsOrigin,
  getSessionCookieName,
  getSessionCookieOptions,
  isCrossOriginDeployment,
  shouldTrustProxy,
} from "./httpConfig.js";
import { warmYahooSession } from "./yahooFinance.js";

loadServerEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, "../../client/dist");

const app = express();

if (shouldTrustProxy()) {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json());

const sessionCookie = getSessionCookieOptions();
app.use(
  session({
    name: getSessionCookieName(),
    secret: process.env.SESSION_SECRET ?? "openfolio-dev-session-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: sessionCookie,
  })
);

if (isCrossOriginDeployment()) {
  console.log("Cross-origin mode: CLIENT_ORIGINS=", process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN);
  console.log(`Session cookie: sameSite=${sessionCookie.sameSite}, secure=${sessionCookie.secure}`);
}

const insertSchema = z.object({
  occurredAt: z.string().min(4),
  side: z.enum(["buy", "sell"]),
  ticker: z.string().min(1).max(16),
  name: z.string().max(128).optional().nullable(),
  quantity: z.number().positive(),
  priceUsd: z.number().nonnegative(),
  fxSgdPerUsd: z.number().positive().optional(),
  fundingSource: z.enum(["dbs", "proceeds", "bonus"]).optional(),
  feesUsd: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/transactions", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const rows = await listUserTransactions(getDb(), userId);
  res.json(rows);
});

app.post("/api/transactions", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = insertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const existing = await listUserTransactions(getDb(), userId);
  const fx = b.fxSgdPerUsd ?? 1.35;
  const funding = b.side === "sell" ? "unspecified" : (b.fundingSource ?? "dbs");
  const proposedRow: TransactionRow = {
    id: "__pending__",
    occurred_at: new Date(b.occurredAt).toISOString(),
    side: b.side,
    ticker: b.ticker.trim().toUpperCase(),
    name: b.name ?? null,
    quantity: b.quantity,
    price_usd: b.priceUsd,
    fx_sgd_per_usd: fx,
    funding_source: funding,
    fees_usd: b.feesUsd ?? 0,
    notes: b.notes ?? null,
  };
  const v = validateLedger([...existing, proposedRow]);
  if (!v.ok) {
    res.status(400).json({ error: v.message });
    return;
  }
  const vr = validateRecycledFunding([...existing, proposedRow]);
  if (!vr.ok) {
    res.status(400).json({ error: vr.message });
    return;
  }
  const id = nanoid();
  const row = await insertTransaction(getDb(), {
    legacyUserId: userId,
    legacyId: id,
    occurred_at: proposedRow.occurred_at,
    side: proposedRow.side,
    ticker: proposedRow.ticker,
    name: proposedRow.name,
    quantity: proposedRow.quantity,
    price_usd: proposedRow.price_usd,
    fx_sgd_per_usd: proposedRow.fx_sgd_per_usd,
    funding_source: proposedRow.funding_source,
    fees_usd: proposedRow.fees_usd,
    notes: proposedRow.notes,
  });
  res.status(201).json(row);
});

app.patch("/api/transactions/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "Transaction id is required." });
    return;
  }
  const existingRow = await getUserTransaction(getDb(), userId, id);
  if (!existingRow) {
    res.status(404).json({ error: "Transaction not found." });
    return;
  }

  const parsed = insertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const others = (await listUserTransactions(getDb(), userId)).filter((r) => r.id !== id);
  const fx = b.fxSgdPerUsd ?? existingRow.fx_sgd_per_usd;
  const funding = b.side === "sell" ? "unspecified" : (b.fundingSource ?? existingRow.funding_source);
  const proposedRow: TransactionRow = {
    id,
    occurred_at: new Date(b.occurredAt).toISOString(),
    side: b.side,
    ticker: b.ticker.trim().toUpperCase(),
    name: b.name ?? null,
    quantity: b.quantity,
    price_usd: b.priceUsd,
    fx_sgd_per_usd: fx,
    funding_source: funding,
    fees_usd: b.feesUsd ?? 0,
    notes: b.notes ?? null,
  };
  const v = validateLedger([...others, proposedRow]);
  if (!v.ok) {
    res.status(400).json({ error: v.message });
    return;
  }
  const vr = validateRecycledFunding([...others, proposedRow]);
  if (!vr.ok) {
    res.status(400).json({ error: vr.message });
    return;
  }

  const row = await updateTransaction(getDb(), userId, id, {
    occurred_at: proposedRow.occurred_at,
    side: proposedRow.side,
    ticker: proposedRow.ticker,
    name: proposedRow.name,
    quantity: proposedRow.quantity,
    price_usd: proposedRow.price_usd,
    fx_sgd_per_usd: proposedRow.fx_sgd_per_usd,
    funding_source: proposedRow.funding_source,
    fees_usd: proposedRow.fees_usd,
    notes: proposedRow.notes,
  });
  res.json(row);
});

const importPreviewSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});

app.post("/api/transactions/import/preview", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = importPreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide csv: file contents as text." });
    return;
  }
  const result = parseTransactionsCsv(parsed.data.csv);
  if (!result.ok) {
    res.status(400).json({ errors: result.errors });
    return;
  }
  const existing = await listUserTransactions(getDb(), userId);
  const ledgerCheck = validateImportAgainstLedger(existing, result.rows);
  res.json({
    rowCount: result.rows.length,
    rows: result.rows,
    ledgerOk: ledgerCheck.ok,
    ledgerError: ledgerCheck.ok ? null : ledgerCheck.message,
  });
});

const importCommitSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});

app.post("/api/transactions/import/commit", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = importCommitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide csv: file contents as text." });
    return;
  }
  const result = parseTransactionsCsv(parsed.data.csv);
  if (!result.ok) {
    res.status(400).json({ errors: result.errors });
    return;
  }
  const existing = await listUserTransactions(getDb(), userId);
  const ledgerCheck = validateImportAgainstLedger(existing, result.rows);
  if (!ledgerCheck.ok) {
    res.status(400).json({ error: ledgerCheck.message });
    return;
  }

  const batch = result.rows.map((row) => {
    const id = nanoid();
    const tx = csvImportRowToTransactionRow(row, id);
    return {
      legacyId: id,
      occurred_at: tx.occurred_at,
      side: tx.side,
      ticker: tx.ticker,
      name: tx.name,
      quantity: tx.quantity,
      price_usd: tx.price_usd,
      fx_sgd_per_usd: tx.fx_sgd_per_usd,
      funding_source: tx.funding_source,
      fees_usd: tx.fees_usd,
      notes: tx.notes,
    };
  });
  const inserted = await insertTransactionsBatch(getDb(), userId, batch);
  res.status(201).json({ inserted });
});

app.delete("/api/transactions/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "Transaction id is required." });
    return;
  }
  const ok = await deleteTransaction(getDb(), userId, id);
  if (!ok) {
    res.status(404).json({ error: "Transaction not found." });
    return;
  }
  res.status(204).send();
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

app.post("/api/transactions/bulk-delete", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide ids: a non-empty array of transaction ids (max 200)." });
    return;
  }
  const ids = [...new Set(parsed.data.ids)];
  const existing = await listUserTransactions(getDb(), userId);
  const found = existing.filter((t) => ids.includes(t.id)).length;
  if (found !== ids.length) {
    res.status(400).json({ error: "Some transactions were not found or do not belong to your account." });
    return;
  }
  const deleted = await bulkDeleteTransactions(getDb(), userId, ids);
  res.json({ deleted });
});

app.get("/api/analytics/model-policy", requireAuth, (_req, res) => {
  res.json({ policy: getGeminiAnalyticsModelPolicy() });
});

const ANALYZE_SYSTEM = `You are an experienced portfolio reviewer helping a retail investor reflect on past trades.
You receive ONE JSON object that mirrors their OpenFolio app: capital overview, open positions (with weights and XIRR where available), latest prices, USD/SGD spot, the full chronological transaction ledger (including funding_source and fees), and a short watchlist.
Rules:
- Base conclusions only on the provided data. If something is unknown, say so.
- Reference specific trades by date, ticker, side, and quantity where helpful.
- Group commentary into: (1) decisions that look sound in hindsight, (2) trades or patterns that might have room to improve timing, sizing, or diversification for better future outcomes, (3) weaker or costly outcomes and what to learn from them.
- Be direct but not alarmist. This is educational reflection, not personalized investment advice.`;

app.post("/api/analytics/analyze-portfolio", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const db = getDb();
    const bundle = await buildAnalyticsBundle(db, userId);
    const userPayload = JSON.stringify(bundle);
    const text = await geminiGenerateText(
      ANALYZE_SYSTEM,
      `Here is the complete portfolio dataset (Home metrics, positions/breakdown fields, ledger, watchlist):\n\n${userPayload}`
    );
    res.json({ analysis: text });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    res.status(msg.includes("GEMINI_API_KEY") ? 503 : 500).json({ error: msg });
  }
});

app.post("/api/analytics/investment-ideas", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const db = getDb();
    const payload = await buildInvestmentIdeasInput(db, userId);
    const userPayload = JSON.stringify(payload);
    const text = await geminiGenerateText(
      INVESTMENT_IDEAS_SYSTEM_INSTRUCTION,
      `Structured OpenFolio input (schema investmentIdeasInput.v1). Follow your system instructions exactly.\n\n${userPayload}`,
      { maxOutputTokens: 8192 }
    );
    res.json({ ideas: text });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    res.status(msg.includes("GEMINI_API_KEY") ? 503 : 500).json({ error: msg });
  }
});

const saveReportSchema = z.object({
  kind: z.enum(["portfolio_analysis", "investment_ideas"]),
  body: z.string().min(1).max(500_000),
});

app.post("/api/analytics/reports", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const parsed = saveReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const db = getDb();
    const reportId = nanoid();
    await saveAnalyticsReport(db, userId, parsed.data.kind, parsed.data.body, reportId);
    const report = await getAnalyticsReport(db, userId, reportId);
    if (!report) {
      res.status(500).json({ error: "Report saved but could not be loaded." });
      return;
    }
    res.status(201).json({ report });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/analytics/reports", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const kindRaw = String(req.query.kind ?? "").trim();
  const kind =
    kindRaw === "portfolio_analysis" || kindRaw === "investment_ideas" ? kindRaw : undefined;
  res.json({ reports: await listAnalyticsReports(getDb(), userId, { kind, limit: 50 }) });
});

app.get("/api/analytics/reports/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = String(req.params.id ?? "").trim();
  const report = await getAnalyticsReport(getDb(), userId, id);
  if (!report) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  const previous = await getPreviousAnalyticsReport(getDb(), userId, report.kind, report.createdAt);
  res.json({ report, previous });
});

app.delete("/api/analytics/reports/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const id = String(req.params.id ?? "").trim();
  if (!(await deleteAnalyticsReport(getDb(), userId, id))) {
    res.status(404).json({ error: "Report not found." });
    return;
  }
  res.status(204).send();
});

app.get("/api/market/price-chart", async (req, res) => {
  try {
    const ticker = String(req.query.ticker ?? "").trim();
    const rangeRaw = String(req.query.range ?? "1mo").trim();
    if (!ticker) {
      res.status(400).json({ error: "Query parameter ticker is required." });
      return;
    }
    if (!isPriceChartRange(rangeRaw)) {
      res.status(400).json({ error: "Query parameter range must be 1w, 1mo, 6mo, or ytd." });
      return;
    }
    const chart = await fetchPriceChartData(ticker, rangeRaw);
    res.json({
      ticker: ticker.toUpperCase(),
      range: rangeRaw,
      name: chart.name,
      changePct: chart.changePct,
      closes: chart.closes,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/market/trade-date-quote", async (req, res) => {
  try {
    const ticker = String(req.query.ticker ?? "").trim();
    const date = String(req.query.date ?? "").trim();
    if (!ticker) {
      res.status(400).json({ error: "Query parameter ticker is required." });
      return;
    }
    const dv = validateTradeCalendarDate(date);
    if (!dv.ok) {
      res.status(400).json({ error: dv.message });
      return;
    }

    const [fx, px] = await Promise.all([
      lookupUsdSgdOnTradeDate(dv.ymd),
      lookupEquityCloseOnTradeDate(ticker, dv.ymd),
    ]);

    if (!fx.ok || !px.ok) {
      const parts: string[] = [];
      if (!fx.ok) parts.push(`USD/SGD: ${fx.message}`);
      if (!px.ok) parts.push(`Share price: ${px.message}`);
      res.status(400).json({
        error: parts.join(" "),
        details: { fxOk: fx.ok, priceOk: px.ok },
      });
      return;
    }

    res.json({
      ticker: ticker.toUpperCase(),
      tradeDate: dv.ymd,
      priceUsd: px.priceUsd,
      fxSgdPerUsd: fx.fxSgdPerUsd,
      priceBarUtc: new Date(px.barUtcMs).toISOString(),
      fxBarUtc: new Date(fx.barUtcMs).toISOString(),
      occurredAt: occurredAtFromTradeDateYmd(dv.ymd),
      dataProvider:
        "Yahoo Finance daily chart (Google Finance does not provide a stable historical API for automated server access).",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/fx/today", async (_req, res) => {
  try {
    const fx = await fetchUsdSgdLive();
    if (fx == null) {
      res.status(502).json({ error: "Could not load USD/SGD spot." });
      return;
    }
    res.json({ fxSgdPerUsd: fx });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/watchlist", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    res.json(await loadWatchlistPayload(getDb(), userId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

const watchlistPutSchema = z.object({
  tickers: z.array(z.string()).max(4),
});

app.put("/api/watchlist", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const parsed = watchlistPutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const uniq = [
      ...new Set(parsed.data.tickers.map((s) => s.trim().toUpperCase()).filter(Boolean)),
    ];
    if (uniq.length > 4) {
      res.status(400).json({ error: "Watchlist supports at most 4 tickers." });
      return;
    }
    await replaceWatchlist(getDb(), userId, uniq);
    res.json(await loadWatchlistPayload(getDb(), userId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/portfolio", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const rows = await listUserTransactions(getDb(), userId);
    const tickers = [...new Set(rows.map((r) => r.ticker.trim().toUpperCase()))];
    const allSymbols = [...new Set([...tickers, "USDSGD=X"])];
    const prices = await fetchPrices(allSymbols);
    const { positions, capital } = buildPortfolio(rows, prices);
    const liveFxSgdPerUsd = prices["USDSGD=X"] ?? null;
    res.json({
      capital,
      positions,
      prices,
      liveFxSgdPerUsd,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

const port = Number(process.env.PORT ?? 8787);
/** Render sets PORT; bind 0.0.0.0 in that case. Local dev stays on 127.0.0.1. */
const host = process.env.HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

const serveClient =
  process.env.SERVE_CLIENT === "true" ||
  (process.env.SERVE_CLIENT !== "false" && fs.existsSync(path.join(clientDistDir, "index.html")));

if (serveClient) {
  app.use(express.static(clientDistDir));
  app.get(/^(?!\/api\/).*/, (_req, res, next) => {
    const indexHtml = path.join(clientDistDir, "index.html");
    if (!fs.existsSync(indexHtml)) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
  console.log(`Serving web UI from ${clientDistDir}`);
}

async function start(): Promise<void> {
  const db = await connectDb();
  registerAuthRoutes(app, db);
  void warmYahooSession();
  setInterval(() => void warmYahooSession(), 25 * 60 * 1000);
  app.listen(port, host, () => {
    const label = serveClient ? "OpenFolio (API + web UI)" : "OpenFolio API";
    console.log(`${label} listening on http://${host}:${port}`);
    if (!serveClient) {
      console.log("  Dev UI: run the Vite client (http://127.0.0.1:5000/OpenFolio/).");
    }
  });
}

start().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
