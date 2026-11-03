/**
 * Geography rules: river and mountain crossings, sea routes and amphibious lift, strategic depth,
 * and maritime chokepoints (D-050, D-051, D-052).
 */
import { crossingKey, nationName, type ChokepointMeta, type CrossingMeta, type World } from './world';
import type { ChokepointState, GameState, Iso3, Modifier, RegionId, Unit } from './types';
import {
  alliesOf,
  atWar,
  clamp,
  headline,
  isLand,
  log,
  roll,
  unitPower,
  unitsIn,
} from './query';
import { TERRAIN, terrainRule, weatherAt, weatherMoveFactor } from './terrain';

// --- crossings ---------------------------------------------------------------------------------

export function crossingBetween(world: World, a: RegionId, b: RegionId): CrossingMeta | null {
  return world.crossings.get(crossingKey(a, b)) ?? null;
}

/**
 * Attacker penalty for assaulting `to` from `from` across a river or mountain border, eased by
 * engineering tech (`crossing` modifier). Returns null when the edge has no crossing feature.
 */
export function crossingModifier(
  world: World,
  state: GameState,
  iso: Iso3,
  from: RegionId,
  to: RegionId,
): Modifier | null {
  const c = crossingBetween(world, from, to);
  if (!c) return null;
  const engineering = clamp(state.nations[iso]?.modifiers.crossing ?? 0, 0, 0.9);
  let factor = 1;
  const parts: string[] = [];
  if (c.rivers.length > 0) {
    factor *= 1 - 0.25 * (1 - engineering);
    parts.push(`river crossing (${c.rivers.join(', ')})`);
  }
  if (c.mountain) {
    factor *= c.pass ? 1 - 0.2 * (1 - engineering) : 1 - 0.3 * (1 - engineering);
    parts.push(
      c.pass
        ? `mountain border via ${c.pass}`
        : `mountain border${c.ranges.length ? ` (${c.ranges.join(', ')})` : ''}`,
    );
  }
  if (parts.length === 0) return null;
  return {
    label: 'Crossing',
    factor,
    detail: `${parts.join('; ')}${engineering > 0 ? `; engineering tech recovers ${Math.round(engineering * 100)} % of the penalty` : ''}. Units already inside the region (a bridgehead) pay nothing.`,
  };
}

/** Extra movement cost of crossing the edge `from → to`. */
export function crossingMoveCost(world: World, from: RegionId, to: RegionId): number {
  const c = crossingBetween(world, from, to);
  if (!c) return 0;
  let extra = 0;
  if (c.rivers.length > 0) extra += 0.3;
  if (c.mountain) extra += c.pass ? 0.3 : 0.5;
  return extra;
}

/** Full cost of a land step `from → to` in the given month: terrain × weather + crossing. */
export function stepCost(world: World, from: RegionId, to: RegionId, month: number): number {
  const meta = world.regions.get(to);
  if (!meta || meta.sea) return 1;
  const rule = terrainRule(world, to);
  const w = weatherAt(world, to, month);
  return rule.moveCost * weatherMoveFactor(w) + crossingMoveCost(world, from, to);
}

// --- sea control and routes -------------------------------------------------------------------

export interface SeaBalance {
  mine: number;
  theirs: number;
  enemySubs: number;
  myEscorts: number;
}

/** Per-state memo for sea balances, lift and landing targets; cleared whenever units move. */
const geoCache = new WeakMap<GameState, { dv: number; rv: number; map: Map<string, unknown> }>();
function memo<T>(state: GameState, key: string, compute: () => T): T {
  // Numeric version check: this runs hundreds of thousands of times a turn.
  let e = geoCache.get(state);
  if (!e || e.dv !== state.diplomacyVersion || e.rv !== state.regionsVersion)
    geoCache.set(state, (e = { dv: state.diplomacyVersion, rv: state.regionsVersion, map: new Map() }));
  const m = e.map;
  if (m.has(key)) return m.get(key) as T;
  const v = compute();
  m.set(key, v);
  return v;
}
export function invalidateGeoCache(state: GameState): void {
  geoCache.delete(state);
}

export function seaBalance(world: World, state: GameState, zone: RegionId, iso: Iso3): SeaBalance {
  // Two-level numeric/iso cache: this is the hottest lookup in supply and pathfinding.
  const byIso = memo(state, 'sb', () => new Map<Iso3, Map<RegionId, SeaBalance>>());
  let byZone = byIso.get(iso);
  if (!byZone) byIso.set(iso, (byZone = new Map()));
  let b = byZone.get(zone);
  if (!b) byZone.set(zone, (b = computeSeaBalance(world, state, zone, iso)));
  return b;
}

