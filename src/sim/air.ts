/**
 * The air war (D-059). Every air wing flies one mission a month from its base region:
 *   superiority  — contests the air over its range; escorts; half strike weight in battles
 *   cas          — close air support: full strike weight in battles within range, little air-to-air
 *   interdiction — cuts enemy supply and bleeds enemy units moving within range
 *   bombing      — strategic bombing of enemy regions in range (devastation, infrastructure)
 *   recon        — intelligence over its range (see intel.ts)
 * Wings flying over defended enemy regions are intercepted by air-defence brigades and enemy
 * fighters on superiority; the loss depends on the air-defence weight against the wing's own
 * escorts and air-power tech.
 */
import { nationName, type World } from './world';
import type { AirMission, GameState, Iso3, RegionId, Unit } from './types';
import { alliesOf, atWar, clamp, isLand, log, headline } from './query';
import { terrainRule, weatherAirFactor, weatherAt } from './terrain';

export const MISSION_INFO: Record<AirMission, { label: string; short: string; description: string }> = {
  superiority: {
    label: 'Air superiority',
    short: 'SUP',
    description: 'Sweep the skies over the base and its neighbours: full air-to-air weight and normal strike weight in battles in range. Escorts other wings based here.',
  },
  cas: {
    label: 'Close air support',
    short: 'CAS',
    description: 'Strike enemy ground forces in battles within range at ×1.5 weight; little air-to-air weight and exposed to air defence.',
  },
  interdiction: {
    label: 'Interdiction',
    short: 'INT',
    description: 'Hit roads, bridges and columns: enemy supply in range −15 % per wing (max −45 %) and enemy units moving there lose 2 strength a month.',
  },
  bombing: {
    label: 'Strategic bombing',
    short: 'BMB',
    description: 'Bomb the enemy region in range with the most industry: devastation and infrastructure damage every month. Intercepted by air defence.',
  },
  recon: {
    label: 'Reconnaissance',
    short: 'RCN',
    description: 'Fly ISR over the range: intelligence level +2 for every region covered; no strikes.',
  },
};

/** Which missions a unit type may fly. */
export function missionsFor(type: string): AirMission[] {
  switch (type) {
    case 'fighter':
      return ['superiority', 'cas', 'interdiction', 'recon'];
    case 'bomber':
      return ['bombing', 'interdiction', 'cas'];
    case 'drone':
      return ['recon', 'cas', 'interdiction', 'superiority'];
    default:
      return [];
  }
}

/** Regions within `range` steps of `from` (inclusive of `from`). */
export function regionsInRange(world: World, from: RegionId, range: number): RegionId[] {
  const seen = new Set<RegionId>([from]);
  let frontier = [from];
  for (let d = 1; d <= range; d++) {
    const next: RegionId[] = [];
    for (const r of frontier)
      for (const nb of world.regions.get(r)?.neighbours ?? [])
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
    frontier = next;
  }
  return [...seen];
}

interface AirCache {
  version: string;
  interdiction: Map<RegionId, Map<Iso3, number>>;
  defenceAA: Map<RegionId, Map<Iso3, number>>;
}
const airCache = new WeakMap<GameState, AirCache>();
function cacheFor(world: World, state: GameState): AirCache {
  const version = `${state.turn}|${state.regionsVersion}|${state.diplomacyVersion}|${Object.keys(state.units).length}`;
  let c = airCache.get(state);
  if (c && c.version === version) return c;
  c = { version, interdiction: new Map(), defenceAA: new Map() };
  // Interdiction weight per region per victim: wings at war with the victim, within range.
  for (const u of Object.values(state.units)) {
    if (u.mission !== 'interdiction') continue;
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'air') continue;
    const n = state.nations[u.owner];
    const w = (u.strength / 100) * (1 + (n?.modifiers.airPower ?? 0));
    for (const r of regionsInRange(world, u.region, Math.max(1, t.range))) {
      if (!isLand(world, r)) continue;
      const ctrl = state.regions[r]?.controller;
      if (!ctrl || !atWar(state, u.owner, ctrl)) continue;
      const wf = weatherAirFactor(weatherAt(world, r, state.date.month)) * terrainRule(world, r).air;
      let m = c.interdiction.get(r);
      if (!m) c.interdiction.set(r, (m = new Map()));
      m.set(ctrl, (m.get(ctrl) ?? 0) + w * wf);
    }
  }
  airCache.set(state, c);
  return c;
}
export function invalidateAirCache(state: GameState): void {
  airCache.delete(state);
}

