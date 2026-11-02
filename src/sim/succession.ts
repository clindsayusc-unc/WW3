/**
 * Successor personalities (D-078). When a leader leaves office, the successor — always generated
 * and fictional — comes from a party or faction (data/factions.json, profiles from public
 * positions). Their traits blend the faction's profile with the national baseline, plus seeded
 * variation, kept within the faction's plausible bounds. Coups and revolutions (regime change)
 * shift traits further and widen the bounds.
 */
import { DEFAULT_TRAITS, type FactionMeta, type Traits, type World } from './world';
import type { GameState, Iso3 } from './types';
import { clamp, roll } from './query';

export type SuccessionCause =
  | 'election'
  | 'termLimit'
  | 'health'
  | 'resignation'
  | 'assassination'
  | 'impeachment'
  | 'coup'
  | 'revolution';

export const TRAIT_KEYS: readonly (keyof Traits)[] = [
  'aggression',
  'riskTolerance',
  'pragmatism',
  'nationalism',
  'paranoia',
  'economicPriority',
  'allianceLoyalty',
  'nuclearThreshold',
];

/** Regime change pushes a nation toward suspicion, force and a lower nuclear bar. */
export const COUP_SHIFT: Traits = {
  aggression: 10,
  riskTolerance: 8,
  pragmatism: -10,
  nationalism: 8,
  paranoia: 12,
  economicPriority: -8,
  allianceLoyalty: -8,
  nuclearThreshold: -8,
};
/** A revolution brings the opposition to power amid upheaval: less loyal, more anxious, less predictable. */
export const REVOLUTION_SHIFT: Traits = {
  aggression: 4,
  riskTolerance: 6,
  pragmatism: -6,
  nationalism: 6,
  paranoia: 8,
  economicPriority: -6,
  allianceLoyalty: -10,
  nuclearThreshold: -4,
};
const ZERO: Traits = { aggression: 0, riskTolerance: 0, pragmatism: 0, nationalism: 0, paranoia: 0, economicPriority: 0, allianceLoyalty: 0, nuclearThreshold: 0 };

export const isRegimeChange = (cause: SuccessionCause): boolean => cause === 'coup' || cause === 'revolution';
const rawShift = (cause: SuccessionCause): Traits => (cause === 'coup' ? COUP_SHIFT : cause === 'revolution' ? REVOLUTION_SHIFT : ZERO);

/**
 * The regime-change shift for a faction, scaled by the headroom left on each trait: a faction that
 * is already at 90 aggression has little further to go (full shift with ≥ 40 points of room).
 */
function shiftFor(faction: FactionMeta | null, cause: SuccessionCause): Traits {
  const raw = rawShift(cause);
  const out = {} as Record<keyof Traits, number>;
  for (const k of TRAIT_KEYS) {
    const p = faction?.traits[k] ?? 50;
    const room = raw[k] >= 0 ? 100 - p : p;
    out[k] = raw[k] * Math.min(1, room / 40);
  }
  return out;
}

/**
 * National baseline: the mean of the weight-averaged faction profiles and the researched leader's
 * traits — the strategic culture any government of the nation inherits (threats, doctrine).
 */
export function nationalBaseline(world: World, iso: Iso3): Traits {
  const real = world.leaders.get(iso)?.traits ?? DEFAULT_TRAITS;
  const fs = world.factions.get(iso)?.factions ?? [];
  const total = fs.reduce((s, f) => s + f.weight, 0);
  const out = { ...real } as Record<keyof Traits, number>;
  if (total > 0)
    for (const k of TRAIT_KEYS) {
      const mean = fs.reduce((s, f) => s + f.traits[k] * f.weight, 0) / total;
      out[k] = Math.round((mean + real[k]) / 2);
    }
  return out;
}

export function factionOf(world: World, iso: Iso3, id: string | null): FactionMeta | null {
  const nf = world.factions.get(iso);
  if (!nf) return null;
  return nf.factions.find((f) => f.id === (id ?? nf.incumbent)) ?? nf.factions[0] ?? null;
}

