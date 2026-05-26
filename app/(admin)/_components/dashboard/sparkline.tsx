/**
 * Pure-SVG sparkline. No external chart library, no client-side JS.
 *
 * Renders a smoothed line through the given data points, normalized to the
 * provided viewBox. The trailing dot is the most recent value. Designed
 * to be embedded inside small KPI cards — the Stocky-style "tiny trend
 * graph next to a big number" pattern.
 *
 * Values are scaled across [min, max] in the dataset, so a sparkline of
 * all-zero data renders as a flat line in the middle (instead of
 * collapsing).
 */

interface Props {
  /** The data to plot, oldest to newest. */
  values: number[];
  /** Tailwind text-color class for the stroke, e.g. "text-emerald-500". */
  colorClass?: string;
  /** Width in pixels of the SVG element. Height is derived 4:1. */
  width?: number;
  /** Whether to render a filled area below the line for emphasis. */
  filled?: boolean;
  /** Whether to render the trailing dot marker. */
  showEndDot?: boolean;
  /** Optional aria-label. */
  label?: string;
}

export function Sparkline({
  values,
  colorClass = "text-emerald-500",
  width = 120,
  filled = true,
  showEndDot = true,
  label,
}: Props) {
  const height = Math.round(width / 4);

  // Empty state: render a flat dim line so the card layout doesn't jump
  if (values.length === 0) {
    return (
      <svg
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="text-stone-700 dark:text-stone-800"
        aria-label={label ?? "no data"}
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="2,3"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Avoid divide-by-zero when all values are equal — render flat midline
  const range = max - min || 1;

  // Map (idx, value) → (x, y) within the viewBox, leaving 2px padding so
  // the stroke doesn't get clipped at edges.
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });

  // Build the line path with smooth catmull-rom-ish curves between points.
  // For sparklines a simple per-segment bezier looks clean enough; full
  // smoothing libraries are overkill here.
  const linePath = points
    .map(([x, y], i) => {
      if (i === 0) return `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      const [px, py] = points[i - 1] ?? [x, y];
      const midX = (px + x) / 2;
      return `Q ${px.toFixed(2)} ${py.toFixed(2)}, ${midX.toFixed(2)} ${((py + y) / 2).toFixed(2)} T ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  // For the filled area, close down to baseline
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath =
    last && first
      ? `${linePath} L ${last[0].toFixed(2)} ${height} L ${first[0].toFixed(2)} ${height} Z`
      : linePath;

  return (
    <svg
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={colorClass}
      aria-label={label ?? `trend, ${values.length} data points`}
    >
      {filled && (
        <>
          <defs>
            <linearGradient
              id={`spark-grad-${colorClass.replace(/\W/g, "")}`}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#spark-grad-${colorClass.replace(/\W/g, "")})`} />
        </>
      )}
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndDot && last && <circle cx={last[0]} cy={last[1]} r="2.5" fill="currentColor" />}
    </svg>
  );
}