/** Supply multiplier (0.55..1) for `iso`'s supply in `region` under enemy interdiction. */
export function interdictionFactor(world: World, state: GameState, region: RegionId, iso: Iso3): number {
  const w = cacheFor(world, state).interdiction.get(region)?.get(iso) ?? 0;
  return 1 - Math.min(0.45, 0.15 * w);
}

/** Strength lost per month by `iso`'s land units moving through `region` under interdiction. */
export function interdictionAttrition(world: World, state: GameState, region: RegionId, iso: Iso3): number {
  const w = cacheFor(world, state).interdiction.get(region)?.get(iso) ?? 0;
  return Math.min(6, 2 * w);
}

/** Air-defence weight the controller of `region` (and allies) can bring against an intruding wing of `intruder`. */
export function airDefenceAt(world: World, state: GameState, region: RegionId, intruder: Iso3): number {
  const c = cacheFor(world, state);
  let m = c.defenceAA.get(region);
  if (!m) c.defenceAA.set(region, (m = new Map()));
  const hit = m.get(intruder);
  if (hit !== undefined) return hit;
  let aa = 0;
  const ctrl = state.regions[region]?.controller ?? null;
  const defenders = new Set<Iso3>();
  for (const n of Object.values(state.nations)) if (n.alive && atWar(state, n.iso3, intruder)) defenders.add(n.iso3);
  const near = new Set(regionsInRange(world, region, 1));
  for (const u of Object.values(state.units)) {
    if (!defenders.has(u.owner)) continue;
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    if (t.domain === 'land' && u.region === region && t.antiAir >= 3) {
      aa += (u.strength / 100) * t.antiAir * (1 + (state.nations[u.owner]?.modifiers.antiAir ?? 0));
    } else if (t.domain === 'air' && u.mission === 'superiority' && near.has(u.region)) {
      aa += (u.strength / 100) * t.antiAir * 0.6 * (1 + (state.nations[u.owner]?.modifiers.airPower ?? 0));
    } else if (t.domain === 'sea' && t.antiAir >= 5 && world.regions.get(region)?.neighbours.includes(u.region)) {
      aa += (u.strength / 100) * t.antiAir * 0.3;
    }
  }
  void ctrl;
  m.set(intruder, aa);
  return aa;
}

/** Escort weight protecting wings based in `base` (friendly superiority wings within one step). */
function escortAt(world: World, state: GameState, base: RegionId, iso: Iso3): number {
  const side = new Set([iso, ...alliesOf(world, state, iso)]);
  const near = new Set(regionsInRange(world, base, 1));
  let e = 0;
  for (const u of Object.values(state.units)) {
    if (!side.has(u.owner) || u.mission !== 'superiority' || !near.has(u.region)) continue;
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'air') continue;
    e += (u.strength / 100) * t.antiAir * (1 + (state.nations[u.owner]?.modifiers.airPower ?? 0));
  }
  return e;
}

/**
 * Interception loss (strength points) for a wing of `iso` operating over `target`. Air defence
 * is weighed against the wing's escorts and its own air-power technology.
 */
export function interceptionLoss(world: World, state: GameState, wing: Unit, target: RegionId): number {
  const defence = airDefenceAt(world, state, target, wing.owner);
  if (defence <= 0) return 0;
  const escorts = escortAt(world, state, wing.region, wing.owner);
  const tech = 1 + (state.nations[wing.owner]?.modifiers.airPower ?? 0);
  const t = world.unitTypes.get(wing.type);
  const stealth = wing.type === 'bomber' ? 0.8 : wing.type === 'drone' ? 1.2 : 1;
  const exposure = wing.mission === 'cas' ? 1.2 : wing.mission === 'recon' ? 0.6 : 1;
  void t;
  return clamp((5 * defence * stealth * exposure) / (tech * (1 + 0.6 * escorts)), 0, 25);
}

