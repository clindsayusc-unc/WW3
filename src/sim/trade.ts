/**
 * Trade network, sanctions regimes and the strategic-resource market (D-061).
 *
 * Every month: (1) each bilateral relationship in data/trade.json is routed over the sea-zone
 * graph (or overland between neighbours) and scaled by war, embargoes, sanctions, secondary
 * sanctions, treaties, relations and the size of both economies; (2) six strategic resources are
 * allocated from producers to consumers along the same routes, under the same restrictions;
 * (3) each nation's trade, export, shortage and price terms are stored in `NationState.econ` for
 * the growth model (economy.ts) and the UI. Everything is measured against the January 2027
 * baseline, so the starting world (with its existing sanctions) has zero penalties.
 */
import { nationName, relationKey, sanctionKey, traitsOf, type InputWeights, type ResourceMeta, type World } from './world';
import {
  RESOURCE_IDS,
  type EconTerms,
  type GameState,
  type Iso3,
  type RegionId,
  type ResourceBalance,
  type ResourceId,
  type TradeRoute,
  type TradeStatus,
} from './types';
import {
  alliesOf,
  adjustRelation,
  atWar,
  clamp,
  controlShare,
  getRelation,
  hasTreaty,
  headline,
  isSanctioned,
  log,
  sanctionersOf,
} from './query';
import { zoneControl } from './naval';

/** Share of bilateral trade that survives sanctions (grey trade, exempt goods). */
export const SANCTION_TRADE_FACTOR = 0.3;
/** Share of its trade with a target that a third party keeps when it complies with secondary sanctions. */
export const SECONDARY_COMPLY_FACTOR = 0.3;
/** Share of its trade with the sanctioner that a defiant third party loses. */
export const SECONDARY_DEFY_PENALTY = 0.25;
/** Growth elasticity of lost trade: pp of annual growth per 1 % of GDP of trade lost. */
export const TRADE_ELASTICITY = 0.6;
/** Volume uplift from a bilateral trade agreement. */
export const TREATY_FACTOR = 1.06;
/** Throughput of a route that runs through contested waters. */
export const CONTESTED_FACTOR = 0.5;
/** Throughput of a route forced onto a much longer detour (higher freight and insurance). */
export const REROUTE_FACTOR = 0.85;

// --- sanctions predicates ---------------------------------------------------------------------

export const isEmbargoed = (state: GameState, from: Iso3, to: Iso3): boolean =>
  state.embargoes.includes(sanctionKey(from, to));
export const embargoBetween = (state: GameState, a: Iso3, b: Iso3): boolean =>
  isEmbargoed(state, a, b) || isEmbargoed(state, b, a);
export const sanctionBetween = (state: GameState, a: Iso3, b: Iso3): boolean =>
  isSanctioned(state, a, b) || isSanctioned(state, b, a);
export const hasSecondary = (state: GameState, from: Iso3, to: Iso3): boolean =>
  state.secondarySanctions.includes(sanctionKey(from, to));

let pairVolume: Map<string, number> | null = null;
/** Two-way goods trade between two nations in the data (US$ bn/yr; 0 when not listed). */
export function baseVolume(world: World, a: Iso3, b: Iso3): number {
  if (!pairVolume) pairVolume = new Map(world.tradePairs.map((p) => [relationKey(p.a, p.b), p.volume]));
  return pairVolume.get(relationKey(a, b)) ?? 0;
}

/**
 * Does third party `x` comply with `f`'s secondary sanctions on `t`? Allies of the target defy;
 * allies of the sanctioner comply; friends of the target defy; everyone else complies when its trade with
 * the sanctioner is worth at least 1.5× its trade with the target. The player never complies
 * automatically: it sanctions the target itself, or defies and pays the penalty.
 */
export function compliesWithSecondary(world: World, state: GameState, x: Iso3, f: Iso3, t: Iso3): boolean {
  if (x === f || x === t || x === state.player) return false;
  if (alliesOf(world, state, x).includes(t)) return false;
  if (alliesOf(world, state, x).includes(f)) return true;
  if (getRelation(world, state, x, t) >= 40) return false;
  const vf = baseVolume(world, x, f);
  const vt = baseVolume(world, x, t);
  return vf > 0 && vf >= 1.5 * vt;
}

/** Secondary sanctions affecting trade between `a` and `b`: which of them complies, and who defies whom. */
function secondaryOn(world: World, state: GameState, a: Iso3, b: Iso3): { comply: boolean; defiers: [Iso3, Iso3][] } {
  let comply = false;
  const defiers: [Iso3, Iso3][] = [];
  for (const key of state.secondarySanctions) {
    const [f, t] = key.split('>') as [Iso3, Iso3];
    let x: Iso3 | null = null;
    if (t === b && a !== f) x = a;
    else if (t === a && b !== f) x = b;
    if (!x) continue;
    if (isSanctioned(state, x, t) || isEmbargoed(state, x, t)) continue; // already cut
    if (compliesWithSecondary(world, state, x, f, t)) comply = true;
    else if (state.nations[f]?.alive) defiers.push([x, f]);
  }
  return { comply, defiers };
}

/** General (non-strategic) trade multiplier and status between two nations from war and sanctions. */
export function policyFactor(world: World, state: GameState, a: Iso3, b: Iso3): { factor: number; status: TradeStatus; note: string } {
  if (atWar(state, a, b)) return { factor: 0, status: 'war', note: 'At war: all trade has stopped.' };
  if (embargoBetween(state, a, b))
    return { factor: 0, status: 'embargoed', note: `Embargo by ${isEmbargoed(state, a, b) ? nationName(world, a) : nationName(world, b)}: all trade banned.` };
  if (sanctionBetween(state, a, b))
    return {
      factor: SANCTION_TRADE_FACTOR,
      status: 'sanctioned',
      note: `Sanctions: strategic goods banned, ${Math.round(SANCTION_TRADE_FACTOR * 100)} % of trade survives through grey channels.`,
    };
  const sec = secondaryOn(world, state, a, b);
  if (sec.comply)
    return {
      factor: SECONDARY_COMPLY_FACTOR,
      status: 'sanctioned',
      note: 'Secondary sanctions: firms cut back rather than lose access to the sanctioning market.',
    };
  return { factor: 1, status: 'open', note: '' };
}

