import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { CapitalOverview, PortfolioResponse, Position, TransactionRow, WatchlistResponse } from "./api";
import { fetchPortfolio, fetchTransactions, fetchWatchlist, fetchWatchlistMomentum, fetchAuthMe, postBulkDeleteTransactions } from "./api";
import { setAuthToken } from "./http";
import { AdvancedAnalyticsPage } from "./components/AdvancedAnalyticsPage";
import { AllocationPieChart } from "./components/AllocationPieChart";
import { BuyVsCurrentChart } from "./components/BuyVsCurrentChart";
import { BrandMark } from "./components/BrandMark";
import { ImportCsvModal } from "./components/ImportCsvModal";
import { TransactionModal } from "./components/TransactionModal";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { DemoBanner } from "./components/DemoBanner";
import { SessionOverlay } from "./components/SessionOverlay";
import { WhyOpenFolioModal } from "./components/WhyOpenFolioModal";
import { DEMO_PORTFOLIO, DEMO_TRANSACTIONS, DEMO_WATCHLIST } from "./demoPortfolio";
import { CurrencyProvider, useCurrency } from "./CurrencyContext";
import { AuthProvider, useAuth } from "./AuthContext";
import { CompleteProfileModal, UserAccountMenu } from "./components/UserAccountMenu";
import { fmtPct, fmtSgd, fmtUsd } from "./format";

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