/** Which faction the successor comes from. Deterministic. */
export function successorFaction(world: World, state: GameState, iso: Iso3, cause: SuccessionCause): FactionMeta | null {
  const nf = world.factions.get(iso);
  if (!nf) return null;
  const current = factionOf(world, iso, state.nations[iso]?.leaderFaction ?? null);
  const civilians = nf.factions.filter((f) => f.kind !== 'military');
  const best = (list: readonly FactionMeta[], score: (f: FactionMeta) => number) =>
    list.reduce<FactionMeta | null>((b, f) => (!b || score(f) > score(b) ? f : b), null);
  switch (cause) {
    case 'election':
      // The main opposition: the largest civilian faction other than the government's.
      return best(civilians.filter((f) => f.id !== current?.id), (f) => f.weight) ?? current;
    case 'coup':
      // The army, or failing a military faction, the most hawkish and suspicious one.
      return best(nf.factions.filter((f) => f.kind === 'military'), (f) => f.weight) ?? best(nf.factions, (f) => f.traits.aggression + f.traits.paranoia);
    case 'revolution':
      // The opposition that brought the crowds out: large and least paranoid.
      return best(civilians.filter((f) => f.id !== current?.id), (f) => f.weight * (100 - f.traits.paranoia)) ?? current;
    default:
      return current;
  }
}

/** Plausible range for each trait of a successor from `faction` after `cause`. */
export function successorBounds(faction: FactionMeta, cause: SuccessionCause): Record<keyof Traits, [number, number]> {
  const shift = shiftFor(faction, cause);
  const spread = faction.spread + (isRegimeChange(cause) ? 12 : 0);
  const out = {} as Record<keyof Traits, [number, number]>;
  for (const k of TRAIT_KEYS) {
    const centre = faction.traits[k] + shift[k];
    out[k] = [clamp(Math.round(centre - spread), 0, 100), clamp(Math.round(centre + spread), 0, 100)];
  }
  return out;
}

/** Sum of absolute trait differences. */
export const traitDistance = (a: Traits, b: Traits): number => TRAIT_KEYS.reduce((s, k) => s + Math.abs(a[k] - b[k]), 0);

/** Minimum distance between a successor and the predecessor: a new person, not a copy. */
export const MIN_SUCCESSOR_DISTANCE = 12;

/**
 * Generates a successor's traits: faction profile (65 %, 75 % in a regime change) blended with the
 * national baseline, plus the regime-change shift and seeded variation (±8, ±10 after a coup, ±12
 * after a revolution), clamped to the faction's bounds. Uses the state's RNG.
 */
export function successorTraits(
  world: World,
  state: GameState,
  iso: Iso3,
  faction: FactionMeta | null,
  cause: SuccessionCause,
  predecessor: Traits,
): Traits {
  const base = nationalBaseline(world, iso);
  const shift = shiftFor(faction, cause);
  const regime = isRegimeChange(cause);
  const amp = cause === 'coup' ? 10 : cause === 'revolution' ? 12 : 8;
  const profile = faction?.traits ?? predecessor;
  const wP = regime ? 0.75 : 0.65;
  const bounds = faction ? successorBounds(faction, cause) : null;
  const out = {} as Record<keyof Traits, number>;
  for (const k of TRAIT_KEYS) {
    let v = wP * profile[k] + (1 - wP) * base[k] + shift[k] + (roll(state) - 0.5) * 2 * amp;
    const [lo, hi] = bounds?.[k] ?? [0, 100];
    v = clamp(Math.round(v), lo, hi);
    out[k] = v;
  }
  // A new person: if the draw landed too close to the predecessor, push traits apart within bounds.
  for (const k of TRAIT_KEYS) {
    if (traitDistance(out, predecessor) >= MIN_SUCCESSOR_DISTANCE) break;
    const [lo, hi] = bounds?.[k] ?? [0, 100];
    // Only ever move away from the predecessor; a trait pinned at its bound stays put.
    const away = out[k] >= predecessor[k] ? 6 : -6;
    out[k] = clamp(out[k] + away, lo, hi);
  }
  return out;
}