/** Share of a strategic resource that may flow from exporter `e` to importer `i` under war and sanctions. */
export function strategicAccess(world: World, state: GameState, e: Iso3, i: Iso3, r: ResourceId): number {
  if (atWar(state, e, i) || embargoBetween(state, e, i)) return 0;
  if (sanctionBetween(state, e, i)) return r === 'food' ? 1 : 0; // humanitarian exemption
  if (state.secondarySanctions.length > 0 && secondaryOn(world, state, e, i).comply) return r === 'food' ? 1 : 0.2;
  return 1;
}

// --- routes ------------------------------------------------------------------------------------

/** Throughput of a route that lands its cargo in a friendly neighbour's port and goes on overland. */
export const TRANSIT_FACTOR = 0.8;

export interface RouteResult {
  factor: number;
  status: 'open' | 'rerouted' | 'contested' | 'cut';
  via: RegionId[];
  land: boolean;
  /** Neighbour whose ports and railways carry the cargo when the direct sea route is cut. */
  transit: Iso3 | null;
}

interface ZoneSets {
  blocked: Set<RegionId>;
  contested: Set<RegionId>;
}

interface Bfs {
  prev: Int32Array;
  /** −1 = unreachable. */
  dist: Int16Array;
}

/** Per-turn context: ports, land borders and the sea zones blocked or contested for each nation. */
export interface TradeCtx {
  portZones: Map<Iso3, RegionId[]>;
  landNeighbours: Map<Iso3, Set<Iso3>>;
  /** Connected water bodies each nation's coasts touch. */
  waters: Map<Iso3, Set<number>>;
  /** Zones with fleets or a non-open chokepoint, with what is known about them. */
  hotZones: { zone: RegionId; controller: Iso3 | null; contested: boolean; owners: Iso3[]; closedBy: Iso3 | null; chokeContested: boolean }[];
  sets: Map<Iso3, ZoneSets>;
  bfs: Map<string, Bfs>;
  routes: Map<string, RouteResult>;
  /** Fast lookups for this month: enemies, sanctions, embargoes, secondary-sanction compliance. */
  enemies: Map<Iso3, Set<Iso3>>;
  sanc: Map<Iso3, Set<Iso3>>;
  emb: Map<Iso3, Set<Iso3>>;
  comply: Map<string, boolean>;
}

const has = (m: Map<Iso3, Set<Iso3>>, a: Iso3, b: Iso3): boolean => m.get(a)?.has(b) ?? false;
function indexPairs(keys: readonly string[]): Map<Iso3, Set<Iso3>> {
  const m = new Map<Iso3, Set<Iso3>>();
  for (const k of keys) {
    const [f, t] = k.split('>') as [Iso3, Iso3];
    if (!m.has(f)) m.set(f, new Set());
    m.get(f)!.add(t);
  }
  return m;
}

const warIn = (ctx: TradeCtx, a: Iso3, b: Iso3): boolean => ctx.enemies.get(a)?.has(b) ?? false;

/** [strategic, food] access from exporter `e` to importer `i` (policy only), using the month's indexes. */
function fastPolicy(world: World, state: GameState, ctx: TradeCtx, e: Iso3, i: Iso3): [number, number] {
  if (warIn(ctx, e, i) || has(ctx.emb, e, i) || has(ctx.emb, i, e)) return [0, 0];
  if (has(ctx.sanc, e, i) || has(ctx.sanc, i, e)) return [0, 1];
  for (const key of state.secondarySanctions) {
    const [f, t] = key.split('>') as [Iso3, Iso3];
    let x: Iso3 | null = null;
    if (t === i && e !== f) x = e;
    else if (t === e && i !== f) x = i;
    if (!x || has(ctx.sanc, x, t)) continue;
    const ck = `${x}|${f}|${t}`;
    let c = ctx.comply.get(ck);
    if (c === undefined) {
      c = compliesWithSecondary(world, state, x, f, t);
      ctx.comply.set(ck, c);
    }
    if (c) return [0.2, 1];
  }
  return [1, 1];
}

export function buildTradeCtx(world: World, state: GameState): TradeCtx {
  const portZones = new Map<Iso3, RegionId[]>();
  const landNeighbours = new Map<Iso3, Set<Iso3>>();
  for (const r of Object.values(state.regions)) {
    const c = r.controller;
    if (!c) continue;
    const meta = world.regions.get(r.id);
    if (!meta || meta.sea) continue;
    for (const nb of meta.neighbours) {
      const m = world.regions.get(nb);
      if (!m) continue;
      if (m.sea) {
        const list = portZones.get(c) ?? [];
        if (!list.includes(nb)) list.push(nb);
        portZones.set(c, list);
      } else {
        const d = state.regions[nb]?.controller;
        if (!d || d === c) continue;
        if (!landNeighbours.has(c)) landNeighbours.set(c, new Set());
        landNeighbours.get(c)!.add(d);
      }
    }
  }
  const waters = new Map<Iso3, Set<number>>();
  for (const [iso, zones] of portZones) waters.set(iso, new Set(zones.map((z) => world.seaComponent.get(z) ?? -1)));
  const fleetZones = new Map<RegionId, Iso3[]>();
  for (const u of Object.values(state.units)) {
    if (!world.regions.get(u.region)?.sea) continue;
    if (world.unitTypes.get(u.type)?.domain !== 'sea') continue;
    const list = fleetZones.get(u.region) ?? [];
    if (!list.includes(u.owner)) list.push(u.owner);
    fleetZones.set(u.region, list);
  }
  const chokeZones = new Map<RegionId, { by: Iso3 | null; contested: boolean }>();
  for (const c of world.chokepoints) {
    const s = state.chokepoints[c.id];
    if (!s || s.status === 'open') continue;
    for (const z of c.zones) chokeZones.set(z, { by: s.by, contested: s.status === 'contested' });
  }
  const hotZones: TradeCtx['hotZones'] = [];
  for (const z of new Set([...fleetZones.keys(), ...chokeZones.keys()])) {
    const zc = fleetZones.has(z) ? zoneControl(world, state, z) : { controller: null, contested: false };
    const ch = chokeZones.get(z);
    hotZones.push({
      zone: z,
      controller: zc.controller,
      contested: zc.contested,
      owners: fleetZones.get(z) ?? [],
      closedBy: ch && !ch.contested ? ch.by : null,
      chokeContested: ch?.contested ?? false,
    });
  }
  const enemies = new Map<Iso3, Set<Iso3>>();
  const addEnemy = (x: Iso3, y: Iso3) => {
    if (!enemies.has(x)) enemies.set(x, new Set());
    enemies.get(x)!.add(y);
  };
  for (const w of state.wars)
    for (const x of w.attackers)
      for (const y of w.defenders) {
        addEnemy(x, y);
        addEnemy(y, x);
      }
  return {
    portZones,
    landNeighbours,
    waters,
    hotZones,
    sets: new Map(),
    bfs: new Map(),
    routes: new Map(),
    enemies,
    sanc: indexPairs(state.sanctions),
    emb: indexPairs(state.embargoes),
    comply: new Map(),
  };
}