/** Naval units grouped by sea zone, built once per state (cleared with the geo cache). */
function seaUnitsByZone(world: World, state: GameState): Map<RegionId, Unit[]> {
  return memo(state, 'seaUnits', () => {
    const map = new Map<RegionId, Unit[]>();
    for (const u of Object.values(state.units)) {
      if (world.unitTypes.get(u.type)?.domain !== 'sea') continue;
      const list = map.get(u.region);
      if (list) list.push(u);
      else map.set(u.region, [u]);
    }
    return map;
  });
}

function computeSeaBalance(world: World, state: GameState, zone: RegionId, iso: Iso3): SeaBalance {
  const out: SeaBalance = { mine: 0, theirs: 0, enemySubs: 0, myEscorts: 0 };
  const allies = alliesOf(world, state, iso);
  for (const u of seaUnitsByZone(world, state).get(zone) ?? []) {
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'sea') continue;
    const p = unitPower(world, state, u, 'attack');
    if (u.owner === iso || allies.includes(u.owner)) {
      out.mine += p;
      if (u.type === 'destroyerGroup' || u.type === 'carrierGroup') out.myEscorts += 1;
    } else if (atWar(state, iso, u.owner)) {
      out.theirs += p;
      if (u.type === 'attackSub') out.enemySubs += 1;
    }
  }
  return out;
}

/** Friendly naval power at least matches the enemy's and at least one friendly ship is present. */
export function hasSeaControl(world: World, state: GameState, zone: RegionId, iso: Iso3): boolean {
  const b = seaBalance(world, state, zone, iso);
  return b.mine > 0 && b.mine >= b.theirs;
}

/** Convoys can run a zone that has no hostile fleet, or where friendly ships at least match it. */
export function convoySafe(world: World, state: GameState, zone: RegionId, iso: Iso3): boolean {
  const b = seaBalance(world, state, zone, iso);
  return b.theirs === 0 || b.mine >= b.theirs;
}

/** Sea control with a clear margin: twice the enemy's power, or no enemy at all. */
export function hasSeaDominance(world: World, state: GameState, zone: RegionId, iso: Iso3): boolean {
  const b = seaBalance(world, state, zone, iso);
  return b.mine > 0 && (b.theirs === 0 || b.mine >= 2 * b.theirs);
}

/** Can `iso` move ships (or convoys) from sea zone `a` to adjacent sea zone `b`? Closed chokepoints block enemies. */
export function chokepointBlocks(world: World, state: GameState, a: RegionId, b: RegionId, iso: Iso3): ChokepointMeta | null {
  for (const c of world.chokepointsByZone.get(a) ?? []) {
    if (!c.zones.includes(b) && c.zones.length > 1) continue;
    const s = state.chokepoints[c.id];
    if (!s || s.status !== 'closed' || !s.by) continue;
    if (s.by === iso || alliesOf(world, state, iso).includes(s.by)) continue;
    if (!atWar(state, iso, s.by) && !s.mined) continue;
    return c;
  }
  for (const c of world.chokepointsByZone.get(b) ?? []) {
    if (c.zones.length > 1 && !c.zones.includes(a)) continue;
    const s = state.chokepoints[c.id];
    if (!s || s.status !== 'closed' || !s.by) continue;
    if (s.by === iso || alliesOf(world, state, iso).includes(s.by)) continue;
    if (!atWar(state, iso, s.by) && !s.mined) continue;
    return c;
  }
  return null;
}

/**
 * Breadth-first route through sea zones the nation controls, from any zone in `from` to any zone
 * in `to`. Returns the zone list (inclusive) or null.
 */
