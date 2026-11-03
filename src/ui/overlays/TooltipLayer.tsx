/**
 * Tooltips (D-080). One layer serves every `data-tip` (plain text) and every `<Tip>` (rich
 * content). Rich tooltips accept the pointer, so a row inside one can carry its own tooltip: hover
 * a modifier to see its sources, and a source to see its detail, up to three levels deep.
 * Positions are clamped to the screen and converted into the UI-scale coordinate space.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useUiStore } from '../../state/uiStore';

const rich = new Map<string, ReactNode>();
const MAX_LEVELS = 3;
const CLOSE_MS = 220;
const OPEN_MS = 90;

/** Wrap anything to give it a rich (and nestable) tooltip. */
export function Tip({ content, children, className = '', testId }: { content: ReactNode; children: ReactNode; className?: string | undefined; testId?: string | undefined }) {
  const id = useId();
  useLayoutEffect(() => {
    rich.set(id, content);
  });
  useEffect(() => () => void rich.delete(id), [id]);
  return (
    <span className={`tip-anchor ${className}`} data-tip-rich={id} data-testid={testId}>
      {children}
    </span>
  );
}

interface Level {
  anchor: HTMLElement;
  text: string | null;
  richId: string | null;
  x: number;
  y: number;
  below: boolean;
  maxW: number;
}

function anchorOf(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof Element)) return null;
  return el.closest<HTMLElement>('[data-tip-rich],[data-tip]');
}

export function TooltipLayer() {
  const scale = useUiStore((s) => s.prefs.uiScale);
  const [levels, setLevels] = useState<Level[]>([]);
  const levelsRef = useRef<Level[]>([]);
  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const commit = (next: Level[]) => {
      levelsRef.current = next;
      setLevels(next);
    };
    const place = (anchor: HTMLElement, depth: number): Level => {
      const r = anchor.getBoundingClientRect();
      const s = useUiStore.getState().prefs.uiScale;
      const vw = window.innerWidth / s;
      // First-level tooltips sit above their anchor unless it is near the top of the screen.
      const below = depth > 0 || r.top / s < 140;
      const nested = depth > 0;
      return {
        anchor,
        text: anchor.getAttribute('data-tip-rich') ? null : anchor.getAttribute('data-tip'),
        richId: anchor.getAttribute('data-tip-rich'),
        // Nested tooltips open to the side of their row; first-level ones above or below.
        x: nested ? r.right / s + 8 : (r.left + r.width / 2) / s,
        y: nested ? r.top / s - 6 : below ? r.bottom / s + 8 : r.top / s - 8,
        below: nested ? true : below,
        maxW: Math.min(360, vw - 16),
      };
    };
    const levelOfTooltip = (el: Element | null): number => {
      const box = el?.closest('[data-tt-level]');
      return box ? Number(box.getAttribute('data-tt-level')) : -1;
    };
    const cancelClose = () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    };
    const onOver = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const inside = levelOfTooltip(target);
      const anchor = anchorOf(target);
      cancelClose();
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
      if (!anchor) {
        // Over a tooltip body (keep it and its parents) or over nothing (schedule close).
        if (inside >= 0) {
          if (levelsRef.current.length > inside + 1) commit(levelsRef.current.slice(0, inside + 1));
          return;
        }
        closeTimer.current = window.setTimeout(() => commit([]), CLOSE_MS);
        return;
      }
      const depth = inside >= 0 ? inside + 1 : 0;
      if (depth >= MAX_LEVELS) return;
      const current = levelsRef.current[depth];
      if (current && current.anchor === anchor) {
        if (levelsRef.current.length > depth + 1) commit(levelsRef.current.slice(0, depth + 1));
        return;
      }
      openTimer.current = window.setTimeout(() => {
        if (!anchor.isConnected) return;
        commit([...levelsRef.current.slice(0, depth), place(anchor, depth)]);
      }, depth === 0 && levelsRef.current.length === 0 ? OPEN_MS : 40);
    };
    const onDown = (e: PointerEvent) => {
      // A click dismisses tooltips, including one about to open for the button just pressed.
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
      openTimer.current = null;
      if (levelOfTooltip(e.target as Element) < 0) commit([]);
    };
    const onScroll = () => commit([]);
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Keep every box on screen once its size is known.
  useLayoutEffect(() => {
    const vw = window.innerWidth / scale;
    const vh = window.innerHeight / scale;
    levels.forEach((l, i) => {
      const el = refs.current[i];
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const nested = i > 0;
      let left = nested ? l.x : l.x - w / 2;
      if (nested && left + w > vw - 8) left = l.anchor.getBoundingClientRect().left / scale - w - 8;
      left = Math.max(8, Math.min(vw - w - 8, left));
      let top = l.below ? l.y : l.y - h;
      top = Math.max(8, Math.min(vh - h - 8, top));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = 'visible';
    });
  }, [levels, scale]);

  // A removed anchor closes its tooltip.
  useEffect(() => {
    if (levels.length === 0) return;
    const t = window.setInterval(() => {
      const alive = levelsRef.current.filter((l) => l.anchor.isConnected);
      if (alive.length !== levelsRef.current.length) {
        levelsRef.current = alive;
        setLevels(alive);
      }
    }, 300);
    return () => window.clearInterval(t);
  }, [levels.length]);

  return (
    <div className="tt-layer" aria-live="polite">
      {levels.map((l, i) => (
        <div
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={`tt ${l.richId ? 'tt-rich' : ''} ${i > 0 ? 'tt-nested' : ''}`}
          data-tt-level={i}
          data-testid={i === 0 ? 'tooltip' : `tooltip-${i}`}
          role="tooltip"
          style={{ maxWidth: l.maxW, visibility: 'hidden' }}
        >
          {l.richId ? rich.get(l.richId) ?? null : l.text}
        </div>
      ))}
    </div>
  );
}