/** Zones closed to a nation's shipping (enemy-held, or a strait closed against it) and contested ones. */
function zoneSets(world: World, state: GameState, ctx: TradeCtx, x: Iso3): ZoneSets {
  const hit = ctx.sets.get(x);
  if (hit) return hit;
  const blocked = new Set<RegionId>();
  const contested = new Set<RegionId>();
  if (ctx.hotZones.length > 0) {
    const friends = ctx.hotZones.some((h) => h.closedBy) ? alliesOf(world, state, x) : [];
    for (const h of ctx.hotZones) {
      if (h.controller && warIn(ctx, h.controller, x)) blocked.add(h.zone);
      else if (h.contested && h.owners.some((o) => warIn(ctx, o, x))) contested.add(h.zone);
      if (h.closedBy && h.closedBy !== x && !friends.includes(h.closedBy)) blocked.add(h.zone);
      else if (h.chokeContested && h.closedBy !== x) contested.add(h.zone);
    }
  }
  const out = { blocked, contested };
  ctx.sets.set(x, out);
  return out;
}

let seaAdj: { world: World; adj: Map<RegionId, RegionId[]>; size: number } | null = null;
/** Sea-to-sea adjacency (built once per world). */
function seaAdjacency(world: World): { adj: Map<RegionId, RegionId[]>; size: number } {
  if (!seaAdj || seaAdj.world !== world) {
    const adj = new Map<RegionId, RegionId[]>();
    let size = 0;
    for (const r of world.regionList) {
      size = Math.max(size, r.id + 1);
      if (r.sea) adj.set(r.id, r.neighbours.filter((n) => world.regions.get(n)?.sea));
    }
    seaAdj = { world, adj, size };
  }
  return seaAdj;
}

/** Breadth-first search over sea zones from a nation's coast, avoiding `avoid` (cached per signature). */
function bfsFrom(world: World, ctx: TradeCtx, origin: Iso3, avoid: ReadonlySet<RegionId>, sig: string): Bfs {
  const key = `${origin}|${sig}`;
  const hit = ctx.bfs.get(key);
  if (hit) return hit;
  const { adj, size } = seaAdjacency(world);
  const dist = new Int16Array(size).fill(-1);
  const prev = new Int32Array(size).fill(-1);
  const queue: RegionId[] = [];
  for (const z of ctx.portZones.get(origin) ?? []) {
    if (avoid.has(z) || dist[z]! >= 0) continue;
    dist[z] = 0;
    queue.push(z);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    const d = dist[cur]!;
    for (const nb of adj.get(cur) ?? []) {
      if (dist[nb]! >= 0 || avoid.has(nb)) continue;
      dist[nb] = d + 1;
      prev[nb] = cur;
      queue.push(nb);
    }
  }
  const out = { prev, dist };
  ctx.bfs.set(key, out);
  return out;
}

interface SeaLeg {
  path: RegionId[] | null;
  contested: boolean;
  rerouted: boolean;
}

/** The sea leg between two coasts, avoiding waters closed to either party. */
function seaLeg(world: World, state: GameState, ctx: TradeCtx, a: Iso3, b: Iso3): SeaLeg {
  const sa = zoneSets(world, state, ctx, a);
  const sb = zoneSets(world, state, ctx, b);
  let avoid: Set<RegionId>;
  let sig = '';
  if (sa.blocked.size + sb.blocked.size === 0) avoid = new Set();
  else {
    avoid = new Set([...sa.blocked, ...sb.blocked]);
    sig = [...avoid].sort((x, y) => x - y).join(',');
  }
  const search = bfsFrom(world, ctx, a, avoid, sig);
  let best: RegionId | null = null;
  let bestD = Infinity;
  for (const z of ctx.portZones.get(b) ?? []) {
    const d = search.dist[z]!;
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = z;
    }
  }
  if (best === null) return { path: null, contested: false, rerouted: false };
  const path: RegionId[] = [];
  for (let p: RegionId = best; p !== -1; p = search.prev[p]!) path.push(p);
  path.reverse();
  const contested = (sa.contested.size + sb.contested.size > 0) && path.some((z) => sa.contested.has(z) || sb.contested.has(z));
  let rerouted = false;
  if (sig !== '') {
    const free = bfsFrom(world, ctx, a, new Set(), '');
    let freeD = Infinity;
    for (const z of ctx.portZones.get(b) ?? []) if (free.dist[z]! >= 0) freeD = Math.min(freeD, free.dist[z]!);
    rerouted = bestD > freeD + 2;
  }
  return { path, contested, rerouted };
}

const shareWater = (ctx: TradeCtx, a: Iso3, b: Iso3): boolean => {
  const wa = ctx.waters.get(a);
  const wb = ctx.waters.get(b);
  if (!wa || !wb) return false;
  for (const w of wa) if (wb.has(w)) return true;
  return false;
};

