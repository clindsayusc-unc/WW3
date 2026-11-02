/** Read helpers and small mutators shared by every simulation subsystem. */
import { nextFloat } from './rng';
import { relationKey, sanctionKey, type World } from './world';
import type { GameState, Iso3, LogEntry, RegionId, Unit, War } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Advances the state's RNG and returns a float in [0,1). Mutates `state.rng` only. */
export function roll(state: GameState): number {
  const [v, next] = nextFloat(state.rng);
  state.rng = next;
  return v;
}

export function pick<T>(state: GameState, list: readonly T[]): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.floor(roll(state) * list.length)];
}

export function pickWeighted<T>(
  state: GameState,
  list: readonly T[],
  weight: (t: T) => number,
): T | undefined {
  let total = 0;
  for (const t of list) total += Math.max(0, weight(t));
  if (total <= 0) return undefined;
  let r = roll(state) * total;
  for (const t of list) {
    r -= Math.max(0, weight(t));
    if (r <= 0) return t;
  }
  return list[list.length - 1];
}

export function log(state: GameState, entry: Omit<LogEntry, 'turn'>): void {
  state.log.push({ turn: state.turn, ...entry });
}

export function headline(state: GameState, text: string): void {
  state.news.push(text);
}

// --- relations ------------------------------------------------------------------------------

export function defaultRelation(world: World, a: Iso3, b: Iso3): number {
  const na = world.nations.get(a);
  const nb = world.nations.get(b);
  if (!na || !nb) return 0;
  let v = 0;
  const shared = na.blocs.filter((x) => nb.blocs.includes(x));
  if (shared.length > 0) v = 40;
  const hostile: [string, string][] = [
    ['NATO', 'CSTO'],
    ['NATO', 'SCO'],
    ['EU', 'CSTO'],
    ['AUKUS', 'SCO'],
    ['Quad', 'SCO'],
  ];
  for (const [x, y] of hostile) {
    if (
      (na.blocs.includes(x) && nb.blocs.includes(y)) ||
      (na.blocs.includes(y) && nb.blocs.includes(x))
    )
      v = Math.min(v, x === 'NATO' && y === 'CSTO' ? -50 : -25);
  }
  if (na.region === nb.region && v === 0) v = 10;
  return v;
}

export function getRelation(world: World, state: GameState, a: Iso3, b: Iso3): number {
  if (a === b) return 100;
  return state.relations[relationKey(a, b)] ?? defaultRelation(world, a, b);
}

export function adjustRelation(
  world: World,
  state: GameState,
  a: Iso3,
  b: Iso3,
  delta: number,
): void {
  if (a === b) return;
  const key = relationKey(a, b);
  const cur = state.relations[key] ?? defaultRelation(world, a, b);
  state.relations[key] = clamp(Math.round((cur + delta) * 10) / 10, -100, 100);
}

export function setRelation(state: GameState, a: Iso3, b: Iso3, value: number): void {
  if (a === b) return;
  state.relations[relationKey(a, b)] = clamp(value, -100, 100);
}

// --- wars, treaties, sanctions ---------------------------------------------------------------

export function warBetween(state: GameState, a: Iso3, b: Iso3): War | undefined {
  return state.wars.find(
    (w) =>
      (w.attackers.includes(a) && w.defenders.includes(b)) ||
      (w.attackers.includes(b) && w.defenders.includes(a)),
  );
}

export const atWar = (state: GameState, a: Iso3, b: Iso3): boolean =>
  a !== b && warBetween(state, a, b) !== undefined;

export function enemiesOf(state: GameState, iso: Iso3): Iso3[] {
  const out = new Set<Iso3>();
  for (const w of state.wars) {
    if (w.attackers.includes(iso)) for (const d of w.defenders) out.add(d);
    if (w.defenders.includes(iso)) for (const a of w.attackers) out.add(a);
  }
  return [...out];
}

export const isAtWar = (state: GameState, iso: Iso3): boolean =>
  state.wars.some((w) => w.attackers.includes(iso) || w.defenders.includes(iso));

