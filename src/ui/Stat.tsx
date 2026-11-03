import type { ReactNode } from 'react';
import { Tip } from './overlays/TooltipLayer';

/** One line of a tooltip breakdown; `tip` opens a nested tooltip with its sources (D-080). */
export interface BreakdownRow {
  readonly label: string;
  readonly value: string;
  /** Plain text or rich content shown when the row itself is hovered. */
  readonly tip?: ReactNode;
  /** Colour the value: positive (good), negative (bad) or neutral. */
  readonly tone?: 'good' | 'bad' | 'neutral';
}

interface StatProps {
  label?: string | undefined;
  value: ReactNode;
  /** Required: every number shown in the UI must explain its cause (D-007, D-018). */
  tooltip: string;
  /** Optional itemised causes; each row may carry its own nested tooltip. */
  breakdown?: readonly BreakdownRow[] | undefined;
  className?: string | undefined;
  accent?: string | undefined;
  inline?: boolean | undefined;
  testId?: string | undefined;
}

/** Rich tooltip body: the explanation, then a table of causes whose rows explain themselves. */
export function BreakdownTip({ title, text, rows }: { title?: string | undefined; text: string; rows: readonly BreakdownRow[] }) {
  return (
    <div className="bd">
      {title && <div className="bd-title">{title}</div>}
      <div className="bd-text">{text}</div>
      <div className="bd-rows">
        {rows.map((r) => {
          const row = (
            <span className={`bd-row ${r.tip ? 'has-tip' : ''}`}>
              <span className="bd-label">{r.label}</span>
              <span className={`bd-value ${r.tone ?? ''}`}>{r.value}</span>
            </span>
          );
          if (!r.tip) return <span key={r.label}>{row}</span>;
          return typeof r.tip === 'string' ? (
            <span key={r.label} data-tip={r.tip} className="bd-nest">
              {row}
            </span>
          ) : (
            <Tip key={r.label} content={r.tip} className="bd-nest">
              {row}
            </Tip>
          );
        })}
      </div>
      {rows.some((r) => r.tip) && <div className="bd-foot">Hover a line for its sources.</div>}
    </div>
  );
}

/** The only sanctioned way to put a number on screen. Hover shows the cause. */
export function Stat({ label, value, tooltip, breakdown, className = '', accent, inline = false, testId }: StatProps) {
  const body = (
    <>
      {label && <span className="stat-label">{label}</span>}
      <span className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </>
  );
  if (breakdown && breakdown.length > 0)
    return (
      <Tip content={<BreakdownTip title={label} text={tooltip} rows={breakdown} />} className={`stat ${inline ? 'stat-inline' : ''} ${className}`} testId={testId}>
        {body}
      </Tip>
    );
  return (
    <span className={`stat ${inline ? 'stat-inline' : ''} ${className}`} data-tip={tooltip} aria-label={`${label ?? ''}: ${String(value)}. ${tooltip}`} data-testid={testId}>
      {body}
    </span>
  );
}