/**
 * How goods move between `a` and `b` this month. Neighbours trade overland; otherwise the cargo
 * takes the shortest sea path between their coasts that avoids zones held by an enemy of either
 * party and straits closed against them. When that is impossible, it may land in a friendly
 * neighbour's port and finish the trip by rail (transit, 80 %). No path at all: the route is cut.
 * A path through contested waters carries half; a long detour carries 85 %.
 */
export function routeBetween(world: World, state: GameState, ctx: TradeCtx, a: Iso3, b: Iso3): RouteResult {
  const key = `${a}>${b}`;
  const hit = ctx.routes.get(key);
  if (hit) return hit;
  let out: RouteResult;
  if (ctx.landNeighbours.get(a)?.has(b) || !ctx.portZones.has(a) || !ctx.portZones.has(b) || !shareWater(ctx, a, b)) {
    // Overland (rail, road, pipeline) — or a landlocked partner reached through its neighbours.
    out = { factor: 1, status: 'open', via: [], land: true, transit: null };
  } else {
    const leg = seaLeg(world, state, ctx, a, b);
    if (leg.path && !leg.contested)
      out = { factor: leg.rerouted ? REROUTE_FACTOR : 1, status: leg.rerouted ? 'rerouted' : 'open', via: leg.path, land: false, transit: null };
    else {
      // Transit through a neighbour of either party that is at war with neither.
      let transit: RouteResult | null = null;
      const tryVia = (from: Iso3, to: Iso3, side: Iso3) => {
        for (const nb of ctx.landNeighbours.get(side) ?? []) {
          if (transit) return;
          if (nb === from || !state.nations[nb]?.alive || warIn(ctx, nb, a) || warIn(ctx, nb, b)) continue;
          if (!ctx.portZones.has(nb) || !shareWater(ctx, from, nb)) continue;
          const l = seaLeg(world, state, ctx, from, nb);
          if (l.path && !l.contested) transit = { factor: TRANSIT_FACTOR, status: 'rerouted', via: l.path, land: false, transit: nb };
        }
        void to;
      };
      tryVia(a, b, b);
      if (!transit) tryVia(b, a, a);
      if (transit) out = transit;
      else if (leg.path) out = { factor: CONTESTED_FACTOR, status: 'contested', via: leg.path, land: false, transit: null };
      else {
        const free = seaLeg(world, state, { ...ctx, sets: new Map([[a, { blocked: new Set(), contested: new Set() }], [b, { blocked: new Set(), contested: new Set() }]]) }, a, b);
        out = { factor: 0, status: 'cut', via: free.path ?? [], land: false, transit: null };
      }
    }
  }
  ctx.routes.set(key, out);
  return out;
}

// --- bilateral trade ---------------------------------------------------------------------------

const gdp0 = (world: World, iso: Iso3): number => world.nations.get(iso)?.gdpUsdBn ?? 1;

interface RouteEval {
  mult: number;
  status: TradeStatus;
  note: string;
  route: RouteResult;
  defiers: [Iso3, Iso3][];
}

function evalRoute(world: World, state: GameState, ctx: TradeCtx, a: Iso3, b: Iso3): RouteEval {
  const na = state.nations[a];
  const nb = state.nations[b];
  const route = routeBetween(world, state, ctx, a, b);
  if (!na?.alive || !nb?.alive) return { mult: 0, status: 'war', note: 'One partner no longer exists.', route, defiers: [] };
  const policy = policyFactor(world, state, a, b);
  // A trade agreement adds 6 % (nothing inside the EU single market, which already has one).
  const bothEu = world.nations.get(a)?.blocs.includes('EU') && world.nations.get(b)?.blocs.includes('EU');
  const treaty = hasTreaty(state, a, b, 'trade') && !bothEu ? TREATY_FACTOR : 1;
  const rel = getRelation(world, state, a, b);
  const relF = rel < -40 ? 0.85 : rel > 50 ? 1.05 : 1;
  let status: TradeStatus = policy.status;
  let note = policy.note;
  if (status === 'open' && route.status !== 'open') {
    status = route.status;
    note =
      route.status === 'cut'
        ? 'Every sea route runs through waters held by an enemy or a strait closed against them.'
        : route.status === 'contested'
          ? 'Convoys run through contested waters: half the cargo gets through.'
          : route.transit
            ? `The direct sea route is closed: cargo lands in ${nationName(world, route.transit)} and goes on by rail (${Math.round(TRANSIT_FACTOR * 100)} %).`
            : 'Shipping detours around hostile waters: longer voyages, higher freight and insurance.';
  }
  const sec = state.secondarySanctions.length > 0 ? secondaryOn(world, state, a, b) : { comply: false, defiers: [] };
  return { mult: policy.factor * route.factor * treaty * relF, status, note, route, defiers: sec.defiers };
}

function econZero(): EconTerms {
  return {
    tradeLost: 0,
    tradeEffect: 0,
    exportValue: 0,
    exportRef: 0,
    exportEffect: 0,
    shortageEffect: 0,
    priceEffect: 0,
    secondaryLost: 0,
    deficitPct: 0,
    sanctionShare: 0,
    sanctionRef: 0,
  };
}
export { econZero };