function InfoButton({ description, label }: { description: string; label: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="info-tip-wrap">
      <button
        type="button"
        className="info-tip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <div className="info-tip-popover" role="dialog" aria-label={label}>
          <p>{description}</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="card-surface">
      <div className="stat-card-label-row">
        <div style={{ color: "var(--muted)", fontSize: 13 }}>{label}</div>
        {info && <InfoButton label={label} description={info} />}
      </div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>
        {value}
      </div>
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

const PORTFOLIO_XIRR_INFO =
  "Money-weighted annualized return for your whole portfolio. OpenFolio builds a cash-flow series from every buy (outflow), sell (inflow), and today’s total market value, then solves for the internal rate of return (XIRR).";

const AVG_HOLDING_GROWTH_INFO =
  "Simple average of each open holding’s annualized return (XIRR). Every position counts equally, regardless of size — unlike Portfolio XIRR, which weights all portfolio cash flows together.";

function HomeView({
  c,
  positions,
  watchlistData,
  chartOn,
  setChartOn,
  onWatchlistChanged,
  readOnly = false,
}: {
  c: CapitalOverview;
  positions: Position[];
  watchlistData: WatchlistResponse | null;
  chartOn: Record<string, boolean>;
  setChartOn: Dispatch<SetStateAction<Record<string, boolean>>>;
  onWatchlistChanged: () => void;
  readOnly?: boolean;
}) {
  const { currency } = useCurrency();

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
          <StatCard label="Portfolio XIRR" value={fmtPct(c.portfolioXirr)} info={PORTFOLIO_XIRR_INFO} />
          <StatCard
            label="Avg. annual growth (holdings)"
            value={fmtPct(c.averageHoldingXirr)}
            info={AVG_HOLDING_GROWTH_INFO}
          />
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
          <AllocationPieChart positions={positions} />
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

const SESSION_EXPIRED_MSG = "Your session expired. Please sign in again.";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portfolioMissingLivePrices(p: PortfolioResponse): boolean {
  const open = p.positions.filter((pos) => pos.shares > 0);
  if (open.length === 0) return false;
  return open.every((pos) => {
    const key = pos.ticker.trim().toUpperCase();
    return p.prices[key] == null && pos.marketPriceUsd == null;
  });
}

async function fetchPortfolioResilient(): Promise<PortfolioResponse> {
  let portfolio = await fetchPortfolio();
  if (!portfolioMissingLivePrices(portfolio)) return portfolio;
  await sleep(900);
  try {
    const retry = await fetchPortfolio();
    if (!portfolioMissingLivePrices(retry)) return retry;
  } catch {
    /* keep first response */
  }
  return portfolio;
}

function AppShell() {
  const { user, authLoading, authReady, sessionBusy, sessionAction, refresh, logout } = useAuth();
  const [page, setPage] = useState<PageId>("home");
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [tx, setTx] = useState<TransactionRow[] | null>(null);
  const [watchlistData, setWatchlistData] = useState<WatchlistResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [editTx, setEditTx] = useState<TransactionRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [chartOn, setChartOn] = useState<Record<string, boolean>>({});
  const [whyOpenFolioOpen, setWhyOpenFolioOpen] = useState(false);
  const loadGenerationRef = useRef(0);
  const prevUserIdRef = useRef<string | null>(null);
  const signedOutAtRef = useRef(0);

  const applyWatchlistMomentum = useCallback(
    (gen: number, changes: Record<string, number | null>) => {
      if (gen !== loadGenerationRef.current) return;
      setWatchlistData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) => ({
            ...item,
            change1moPct: changes[item.ticker] ?? item.change1moPct,
          })),
        };
      });
    },
    []
  );

  const loadWatchlistMomentumOnly = useCallback((gen: number) => {
    void fetchWatchlistMomentum()
      .then((changes) => applyWatchlistMomentum(gen, changes))
      .catch((watchErr) => console.warn("Watchlist momentum load failed:", watchErr));
  }, [applyWatchlistMomentum]);

  const applyDemoState = useCallback(() => {
    setData(DEMO_PORTFOLIO);
    setTx(DEMO_TRANSACTIONS);
    setWatchlistData(DEMO_WATCHLIST);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    if (!user || user.needsDisplayName) return;

    const gen = ++loadGenerationRef.current;
    setPortfolioLoading(true);
    setLoadedUserId(null);
    setError(null);
    try {
      const [p, t] = await Promise.all([fetchPortfolioResilient(), fetchTransactions()]);
      if (gen !== loadGenerationRef.current) return;
      setData(p);
      setTx(t);
      setLoadedUserId(user.id);
    } catch (e) {
      if (gen !== loadGenerationRef.current) return;
      const msg = e instanceof Error ? e.message : "Load failed";
      if (msg === "UNAUTHORIZED") {
        setAuthToken(null);
        const { user: me } = await fetchAuthMe();
        if (gen !== loadGenerationRef.current) return;
        if (!me) {
          const recentSignOut = Date.now() - signedOutAtRef.current < 3000;
          if (!recentSignOut) {
            setError(SESSION_EXPIRED_MSG);
          }
          try {
            await logout();
          } catch {
            /* already signed out */
          }
          applyDemoState();
          return;
        }
        await refresh();
        if (gen !== loadGenerationRef.current) return;
        try {
          const [p, t] = await Promise.all([fetchPortfolioResilient(), fetchTransactions()]);
          if (gen !== loadGenerationRef.current) return;
          setData(p);
          setTx(t);
          setLoadedUserId(user.id);
        } catch (retryErr) {
          if (gen !== loadGenerationRef.current) return;
          const retryMsg = retryErr instanceof Error ? retryErr.message : "Load failed";
          setError(retryMsg);
          return;
        }
      } else {
        setError(msg);
        return;
      }
    } finally {
      if (gen === loadGenerationRef.current) {
        setPortfolioLoading(false);
      }
    }

    try {
      if (gen !== loadGenerationRef.current) return;
      setWatchlistData(await fetchWatchlist());
      loadWatchlistMomentumOnly(gen);
    } catch (watchErr) {
      if (gen !== loadGenerationRef.current) return;
      console.warn("Watchlist load failed:", watchErr);
      setWatchlistData({ items: [], max: 4 });
    }
  }, [user, logout, refresh, applyDemoState, loadWatchlistMomentumOnly]);

  const refreshPortfolio = useCallback(() => {
    if (!user || user.needsDisplayName) {
      applyDemoState();
      return;
    }
    void load();
  }, [user, load, applyDemoState]);

  const loadWatchlistOnly = useCallback(async () => {
    if (!user || user.needsDisplayName) return;
    const gen = loadGenerationRef.current;
    try {
      setWatchlistData(await fetchWatchlist());
      loadWatchlistMomentumOnly(gen);
    } catch {
      /* ignore */
    }
  }, [user, loadWatchlistMomentumOnly]);

  useEffect(() => {
    if (authLoading || !authReady || sessionBusy) return;
    const userId = user?.id ?? null;
    const needsDisplayName = Boolean(user?.needsDisplayName);
    if (!user) {
      if (prevUserIdRef.current) signedOutAtRef.current = Date.now();
      prevUserIdRef.current = null;
      loadGenerationRef.current += 1;
      setAuthToken(null);
      setLoadedUserId(null);
      setPortfolioLoading(false);
      applyDemoState();
      return;
    }
    if (needsDisplayName) {
      if (prevUserIdRef.current !== userId) {
        prevUserIdRef.current = userId;
        loadGenerationRef.current += 1;
      }
      setData(null);
      setTx(null);
      setWatchlistData(null);
      setLoadedUserId(null);
      setPortfolioLoading(false);
      setError(null);
      return;
    }
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      setData(null);
      setTx(null);
      setWatchlistData(null);
      setLoadedUserId(null);
      setError(null);
      void load();
      return;
    }
    if (loadedUserId !== userId && !portfolioLoading) {
      void load();
    }
  }, [
    authLoading,
    authReady,
    sessionBusy,
    user?.id,
    user?.needsDisplayName,
    loadedUserId,
    portfolioLoading,
    load,
    applyDemoState,
  ]);

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

  const c = data?.capital;
  const positions = data?.positions ?? [];
  const isDemo = !user && authReady && !authLoading;
  const portfolioReady = Boolean(
    (isDemo && data && tx !== null) ||
      (user && !user.needsDisplayName && data && tx !== null && loadedUserId === user.id)
  );
  const uiBlocked =
    authLoading ||
    sessionBusy ||
    (Boolean(user) && !user?.needsDisplayName && (portfolioLoading || loadedUserId !== user?.id));
  const overlayMessage = sessionBusy
    ? sessionAction === "logout"
      ? "Signing out…"
      : sessionAction === "register"
        ? "Creating account…"
        : "Signing in…"
    : authLoading
      ? "Checking session…"
      : "Loading your portfolio…";
  const headerActionsDisabled = !user || Boolean(user.needsDisplayName) || uiBlocked;

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
      {uiBlocked && <SessionOverlay message={overlayMessage} />}
      <div className={"app-shell" + (uiBlocked ? " app-shell-blocked" : "")}>
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
                  disabled={uiBlocked}
                  onClick={() => setPage(item.id)}
                >
                  <span className="sidebar-link-label">{item.label}</span>
                  <span className="sidebar-link-hint">{item.hint}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="sidebar-trust-btn"
              disabled={uiBlocked}
              onClick={() => setWhyOpenFolioOpen(true)}
            >
              why OpenFolio?
            </button>
          </nav>
        </aside>

        <div className="main-area">
          <MainHeader
            pageTitle={pageTitle}
            kicker={kicker}
            onRefresh={refreshPortfolio}
            onNewTx={() => setModal(true)}
            accountSlot={<UserAccountMenu />}
            actionsDisabled={headerActionsDisabled}
          />

          {error && <div className="banner-error">{error}</div>}

          <main className="main-content">
            {isDemo && <DemoBanner />}

            {!authLoading && user && user.needsDisplayName && (
              <p style={{ color: "var(--muted)" }}>Add your name in the dialog above to continue.</p>
            )}

            {!uiBlocked && portfolioReady && data && tx !== null && page === "home" && c && (
              <HomeView
                c={c}
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
