/**
 * Intelligence and fog of war (D-059). A nation's picture of a region is a level 0..4:
 *   0 nothing, 1 presence only, 2 rough count, 3 count and types, 4 full picture.
 * Own and allied territory and anything next to it is seen; satellites, ISR fusion tech, recon
 * wings and spy operations widen the view; enemy counterspace and cyber blinding narrow it. Allies
 * share what they see. The AI itself is omniscient (documented); fog shapes what the player sees
 * and the odds estimate's confidence.
 */
import type { World } from './world';
import type { GameState, IntelLevel, Iso3, RegionId, StackEstimate, Unit } from './types';
import { alliesOf, atWar, clamp, isLand } from './query';

/** Cost of a spy operation as a share of GDP, and the months of coverage it buys. */
export const SPY_OP_COST_PCT_GDP = 0.0004;
export const SPY_OP_MONTHS = 6;
/** Cost of launching one satellite, USD bn (before the launch-cadence discount). */
export const SATELLITE_COST_BN = 2.5;
export const ASAT_DEBRIS = 12;

interface IntelCache {
  version: string;
  unitsByRegion: Map<RegionId, Unit[]>;
  /** Regions covered by a nation's recon wings (and its allies'). */
  recon: Map<Iso3, Set<RegionId>>;
  friendlySeen: Map<Iso3, Set<RegionId>>;
  levels: Map<Iso3, Map<RegionId, IntelLevel>>;
}
const cache = new WeakMap<GameState, IntelCache>();

function unitIndex(state: GameState): Map<RegionId, Unit[]> {
  const m = new Map<RegionId, Unit[]>();
  for (const u of Object.values(state.units)) {
    const l = m.get(u.region);
    if (l) l.push(u);
    else m.set(u.region, [u]);
  }
  return m;
}

function ctx(_world: World, state: GameState): IntelCache {
  const version = `${state.turn}|${state.regionsVersion}|${state.diplomacyVersion}|${Object.keys(state.units).length}`;
  let c = cache.get(state);
  if (c && c.version === version) return c;
  c = { version, unitsByRegion: unitIndex(state), recon: new Map(), friendlySeen: new Map(), levels: new Map() };
  cache.set(state, c);
  return c;
}

/** Effective satellites after orbital debris losses to sensors (0..). */
export function effectiveSatellites(state: GameState, iso: Iso3): number {
  const n = state.nations[iso];
  if (!n) return 0;
  return n.satellites * (1 - clamp(state.debris / 150, 0, 0.6));
}

/** Global intel bonus from orbit, tech and cyber blinding, before regional sources. */
export function globalIntelBonus(state: GameState, iso: Iso3): number {
  const n = state.nations[iso];
  if (!n) return 0;
  const sats = effectiveSatellites(state, iso);
  let b = sats >= 5 ? 2 : sats >= 1.5 ? 1 : 0;
  b += clamp(Math.round(n.modifiers.intel ?? 0), 0, 2);
  if (n.blinded > 0) b -= 2;
  return b;
}

function reconSet(world: World, state: GameState, c: IntelCache, iso: Iso3): Set<RegionId> {
  let s = c.recon.get(iso);
  if (s) return s;
  s = new Set();
  const side = new Set([iso, ...alliesOf(world, state, iso)]);
  for (const u of Object.values(state.units)) {
    if (u.mission !== 'recon' || !side.has(u.owner)) continue;
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'air') continue;
    const range = Math.max(1, t.range);
    s.add(u.region);
    let frontier = [u.region];
    for (let d = 1; d <= range; d++) {
      const next: RegionId[] = [];
      for (const r of frontier)
        for (const nb of world.regions.get(r)?.neighbours ?? [])
          if (!s.has(nb)) {
            s.add(nb);
            next.push(nb);
          }
      frontier = next;
    }
  }
  c.recon.set(iso, s);
  return s;
}

