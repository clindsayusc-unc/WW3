import type { ReactNode } from 'react';

interface StatProps {
  label?: string | undefined;
  value: ReactNode;
  /** Required: every number shown in the UI must explain its cause (D-007, D-018). */
  tooltip: string;
  className?: string | undefined;
  accent?: string | undefined;
  inline?: boolean | undefined;
}

/** The only sanctioned way to put a number on screen. Hover shows the cause. */
export function Stat({ label, value, tooltip, className = '', accent, inline = false }: StatProps) {
  return (
    <span
      className={`stat ${inline ? 'stat-inline' : ''} ${className}`}
      data-tip={tooltip}
      aria-label={`${label ?? ''}: ${String(value)}. ${tooltip}`}
    >
      {label && <span className="stat-label">{label}</span>}
      <span className="stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
    </span>
  );
}
