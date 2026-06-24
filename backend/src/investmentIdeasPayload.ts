import type { Db } from "mongodb";
import type { CapitalOverview, Position, TransactionRow } from "./portfolio.js";
import { buildAnalyticsBundle } from "./analyticsBundle.js";

/** Yahoo-style forex symbols and common currency / dollar-index products. */
const CURRENCY_OR_FX_TICKERS = new Set<string>([
  "UUP",
  "UDN",
  "ULE",
  "EUO",
  "FXE",
  "FXY",
  "FXB",
  "FXC",
  "FXF",
  "FXA",
  "CYB",
  "YCL",
  "USDU",
  "ERO",
  "EUFX",
  "DBV",
  "CEW",
  "ICI",
]);

function isFxOrCurrencyRelatedTransaction(t: TransactionRow): boolean {
  const raw = t.ticker.trim();
  const tk = raw.toUpperCase();
  if (tk.includes("=X")) return true;
  if (CURRENCY_OR_FX_TICKERS.has(tk)) return true;
  const name = (t.name ?? "").toLowerCase();
  if (/\b(forex|foreign exchange|currency shares|currencyshares)\b/.test(name)) return true;
  if (/\b(us )?dollar index\b/.test(name)) return true;
  if (/\bcurrency (hedged|hedge|etf|etn|trust)\b/.test(name)) return true;
  return false;
}

function r4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function computeDerived(positions: Position[], equityTx: TransactionRow[], capital: CapitalOverview) {
  const weights = positions.map((p) => p.pctOfPortfolio);
  const hhi = weights.reduce((s, w) => s + w * w, 0);

  let buyCount = 0;
  let sellCount = 0;
  let dbs = 0;
  let proceeds = 0;
  let bonus = 0;
  let unspecified = 0;
  const tickerAgg = new Map<string, { buys: number; sells: number }>();

  for (const tx of equityTx) {
    const tk = tx.ticker.trim().toUpperCase();
    const row = tickerAgg.get(tk) ?? { buys: 0, sells: 0 };
    if (tx.side === "buy") {
      buyCount++;
      row.buys++;
      if (tx.funding_source === "dbs") dbs++;
      else if (tx.funding_source === "proceeds") proceeds++;
      else if (tx.funding_source === "bonus") bonus++;
      else unspecified++;
    } else {
      sellCount++;
      row.sells++;
    }
    tickerAgg.set(tk, row);
  }

  const times = equityTx.map((x) => new Date(x.occurred_at).getTime()).filter(Number.isFinite);
  const firstTradeDate = times.length ? new Date(Math.min(...times)).toISOString().slice(0, 10) : null;
  const lastTradeDate = times.length ? new Date(Math.max(...times)).toISOString().slice(0, 10) : null;

  const tickersByActivity = [...tickerAgg.entries()]
    .map(([ticker, c]) => ({ ticker, totalTrades: c.buys + c.sells, buys: c.buys, sells: c.sells }))
    .sort((a, b) => b.totalTrades - a.totalTrades)
    .slice(0, 16);

  const openPositionsOrderedByWeight = positions.map((p) => ({
    ticker: p.ticker,
    name: p.name,
    pctOfPortfolio: r4(p.pctOfPortfolio * 100),
    shares: r4(p.shares),
    marketValueUsd: r4(p.marketValueUsd),
    costBasisUsd: r4(p.costBasisUsd),
    avgCostUsd: r4(p.avgCostUsd),
    marketPriceUsd: p.marketPriceUsd != null ? r4(p.marketPriceUsd) : null,
    xirrAnnualized: p.xirr != null && Number.isFinite(p.xirr) ? r4(p.xirr) : null,
    weightedXirrContribution:
      p.weightedXirrContribution != null && Number.isFinite(p.weightedXirrContribution)
        ? r4(p.weightedXirrContribution)
        : null,
  }));

  const xirrs = positions
    .map((p) => p.xirr)
    .filter((x): x is number => x != null && Number.isFinite(x));
  const xirrMin = xirrs.length ? r4(Math.min(...xirrs)) : null;
  const xirrMax = xirrs.length ? r4(Math.max(...xirrs)) : null;

  return {
    concentrationHerfindahlHhi: r4(hhi),
    openPositionCount: positions.length,
    equityLedgerTradeCounts: {
      buyCount,
      sellCount,
      uniqueTickersWithEquityTrades: tickerAgg.size,
    },
    buyFundingSourceCounts: { dbs, proceeds, bonus, unspecified },
    equityTradeCalendarSpan: { firstTradeDate, lastTradeDate },
    tickersRankedByEquityTradeCount: tickersByActivity,
    openPositionsOrderedByWeight,
    portfolioLevel: {
      currentPortfolioValueUsd: r4(capital.currentPortfolioValueUsd),
      netGainLossUsd: r4(capital.netGainLossUsd),
      portfolioXirrAnnualized:
        capital.portfolioXirr != null && Number.isFinite(capital.portfolioXirr)
          ? r4(capital.portfolioXirr)
          : null,
      averageHoldingXirrAnnualized:
        capital.averageHoldingXirr != null && Number.isFinite(capital.averageHoldingXirr)
          ? r4(capital.averageHoldingXirr)
          : null,
      perPositionXirrRange: xirrs.length ? { min: xirrMin, max: xirrMax } : null,
    },
  };
}