export function seaRoute(
  world: World,
  state: GameState,
  from: readonly RegionId[],
  to: readonly RegionId[],
  iso: Iso3,
  maxZones: number,
  requireControl = true,
): RegionId[] | null {
  const target = new Set(to);
  const prev = new Map<RegionId, RegionId | null>();
  const queue: RegionId[] = [];
  for (const z of from) {
    if (!world.regions.get(z)?.sea) continue;
    if (requireControl && !hasSeaControl(world, state, z, iso)) continue;
    prev.set(z, null);
    queue.push(z);
  }
  const depth = new Map<RegionId, number>(queue.map((z) => [z, 1]));
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (target.has(cur)) {
      const path: RegionId[] = [];
      let x: RegionId | null = cur;
      while (x !== null) {
        path.unshift(x);
        x = prev.get(x) ?? null;
      }
      return path;
    }
    const d = depth.get(cur)!;
    if (d >= maxZones) continue;
    for (const n of world.regions.get(cur)!.neighbours) {
      if (prev.has(n) || !world.regions.get(n)?.sea) continue;
      if (requireControl && !hasSeaControl(world, state, n, iso)) continue;
      if (chokepointBlocks(world, state, cur, n, iso)) continue;
      prev.set(n, cur);
      depth.set(n, d + 1);
      queue.push(n);
    }
  }
  return null;
}

const seaZonesOf = (world: World, region: RegionId): RegionId[] =>
  (world.regions.get(region)?.neighbours ?? []).filter((n) => world.regions.get(n)?.sea);

