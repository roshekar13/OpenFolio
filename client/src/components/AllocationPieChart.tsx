import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Position } from "../api";
import { useCurrency } from "../CurrencyContext";
import { fmtPct } from "../format";

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

type Slice = {
  ticker: string;
  name: string | null;
  value: number;
  marketValueUsd: number;
  pctOfPortfolio: number;
  fill: string;
};

const RADIAN = Math.PI / 180;

function renderSliceLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  payload?: Slice;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, payload } = props;
  if (!payload) return null;

  const radius = outerRadius + 26;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const anchor = x > cx ? "start" : "end";

  return (
    <g>
      <text
        x={x}
        y={y - 7}
        fill="var(--text)"
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={650}
        className="mono"
      >
        {payload.ticker}
      </text>
      <text
        x={x}
        y={y + 9}
        fill="var(--muted)"
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={11}
        className="mono"
      >
        {fmtPct(payload.pctOfPortfolio)}
      </text>
    </g>
  );
}

function AllocationTooltip({
  active,
  payload,
  fmtPortfolioMoney,
}: {
  active?: boolean;
  payload?: { payload: Slice }[];
  fmtPortfolioMoney: (usd: number, digits?: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const slice = payload[0]?.payload;
  if (!slice) return null;

  const title = slice.name ? `${slice.name} (${slice.ticker})` : slice.ticker;

  return (
    <div
      style={{
        background: "var(--bg1)",
        border: "1px solid var(--stroke)",
        borderRadius: 12,
        padding: "10px 12px",
        color: "var(--text)",
        boxShadow: "var(--shadow)",
        maxWidth: 260,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{title}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 650, marginTop: 6 }}>
        {fmtPortfolioMoney(slice.marketValueUsd, 2)}
      </div>
    </div>
  );
}

export function AllocationPieChart({ positions }: { positions: Position[] }) {
  const { fmtPortfolioMoney, toDisplayFromUsd } = useCurrency();

  const slices = useMemo(() => {
    return positions
      .filter((p) => p.marketValueUsd > 0)
      .map((p, i) => ({
        ticker: p.ticker,
        name: p.name,
        value: toDisplayFromUsd(p.marketValueUsd),
        marketValueUsd: p.marketValueUsd,
        pctOfPortfolio: p.pctOfPortfolio,
        fill: COLORS[i % COLORS.length],
      }));
  }, [positions, toDisplayFromUsd]);

  if (slices.length === 0) {
    return (
      <div style={{ color: "var(--muted)", padding: "2rem 0", textAlign: "center" }}>
        Add transactions to see allocation.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 380 }}>
      <ResponsiveContainer>
        <PieChart margin={{ top: 12, right: 72, bottom: 12, left: 72 }}>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="ticker"
            cx="50%"
            cy="50%"
            outerRadius={96}
            paddingAngle={1.5}
            label={renderSliceLabel}
            labelLine={{ stroke: "var(--muted)", strokeWidth: 1 }}
          >
            {slices.map((slice) => (
              <Cell key={slice.ticker} fill={slice.fill} stroke="rgba(0,0,0,0.2)" />
            ))}
          </Pie>
          <Tooltip
            content={(props) => <AllocationTooltip {...props} fmtPortfolioMoney={fmtPortfolioMoney} />}
            wrapperStyle={{ outline: "none" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
