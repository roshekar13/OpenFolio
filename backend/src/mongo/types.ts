import type { ObjectId } from "mongodb";
import type { FundingSource, Side } from "../portfolio.js";

export type UserDoc = {
  _id: ObjectId;
  legacy_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  theme: "dark" | "light";
  created_at: Date;
  /** Bearer token for cross-origin clients (GitHub Pages + Render). */
  api_token?: string;
};

export type TransactionDoc = {
  _id: ObjectId;
  legacy_id: string;
  user_id: ObjectId;
  occurred_at: Date;
  side: Side;
  ticker: string;
  name: string | null;
  quantity: import("mongodb").Decimal128;
  price_usd: import("mongodb").Decimal128;
  fx_sgd_per_usd: import("mongodb").Decimal128;
  funding_source: FundingSource;
  fees_usd: import("mongodb").Decimal128;
  notes: string | null;
};

export type WatchlistDoc = {
  _id: ObjectId;
  user_id: ObjectId;
  ticker: string;
  sort_order: number;
};

export type AnalyticsReportKind = "portfolio_analysis" | "investment_ideas";

export type AnalyticsReportDoc = {
  _id: ObjectId;
  legacy_id: string;
  user_id: ObjectId;
  kind: AnalyticsReportKind;
  body: string;
  created_at: Date;
};
