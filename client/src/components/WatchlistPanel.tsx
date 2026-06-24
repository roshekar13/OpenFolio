import { useCallback, useState } from "react";
import type { WatchlistResponse } from "../api";
import { putWatchlist } from "../api";
import { useCurrency } from "../CurrencyContext";
import { fmtPct, fmtUsd } from "../format";

export function WatchlistPanel({
  data,
  onChanged,
  readOnly = false,
}: {
  data: WatchlistResponse | null;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const { currency, fmtPortfolioMoney, liveFx } = useCurrency();
  const [tickerInput, setTickerInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = data?.items ?? [];
  const max = data?.max ?? 4;

  const saveTickers = useCallback(
    async (next: string[]) => {
      setBusy(true);
      setErr(null);
      try {
        await putWatchlist(next);
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not update watchlist.");
      } finally {
        setBusy(false);
      }
    },
    [onChanged]
  );

  const add = async () => {
    const t = tickerInput.trim().toUpperCase();
    if (!t) return;
    if (items.length >= max) {
      setErr(`Watchlist is full (${max} names). Remove one before adding.`);
      return;
    }
    if (items.some((x) => x.ticker === t)) {
      setErr("That ticker is already on the watchlist.");
      return;
    }
    setTickerInput("");
    await saveTickers([...items.map((i) => i.ticker), t]);
  };

  const remove = async (ticker: string) => {
    await saveTickers(items.map((i) => i.ticker).filter((x) => x !== ticker));
  };

  const fmtPrice = (priceUsd: number | null) => {
    if (priceUsd == null) return "—";
    if (currency === "USD") return fmtUsd(priceUsd, 2);
    if (liveFx == null) return fmtUsd(priceUsd, 2);
    return fmtPortfolioMoney(priceUsd, 2);
  };

  return (
    <div>
      {!readOnly && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 200 }}>
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="Add ticker"
              disabled={busy || items.length >= max}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              disabled={busy || items.length >= max}
              onClick={() => void add()}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--stroke)",
                background: "rgba(255,255,255,0.06)",
                color: "var(--text)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              Add
            </button>
          </div>
          <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
            {items.length}/{max}
          </span>
        </div>
      )}
      {err && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(251,113,133,0.35)",
            background: "rgba(251,113,133,0.1)",
            color: "#fecdd3",
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {items.length === 0 && (
          <div style={{ color: "var(--muted)", fontSize: 14 }}>No symbols yet. Add up to {max} tickers.</div>
        )}
        {items.map((w) => {
          const ch = w.change2wPct;
          const up = ch != null && ch > 0;
          const down = ch != null && ch < 0;
          const arrow = ch == null ? "—" : up ? "▲" : down ? "▼" : "→";
          const tone = up ? "var(--ok)" : down ? "var(--danger)" : "var(--muted)";
          return (
            <div
              key={w.ticker}
              className="watch-row"
              style={{
                display: "grid",
                gridTemplateColumns: readOnly ? "1fr auto" : "1fr auto auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid var(--stroke)",
                background: "linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
              }}
            >
              <div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
                  {w.ticker}
                </div>
                <div className="mono" style={{ fontSize: 12, marginTop: 4, color: ch == null ? "var(--muted)" : tone }}>
                  {ch == null ? "—" : (
                    <>
                      {arrow} {fmtPct(ch)}
                    </>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>
                  {fmtPrice(w.priceUsd)}
                </div>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(w.ticker)}
                  style={{
                    border: "1px solid var(--stroke)",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--muted)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