/** Recomputes every listed trade route; returns trade lost per nation (US$ bn/yr vs the baseline). */
function runRoutes(world: World, state: GameState, ctx: TradeCtx, calibrate: boolean): Map<Iso3, { lost: number; secondary: number }> {
  const out = new Map<Iso3, { lost: number; secondary: number }>();
  const add = (iso: Iso3, lost: number, secondary = 0) => {
    const cur = out.get(iso) ?? { lost: 0, secondary: 0 };
    cur.lost += lost;
    cur.secondary += secondary;
    out.set(iso, cur);
  };
  const evals = world.tradePairs.map((p) => evalRoute(world, state, ctx, p.a, p.b));
  // Defiance of secondary sanctions: the defier loses part of its trade with the sanctioner.
  const defy = new Set<string>();
  for (const e of evals) for (const [x, f] of e.defiers) defy.add(`${x}>${f}`);
  const routes: TradeRoute[] = [];
  world.tradePairs.forEach((p, i) => {
    const e = evals[i]!;
    let mult = e.mult;
    let note = e.note;
    if (defy.has(`${p.a}>${p.b}`) || defy.has(`${p.b}>${p.a}`)) {
      mult *= 1 - SECONDARY_DEFY_PENALTY;
      const defier = defy.has(`${p.a}>${p.b}`) ? p.a : p.b;
      note = `${nationName(world, defier)} defies ${nationName(world, defier === p.a ? p.b : p.a)}'s secondary sanctions: its banks and firms are penalised (−${Math.round(SECONDARY_DEFY_PENALTY * 100)} %).`;
    }
    const key = relationKey(p.a, p.b);
    if (calibrate) state.economy.routeRef[key] = mult;
    const ga = state.nations[p.a]!.gdp * controlShare(world, state, p.a);
    const gb = state.nations[p.b]!.gdp * controlShare(world, state, p.b);
    const gdpF = Math.sqrt(Math.max(0, (ga / gdp0(world, p.a)) * (gb / gdp0(world, p.b))));
    const volume = p.volume * gdpF * mult;
    const reference = p.volume * gdpF * (state.economy.routeRef[key] ?? mult);
    const lost = reference - volume;
    const secondary = defy.has(`${p.a}>${p.b}`) || defy.has(`${p.b}>${p.a}`) ? p.volume * gdpF * SECONDARY_DEFY_PENALTY * e.mult : 0;
    add(p.a, lost, defy.has(`${p.a}>${p.b}`) ? secondary : 0);
    add(p.b, lost, defy.has(`${p.b}>${p.a}`) ? secondary : 0);
    routes.push({
      a: p.a,
      b: p.b,
      base: p.volume,
      volume: Math.round(volume * 10) / 10,
      reference: Math.round(reference * 10) / 10,
      status: e.status,
      via: e.route.via,
      land: e.route.land,
      note,
    });
  });
  state.economy.routes = routes;
  return out;
}

// --- resource market ---------------------------------------------------------------------------

/** Population-weighted war devastation of the regions a nation still owns, 0..1. */
function devastationOf(world: World, state: GameState): Map<Iso3, number> {
  const sum = new Map<Iso3, number>();
  for (const r of Object.values(state.regions)) {
    if (!r.owner || r.devastation <= 0) continue;
    const share = world.regions.get(r.id)?.populationShare ?? 0;
    sum.set(r.owner, (sum.get(r.owner) ?? 0) + r.devastation * share);
  }
  return sum;
}

/** Each nation's share of world demand for a resource (GDP- and population-weighted, war-boosted). */
function demandShares(world: World, state: GameState, res: ResourceMeta): Map<Iso3, number> {
  let gTot = 0;
  let pTot = 0;
  const alive = Object.values(state.nations).filter((n) => n.alive);
  const g = new Map<Iso3, number>();
  for (const n of alive) {
    const eff = n.gdp * controlShare(world, state, n.iso3);
    g.set(n.iso3, eff);
    gTot += eff;
    pTot += n.population;
  }
  // Normalise to the world of January 2027 so demand grows only relative to the start.
  const out = new Map<Iso3, number>();
  for (const n of alive) {
    const share = res.demandGdpWeight * ((g.get(n.iso3) ?? 0) / (gTot || 1)) + (1 - res.demandGdpWeight) * (n.population / (pTot || 1));
    const war = n.mobilization + (state.wars.some((w) => w.attackers.includes(n.iso3) || w.defenders.includes(n.iso3)) ? 0.5 : 0);
    out.set(n.iso3, share * (1 + res.warDemand * war));
  }
  return out;
}

function emptyBalance(): ResourceBalance {
  return { production: 0, demand: 0, imports: 0, exports: 0, satisfaction: 1, suppliers: {} };
}
export function emptyBalances(): Record<ResourceId, ResourceBalance> {
  return Object.fromEntries(RESOURCE_IDS.map((r) => [r, emptyBalance()])) as Record<ResourceId, ResourceBalance>;
}