export type InvestmentIdeasInputV1 = {
  schema: "investmentIdeasInput.v1";
  generatedAt: string;
  marketContext: {
    liveFxSgdPerUsdSpot: number | null;
    fxSgdPerUsdLatestFromLedger: number;
    note: string;
  };
  capital: CapitalOverview;
  positions: Position[];
  latestPrices: Record<string, number | null>;
  watchlist: { items: { ticker: string; priceUsd: number | null; change1moPct: number | null }[]; max: number };
  holdingsTickers: string[];
  watchlistTickers: string[];
  derivedPortfolioSummary: ReturnType<typeof computeDerived>;
  equityTransactionsForBehaviorAnalysis: TransactionRow[];
  transactionsExcludedFromAnalysis: {
    id: string;
    occurred_at: string;
    side: string;
    ticker: string;
    name: string | null;
    exclusionReason: string;
  }[];
};

/**
 * Full aggregated snapshot for Investment Ideas: same underlying data as analytics bundle,
 * plus derived metrics, explicit ticker sets, and FX/currency-only rows stripped from behavior analysis.
 */
export async function buildInvestmentIdeasInput(
  db: Db,
  userId: string
): Promise<InvestmentIdeasInputV1> {
  const bundle = await buildAnalyticsBundle(db, userId);
  const positions = bundle.positions as Position[];
  const capital = bundle.capital as CapitalOverview;
  const allTx = bundle.transactions;

  type WlItem = { ticker: string; priceUsd: number | null; change1moPct: number | null };
  const watchlist = bundle.watchlist as { items: WlItem[]; max: number };

  const excluded = allTx.filter(isFxOrCurrencyRelatedTransaction);
  const equityTx = allTx.filter((t) => !isFxOrCurrencyRelatedTransaction(t));

  const holdingsTickers = [...new Set(positions.map((p) => p.ticker.trim().toUpperCase()))].sort();
  const watchlistTickers = watchlist.items.map((it) => it.ticker.trim().toUpperCase());

  const derivedPortfolioSummary = computeDerived(positions, equityTx, capital);

  return {
    schema: "investmentIdeasInput.v1",
    generatedAt: bundle.generatedAt,
    marketContext: {
      liveFxSgdPerUsdSpot: bundle.liveFxSgdPerUsd,
      fxSgdPerUsdLatestFromLedger: capital.fxSgdPerUsdLatest,
      note:
        "fx_sgd_per_usd on equity transactions is the USD/SGD rate at trade time for reporting; excluded rows are currency/FX instruments and must not drive style inference.",
    },
    capital,
    positions,
    latestPrices: bundle.prices,
    watchlist,
    holdingsTickers,
    watchlistTickers,
    derivedPortfolioSummary,
    equityTransactionsForBehaviorAnalysis: equityTx,
    transactionsExcludedFromAnalysis: excluded.map((t) => ({
      id: t.id,
      occurred_at: t.occurred_at,
      side: t.side,
      ticker: t.ticker,
      name: t.name,
      exclusionReason: "fx_or_currency_instrument",
    })),
  };
}