/** Regions the nation (or an ally) controls or has units in, plus their neighbours. */
function friendlySeen(world: World, state: GameState, c: IntelCache, iso: Iso3): Set<RegionId> {
  let s = c.friendlySeen.get(iso);
  if (s) return s;
  s = new Set();
  const side = new Set([iso, ...alliesOf(world, state, iso)]);
  const own = new Set<RegionId>();
  for (const r of Object.values(state.regions)) if (r.controller && side.has(r.controller)) own.add(r.id);
  for (const u of Object.values(state.units)) if (side.has(u.owner)) own.add(u.region);
  for (const id of own) {
    s.add(id);
    for (const nb of world.regions.get(id)?.neighbours ?? []) s.add(nb);
  }
  c.friendlySeen.set(iso, s);
  return s;
}

/** Intelligence level `viewer` holds on `region`. Cached per state. */
export function intelLevel(world: World, state: GameState, viewer: Iso3, region: RegionId): IntelLevel {
  const c = ctx(world, state);
  let byRegion = c.levels.get(viewer);
  if (!byRegion) c.levels.set(viewer, (byRegion = new Map()));
  const hit = byRegion.get(region);
  if (hit !== undefined) return hit;
  const level = computeLevel(world, state, c, viewer, region);
  byRegion.set(region, level);
  return level;
}

function computeLevel(world: World, state: GameState, c: IntelCache, viewer: Iso3, region: RegionId): IntelLevel {
  const r = state.regions[region];
  const side = new Set([viewer, ...alliesOf(world, state, viewer)]);
  const controller = r?.controller ?? null;
  if (controller && side.has(controller)) return 4;
  const units = c.unitsByRegion.get(region) ?? [];
  if (units.some((u) => side.has(u.owner))) return 4;
  let level = 0;
  if (friendlySeen(world, state, c, viewer).has(region)) level = 2;
  else if (!isLand(world, region)) level = 0;
  level += globalIntelBonus(state, viewer);
  if (reconSet(world, state, c, viewer).has(region)) level += 2;
  if (controller) {
    const n = state.nations[viewer];
    if (n && (n.intelOps[controller] ?? 0) > 0) level += 1;
    // Counterspace and electronic warfare of the region's controller degrade the picture.
    level += Math.round(state.nations[controller]?.modifiers.enemyIntel ?? 0);
    // Open societies at peace are easier to read than a closed enemy at war.
    if (atWar(state, viewer, controller)) level -= 1;
  }
  return clamp(Math.round(level), 0, 4) as IntelLevel;
}

/** What `viewer` knows about a stack of foreign units in a region. */
export function estimateStack(world: World, state: GameState, viewer: Iso3, units: Unit[]): StackEstimate {
  const region = units[0]?.region;
  const level = region === undefined ? (0 as IntelLevel) : intelLevel(world, state, viewer, region);
  const n = units.length;
  if (level >= 4 || units.every((u) => u.owner === viewer)) {
    return { level: 4, min: n, max: n, types: typeCounts(units), strength: avgStrength(units) };
  }
  if (level === 3) {
    return { level, min: Math.max(1, n - 1), max: n + 1, types: typeCounts(units), strength: Math.round(avgStrength(units) / 10) * 10 };
  }
  if (level === 2) {
    return { level, min: Math.max(1, Math.floor(n * 0.5)), max: Math.ceil(n * 1.6) + 1, types: null, strength: null };
  }
  if (level === 1) return { level, min: 1, max: Math.max(2, Math.ceil(n * 3)), types: null, strength: null };
  return { level: 0, min: 0, max: 0, types: null, strength: null };
}

function typeCounts(units: Unit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of units) out[u.type] = (out[u.type] ?? 0) + 1;
  return out;
}
const avgStrength = (units: Unit[]) =>
  units.length === 0 ? 0 : units.reduce((s, u) => s + u.strength, 0) / units.length;

/** Monthly bookkeeping: spy coverage and cyber blindness tick down; debris decays and eats satellites. */
export function runIntelTick(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    for (const k of Object.keys(n.intelOps)) {
      const v = (n.intelOps[k] ?? 0) - 1;
      if (v <= 0) delete n.intelOps[k];
      else n.intelOps[k] = v;
    }
    if (n.blinded > 0) n.blinded -= 1;
    if (n.cyberCooldown > 0) n.cyberCooldown -= 1;
  }
  void world;
}

export const INTEL_LABEL: Record<IntelLevel, string> = {
  0: 'No coverage',
  1: 'Presence detected',
  2: 'Rough estimate',
  3: 'Good picture',
  4: 'Full picture',
};