/** Great-circle distance between two region centroids, km. */
export function distanceKm(world: World, a: RegionId, b: RegionId): number {
  const ma = world.regions.get(a);
  const mb = world.regions.get(b);
  if (!ma || !mb) return Infinity;
  const toRad = Math.PI / 180;
  const dLat = (mb.lat - ma.lat) * toRad;
  const dLon = (mb.lon - ma.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(ma.lat * toRad) * Math.cos(mb.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Reach of a landing from its embarkation region: a self-lifted hop vs. a shipped expedition. */
export const SELF_LIFT_KM = 700;
export const LIFTED_KM = 2000;

/** Amphibious lift available to a nation: amphibious groups carry two formations each (plus tech). */
export function liftCapacity(world: World, state: GameState, iso: Iso3): number {
  return memo(state, `lift|${iso}`, () => computeLift(world, state, iso));
}

function computeLift(world: World, state: GameState, iso: Iso3): number {
  let lift = 0;
  const allies = alliesOf(world, state, iso);
  for (const u of Object.values(state.units)) {
    const t = world.unitTypes.get(u.type);
    if (!t || t.transport <= 0) continue;
    if (u.owner !== iso && !allies.includes(u.owner)) continue;
    lift += t.transport * (u.strength / 100);
  }
  return Math.floor(lift * (1 + (state.nations[iso]?.modifiers.amphibiousLift ?? 0)));
}

/**
 * Coastal land regions a land unit in `from` can land in: every zone on the sea route must be
 * controlled, marines and special forces may self-lift across one zone, everyone else needs
 * amphibious lift (checked per turn in runMovement) and may cross up to three zones.
 */
export function amphibiousTargets(
  world: World,
  state: GameState,
  from: RegionId,
  iso: Iso3,
  unitType?: string,
): RegionId[] {
  const selfLift = unitType === 'marines' || unitType === 'specialForces';
  return memo(state, `amph|${from}|${iso}|${selfLift ? 1 : 0}`, () =>
    computeAmphibiousTargets(world, state, from, iso, selfLift),
  );
}

function computeAmphibiousTargets(
  world: World,
  state: GameState,
  from: RegionId,
  iso: Iso3,
  selfLift: boolean,
): RegionId[] {
  const out: RegionId[] = [];
  const meta = world.regions.get(from);
  if (!meta || meta.sea) return out;
  const start = seaZonesOf(world, from).filter((z) => hasSeaControl(world, state, z, iso));
  if (start.length === 0) return out;
  const lift = liftCapacity(world, state, iso);
  const maxZones = selfLift ? (lift > 0 ? 3 : 1) : lift > 0 ? 3 : 0;
  if (maxZones === 0) return out;
  // Sea zones are large (and a few inland seas share a zone with the ocean), so the reach is also
  // bounded by distance: marines row across a strait; a corps needs shipping and still stages close.
  const maxKm = lift > 0 ? LIFTED_KM : SELF_LIFT_KM;
  const waters = meta.waterBodies;
  const sameWater = (t: RegionId) => world.regions.get(t)!.waterBodies.some((w) => waters.includes(w));
  // Flood fill over controlled zones up to maxZones deep.
  const seen = new Set<RegionId>(start);
  let frontier = [...start];
  for (let d = 1; d <= maxZones; d++) {
    for (const z of frontier)
      for (const t of world.regions.get(z)!.neighbours)
        if (t !== from && isLand(world, t) && !out.includes(t) && sameWater(t) && distanceKm(world, from, t) <= maxKm)
          out.push(t);
    if (d === maxZones) break;
    const next: RegionId[] = [];
    for (const z of frontier)
      for (const n of world.regions.get(z)!.neighbours) {
        if (seen.has(n) || !world.regions.get(n)?.sea) continue;
        if (!hasSeaControl(world, state, n, iso)) continue;
        if (chokepointBlocks(world, state, z, n, iso)) continue;
        seen.add(n);
        next.push(n);
      }
    frontier = next;
  }
  return out;
}

/** True when the unit reached its current region by sea this turn (no shared land border). */
export function landedFromSea(world: World, u: Unit): boolean {
  if (u.prevRegion === u.region) return false;
  const prev = world.regions.get(u.prevRegion);
  return !!prev && !prev.sea && !prev.neighbours.includes(u.region);
}

// --- strategic depth ---------------------------------------------------------------------------

const depthCache = new WeakMap<GameState, Map<string, number>>();

/**
 * Land steps from `region` to the nearest region the nation (or an ally) both owns and controls —
 * how deep in hostile territory an occupier stands. Capped at 6.
 */
export function depthFromHome(world: World, state: GameState, region: RegionId, iso: Iso3): number {
  let cache = depthCache.get(state);
  if (!cache) depthCache.set(state, (cache = new Map()));
  const key = `${region}|${iso}|${state.regionsVersion}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const friendly = new Set([iso, ...alliesOf(world, state, iso)]);
  const home = (id: RegionId) => {
    const r = state.regions[id];
    return !!r && r.owner !== null && friendly.has(r.owner) && r.controller === r.owner;
  };
  let depth = 0;
  if (!home(region)) {
    const seen = new Set<RegionId>([region]);
    let frontier = [region];
    depth = 6;
    outer: for (let d = 1; d <= 6; d++) {
      const next: RegionId[] = [];
      for (const cur of frontier)
        for (const n of world.regions.get(cur)!.neighbours) {
          if (seen.has(n) || !isLand(world, n)) continue;
          if (home(n)) {
            depth = d;
            break outer;
          }
          seen.add(n);
          next.push(n);
        }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }
  cache.set(key, depth);
  return depth;
}

/** Monthly partisan attrition (strength points) for an occupier in a hostile-owned region. */
export function partisanAttrition(world: World, state: GameState, u: Unit): { loss: number; detail: string } | null {
  const r = state.regions[u.region];
  if (!r || !r.owner || r.owner === u.owner) return null;
  if (!atWar(state, u.owner, r.owner)) return null;
  const depth = depthFromHome(world, state, u.region, u.owner);
  const ownerRegions = world.regionsByNation.get(r.owner)?.length ?? 1;
  const big = ownerRegions >= 20 ? 1.3 : ownerRegions >= 10 ? 1.1 : 1;
  const loss = (1.5 + 0.8 * depth) * big;
  return {
    loss,
    detail: `Partisans: ${depth} region${depth === 1 ? '' : 's'} deep in ${nationName(world, r.owner)}${big > 1 ? ' (a large country trades space for time)' : ''}`,
  };
}

// --- chokepoints -------------------------------------------------------------------------------

export function chokepointState(state: GameState, id: string): ChokepointState {
  return (
    state.chokepoints[id] ?? { status: 'open', by: null, mined: false, minedBy: null, since: 0 }
  );
}

/** Nations controlling at least one shore of the chokepoint. */
export function shoreControllers(_world: World, state: GameState, c: ChokepointMeta): Iso3[] {
  const out: Iso3[] = [];
  for (const s of c.shores) {
    const ctrl = state.regions[s]?.controller;
    if (ctrl && !out.includes(ctrl)) out.push(ctrl);
  }
  return out;
}

export function canCloseChokepoint(_world: World, state: GameState, iso: Iso3, c: ChokepointMeta): string | null {
  if (!shoreControllers(_world, state, c).includes(iso)) return 'You must control a shore of the strait.';
  if (!state.wars.some((w) => w.attackers.includes(iso) || w.defenders.includes(iso)))
    return 'Closing a strait is an act of war: you must already be at war.';
  return null;
}

export function canMineChokepoint(_world: World, state: GameState, iso: Iso3, c: ChokepointMeta): string | null {
  const ships = c.zones.some((z) =>
    unitsIn(state, z).some((u) => u.owner === iso && (u.type === 'attackSub' || u.type === 'destroyerGroup')),
  );
  if (!ships) return 'A submarine or destroyer group must be in the strait to lay or clear mines.';
  if (!state.wars.some((w) => w.attackers.includes(iso) || w.defenders.includes(iso)))
    return 'Mining a strait is an act of war: you must already be at war.';
  return null;
}

export function applyChokepointCommand(
  world: World,
  state: GameState,
  iso: Iso3,
  id: string,
  action: 'close' | 'open' | 'mine' | 'clear',
): void {
  const c = world.chokepoints.find((x) => x.id === id);
  if (!c) throw new Error('Unknown chokepoint');
  const s = { ...chokepointState(state, id) };
  if (action === 'close') {
    const why = canCloseChokepoint(world, state, iso, c);
    if (why) throw new Error(why);
    s.status = 'closed';
    s.by = iso;
    s.since = state.turn;
    state.globalTension = clamp(state.globalTension + 6, 0, 100);
    log(state, { kind: 'war', text: `${nationName(world, iso)} closes the ${c.name} to hostile shipping.`, nations: [iso], alert: true });
    headline(state, `${c.name.toUpperCase()} CLOSED — markets reel`);
  } else if (action === 'open') {
    if (s.by !== iso && s.minedBy !== iso) throw new Error('You are not the one closing it.');
    if (s.mined && s.minedBy === iso) {
      s.mined = false;
      s.minedBy = null;
    }
    s.status = 'open';
    s.by = null;
    s.since = state.turn;
    log(state, { kind: 'peace', text: `${nationName(world, iso)} reopens the ${c.name}.`, nations: [iso], alert: true });
  } else if (action === 'mine') {
    const why = canMineChokepoint(world, state, iso, c);
    if (why) throw new Error(why);
    s.mined = true;
    s.minedBy = iso;
    s.status = 'closed';
    s.by = iso;
    s.since = state.turn;
    state.globalTension = clamp(state.globalTension + 6, 0, 100);
    log(state, { kind: 'war', text: `${nationName(world, iso)} mines the ${c.name}.`, nations: [iso], alert: true });
    headline(state, `Mines reported in the ${c.name}; insurers suspend cover`);
  } else {
    const why = canMineChokepoint(world, state, iso, c);
    if (why) throw new Error(why);
    if (!s.mined) throw new Error('No mines to clear.');
    // Clearing takes a turn's worth of minesweeping; modelled as a 60 % chance per attempt.
    if (roll(state) < 0.6) {
      s.mined = false;
      s.minedBy = null;
      if (s.by === null || !shoreControllers(world, state, c).includes(s.by)) {
        s.status = 'open';
        s.by = null;
      }
      log(state, { kind: 'info', text: `${nationName(world, iso)} clears the mines from the ${c.name}.`, nations: [iso], alert: true });
    } else {
      log(state, { kind: 'info', text: `Minesweeping in the ${c.name} continues.`, nations: [iso], alert: true });
    }
  }
  state.chokepoints[id] = s;
}

/**
 * Monthly chokepoint update: AI shore powers at war close straits their enemies depend on; a
 * closure lapses when the closer loses every shore or leaves all its wars; enemy naval dominance
 * over a closed strait contests it (trade partly resumes). Then recompute the oil-price index.
 */
export function updateChokepoints(world: World, state: GameState): void {
  for (const c of world.chokepoints) {
    const s = { ...chokepointState(state, c.id) };
    const shores = shoreControllers(world, state, c);
    const atWarWith = (iso: Iso3) => state.wars.filter((w) => w.attackers.includes(iso) || w.defenders.includes(iso));
    if (s.status !== 'open' && s.by) {
      const stillAtWar = atWarWith(s.by).length > 0;
      const holdsShore = shores.includes(s.by);
      if (!stillAtWar || (!holdsShore && !s.mined) || !state.nations[s.by]?.alive) {
        s.status = 'open';
        s.by = null;
        s.mined = false;
        s.minedBy = null;
        s.since = state.turn;
        log(state, { kind: 'peace', text: `The ${c.name} reopens to shipping.`, nations: [], alert: true });
      } else {
        // Enemy naval dominance in every zone contests the closure; otherwise it stays closed.
        const enemies = new Set<Iso3>();
        for (const w of atWarWith(s.by)) for (const x of [...w.attackers, ...w.defenders]) if (x !== s.by) enemies.add(x);
        const contested = c.zones.every((z) => [...enemies].some((e) => hasSeaDominance(world, state, z, e)));
        const next = contested && !s.mined ? 'contested' : 'closed';
        if (next !== s.status) {
          s.status = next;
          s.since = state.turn;
          if (next === 'contested')
            log(state, { kind: 'battle', text: `Naval forces contest the ${c.name}; convoys run the strait under escort.`, nations: [s.by], alert: true });
        }
      }
    } else if (s.status === 'open') {
      // AI decision: a shore power at war closes the strait when an enemy depends on it.
      for (const iso of shores) {
        if (iso === state.player) continue;
        const wars = atWarWith(iso);
        if (wars.length === 0) continue;
        const enemies = new Set<Iso3>();
        for (const w of wars) for (const x of [...w.attackers, ...w.defenders]) if (x !== iso) enemies.add(x);
        const enemyDependence = [...enemies].reduce((m, e) => Math.max(m, c.dependents[e] ?? 0), 0);
        const ownDependence = c.dependents[iso] ?? 0;
        const traits = world.leaders.get(iso)?.traits;
        const aggression = traits?.aggression ?? 40;
        if (enemyDependence >= 0.1 && enemyDependence > ownDependence * 0.6 && roll(state) < 0.35 + aggression / 400) {
          s.status = 'closed';
          s.by = iso;
          s.since = state.turn;
          state.globalTension = clamp(state.globalTension + 6, 0, 100);
          log(state, { kind: 'war', text: `${nationName(world, iso)} closes the ${c.name} to hostile shipping.`, nations: [iso, ...enemies], alert: true });
          headline(state, `${c.name.toUpperCase()} CLOSED — ${nationName(world, iso)} chokes trade`);
          break;
        }
      }
    }
    state.chokepoints[c.id] = s;
  }
  state.oilPrice = oilIndex(world, state);
}

/**
 * Oil-price index implied by the current chokepoint closures: 1 = all straits open, the pre-war
 * 2025 market (Brent ≈ US$69/bbl, EIA). Hormuz closed at the start puts it at 1.6 ≈ US$110 (D-085).
 */
export function oilIndex(world: World, state: GameState): number {
  let oil = 1;
  for (const c of world.chokepoints) {
    const s = state.chokepoints[c.id];
    if (!s || s.status === 'open') continue;
    oil += c.oilShock * (s.status === 'contested' ? 0.5 : 1);
  }
  return Math.round(oil * 100) / 100;
}

/** Growth-rate exposure (pp of annual growth) of a nation to the current chokepoint closures. */
export function chokepointGrowthEffect(world: World, state: GameState, iso: Iso3): { value: number; reasons: string[] } {
  const reasons: string[] = [];
  let value = 0;
  const meta = world.nations.get(iso);
  const oilExporter = meta?.resources.includes('oil') ?? false;
  for (const c of world.chokepoints) {
    const s = state.chokepoints[c.id];
    if (!s || s.status === 'open') continue;
    const sev = s.status === 'contested' ? 0.5 : 1;
    const share = c.dependents[iso] ?? 0;
    if (share > 0 && s.by !== iso) {
      value -= 6 * share * sev;
      reasons.push(`${c.name} ${s.status}: trade −${(6 * share * sev).toFixed(1)}`);
    }
  }
  const shock = state.oilPrice - 1;
  if (shock > 0.01) {
    if (oilExporter && !reasons.some((r) => /trade/.test(r) && /Hormuz/.test(r))) {
      value += shock * 2;
      reasons.push(`oil price ×${state.oilPrice.toFixed(2)}: exporter windfall +${(shock * 2).toFixed(1)}`);
    } else if (!oilExporter) {
      value -= shock * 3;
      reasons.push(`oil price ×${state.oilPrice.toFixed(2)}: import bill −${(shock * 3).toFixed(1)}`);
    }
  }
  return { value, reasons };
}

/** Research-speed and production-cost penalties from semiconductor chokepoints (for importers). */
export function semiconductorDisruption(world: World, state: GameState, iso: Iso3): number {
  if (world.nations.get(iso)?.resources.includes('semiconductors')) return 0;
  let worst = 0;
  for (const c of world.chokepoints) {
    if (!c.semiconductors) continue;
    const s = state.chokepoints[c.id];
    if (!s || s.status === 'open' || s.by === iso) continue;
    worst = Math.max(worst, s.status === 'contested' ? 0.08 : 0.15);
  }
  return worst;
}

export { TERRAIN };
