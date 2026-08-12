/**
 * F4 chart primitives — pure SVG + accessible tabular fallback.
 * No chart.js / recharts / d3 (dependency governance). Workers SPA budget friendly.
 */
import type { ReactNode } from "react";

export type ChartSlice = {
  id: string;
  label: string;
  value: number;
  /** Lumen CSS color token or hex from F1 categorical palette. */
  color: string;
};

export type DonutChartProps = {
  slices: ChartSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
  "data-testid"?: string;
  empty?: ReactNode;
};

export type BarChartProps = {
  bars: ChartSlice[];
  height?: number;
  "data-testid"?: string;
  empty?: ReactNode;
};

function totalOf(slices: ChartSlice[]): number {
  return slices.reduce((s, x) => s + Math.max(0, x.value), 0);
}

/** SVG donut with legend + hidden data table for screen readers / export parity. */
export function DonutChart({
  slices,
  size = 140,
  thickness = 22,
  centerLabel,
  centerValue,
  "data-testid": testId = "chart-donut",
  empty,
}: DonutChartProps) {
  const total = totalOf(slices);
  if (total <= 0) {
    return (
      <div className="l2-chart l2-chart--empty" data-testid={testId} data-state="empty">
        {empty ?? (
          <p className="l2-chart__empty-msg">No data yet</p>
        )}
      </div>
    );
  }

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="l2-chart l2-chart--donut" data-testid={testId} data-state="ready">
      <div className="l2-chart__donut-row">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={
            centerLabel
              ? `${centerLabel}: ${centerValue ?? total}`
              : `Chart total ${total}`
          }
          data-testid={`${testId}-svg`}
        >
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--lumen-border-subtle)"
            strokeWidth={thickness}
          />
          {slices
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.id}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                  data-slice={s.id}
                />
              );
              offset += len;
              return el;
            })}
          {centerValue != null || centerLabel ? (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              className="l2-chart__center"
            >
              <tspan
                x={cx}
                dy={centerLabel ? "-0.35em" : "0"}
                className="l2-chart__center-value"
              >
                {centerValue ?? total}
              </tspan>
              {centerLabel ? (
                <tspan x={cx} dy="1.35em" className="l2-chart__center-label">
                  {centerLabel}
                </tspan>
              ) : null}
            </text>
          ) : null}
        </svg>
        <ul className="l2-chart__legend" data-testid={`${testId}-legend`}>
          {slices.map((s) => (
            <li key={s.id}>
              <i style={{ background: s.color }} aria-hidden />
              <span>{s.label}</span>
              <strong>{s.value}</strong>
            </li>
          ))}
        </ul>
      </div>
      <table className="l2-chart__table" data-testid={`${testId}-table`}>
        <caption className="sr-only">Chart data</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td>{s.value}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Horizontal bar chart with tabular fallback. */
export function BarChart({
  bars,
  height = 160,
  "data-testid": testId = "chart-bar",
  empty,
}: BarChartProps) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  if (bars.length === 0 || totalOf(bars) <= 0) {
    return (
      <div className="l2-chart l2-chart--empty" data-testid={testId} data-state="empty">
        {empty ?? <p className="l2-chart__empty-msg">No data yet</p>}
      </div>
    );
  }

  return (
    <div className="l2-chart l2-chart--bar" data-testid={testId} data-state="ready">
      <div
        className="l2-chart__bars"
        style={{ minHeight: height }}
        role="img"
        aria-label="Bar chart"
        data-testid={`${testId}-svg`}
      >
        {bars.map((b) => (
          <div key={b.id} className="l2-chart__bar-row" data-bar={b.id}>
            <span className="l2-chart__bar-label">{b.label}</span>
            <div className="l2-chart__bar-track">
              <div
                className="l2-chart__bar-fill"
                style={{
                  width: `${b.value <= 0 ? 0 : (b.value / max) * 100}%`,
                  background: b.color,
                  minWidth: b.value > 0 ? 2 : 0,
                }}
                title={`${b.label}: ${b.value}`}
              />
            </div>
            <span className="l2-chart__bar-value">{b.value}</span>
          </div>
        ))}
      </div>
      <table className="l2-chart__table" data-testid={`${testId}-table`}>
        <caption className="sr-only">Bar chart data</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.id}>
              <td>{b.label}</td>
              <td>{b.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
