/** Effective per-effect levels (0 low, 1 medium, 2 high) after the auto-scaler cap (D-055). */
import { useMemo } from 'react';
import { useUiStore } from '../state/uiStore';
import { effectiveLevel, type EffectKey } from './quality';

export type Levels = Record<EffectKey, number>;

export function levelsOf(effects: Parameters<typeof effectiveLevel>[0], cap: number): Levels {
  return {
    atmosphere: effectiveLevel(effects, 'atmosphere', cap),
    ocean: effectiveLevel(effects, 'ocean', cap),
    clouds: effectiveLevel(effects, 'clouds', cap),
    terrain: effectiveLevel(effects, 'terrain', cap),
    war: effectiveLevel(effects, 'war', cap),
  };
}

export function useLevels(): Levels {
  const effects = useUiStore((s) => s.effects);
  const cap = useUiStore((s) => s.autoCap);
  return useMemo(() => levelsOf(effects, cap), [effects, cap]);
}

/** Non-hook access for useFrame loops. */
export function currentLevels(): Levels {
  const s = useUiStore.getState();
  return levelsOf(s.effects, s.autoCap);
}