function runMarket(world: World, state: GameState, ctx: TradeCtx): void {
  const dev = devastationOf(world, state);
  const alive = Object.values(state.nations).filter((n) => n.alive);
  const N = alive.length;
  const index = new Map<Iso3, number>(alive.map((n, k) => [n.iso3, k]));
  const health = new Float64Array(N);
  alive.forEach((n, k) => (health[k] = clamp(controlShare(world, state, n.iso3) * (1 - (dev.get(n.iso3) ?? 0)), 0, 1)));
  // Pair access (policy × route) is shared by every resource; food is exempt from sanctions.
  const pairCache = new Float64Array(N * N * 2).fill(-1);
  const pair = (e: number, i: number, food: boolean): number => {
    const k = (e * N + i) * 2;
    if (pairCache[k]! < 0) {
      const ei = alive[e]!.iso3;
      const ii = alive[i]!.iso3;
      const [strategic, foodAccess] = fastPolicy(world, state, ctx, ei, ii);
      let route = 0;
      if (strategic > 0 || foodAccess > 0) {
        const se = zoneSets(world, state, ctx, ei);
        const si = zoneSets(world, state, ctx, ii);
        // No hostile or contested waters for either side: any sea path is open.
        route =
          se.blocked.size + se.contested.size + si.blocked.size + si.contested.size === 0
            ? 1
            : routeBetween(world, state, ctx, ei, ii).factor;
      }
      pairCache[k] = strategic * route;
      pairCache[k + 1] = foodAccess * route;
    }
    return pairCache[k + (food ? 1 : 0)]!;
  };
  for (const res of world.resources) {
    const demandMap = demandShares(world, state, res);
    const demand = new Float64Array(N);
    const supply = new Float64Array(N);
    alive.forEach((n, k) => (demand[k] = demandMap.get(n.iso3) ?? 0));
    for (const [iso, share] of Object.entries(res.producers)) {
      const n = state.nations[iso];
      if (!n) continue;
      if (n.alive) {
        const k = index.get(iso)!;
        supply[k] = supply[k]! + share * health[k]!;
      } else if (n.capitulatedTo && index.has(n.capitulatedTo)) {
        // Seized capacity: the conqueror runs part of it (chip fabs hardly at all).
        const k = index.get(n.capitulatedTo)!;
        supply[k] = supply[k]! + share * res.seizedYield * health[k]!;
      }
    }
    const surplus = new Float64Array(N + 1); // index N = diffuse rest-of-world production
    const deficit = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const own = Math.min(demand[k]!, supply[k]!);
      surplus[k] = supply[k]! - own;
      deficit[k] = demand[k]! - own;
    }
    surplus[N] = res.diffuse;
    const exporters: number[] = [];
    for (let k = 0; k <= N; k++) if (surplus[k]! > 1e-9) exporters.push(k);
    const importers: number[] = [];
    for (let k = 0; k < N; k++) if (deficit[k]! > 1e-9) importers.push(k);
    const foodRes = res.id === 'food';
    // Access matrix exporter × importer.
    const acc = exporters.map((e) => {
      const row = new Float64Array(importers.length);
      importers.forEach((i, j) => {
        if (e === N) row[j] = alive[i]!.blockaded ? 0.3 : 1;
        else if (e !== i) row[j] = pair(e, i, foodRes);
      });
      return row;
    });
    const imports = new Float64Array(N);
    const exportsArr = new Float64Array(N);
    const flows = new Map<number, number>(); // e * (N+1) + i → amount
    const offer = exporters.map(() => new Float64Array(importers.length));
    const received = new Float64Array(importers.length);
    for (let pass = 0; pass < 6; pass++) {
      received.fill(0);
      let any = false;
      exporters.forEach((e, x) => {
        const row = acc[x]!;
        const o = offer[x]!;
        o.fill(0);
        const s = surplus[e]!;
        if (s <= 1e-9) return;
        let total = 0;
        for (let j = 0; j < importers.length; j++) total += deficit[importers[j]!]! * row[j]!;
        if (total <= 1e-12) return;
        for (let j = 0; j < importers.length; j++) {
          const a = row[j]!;
          if (a <= 0) continue;
          const d = deficit[importers[j]!]!;
          const give = Math.min(d * a, (s * d * a) / total);
          o[j] = give;
          received[j] = received[j]! + give;
          any = true;
        }
      });
      if (!any) break;
      exporters.forEach((e, x) => {
        const o = offer[x]!;
        for (let j = 0; j < importers.length; j++) {
          const give = o[j]!;
          if (give <= 0) continue;
          const i = importers[j]!;
          const f = give * Math.min(1, deficit[i]! / (received[j] || 1));
          if (f <= 0) continue;
          surplus[e] = surplus[e]! - f;
          deficit[i] = deficit[i]! - f;
          imports[i] = imports[i]! + f;
          if (e < N) exportsArr[e] = exportsArr[e]! + f;
          const fk = e * (N + 1) + i;
          flows.set(fk, (flows.get(fk) ?? 0) + f);
        }
      });
    }
    const suppliers: Record<Iso3, number>[] = alive.map(() => ({}));
    for (const [fk, f] of flows) {
      const e = Math.floor(fk / (N + 1));
      const i = fk % (N + 1);
      if (e < N) suppliers[i]![alive[e]!.iso3] = f;
    }
    let worldDemand = 0;
    let delivered = 0;
    alive.forEach((n, k) => {
      const own = Math.min(demand[k]!, supply[k]!);
      const top = Object.entries(suppliers[k]!).sort((x, y) => y[1] - x[1]).slice(0, 3);
      const b: ResourceBalance = {
        production: round4(supply[k]!),
        demand: round4(demand[k]!),
        imports: round4(imports[k]!),
        exports: round4(exportsArr[k]!),
        satisfaction: demand[k]! > 1e-9 ? clamp((own + imports[k]!) / demand[k]!, 0, 1) : 1,
        suppliers: Object.fromEntries(top.map(([iso, v]) => [iso, round4(v)])),
      };
      worldDemand += demand[k]!;
      delivered += Math.min(demand[k]!, own + imports[k]!);
      n.resources[res.id] = b;
    });
    state.economy.shortage[res.id] = round4(worldDemand > 0 ? clamp(1 - delivered / worldDemand, 0, 1) : 0);
  }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Market prices drift 40 % a month toward (demand ÷ delivered)^1.6 relative to January 2027. */
function updatePrices(world: World, state: GameState, refShortage: Record<ResourceId, number>): void {
  for (const res of world.resources) {
    const s = state.economy.shortage[res.id] ?? 0;
    const s0 = refShortage[res.id] ?? 0;
    const tight = (1 - s0) / Math.max(0.05, 1 - s);
    const target = clamp(tight ** 1.6, 0.6, 5);
    const cur = state.economy.prices[res.id] ?? 1;
    state.economy.prices[res.id] = Math.round((cur + 0.4 * (target - cur)) * 1000) / 1000;
  }
}

/** Value of a nation's strategic-resource exports at current prices, US$ bn/yr. */
function exportValue(world: World, state: GameState, iso: Iso3): number {
  const n = state.nations[iso]!;
  let v = 0;
  for (const res of world.resources) v += (n.resources[res.id]?.exports ?? 0) * res.worldValueUsdBn * (state.economy.prices[res.id] ?? 1);
  return v;
}

/**
 * Monthly trade step. With `calibrate`, the current world becomes the baseline: route multipliers,
 * resource satisfaction and export earnings are stored as the reference the penalties use.
 */
