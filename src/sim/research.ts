/** Research points from the research budget; tech effects become nation modifiers (D-027). */
import { nationName, type World } from './world';
import type { GameState, Iso3 } from './types';
import { headline, log } from './query';
import { semiconductorDisruption } from './geography';

export function researchPointsPerMonth(world: World, state: GameState, iso: Iso3): number {
  const n = state.nations[iso]!;
  const spendBn =
    n.finances.research > 0 ? n.finances.research : (n.gdp * 0.28 * n.budget.research) / 100 / 12;
  const base = 10 * Math.sqrt(Math.max(0, spendBn));
  const major = world.nations.get(iso)?.major ? 1.1 : 1;
  const sanctions = state.sanctions.some((k) => k.endsWith(`>${iso}`)) ? 0.85 : 1;
  // Closed semiconductor chokepoints (Taiwan Strait, Malacca) starve chip importers (D-052).
  const chips = 1 - semiconductorDisruption(world, state, iso);
  // A naval blockade cuts the imports research depends on (D-059).
  const blockade = n.blockaded ? 0.85 : 1;
  return base * major * sanctions * chips * blockade * (1 + (n.modifiers.researchSpeed ?? 0));
}

export function availableTechs(world: World, state: GameState, iso: Iso3): string[] {
  const n = state.nations[iso]!;
  return world.techList
    .filter((t) => !n.techs.includes(t.id) && t.requires.every((r) => n.techs.includes(r)))
    .map((t) => t.id);
}

export function recomputeModifiers(world: World, state: GameState, iso: Iso3): void {
  const n = state.nations[iso]!;
  const mods: Record<string, number> = {};
  for (const id of n.techs) {
    const t = world.techs.get(id);
    if (!t) continue;
    for (const e of t.effects) mods[e.key] = (mods[e.key] ?? 0) + e.value;
  }
  n.modifiers = mods;
}

export function completeTech(world: World, state: GameState, iso: Iso3, techId: string): void {
  const n = state.nations[iso]!;
  if (n.techs.includes(techId)) return;
  n.techs.push(techId);
  recomputeModifiers(world, state, iso);
  const t = world.techs.get(techId);
  if (iso === state.player) {
    log(state, {
      kind: 'research',
      text: `Research complete: ${t?.name ?? techId}. ${t?.framing ?? ''}`,
      nations: [iso],
      alert: true,
    });
  } else if (world.nations.get(iso)?.major && (t?.tier ?? 0) >= 3) {
    headline(state, `${nationName(world, iso)} fields ${t?.name ?? techId}`);
  }
}

export function runResearch(world: World, state: GameState): string[] {
  const completed: string[] = [];
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const pts = researchPointsPerMonth(world, state, n.iso3);
    n.researchPoints += pts;
    if (!n.researchCurrent) continue;
    const t = world.techs.get(n.researchCurrent);
    if (!t) {
      n.researchCurrent = null;
      continue;
    }
    if (n.researchPoints >= t.cost) {
      n.researchPoints -= t.cost;
      completeTech(world, state, n.iso3, t.id);
      if (n.iso3 === state.player) completed.push(t.name);
      n.researchCurrent = null;
    }
  }
  return completed;
}
