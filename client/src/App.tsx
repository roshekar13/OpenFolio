import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
} from "recharts";
import type { CapitalOverview, PortfolioResponse, Position, TransactionRow, WatchlistResponse } from "./api";
import { fetchPortfolio, fetchTransactions, fetchWatchlist, postBulkDeleteTransactions } from "./api";
import { setAuthToken, getAuthToken } from "./http";
import { AdvancedAnalyticsPage } from "./components/AdvancedAnalyticsPage";
import { BuyVsCurrentChart } from "./components/BuyVsCurrentChart";
import { BrandMark } from "./components/BrandMark";
import { ImportCsvModal } from "./components/ImportCsvModal";
import { TransactionModal } from "./components/TransactionModal";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { DemoBanner } from "./components/DemoBanner";
import { WhyOpenFolioModal } from "./components/WhyOpenFolioModal";
import { DEMO_PORTFOLIO, DEMO_TRANSACTIONS, DEMO_WATCHLIST } from "./demoPortfolio";
import { CurrencyProvider, useCurrency } from "./CurrencyContext";
import { AuthProvider, useAuth } from "./AuthContext";
import { CompleteProfileModal, UserAccountMenu } from "./components/UserAccountMenu";
import { fmtPct, fmtSgd, fmtUsd } from "./format";

const COLORS = [
  "#5eead4",
  "#7c9cff",
  "#fbbf24",
  "#fb7185",
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#4ade80",
  "#f97316",
];

type PageId = "home" | "breakdown" | "ledger" | "analytics";

const NAV: { id: PageId; label: string; hint: string }[] = [
  { id: "home", label: "Home", hint: "Overview & charts" },
  { id: "breakdown", label: "Breakdown", hint: "Full positions table" },
  { id: "ledger", label: "Ledger", hint: "All transactions" },
  { id: "analytics", label: "Advanced Analytics", hint: "AI portfolio review" },
];

function MoneyCard({ label, usdAmount, hint }: { label: string; usdAmount: number; hint?: string }) {
  const { fmtPortfolioMoney, currency } = useCurrency();
  const digits = currency === "USD" ? 0 : 2;
  return (
    <div className="card-surface">
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {fmtPortfolioMoney(usdAmount, digits)}
      </div>
      {hint && (
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>{hint}</div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-surface">
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>{sub}</div>
      )}
    </div>
  );
}

