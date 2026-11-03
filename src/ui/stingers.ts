/** Which stinger a new month deserves (D-084): pure, tested. */
import type { GameState, LogKind } from '../sim/types';
import { STINGER_PRIORITY, type StingerKind } from './audio';

const BY_LOG: Partial<Record<LogKind, StingerKind>> = {
  nuclear: 'nuclear',
  war: 'war',
  capitulation: 'capitulation',
  capture: 'capture',
  peace: 'peace',
  research: 'research',
  event: 'event',
};

/**
 * The single most important stinger between two states of the player's game, or null. Alerts
 * come from the month just resolved; a drop in the player's DEFCON and a new victory or defeat
 * count too. Only a turn change can trigger one, so orders within a month stay quiet.
 */
export function stingerFor(prev: GameState | null, next: GameState): StingerKind | null {
  if (!prev || prev.turn === next.turn || prev.player !== next.player) return null;
  const found = new Set<StingerKind>();
  for (const l of next.log) {
    if (l.turn !== next.turn - 1 || !l.alert) continue;
    const s = BY_LOG[l.kind];
    if (s) found.add(s);
  }
  const before = prev.nations[prev.player]?.defcon ?? 5;
  const after = next.nations[next.player]?.defcon ?? 5;
  if (after < before) found.add('defcon');
  if (next.victory && !prev.victory) found.add('victory');
  if (next.defeat && !prev.defeat) found.add('defeat');
  return STINGER_PRIORITY.find((k) => found.has(k)) ?? null;
}