export function hasTreaty(state: GameState, a: Iso3, b: Iso3, type?: string): boolean {
  return state.treaties.some(
    (t) =>
      ((t.a === a && t.b === b) || (t.a === b && t.b === a)) &&
      (type === undefined || t.type === type),
  );
}

const allyCache = new WeakMap<
  GameState,
  { version: number; alive: number; map: Map<Iso3, Iso3[]> }
>();

export function bumpDiplomacy(state: GameState): void {
  state.diplomacyVersion += 1;
}

/** Defence-pact partners: explicit defensive/alliance treaties plus NATO and CSTO membership (D-024). Cached. */
export function alliesOf(world: World, state: GameState, iso: Iso3): Iso3[] {
  let alive = 0;
  for (const n of Object.values(state.nations)) if (n.alive) alive++;
  let entry = allyCache.get(state);
  if (!entry || entry.version !== state.diplomacyVersion || entry.alive !== alive) {
    const map = new Map<Iso3, Set<Iso3>>();
    const add = (a: Iso3, b: Iso3) => {
      if (a === b || !state.nations[a]?.alive || !state.nations[b]?.alive) return;
      if (!map.has(a)) map.set(a, new Set());
      map.get(a)!.add(b);
    };
    for (const t of state.treaties) {
      if (t.type !== 'defensive' && t.type !== 'alliance') continue;
      add(t.a, t.b);
      add(t.b, t.a);
    }
    for (const bloc of ['NATO', 'CSTO']) {
      const members = world.nationList.filter((n) => n.blocs.includes(bloc)).map((n) => n.iso3);
      for (const a of members) for (const b of members) add(a, b);
    }
    const flat = new Map<Iso3, Iso3[]>();
    for (const [k, v] of map) flat.set(k, [...v]);
    entry = { version: state.diplomacyVersion, alive, map: flat };
    allyCache.set(state, entry);
  }
  return entry.map.get(iso) ?? [];
}

export const isSanctioned = (state: GameState, from: Iso3, to: Iso3): boolean =>
  state.sanctions.includes(sanctionKey(from, to));

export function sanctionersOf(state: GameState, to: Iso3): Iso3[] {
  return state.sanctions.filter((k) => k.endsWith(`>${to}`)).map((k) => k.split('>')[0]!);
}

// --- regions & units ---------------------------------------------------------------------------

export function unitsIn(state: GameState, region: RegionId): Unit[] {
  const out: Unit[] = [];
  for (const u of Object.values(state.units)) if (u.region === region) out.push(u);
  return out;
}

export function unitsOf(state: GameState, iso: Iso3): Unit[] {
  const out: Unit[] = [];
  for (const u of Object.values(state.units)) if (u.owner === iso) out.push(u);
  return out;
}

export function controlledRegions(state: GameState, iso: Iso3): RegionId[] {
  const out: RegionId[] = [];
  for (const r of Object.values(state.regions)) if (r.controller === iso) out.push(r.id);
  return out;
}

export function ownedRegions(state: GameState, iso: Iso3): RegionId[] {
  const out: RegionId[] = [];
  for (const r of Object.values(state.regions)) if (r.owner === iso) out.push(r.id);
  return out;
}

const shareCache = new WeakMap<GameState, { version: number; map: Map<Iso3, number> }>();

/** Share of a nation's owned population it still controls (0..1). Cached per state + regionsVersion. */
export function controlShare(world: World, state: GameState, iso: Iso3): number {
  let entry = shareCache.get(state);
  if (!entry || entry.version !== state.regionsVersion) {
    const owned = new Map<Iso3, number>();
    const held = new Map<Iso3, number>();
    for (const r of Object.values(state.regions)) {
      if (!r.owner) continue;
      const share = world.regions.get(r.id)?.populationShare ?? 0;
      owned.set(r.owner, (owned.get(r.owner) ?? 0) + share);
      if (
        r.controller === r.owner ||
        (r.controller !== null && !atWar(state, r.owner, r.controller))
      )
        held.set(r.owner, (held.get(r.owner) ?? 0) + share);
    }
    const map = new Map<Iso3, number>();
    for (const [o, total] of owned) map.set(o, total > 0 ? (held.get(o) ?? 0) / total : 1);
    entry = { version: state.regionsVersion, map };
    shareCache.set(state, entry);
  }
  return entry.map.get(iso) ?? 1;
}