function CurrencyToggle() {
  const { currency, setCurrency, liveFx } = useCurrency();
  const sgdDisabled = liveFx == null;
  return (
    <div
      className="mono"
      style={{
        display: "inline-flex",
        borderRadius: 12,
        border: "1px solid var(--stroke)",
        overflow: "hidden",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <button
        type="button"
        onClick={() => setCurrency("USD")}
        style={{
          padding: "8px 12px",
          border: "none",
          background: currency === "USD" ? "rgba(94,234,212,0.18)" : "transparent",
          color: currency === "USD" ? "var(--text)" : "var(--muted)",
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        USD
      </button>
      <button
        type="button"
        title={sgdDisabled ? "USD/SGD spot unavailable" : `Spot ≈ ${liveFx?.toFixed(4)} SGD/USD`}
        disabled={sgdDisabled}
        onClick={() => setCurrency("SGD")}
        style={{
          padding: "8px 12px",
          border: "none",
          borderLeft: "1px solid var(--stroke)",
          background: currency === "SGD" ? "rgba(94,234,212,0.18)" : "transparent",
          color: currency === "SGD" ? "var(--text)" : "var(--muted)",
          fontWeight: 700,
          fontSize: 12,
          opacity: sgdDisabled ? 0.45 : 1,
        }}
      >
        SGD
      </button>
    </div>
  );
}

function MainHeader({
  pageTitle,
  kicker,
  onRefresh,
  onNewTx,
  accountSlot,
  actionsDisabled,
}: {
  pageTitle: string;
  kicker: string;
  onRefresh: () => void;
  onNewTx: () => void;
  accountSlot?: ReactNode;
  actionsDisabled?: boolean;
}) {
  return (
    <header className="main-header">
      <div>
        <div className="main-kicker">{kicker}</div>
        <h1 className="main-title">{pageTitle}</h1>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <CurrencyToggle />
        <button
          type="button"
          className="btn-ghost"
          disabled={actionsDisabled}
          onClick={() => void onRefresh()}
        >
          Refresh
        </button>
        <button type="button" className="btn-primary" disabled={actionsDisabled} onClick={onNewTx}>
          New transaction
        </button>
        {accountSlot}
      </div>
    </header>
  );
}

function HomeView({
  c,
  weightedXirr,
  positions,
  watchlistData,
  chartOn,
  setChartOn,
  onWatchlistChanged,
  readOnly = false,
}: {
  c: CapitalOverview;
  weightedXirr: number;
  positions: Position[];
  watchlistData: WatchlistResponse | null;
  chartOn: Record<string, boolean>;
  setChartOn: Dispatch<SetStateAction<Record<string, boolean>>>;
  onWatchlistChanged: () => void;
  readOnly?: boolean;
}) {
  const { currency, liveFx, toDisplayFromUsd } = useCurrency();

  const pieData = useMemo(() => {
    return positions
      .filter((p) => p.marketValueUsd > 0)
      .map((p) => ({ name: p.ticker, value: toDisplayFromUsd(p.marketValueUsd) }));
  }, [positions, toDisplayFromUsd]);

  const xirrSub = useMemo(() => {
    const parts = [`Weighted sum of position XIRR: ${fmtPct(weightedXirr)}`];
    if (currency === "SGD" && liveFx != null) {
      parts.push(`Display uses today’s spot ${liveFx.toFixed(4)} SGD/USD`);
    }
    return parts.join(" · ");
  }, [weightedXirr, currency, liveFx]);

  const avgHoldingSub = "Mean of each holding’s XIRR (equal weight). Differs from money-weighted portfolio XIRR.";

  return (
    <>
      <section>
        <h2 className="section-title">Key metrics</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          <MoneyCard label="Current portfolio value" usdAmount={c.currentPortfolioValueUsd} />
          <MoneyCard label="Net gain / loss" usdAmount={c.netGainLossUsd} hint="Versus remaining cost basis." />
          <MoneyCard label="Total invested (cost basis)" usdAmount={c.totalInvestedCapitalUsd} />
          <StatCard label="Portfolio XIRR" value={fmtPct(c.portfolioXirr)} sub={xirrSub} />
          <StatCard label="Avg. annual growth (holdings)" value={fmtPct(c.averageHoldingXirr)} sub={avgHoldingSub} />
        </div>
      </section>

      <section className="home-two-col" style={{ marginTop: 28 }}>
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              Allocation
            </h2>
            <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>
              By market value ({currency})
            </span>
          </div>
          {pieData.length === 0 ? (
            <div style={{ color: "var(--muted)", padding: "2rem 0", textAlign: "center" }}>
              Add transactions to see allocation.
            </div>
          ) : (
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="rgba(0,0,0,0.25)" />
                    ))}
                  </Pie>
                  <RTooltip
                    formatter={(v: number) => (currency === "USD" ? fmtUsd(v) : fmtSgd(v, 2))}
                    contentStyle={{
                      background: "var(--bg1)",
                      border: "1px solid var(--stroke)",
                      borderRadius: 12,
                      color: "var(--text)",
                    }}
                    labelStyle={{ color: "var(--text)" }}
                    itemStyle={{ color: "var(--text)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="panel">
          <h2 className="section-title" style={{ margin: "0 0 12px" }}>
            Watchlist
          </h2>
          <WatchlistPanel data={watchlistData} onChanged={onWatchlistChanged} readOnly={readOnly} />
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <BuyVsCurrentChart
          positions={positions}
          chartOn={chartOn}
          onToggleTicker={(t) =>
            setChartOn((o) => ({
              ...o,
              [t]: o[t] === true ? false : true,
            }))
          }
          onSelectAll={() =>
            setChartOn(Object.fromEntries(positions.map((p) => [p.ticker, true])))
          }
          onClearAll={() =>
            setChartOn(Object.fromEntries(positions.map((p) => [p.ticker, false])))
          }
        />
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 className="section-title">Capital overview</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          <MoneyCard label="Recovered from sales" usdAmount={c.recoveredCapitalFromSalesUsd} />
          <MoneyCard label="Recycled (reinvested)" usdAmount={c.totalRecycledCapitalUsd} />
          <MoneyCard label="Unrecycled proceeds" usdAmount={c.totalUnrecycledCapitalUsd} />
        </div>
      </section>
    </>
  );
}

function BreakdownView({ positions }: { positions: Position[] }) {
  const { currency, fmtPortfolioMoney } = useCurrency();
  return (
    <section>
      <h2 className="section-title">Portfolio breakdown</h2>
      <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        Full numeric detail for every open position. Amounts follow the global currency toggle (today’s spot for SGD).
      </p>
      <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--stroke)" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Ticker</th>
              <th>Shares</th>
              <th>Weight</th>
              <th>Avg cost ({currency})</th>
              <th>Price ({currency})</th>
              <th>Value ({currency})</th>
              <th>XIRR</th>
              <th>Wtd XIRR</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.ticker}>
                <td>{p.name ?? "—"}</td>
                <td className="mono">{p.ticker}</td>
                <td className="mono">{p.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                <td className="mono">{fmtPct(p.pctOfPortfolio)}</td>
                <td className="mono">{fmtPortfolioMoney(p.avgCostUsd, 2)}</td>
                <td className="mono">{p.marketPriceUsd != null ? fmtPortfolioMoney(p.marketPriceUsd, 2) : "—"}</td>
                <td className="mono">{fmtPortfolioMoney(p.marketValueUsd, 2)}</td>
                <td className="mono" style={{ color: p.xirr != null && p.xirr < 0 ? "var(--danger)" : "var(--ok)" }}>
                  {fmtPct(p.xirr)}
                </td>
                <td className="mono">{fmtPct(p.weightedXirrContribution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LedgerView({
  transactions,
  onDeleted,
  onEdit,
  onImportCsv,
  readOnly = false,
}: {
  transactions: TransactionRow[];
  onDeleted: () => void;
  onEdit: (row: TransactionRow) => void;
  onImportCsv: () => void;
  readOnly?: boolean;
}) {
  const { currency, fmtLedgerPrice, fmtLedgerFees } = useCurrency();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()),
    [transactions]
  );

  const colCount = selectMode ? 10 : 10;
  const allSelected = selectMode && sorted.length > 0 && sorted.every((t) => selected.has(t.id));

  const toggleSelectMode = () => {
    setSelectMode((m) => {
      if (m) setSelected(new Set());
      return !m;
    });
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id)));
  };

  const bulkRemove = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected transaction${ids.length === 1 ? "" : "s"}?`)) return;
    try {
      await postBulkDeleteTransactions(ids);
      setSelected(new Set());
      setSelectMode(false);
      onDeleted();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  return (
    <section>
      <h2 className="section-title">Transaction ledger</h2>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          marginTop: 10,
          marginBottom: 12,
          gap: 10,
        }}
      >
        {!readOnly && (
          <>
            <button type="button" className="btn-ghost" style={{ padding: "8px 12px", fontSize: 13 }} onClick={onImportCsv}>
              Import CSV
            </button>
            <button type="button" className="btn-ghost" style={{ padding: "8px 12px", fontSize: 13 }} onClick={toggleSelectMode}>
              {selectMode ? "Cancel" : "Select rows"}
            </button>
          </>
        )}
        {selectMode && !readOnly && (
          <button
            type="button"
            className="btn-ghost"
            disabled={selected.size === 0}
            style={{ marginLeft: "auto", padding: "8px 12px", fontSize: 13 }}
            onClick={() => void bulkRemove()}
          >
            Delete{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        )}
      </div>
      <div style={{ overflowX: "auto", borderRadius: "var(--radius)", border: "1px solid var(--stroke)" }}>
        <table className="data-table">
          <thead>
            <tr>
              {selectMode && (
                <th style={{ width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              <th>Date</th>
              <th>Side</th>
              <th>Ticker</th>
              <th>Name</th>
              <th>Qty</th>
              <th>Price ({currency})</th>
              <th>FX @ trade</th>
              <th>Fees ({currency})</th>
              <th>Notes</th>
              {!selectMode && !readOnly && <th style={{ width: 72 }} />}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ padding: "20px 14px", color: "var(--muted)" }}>
                  No transactions yet. Use “New transaction” to add your first row.
                </td>
              </tr>
            )}
            {sorted.map((t) => (
              <tr key={t.id}>
                {selectMode && (
                  <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleRow(t.id)}
                      aria-label={`Select ${t.ticker} ${t.occurred_at.slice(0, 10)}`}
                    />
                  </td>
                )}
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {t.occurred_at.length >= 10 ? t.occurred_at.slice(0, 10) : "—"}
                </td>
                <td style={{ textTransform: "capitalize" }}>{t.side}</td>
                <td className="mono">{t.ticker}</td>
                <td>{t.name ?? "—"}</td>
                <td className="mono">{t.quantity}</td>
                <td className="mono">{fmtLedgerPrice(t)}</td>
                <td className="mono">{Number(t.fx_sgd_per_usd).toFixed(4)}</td>
                <td className="mono">{fmtLedgerFees(t, 2)}</td>
                <td style={{ color: "var(--muted)", maxWidth: 320 }}>{t.notes ?? ""}</td>
                {!selectMode && !readOnly && (
                  <td>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 12 }}
                      onClick={() => onEdit(t)}
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DemoAnalyticsView() {
  return (
    <section className="panel" style={{ maxWidth: 640 }}>
      <h2 className="section-title">Advanced Analytics</h2>
      <p style={{ color: "var(--muted)", lineHeight: 1.65, marginTop: 0 }}>
        AI-powered portfolio reviews and investment idea reports are available after you create an account. Your
        private ledger powers personalized analysis — the sample portfolio cannot run live analytics.
      </p>
      <p style={{ color: "var(--muted)", lineHeight: 1.65, marginBottom: 0 }}>
        Sign in from the account button in the top-right corner to unlock Advanced Analytics on your own data.
      </p>
    </section>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

function AppShell() {
  const { user, authLoading, authReady, refresh, logout } = useAuth();
  const [page, setPage] = useState<PageId>("home");
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [tx, setTx] = useState<TransactionRow[] | null>(null);
  const [watchlistData, setWatchlistData] = useState<WatchlistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [editTx, setEditTx] = useState<TransactionRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [chartOn, setChartOn] = useState<Record<string, boolean>>({});
  const [whyOpenFolioOpen, setWhyOpenFolioOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, t] = await Promise.all([fetchPortfolio(), fetchTransactions()]);
      setData(p);
      setTx(t);
      setWatchlistData(await fetchWatchlist());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Load failed";
      if (msg === "UNAUTHORIZED") {
        setAuthToken(null);
        await refresh();
        if (!getAuthToken()) {
          await logout();
          setData(null);
          setTx(null);
          setWatchlistData(null);
          setError("Your session expired. Please sign in again.");
          return;
        }
        try {
          const [p, t] = await Promise.all([fetchPortfolio(), fetchTransactions()]);
          setData(p);
          setTx(t);
          setWatchlistData(await fetchWatchlist());
          return;
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : "Load failed";
          setError(retryMsg);
          return;
        }
      }
      setError(msg);
    }
  }, [logout, refresh]);

  const loadWatchlistOnly = useCallback(async () => {
    if (!user || user.needsDisplayName) return;
    try {
      setWatchlistData(await fetchWatchlist());
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !authReady) return;
    if (!user) {
      setData(DEMO_PORTFOLIO);
      setTx(DEMO_TRANSACTIONS);
      setWatchlistData(DEMO_WATCHLIST);
      setError(null);
      return;
    }
    if (user.needsDisplayName) {
      setData(null);
      setTx(null);
      setWatchlistData(null);
      setError(null);
      return;
    }
    void load();
  }, [authLoading, authReady, user, load]);

  useEffect(() => {
    const positions = data?.positions;
    if (!positions?.length) {
      setChartOn({});
      return;
    }
    setChartOn((prev) => {
      const next: Record<string, boolean> = {};
      for (const p of positions) {
        next[p.ticker] = prev[p.ticker] ?? true;
      }
      return next;
    });
  }, [data?.positions]);

  const weightedXirr = useMemo(() => {
    if (!data) return 0;
    return data.positions.reduce((acc, p) => acc + p.weightedXirrContribution, 0);
  }, [data]);

  const c = data?.capital;
  const positions = data?.positions ?? [];
  const isDemo = !user && authReady && !authLoading;
  const portfolioReady = Boolean(
    (isDemo && data && tx !== null) || (user && !user.needsDisplayName && data && tx !== null)
  );
  const headerActionsDisabled = !user || Boolean(user.needsDisplayName);

  const homePageTitle = useMemo(() => {
    if (isDemo) return "Sample Investment Portfolio";
    if (!user) return "Your Investment Portfolio";
    const name = user.displayName.trim();
    const raw = name || (user.email.includes("@") ? user.email.split("@")[0]! : user.email);
    const display = raw
      .split(/[._\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    if (!display) return "Your Investment Portfolio";
    return `${display}'s Investment Portfolio`;
  }, [user, isDemo]);

  const pageTitle =
    page === "home"
      ? homePageTitle
      : page === "breakdown"
        ? "Numeric breakdown"
        : page === "ledger"
          ? "Transaction ledger"
          : "Advanced Analytics";
  const kicker =
    page === "home"
      ? "Dashboard"
      : page === "breakdown"
        ? "Tables"
        : page === "ledger"
          ? "History"
          : "Insights";

  return (
    <CurrencyProvider liveFx={data?.liveFxSgdPerUsd ?? null}>
      <CompleteProfileModal />
      <div className="app-shell">
        <aside className="sidebar" aria-label="Primary">
          <div className="sidebar-brand">
            <BrandMark size={40} />
            <div>
              <div className="sidebar-title">OpenFolio</div>
              <div className="sidebar-sub">Portfolio workspace</div>
            </div>
          </div>
          <nav className="sidebar-nav">
            {NAV.map((item) => {
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={"sidebar-link" + (active ? " sidebar-link-active" : "")}
                  onClick={() => setPage(item.id)}
                >
                  <span className="sidebar-link-label">{item.label}</span>
                  <span className="sidebar-link-hint">{item.hint}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <button
              type="button"
              className="sidebar-trust-btn"
              onClick={() => setWhyOpenFolioOpen(true)}
            >
              why OpenFolio?
            </button>
          </div>
        </aside>

        <div className="main-area">
          <MainHeader
            pageTitle={pageTitle}
            kicker={kicker}
            onRefresh={load}
            onNewTx={() => setModal(true)}
            accountSlot={<UserAccountMenu />}
            actionsDisabled={headerActionsDisabled}
          />

          {error && <div className="banner-error">{error}</div>}

          <main className="main-content">
            {authLoading && <p style={{ color: "var(--muted)" }}>Checking session…</p>}

            {isDemo && <DemoBanner />}

            {!authLoading && user && user.needsDisplayName && (
              <p style={{ color: "var(--muted)" }}>Add your name in the dialog above to continue.</p>
            )}

            {!authLoading && user && !user.needsDisplayName && !portfolioReady && !error && (
              <p style={{ color: "var(--muted)" }}>Loading portfolio…</p>
            )}

            {portfolioReady && data && tx !== null && page === "home" && c && (
              <HomeView
                c={c}
                weightedXirr={weightedXirr}
                positions={positions}
                watchlistData={watchlistData}
                chartOn={chartOn}
                setChartOn={setChartOn}
                onWatchlistChanged={() => void loadWatchlistOnly()}
                readOnly={isDemo}
              />
            )}

            {portfolioReady && page === "breakdown" && <BreakdownView positions={positions} />}

            {portfolioReady && tx !== null && page === "ledger" && (
              <LedgerView
                transactions={tx}
                onDeleted={() => void load()}
                onEdit={(row) => setEditTx(row)}
                onImportCsv={() => setImportOpen(true)}
                readOnly={isDemo}
              />
            )}

            {portfolioReady && page === "analytics" && (isDemo ? <DemoAnalyticsView /> : <AdvancedAnalyticsPage />)}
          </main>
        </div>
      </div>

      <TransactionModal
        open={modal && portfolioReady && !isDemo}
        onClose={() => setModal(false)}
        onSaved={() => void load()}
      />
      <TransactionModal
        open={Boolean(editTx) && portfolioReady && !isDemo}
        editRow={editTx}
        onClose={() => setEditTx(null)}
        onSaved={() => void load()}
      />
      <ImportCsvModal
        open={importOpen && portfolioReady && !isDemo}
        onClose={() => setImportOpen(false)}
        onImported={() => void load()}
      />
      <WhyOpenFolioModal open={whyOpenFolioOpen} onClose={() => setWhyOpenFolioOpen(false)} />

      <style>{`
        input, select, textarea {
          width: 100%;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--stroke);
          background: rgba(255,255,255,0.04);
          color: var(--text);
          outline: none;
        }
        textarea { resize: vertical; min-height: 64px; }
      `}</style>
    </CurrencyProvider>
  );
}
