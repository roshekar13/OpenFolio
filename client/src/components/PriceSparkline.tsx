import { useMemo } from "react";

function sparkPath(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = padY + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function PriceSparkline({
  values,
  changePct,
  width = 56,
  height = 26,
  className,
}: {
  values: number[];
  changePct: number | null;
  width?: number;
  height?: number;
  className?: string;
}) {
  const path = useMemo(() => sparkPath(values, width, height), [values, width, height]);
  const up = changePct != null && changePct > 0;
  const down = changePct != null && changePct < 0;
  const stroke = up ? "var(--ok)" : down ? "var(--danger)" : "var(--muted)";

  if (!path) {
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--stroke)" strokeWidth={1} />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      style={{ display: "block", maxWidth: "100%" }}
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