/** Monthly air operations: strategic bombing and interception of every wing flying over the enemy. */
export function runAirOperations(world: World, state: GameState): void {
  invalidateAirCache(state);
  const bombed = new Map<string, { hits: number; regions: Set<RegionId>; loss: number }>();
  const intercepted = new Map<Iso3, number>();
  for (const u of Object.values(state.units)) {
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'air' || !u.mission || u.mission === 'superiority') continue;
    const range = Math.max(1, t.range);
    const n = state.nations[u.owner];
    if (!n?.alive) continue;
    // Regions flown over that belong to an enemy.
    const hostile = regionsInRange(world, u.region, range).filter((r) => {
      if (!isLand(world, r)) return false;
      const c = state.regions[r]?.controller;
      return !!c && atWar(state, u.owner, c);
    });
    if (hostile.length === 0) continue;
    let target: RegionId | null = null;
    if (u.mission === 'bombing') {
      // The most valuable enemy region in range: output first, then infrastructure.
      let best = -1;
      for (const r of hostile) {
        const m = world.regions.get(r)!;
        const ctrl = state.regions[r]!.controller!;
        const value = (state.nations[ctrl]?.gdp ?? 0) * m.populationShare * (1 - state.regions[r]!.devastation) + m.infrastructure * 5;
        if (value > best) {
          best = value;
          target = r;
        }
      }
    } else {
      // Interdiction, CAS and recon are intercepted over the best-defended enemy region in range.
      let worst = -1;
      for (const r of hostile) {
        const d = airDefenceAt(world, state, r, u.owner);
        if (d > worst) {
          worst = d;
          target = r;
        }
      }
    }
    if (target === null) continue;
    const loss = interceptionLoss(world, state, u, target);
    if (loss > 0) {
      u.strength = clamp(u.strength - loss, 1, 100);
      u.morale = clamp(u.morale - loss / 3, 5, 100);
      intercepted.set(u.owner, (intercepted.get(u.owner) ?? 0) + loss);
      if (u.strength <= 5) delete state.units[u.id];
    }
    if (u.mission === 'bombing' && state.units[u.id]) {
      const r = state.regions[target]!;
      const meta = world.regions.get(target)!;
      const wf = weatherAirFactor(weatherAt(world, target, state.date.month)) * terrainRule(world, target).air;
      const weight = (u.strength / 100) * (1 + (n.modifiers.airPower ?? 0) + (n.modifiers.strikePower ?? 0)) * wf;
      r.devastation = clamp(r.devastation + 0.02 * weight, 0, 0.8);
      r.infraDamage = clamp(r.infraDamage + 0.04 * weight, 0, 0.7);
      const key = `${u.owner}>${r.controller}`;
      const e = bombed.get(key) ?? { hits: 0, regions: new Set<RegionId>(), loss: 0 };
      e.hits += weight;
      e.regions.add(target);
      bombed.set(key, e);
      state.strikes.push({ turn: state.turn, kind: 'air', from: u.region, to: target, attacker: u.owner });
      void meta;
    }
  }
  for (const [key, e] of bombed) {
    const [att, def] = key.split('>') as [Iso3, Iso3];
    const names = [...e.regions].slice(0, 3).map((r) => world.regions.get(r)!.name).join(', ');
    const involvesPlayer = att === state.player || def === state.player;
    log(state, {
      kind: 'strike',
      text: `${nationName(world, att)} bombs ${names}${e.regions.size > 3 ? ` and ${e.regions.size - 3} more` : ''} (${nationName(world, def)}): ${e.hits.toFixed(1)} wing-sorties of damage to industry and infrastructure.`,
      nations: [att, def],
      region: [...e.regions][0]!,
      alert: involvesPlayer,
    });
    if (involvesPlayer || e.hits >= 3) headline(state, `Air raids hit ${names.split(',')[0]}`);
  }
  for (const [iso, loss] of intercepted) {
    if (loss < 8) continue;
    log(state, {
      kind: 'battle',
      text: `${nationName(world, iso)} loses ${Math.round(loss)} strength of air wings to enemy air defences this month.`,
      nations: [iso],
      alert: iso === state.player,
    });
  }
}

/** Default mission when a wing is created or its order is cleared. */
export const DEFAULT_MISSION: AirMission = 'superiority';
