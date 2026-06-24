import type { PortfolioResponse, TransactionRow, WatchlistResponse } from "./api";

/** Illustrative FX for demo display (not live). */
export const DEMO_FX_SGD_PER_USD = 1.299;

export const DEMO_TRANSACTIONS: TransactionRow[] = [
  {
    id: "demo-tx-1",
    occurred_at: "2022-03-15T12:00:00.000Z",
    side: "buy",
    ticker: "AAPL",
    name: "Apple",
    quantity: 40,
    price_usd: 155,
    fx_sgd_per_usd: 1.35,
    funding_source: "dbs",
    fees_usd: 0,
    notes: "Initial DBS deployment",
  },
  {
    id: "demo-tx-2",
    occurred_at: "2022-06-01T12:00:00.000Z",
    side: "buy",
    ticker: "GOOGL",
    name: "Alphabet",
    quantity: 25,
    price_usd: 108.5,
    fx_sgd_per_usd: 1.35,
    funding_source: "dbs",
    fees_usd: 0,
    notes: "Core tech holding",
  },
  {
    id: "demo-tx-3",
    occurred_at: "2023-01-10T12:00:00.000Z",
    side: "buy",
    ticker: "NVDA",
    name: "NVIDIA",
    quantity: 60,
    price_usd: 28.5,
    fx_sgd_per_usd: 1.35,
    funding_source: "bonus",
    fees_usd: 0,
    notes: "Bonus allocation",
  },
  {
    id: "demo-tx-4",
    occurred_at: "2023-08-20T12:00:00.000Z",
    side: "buy",
    ticker: "MSFT",
    name: "Microsoft",
    quantity: 30,
    price_usd: 315,
    fx_sgd_per_usd: 1.35,
    funding_source: "dbs",
    fees_usd: 4.95,
    notes: "Quality compounder",
  },
  {
    id: "demo-tx-5",
    occurred_at: "2024-11-05T12:00:00.000Z",
    side: "sell",
    ticker: "NVDA",
    name: "NVIDIA",
    quantity: 20,
    price_usd: 145,
    fx_sgd_per_usd: 1.34,
    funding_source: "unspecified",
    fees_usd: 1,
    notes: "Trim after strong run",
  },
];

const prices = {
  AAPL: 228,
  GOOGL: 178,
  NVDA: 142,
  MSFT: 445,
} as const;

const portfolioValueUsd = 32600;
const costBasisUsd = 19502.5;
const netGainUsd = portfolioValueUsd - costBasisUsd;

export const DEMO_PORTFOLIO: PortfolioResponse = {
  liveFxSgdPerUsd: DEMO_FX_SGD_PER_USD,
  prices: { ...prices },
  positions: [
    {
      ticker: "MSFT",
      name: "Microsoft",
      shares: 30,
      costBasisUsd: 9454.95,
      avgCostUsd: 315.165,
      marketPriceUsd: prices.MSFT,
      marketValueUsd: 13350,
      marketValueSgd: 13350 * DEMO_FX_SGD_PER_USD,
      pctOfPortfolio: 0.4095,
      xirr: 0.218,
      weightedXirrContribution: 0.0893,
    },
    {
      ticker: "AAPL",
      name: "Apple",
      shares: 40,
      costBasisUsd: 6200,
      avgCostUsd: 155,
      marketPriceUsd: prices.AAPL,
      marketValueUsd: 9120,
      marketValueSgd: 9120 * DEMO_FX_SGD_PER_USD,
      pctOfPortfolio: 0.2798,
      xirr: 0.152,
      weightedXirrContribution: 0.0425,
    },
    {
      ticker: "NVDA",
      name: "NVIDIA",
      shares: 40,
      costBasisUsd: 1140,
      avgCostUsd: 28.5,
      marketPriceUsd: prices.NVDA,
      marketValueUsd: 5680,
      marketValueSgd: 5680 * DEMO_FX_SGD_PER_USD,
      pctOfPortfolio: 0.1742,
      xirr: 0.462,
      weightedXirrContribution: 0.0805,
    },
    {
      ticker: "GOOGL",
      name: "Alphabet",
      shares: 25,
      costBasisUsd: 2712.5,
      avgCostUsd: 108.5,
      marketPriceUsd: prices.GOOGL,
      marketValueUsd: 4450,
      marketValueSgd: 4450 * DEMO_FX_SGD_PER_USD,
      pctOfPortfolio: 0.1365,
      xirr: 0.118,
      weightedXirrContribution: 0.0161,
    },
  ],
  capital: {
    dbsCapitalDeployedUsd: 18367.45,
    dbsCapitalDeployedSgd: 18367.45 * DEMO_FX_SGD_PER_USD,
    bonusCapitalDeployedUsd: 1710,
    bonusCapitalDeployedSgd: 1710 * DEMO_FX_SGD_PER_USD,
    recoveredCapitalFromSalesUsd: 2899,
    recoveredCapitalFromSalesSgd: 2899 * DEMO_FX_SGD_PER_USD,
    totalRecycledCapitalUsd: 0,
    totalRecycledCapitalSgd: 0,
    totalUnrecycledCapitalUsd: 2899,
    totalUnrecycledCapitalSgd: 2899 * DEMO_FX_SGD_PER_USD,
    totalInvestedCapitalUsd: costBasisUsd,
    totalInvestedCapitalSgd: costBasisUsd * DEMO_FX_SGD_PER_USD,
    currentPortfolioValueUsd: portfolioValueUsd,
    currentPortfolioValueSgd: portfolioValueUsd * DEMO_FX_SGD_PER_USD,
    netGainLossUsd: netGainUsd,
    netGainLossSgd: netGainUsd * DEMO_FX_SGD_PER_USD,
    portfolioXirr: 0.184,
    averageHoldingXirr: 0.2375,
    fxSgdPerUsdLatest: DEMO_FX_SGD_PER_USD,
  },
};

/** Illustrative 1-month close series for demo sparklines (not live). */
function demoChartCloses(start: number, end: number, points = 22): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const wiggle = Math.sin(i * 0.55) * (end - start) * 0.04;
    out.push(start + (end - start) * t + wiggle);
  }
  return out;
}

export const DEMO_WATCHLIST: WatchlistResponse = {
  max: 4,
  items: [
    {
      ticker: "AMD",
      name: "Advanced Micro Devices, Inc.",
      priceUsd: 118.4,
      changePct: 0.034,
      chartCloses: demoChartCloses(108, 118.4),
    },
    {
      ticker: "META",
      name: "Meta Platforms, Inc.",
      priceUsd: 612.5,
      changePct: -0.012,
      chartCloses: demoChartCloses(620, 612.5),
    },
    {
      ticker: "TSLA",
      name: "Tesla, Inc.",
      priceUsd: 294.3,
      changePct: 0.021,
      chartCloses: demoChartCloses(288, 294.3),
    },
    {
      ticker: "AMZN",
      name: "Amazon.com, Inc.",
      priceUsd: 228.9,
      changePct: 0.008,
      chartCloses: demoChartCloses(227, 228.9),
    },
  ],
};
