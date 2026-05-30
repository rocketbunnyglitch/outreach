/**
 * Sparkline — minimal inline trend line for daily-stat point arrays.
 *
 * SVG only — no chart library. We're rendering 14 points in ~80px;
 * a real chart library is overkill and would balloon the bundle.
 *
 * Conventions:
 *   - height: 16px (matches typography line-height for inline use)
 *   - color: passed via props (parent picks tone based on metric)
 *   - empty / single-point series renders a faint baseline so the
 *     row layout doesn't jump when an inbox has no history yet
 *   - tooltip on hover shows the latest + max values
 */

interface Props {
  values: number[];
  /** SVG color string. Default zinc-500 hex. */
  color?: string;
  /** Width in px. Default 80. */
  width?: number;
  /** Height in px. Default 16. */
  height?: number;
  /** Inline label used in the title attribute. */
  label?: string;
}

export function Sparkline({ values, color = "#71717a", width = 80, height = 16, label }: Props) {
  if (values.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="inline-block align-middle"
        aria-hidden="true"
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={1}
        />
      </svg>
    );
  }

  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const path = values
    .map((v, i) => {
      const x = i * stepX;
      // Pad 1px from each edge so the stroke doesn't clip
      const y = height - 1 - (v / max) * (height - 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const latest = values[values.length - 1] ?? 0;
  const title = `${label ?? "Series"}: latest ${latest}, max ${max} over ${values.length} days`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="inline-block align-middle"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
      {/* Mark the latest point so the eye lands on the current value */}
      <circle
        cx={(values.length - 1) * stepX}
        cy={height - 1 - (latest / max) * (height - 2)}
        r={1.5}
        fill={color}
      />
    </svg>
  );
}