/** Marks region ownership/control as changed so cached shares are recomputed. */
export function touchRegions(state: GameState): void {
  state.regionsVersion += 1;
}

const upkeepCache = new WeakMap<GameState, { count: number; map: Map<Iso3, number> }>();

/** Raw upkeep (before tech modifiers) per nation, cached per state while the unit count is unchanged. */
export function rawUpkeepByNation(world: World, state: GameState): Map<Iso3, number> {
  const count = Object.keys(state.units).length;
  let entry = upkeepCache.get(state);
  if (!entry || entry.count !== count) {
    const map = new Map<Iso3, number>();
    for (const u of Object.values(state.units)) {
      const t = world.unitTypes.get(u.type);
      map.set(u.owner, (map.get(u.owner) ?? 0) + (t?.upkeepBn ?? 0.1));
    }
    entry = { count, map };
    upkeepCache.set(state, entry);
  }
  return entry.map;
}

/** Poorer armies are cheaper to raise and keep (D-026). */
export function costFactor(quality: number): number {
  return clamp(quality ** 1.5, 0.3, 1.6);
}

/** Combat value of a unit stack for the AI and the odds display (no terrain). */
export function unitPower(
  world: World,
  state: GameState,
  u: Unit,
  mode: 'attack' | 'defence',
): number {
  const t = world.unitTypes.get(u.type);
  if (!t) return 0;
  const n = state.nations[u.owner];
  const mods = n?.modifiers ?? {};
  const base = mode === 'attack' ? t.attack : t.defence;
  let mult = n?.quality ?? 1;
  if (t.domain === 'land')
    mult *= 1 + (mods[mode === 'attack' ? 'landAttack' : 'landDefence'] ?? 0);
  if (t.domain === 'air') mult *= 1 + (mods.airPower ?? 0);
  if (t.domain === 'sea') mult *= 1 + (mods.navalPower ?? 0);
  if (u.type === 'drone') mult *= 1 + (mods.droneStrength ?? 0);
  return (u.strength / 100) * base * mult * (0.6 + 0.4 * (u.morale / 100));
}

/** Military power index of a nation (sum of unit attack+defence values). */
export function militaryPower(world: World, state: GameState, iso: Iso3): number {
  let p = 0;
  for (const u of Object.values(state.units)) {
    if (u.owner !== iso) continue;
    p += unitPower(world, state, u, 'attack') + unitPower(world, state, u, 'defence');
  }
  return p;
}

export function effectiveGdp(world: World, state: GameState, iso: Iso3): number {
  const n = state.nations[iso];
  if (!n) return 0;
  return n.gdp * controlShare(world, state, iso);
}

export function worldGdp(world: World, state: GameState): number {
  let g = 0;
  for (const n of Object.values(state.nations))
    if (n.alive) g += effectiveGdp(world, state, n.iso3);
  return g;
}

export const isLand = (world: World, id: RegionId): boolean =>
  !(world.regions.get(id)?.sea ?? true);

/** Land adjacency across a shared sea zone, usable by amphibious units when the mover holds sea control (D-025). */
export function amphibiousTargets(
  world: World,
  state: GameState,
  from: RegionId,
  iso: Iso3,
): RegionId[] {
  const out: RegionId[] = [];
  const meta = world.regions.get(from);
  if (!meta || meta.sea) return out;
  for (const z of meta.neighbours) {
    const zm = world.regions.get(z);
    if (!zm?.sea) continue;
    if (!hasSeaControl(world, state, z, iso)) continue;
    for (const t of zm.neighbours) {
      if (t !== from && isLand(world, t) && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function hasSeaControl(world: World, state: GameState, zone: RegionId, iso: Iso3): boolean {
  let mine = 0;
  let theirs = 0;
  for (const u of unitsIn(state, zone)) {
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'sea') continue;
    const p = unitPower(world, state, u, 'attack');
    if (u.owner === iso || alliesOf(world, state, iso).includes(u.owner)) mine += p;
    else if (atWar(state, iso, u.owner)) theirs += p;
  }
  return mine > 0 && mine >= theirs;
}