export function runTrade(world: World, state: GameState, calibrate = false): void {
  const ctx = buildTradeCtx(world, state);
  const lost = runRoutes(world, state, ctx, calibrate);
  runMarket(world, state, ctx);
  if (calibrate) {
    for (const r of RESOURCE_IDS) state.economy.prices[r] = 1;
  } else updatePrices(world, state, state.economy.shortageRef);
  if (calibrate) state.economy.shortageRef = { ...state.economy.shortage };
  const shares = sanctionShares(state);
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const gdp = Math.max(1, n.gdp);
    const l = lost.get(n.iso3) ?? { lost: 0, secondary: 0 };
    const ev = exportValue(world, state, n.iso3);
    const sanctionShare = shares.get(n.iso3) ?? 0;
    if (calibrate) {
      n.econ.exportRef = ev;
      n.econ.sanctionRef = sanctionShare;
      for (const r of RESOURCE_IDS) n.resourceRef[r] = n.resources[r].satisfaction;
    }
    let shortage = 0;
    let price = 0;
    for (const res of world.resources) {
      const b = n.resources[res.id];
      const ref = Math.max(0.05, n.resourceRef[res.id] ?? 1);
      shortage -= res.gdpWeight * Math.max(0, ref - b.satisfaction) / ref;
      price -= (b.imports * res.worldValueUsdBn * ((state.economy.prices[res.id] ?? 1) - 1)) / gdp * 100 * 0.4;
    }
    n.econ = {
      ...n.econ,
      tradeLost: Math.round(l.lost * 10) / 10,
      tradeEffect: clamp((-TRADE_ELASTICITY * l.lost) / gdp * 100, -8, 1.5),
      secondaryLost: Math.round(l.secondary * 10) / 10,
      exportValue: Math.round(ev * 10) / 10,
      exportEffect: clamp(((ev - n.econ.exportRef) / gdp) * 100 * 0.5, -8, 4),
      shortageEffect: clamp(shortage, -8, 0),
      priceEffect: clamp(price, -5, 1),
      sanctionShare: Math.round(sanctionShare * 1000) / 1000,
    };
  }
}

// --- shortages for production and research ------------------------------------------------------

/** Weighted shortage (0..1) of a set of inputs for a nation: 1 − satisfaction, by weight. */
export function inputShortage(state: GameState, iso: Iso3, weights: InputWeights | undefined): number {
  const n = state.nations[iso];
  if (!n || !weights) return 0;
  let s = 0;
  let w = 0;
  for (const [r, wt] of Object.entries(weights) as [ResourceId, number][]) {
    const b = n.resources?.[r];
    if (!b) continue;
    s += wt * (1 - b.satisfaction);
    w += wt;
  }
  return w > 0 ? clamp(s / w, 0, 1) : 0;
}

/** Monthly build progress of a unit type: shortages of its inputs slow the line (min 25 %). */
export function productionThroughput(world: World, state: GameState, iso: Iso3, type: string): number {
  return clamp(1 - 0.75 * inputShortage(state, iso, world.unitInputs.get(type)), 0.25, 1);
}

/** Research multiplier for a branch from shortages of its inputs (min 40 %). */
export function researchThroughput(world: World, state: GameState, iso: Iso3, branch: string): number {
  return clamp(1 - 0.6 * inputShortage(state, iso, world.branchInputs.get(branch)), 0.4, 1);
}

/** Share of world GDP held by nations sanctioning or embargoing `iso`. */
export function sanctionGdpShare(state: GameState, iso: Iso3): number {
  let total = 0;
  let cut = 0;
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    total += n.gdp;
    if (n.iso3 !== iso && (isSanctioned(state, n.iso3, iso) || isEmbargoed(state, n.iso3, iso))) cut += n.gdp;
  }
  return total > 0 ? cut / total : 0;
}

/** Every target's sanctioners' share of world GDP, in one pass. */
function sanctionShares(state: GameState): Map<Iso3, number> {
  let total = 0;
  for (const n of Object.values(state.nations)) if (n.alive) total += n.gdp;
  const by = new Map<Iso3, Set<Iso3>>();
  for (const k of [...state.sanctions, ...state.embargoes]) {
    const [f, t] = k.split('>') as [Iso3, Iso3];
    if (!by.has(t)) by.set(t, new Set());
    by.get(t)!.add(f);
  }
  const out = new Map<Iso3, number>();
  for (const [t, fs] of by) {
    let cut = 0;
    for (const f of fs) if (f !== t && state.nations[f]?.alive) cut += state.nations[f]!.gdp;
    out.set(t, total > 0 ? cut / total : 0);
  }
  return out;
}

/** Research penalty from technology-export controls: 1 − 0.3 × sanctioners' share of world GDP. */
export function techAccess(_world: World, state: GameState, iso: Iso3): number {
  return 1 - 0.3 * sanctionGdpShare(state, iso);
}

// --- sanctions actions -------------------------------------------------------------------------

export function imposeEmbargo(world: World, state: GameState, from: Iso3, to: Iso3): void {
  const key = sanctionKey(from, to);
  if (from === to || state.embargoes.includes(key)) return;
  state.embargoes.push(key);
  if (!state.sanctions.includes(key)) state.sanctions.push(key);
  adjustRelation(world, state, from, to, -30);
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, from)} imposes a total trade embargo on ${nationName(world, to)}.`,
    nations: [from, to],
    alert: from === state.player || to === state.player,
  });
  if (world.nations.get(from)?.major || world.nations.get(to)?.major)
    headline(state, `${nationName(world, from)} embargoes ${nationName(world, to)}`);
}

export function liftEmbargo(world: World, state: GameState, from: Iso3, to: Iso3): void {
  const key = sanctionKey(from, to);
  if (!state.embargoes.includes(key)) return;
  state.embargoes = state.embargoes.filter((k) => k !== key);
  adjustRelation(world, state, from, to, 10);
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, from)} lifts its embargo on ${nationName(world, to)} (sanctions remain).`,
    nations: [from, to],
    alert: from === state.player || to === state.player,
  });
}

