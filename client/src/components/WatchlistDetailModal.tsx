import { useCallback, useEffect, useRef, useState } from "react";
import type { PriceChartRange, WatchlistItem } from "../api";
import { fetchPriceChart } from "../api";
import { useCurrency } from "../CurrencyContext";
import { fmtPct, fmtUsd } from "../format";
import { PriceSparkline } from "./PriceSparkline";

const RANGES: PriceChartRange[] = ["1w", "1mo", "6mo", "ytd"];

const RANGE_LABELS: Record<PriceChartRange, string> = {
  "1w": "1 week",
  "1mo": "1 month",
  "6mo": "6 months",
  ytd: "YTD",
};

type ChartState = {
  closes: number[];
  changePct: number | null;
};

export function WatchlistDetailModal({
  item,
  onClose,
}: {
  item: WatchlistItem;
  onClose: () => void;
}) {
  const { currency, fmtPortfolioMoney, liveFx } = useCurrency();
  const [range, setRange] = useState<PriceChartRange>("1mo");
  const [chart, setChart] = useState<ChartState>({
    closes: item.chartCloses,
    changePct: item.changePct,
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const chartCacheRef = useRef<Partial<Record<PriceChartRange, ChartState>>>({
    "1mo": { closes: item.chartCloses, changePct: item.changePct },
  });

  const loadChart = useCallback(
    async (nextRange: PriceChartRange) => {
      const cached = chartCacheRef.current[nextRange];
      if (cached) {
        setChart(cached);
        setChartErr(null);
        return;
      }
      setChartLoading(true);
      setChartErr(null);
      try {
        const data = await fetchPriceChart(item.ticker, nextRange);
        const next = { closes: data.closes, changePct: data.changePct };
        chartCacheRef.current[nextRange] = next;
        setChart(next);
      } catch (e) {
        setChartErr(e instanceof Error ? e.message : "Could not load chart.");
      } finally {
        setChartLoading(false);
      }
    },
    [item.ticker, item.chartCloses, item.changePct]
  );

  useEffect(() => {
    void loadChart(range);
  }, [range, loadChart]);

  const ch = chart.changePct;
  const up = ch != null && ch > 0;
  const down = ch != null && ch < 0;
  const tone = up ? "var(--ok)" : down ? "var(--danger)" : "var(--muted)";
  const arrow = ch == null ? "—" : up ? "▲" : down ? "▼" : "→";

  const fmtPrice = (priceUsd: number | null) => {
    if (priceUsd == null) return "—";
    if (currency === "USD") return fmtUsd(priceUsd, 2);
    if (liveFx == null) return fmtUsd(priceUsd, 2);
    return fmtPortfolioMoney(priceUsd, 2);
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="watchlist-detail-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 80,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          background: "var(--bg1)",
          border: "1px solid var(--stroke)",
          borderRadius: 18,
          padding: "1.15rem 1.35rem",
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div id="watchlist-detail-title" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
              {item.name ?? item.ticker}
            </div>
            <div className="mono" style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>
              {item.ticker}
            </div>
          </div>
          <button type="button" className="btn-ghost" style={{ padding: "6px 10px", flexShrink: 0 }} onClick={onClose}>
            Close
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid var(--stroke)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RANGES.map((r) => {
                const active = range === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "rgba(94,234,212,0.45)" : "var(--stroke)"}`,
                      background: active ? "rgba(94,234,212,0.12)" : "rgba(255,255,255,0.03)",
                      color: active ? "var(--text)" : "var(--muted)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {RANGE_LABELS[r]}
                  </button>
                );
              })}
            </div>
            <span className="mono" style={{ fontSize: 15, fontWeight: 650, color: tone }}>
              {ch == null ? "—" : (
                <>
                  {arrow} {fmtPct(ch)}
                </>
              )}
            </span>
          </div>

          <div style={{ width: "100%", height: 88, position: "relative", overflow: "hidden" }}>
            {chartLoading && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(7,10,15,0.35)",
                  color: "var(--muted)",
                  fontSize: 13,
                  zIndex: 1,
                }}
              >
                Loading…
              </div>
            )}
            <PriceSparkline values={chart.closes} changePct={chart.changePct} width={600} height={88} />
          </div>
          {chartErr && (
            <p style={{ margin: "8px 0 0", color: "var(--danger)", fontSize: 12 }}>{chartErr}</p>
          )}
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Current price</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 650 }}>
              {fmtPrice(item.priceUsd)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              {RANGE_LABELS[range]} change
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 650, color: tone }}>
              {ch == null ? "—" : fmtPct(ch)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
