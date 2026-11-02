import type { ReactNode } from 'react';

interface StatProps {
  label: string;
  value: ReactNode;
  /** Required: every number shown in the UI must explain itself. */
  tooltip: string;
}

/** The only sanctioned way to put a number on screen. */
export function Stat({ label, value, tooltip }: StatProps) {
  return (
    <div className="stat" title={tooltip} aria-label={`${label}: ${String(value)}. ${tooltip}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