export function imposeSecondary(world: World, state: GameState, from: Iso3, to: Iso3): void {
  const key = sanctionKey(from, to);
  if (from === to || state.secondarySanctions.includes(key)) return;
  state.secondarySanctions.push(key);
  if (!state.sanctions.includes(key)) state.sanctions.push(key);
  adjustRelation(world, state, from, to, -10);
  // Big partners of the target resent the extraterritorial reach.
  for (const p of world.tradePairs) {
    const x = p.a === to ? p.b : p.b === to ? p.a : null;
    if (x && x !== from && !compliesWithSecondary(world, state, x, from, to)) adjustRelation(world, state, x, from, -5);
  }
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, from)} announces secondary sanctions: firms anywhere that trade with ${nationName(world, to)} lose access to its market.`,
    nations: [from, to],
    alert: from === state.player || to === state.player,
  });
}

export function liftSecondary(world: World, state: GameState, from: Iso3, to: Iso3): void {
  const key = sanctionKey(from, to);
  if (!state.secondarySanctions.includes(key)) return;
  state.secondarySanctions = state.secondarySanctions.filter((k) => k !== key);
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, from)} drops its secondary sanctions on ${nationName(world, to)}.`,
    nations: [from, to],
    alert: from === state.player || to === state.player,
  });
}

export interface CoalitionReply {
  readonly iso: Iso3;
  readonly joins: boolean;
  readonly reason: string;
}

/**
 * How a nation answers a call to join sanctions on `target` led by `leader`: friends of the
 * leader with cool relations toward the target join unless their own trade with the target is
 * too valuable to give up. Deterministic.
 */
export function coalitionReply(world: World, state: GameState, leader: Iso3, x: Iso3, target: Iso3): CoalitionReply {
  const name = nationName(world, x);
  if (isSanctioned(state, x, target)) return { iso: x, joins: false, reason: `${name} already sanctions them.` };
  if (atWar(state, x, target)) return { iso: x, joins: false, reason: `${name} is already at war with them.` };
  if (alliesOf(world, state, x).includes(target)) return { iso: x, joins: false, reason: `${name} is their ally.` };
  const relL = getRelation(world, state, x, leader);
  const relT = getRelation(world, state, x, target);
  const dependence = baseVolume(world, x, target) / Math.max(1, state.nations[x]!.gdp);
  const allied = alliesOf(world, state, x).includes(leader);
  const score = (relL - relT) / 100 + traitsOf(world, x).allianceLoyalty / 200 + (allied ? 0.3 : 0) - dependence * 10;
  if (relL < 25 && !allied) return { iso: x, joins: false, reason: `${name} is not close enough to you (relations ${Math.round(relL)}).` };
  if (relT > 0) return { iso: x, joins: false, reason: `${name} has no quarrel with them (relations ${Math.round(relT)}).` };
  if (score >= 0.9) return { iso: x, joins: true, reason: `${name} joins (relations with you ${Math.round(relL)}, with them ${Math.round(relT)}).` };
  return {
    iso: x,
    joins: false,
    reason: dependence > 0.02 ? `${name} cannot afford to lose its trade with them (${(dependence * 100).toFixed(1)} % of GDP).` : `${name} sees no reason to join (relations with them ${Math.round(relT)}).`,
  };
}

/** Rallies a sanctions coalition against `target`; returns the members who joined. */
export function rallyCoalition(world: World, state: GameState, leader: Iso3, target: Iso3): Iso3[] {
  const joined: Iso3[] = [];
  if (!isSanctioned(state, leader, target)) {
    state.sanctions.push(sanctionKey(leader, target));
    adjustRelation(world, state, leader, target, -20);
  }
  for (const n of Object.values(state.nations)) {
    if (!n.alive || n.iso3 === leader || n.iso3 === target) continue;
    if (n.iso3 === state.player && leader !== state.player) continue;
    const meta = world.nations.get(n.iso3);
    if (!meta) continue;
    const reply = coalitionReply(world, state, leader, n.iso3, target);
    if (!reply.joins) continue;
    state.sanctions.push(sanctionKey(n.iso3, target));
    adjustRelation(world, state, n.iso3, target, -15);
    adjustRelation(world, state, n.iso3, leader, 3);
    joined.push(n.iso3);
  }
  log(state, {
    kind: 'diplomacy',
    text:
      joined.length > 0
        ? `${nationName(world, leader)} rallies a sanctions coalition against ${nationName(world, target)}: ${joined.map((x) => nationName(world, x)).join(', ')} join.`
        : `${nationName(world, leader)} calls for sanctions on ${nationName(world, target)}, but no one else joins.`,
    nations: [leader, target, ...joined],
    alert: leader === state.player || target === state.player,
  });
  if (joined.length >= 3) headline(state, `${joined.length + 1}-nation sanctions coalition targets ${nationName(world, target)}`);
  return joined;
}

export interface Coalition {
  readonly target: Iso3;
  readonly members: Iso3[];
  readonly embargo: Iso3[];
  readonly secondary: Iso3[];
  /** Members' share of world GDP. */
  readonly gdpShare: number;
}

/** Sanctions coalitions: every target with the nations sanctioning it, largest first. */
export function sanctionCoalitions(state: GameState): Coalition[] {
  const total = Object.values(state.nations).reduce((s, n) => s + (n.alive ? n.gdp : 0), 0) || 1;
  const targets = new Set(state.sanctions.map((k) => k.split('>')[1]!));
  const out: Coalition[] = [];
  for (const t of targets) {
    if (!state.nations[t]?.alive) continue;
    const members = sanctionersOf(state, t).filter((m) => state.nations[m]?.alive);
    out.push({
      target: t,
      members,
      embargo: state.embargoes.filter((k) => k.endsWith(`>${t}`)).map((k) => k.split('>')[0]!),
      secondary: state.secondarySanctions.filter((k) => k.endsWith(`>${t}`)).map((k) => k.split('>')[0]!),
      gdpShare: members.reduce((s, m) => s + (state.nations[m]?.gdp ?? 0), 0) / total,
    });
  }
  return out.sort((a, b) => b.gdpShare - a.gdpShare);
}

/** The player's (or any nation's) trade partners by current volume. */
export function tradePartners(state: GameState, iso: Iso3): { partner: Iso3; route: TradeRoute }[] {
  return state.economy.routes
    .filter((r) => r.a === iso || r.b === iso)
    .map((r) => ({ partner: r.a === iso ? r.b : r.a, route: r }))
    .sort((x, y) => Math.max(y.route.volume, y.route.reference) - Math.max(x.route.volume, x.route.reference));
}
