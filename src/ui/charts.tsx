/** Small inline charts for briefings and panels (D-080): pure SVG, no library. */

export function Sparkline({ values, width = 132, height = 34, color = 'var(--accent-2)', label }: { values: readonly number[]; width?: number; height?: number; color?: string; label: string }) {
  if (values.length < 2)
    return (
      <svg width={width} height={height} className="spark" role="img" aria-label={`${label}: not enough history yet`}>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} style={{ stroke: 'var(--line-strong)' }} strokeDasharray="3 3" />
      </svg>
    );
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A minimum span (2 % of the level) keeps a negligible wobble from looking like a crash.
  const mean = values.reduce((a, b) => a + Math.abs(b), 0) / values.length;
  const span = Math.max(max - min, mean * 0.02, 1e-6);
  const mid = (max + min) / 2;
  const lo = Math.min(min, mid - span / 2);
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - 2 * pad), pad + (1 - (v - lo) / span) * (height - 2 * pad)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  const area = `${d} L${last[0].toFixed(1)},${height - pad} L${pts[0]![0].toFixed(1)},${height - pad} Z`;
  return (
    <svg width={width} height={height} className="spark" role="img" aria-label={`${label}: from ${values[0]} to ${values[values.length - 1]}`}>
      <path d={area} style={{ fill: color }} opacity={0.12} />
      <path d={d} fill="none" style={{ stroke: color }} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.6} style={{ fill: color }} />
    </svg>
  );
}

/** A diverging horizontal bar from −100 to +100 (relations, opinion). */
export function DivergingBar({ value, width = 150 }: { value: number; width?: number }) {
  const v = Math.max(-100, Math.min(100, value));
  const mid = width / 2;
  const w = (Math.abs(v) / 100) * mid;
  return (
    <svg width={width} height={10} className="dbar" aria-hidden="true">
      <rect x={0} y={4} width={width} height={2} style={{ fill: 'var(--line)' }} />
      <rect x={v >= 0 ? mid : mid - w} y={1} width={w} height={8} rx={2} style={{ fill: v >= 0 ? 'var(--good)' : 'var(--bad)' }} opacity={0.85} />
      <rect x={mid - 0.5} y={0} width={1} height={10} style={{ fill: 'var(--text-dim)' }} />
    </svg>
  );
}
