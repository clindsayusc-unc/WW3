/**
 * The naval war (D-059): sea control per zone, fleet battles, commerce raiding by submarines,
 * blockades that cut trade. Amphibious preparation timers live in military.ts (runMovement).
 */
import { nationName, type World } from './world';
import type { BattleReport, BattleSide, GameState, Iso3, RegionId, Unit } from './types';
import { alliesOf, atWar, clamp, headline, isLand, log, roll, unitPower } from './query';
import { invalidateGeoCache } from './geography';
import { commanderLossFactor } from './commanders';

export const NAVAL_K = 2;

export interface ZoneControl {
  /** Nation (with its allies) holding the zone with a clear margin, or null. */
  controller: Iso3 | null;
  /** Hostile fleets present with no clear winner. */
  contested: boolean;
  /** Naval attack power of the strongest side. */
  power: number;
}

const controlCache = new WeakMap<GameState, { version: string; map: Map<RegionId, ZoneControl> }>();

/** Who controls a sea zone: strongest fleet ≥ 2× every fleet at war with it, else contested. */
export function zoneControl(world: World, state: GameState, zone: RegionId): ZoneControl {
  const version = `${state.turn}|${state.diplomacyVersion}|${Object.keys(state.units).length}`;
  let c = controlCache.get(state);
  if (!c || c.version !== version) controlCache.set(state, (c = { version, map: new Map() }));
  const hit = c.map.get(zone);
  if (hit) return hit;
  const power = new Map<Iso3, number>();
  for (const u of Object.values(state.units)) {
    if (u.region !== zone) continue;
    const t = world.unitTypes.get(u.type);
    if (!t || t.domain !== 'sea') continue;
    power.set(u.owner, (power.get(u.owner) ?? 0) + unitPower(world, state, u, 'attack'));
  }
  let out: ZoneControl = { controller: null, contested: false, power: 0 };
  if (power.size > 0) {
    // Fold allies together for the strongest side.
    let top: Iso3 | null = null;
    let topP = 0;
    for (const [iso] of power) {
      const allies = alliesOf(world, state, iso);
      let p = 0;
      for (const [o, v] of power) if (o === iso || allies.includes(o)) p += v;
      if (p > topP) {
        topP = p;
        top = iso;
      }
    }
    let hostile = 0;
    for (const [o, v] of power) if (top && atWar(state, top, o)) hostile += v;
    out = top && topP >= 2 * hostile ? { controller: top, contested: false, power: topP } : { controller: null, contested: true, power: topP };
  }
  c.map.set(zone, out);
  return out;
}

/** Fleet battles: hostile ships sharing a zone fight; submarines hit surface groups hard and are hard to find. */
export function runNavalCombat(world: World, state: GameState): BattleReport[] {
  const reports: BattleReport[] = [];
  const byZone = new Map<RegionId, Unit[]>();
  for (const u of Object.values(state.units)) {
    if (isLand(world, u.region)) continue;
    if (world.unitTypes.get(u.type)?.domain !== 'sea') continue;
    const l = byZone.get(u.region) ?? [];
    l.push(u);
    byZone.set(u.region, l);
  }
  for (const [zone, ships] of byZone) {
    const hostileTo = (u: Unit) => ships.filter((o) => atWar(state, o.owner, u.owner));
    if (!ships.some((u) => hostileTo(u).length > 0)) continue;
    // Attackers: ships that entered this month; if none, the weaker side.
    const movers = new Set(ships.filter((u) => u.prevRegion !== u.region).map((u) => u.owner));
    const nations = [...new Set(ships.map((u) => u.owner))];
    const fighting = nations.filter((n) => ships.some((u) => u.owner === n && hostileTo(u).length > 0));
    let attackers = fighting.filter((n) => movers.has(n));
    if (attackers.length === 0) attackers = [fighting[0]!];
    const attSet = new Set(attackers);
    const defenders = fighting.filter((n) => !attSet.has(n) && attackers.some((a) => atWar(state, a, n)));
    if (defenders.length === 0) continue;
    const defSet = new Set(defenders);
    const sideUnits = (set: Set<Iso3>) => ships.filter((u) => set.has(u.owner));
    const attUnits = sideUnits(attSet);
    const defUnits = sideUnits(defSet);
    const before = (list: Unit[]) => list.reduce((s, u) => s + u.strength, 0);
    const attBefore = before(attUnits);
    const defBefore = before(defUnits);
    const damage = (shooters: Unit[], targets: Unit[]) => {
      const total = targets.reduce((s, u) => s + u.strength, 0) || 1;
      let applied = 0;
      for (const target of targets) {
        let incoming = 0;
        for (const s of shooters) {
          let f = 1;
          if (s.type === 'attackSub') f = target.type === 'attackSub' ? 0.7 : 1.3;
          else if (target.type === 'attackSub' || target.type === 'missileSub') f = s.type === 'destroyerGroup' ? 1 : 0.5;
          incoming += unitPower(world, state, s, 'attack') * f;
        }
        const d = Math.min(target.strength, (NAVAL_K * incoming * target.strength) / total * commanderLossFactor(target.commander));
        target.strength -= d;
        target.morale = clamp(target.morale - d / 2, 5, 100);
        applied += d;
      }
      return applied;
    };
    const dmgToDef = damage(attUnits, defUnits);
    const dmgToAtt = damage(defUnits, attUnits);
    for (const u of ships) {
      if (u.strength <= 1) delete state.units[u.id];
      else if (u.strength < 25) retreatShip(world, state, u);
      else u.experience = clamp(u.experience + 5, 0, 100);
    }
    invalidateGeoCache(state);
    const attAfter = attUnits.filter((u) => state.units[u.id] && u.region === zone).reduce((s, u) => s + u.strength, 0);
    const defAfter = defUnits.filter((u) => state.units[u.id] && u.region === zone).reduce((s, u) => s + u.strength, 0);
    const side = (set: Set<Iso3>, list: Unit[]): BattleSide[] =>
      [...set].map((nation) => {
        const mine = list.filter((u) => u.owner === nation);
        const counts = new Map<string, number>();
        for (const u of mine) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
        return {
          nation,
          units: [...counts].map(([type, count]) => ({ type, count })),
          strengthBefore: mine.reduce((s, u) => s + u.strength, 0),
          strengthAfter: mine.filter((u) => state.units[u.id] && u.region === zone).reduce((s, u) => s + u.strength, 0),
        };
      });
    const meta = world.regions.get(zone)!;
    const outcome = defAfter === 0 ? 'attackerWins' : attAfter === 0 ? 'defenderHolds' : 'stalemate';
    reports.push({
      id: state.nextId++,
      turn: state.turn,
      region: zone,
      domain: 'sea',
      attackers: side(attSet, attUnits),
      defenders: side(defSet, defUnits),
      attackerMods: [],
      defenderMods: [],
      airSuperiority: 0.5,
      attackPower: attUnits.reduce((s, u) => s + unitPower(world, state, u, 'attack'), 0),
      defencePower: defUnits.reduce((s, u) => s + unitPower(world, state, u, 'attack'), 0),
      attackerLoss: dmgToAtt,
      defenderLoss: dmgToDef,
      captured: false,
      outcome,
    });
    const involvesPlayer = attSet.has(state.player) || defSet.has(state.player);
    log(state, {
      kind: 'battle',
      text: `Naval battle in the ${meta.name}: ${attackers.map((x) => nationName(world, x)).join(', ')} vs ${defenders.map((x) => nationName(world, x)).join(', ')} — attackers lose ${Math.round(dmgToAtt)}, defenders lose ${Math.round(dmgToDef)} strength${outcome === 'attackerWins' ? '; the defenders are driven off' : outcome === 'defenderHolds' ? '; the attack is repulsed' : ''}.`,
      nations: [...attackers, ...defenders],
      region: zone,
      alert: involvesPlayer,
    });
    void attBefore;
    void defBefore;
    if (involvesPlayer || dmgToAtt + dmgToDef > 80) headline(state, `Fleets clash in the ${meta.name}`);
  }
  return reports;
}

function retreatShip(world: World, state: GameState, u: Unit): void {
  const meta = world.regions.get(u.region)!;
  const options = meta.neighbours.filter((n) => {
    const m = world.regions.get(n);
    if (!m?.sea) return false;
    return !Object.values(state.units).some((o) => o.region === n && atWar(state, o.owner, u.owner));
  });
  if (options.length === 0) return;
  u.region = options[Math.floor(roll(state) * options.length)]!;
  u.path = [];
}

/** Submarines raid the trade of enemies whose ports open on their zone; escorts hunt them back. */
export function runCommerceRaiding(world: World, state: GameState): void {
  const subsByZone = new Map<RegionId, Unit[]>();
  const escortsByZone = new Map<RegionId, Unit[]>();
  for (const u of Object.values(state.units)) {
    if (isLand(world, u.region)) continue;
    if (u.type === 'attackSub') subsByZone.set(u.region, [...(subsByZone.get(u.region) ?? []), u]);
    else if (u.type === 'destroyerGroup' || u.type === 'carrierGroup')
      escortsByZone.set(u.region, [...(escortsByZone.get(u.region) ?? []), u]);
  }
  const raided = new Map<string, number>();
  for (const [zone, subs] of subsByZone) {
    const meta = world.regions.get(zone)!;
    // Trading nations: ports on this zone.
    const traders = new Map<Iso3, number>();
    for (const nb of meta.neighbours) {
      const m = world.regions.get(nb);
      if (!m || m.sea || m.portCapacity <= 0) continue;
      const c = state.regions[nb]?.controller;
      if (c) traders.set(c, (traders.get(c) ?? 0) + m.portCapacity);
    }
    for (const sub of subs) {
      for (const [victim, capacity] of traders) {
        if (!atWar(state, sub.owner, victim)) continue;
        const escorts = (escortsByZone.get(zone) ?? []).filter((e) => e.owner === victim || alliesOf(world, state, victim).includes(e.owner));
        const key = `${sub.owner}>${victim}`;
        if (escorts.length === 0) {
          const hit = 0.25 * (sub.strength / 100) * Math.min(1, capacity / 6);
          raided.set(key, (raided.get(key) ?? 0) + hit);
        } else {
          // Anti-submarine warfare: hunted subs take damage.
          const asw = Math.min(12, 4 * escorts.length);
          sub.strength = clamp(sub.strength - asw, 1, 100);
          raided.set(key, (raided.get(key) ?? 0) + 0.08 * (sub.strength / 100));
        }
      }
    }
  }
  // One line per victim per month, and an alert only when the loss is material (log noise, D-048).
  const byVictim = new Map<Iso3, { raiders: Iso3[]; hit: number }>();
  for (const [key, hit] of raided) {
    const [raider, victim] = key.split('>') as [Iso3, Iso3];
    const v = state.nations[victim];
    if (!v) continue;
    v.growthMods.push({ delta: -Math.min(1.5, hit), monthsLeft: 1, reason: `Commerce raiding by ${nationName(world, raider)}` });
    const e = byVictim.get(victim) ?? { raiders: [], hit: 0 };
    e.raiders.push(raider);
    e.hit += hit;
    byVictim.set(victim, e);
  }
  for (const [victim, e] of byVictim) {
    const total = Math.min(1.5, e.hit);
    const involvesPlayer = victim === state.player || e.raiders.includes(state.player);
    if (!involvesPlayer && total < 0.5) continue;
    log(state, {
      kind: 'battle',
      text: `${e.raiders.map((r) => nationName(world, r)).join(' and ')} submarines sink ${nationName(world, victim)} merchant shipping (growth −${total.toFixed(1)} pp this month).`,
      nations: [...e.raiders, victim],
      alert: involvesPlayer && total >= 0.5,
    });
  }
}

/** A nation is blockaded when enemy fleets control the zones off at least half its port capacity. */
export function blockadeShare(world: World, state: GameState, iso: Iso3): number {
  let total = 0;
  let blocked = 0;
  for (const r of Object.values(state.regions)) {
    if (r.controller !== iso) continue;
    const m = world.regions.get(r.id);
    if (!m || m.sea || m.portCapacity <= 0) continue;
    total += m.portCapacity;
    const zones = m.neighbours.filter((n) => world.regions.get(n)?.sea);
    if (zones.length === 0) continue;
    const allBlocked = zones.every((z) => {
      const zc = zoneControl(world, state, z);
      return zc.controller !== null && atWar(state, zc.controller, iso);
    });
    if (allBlocked) blocked += m.portCapacity;
  }
  return total > 0 ? blocked / total : 0;
}

export function runBlockades(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const enemies = state.wars.some((w) => w.attackers.includes(n.iso3) || w.defenders.includes(n.iso3));
    const share = enemies ? blockadeShare(world, state, n.iso3) : 0;
    const now = share >= 0.5;
    if (now) {
      n.growthMods.push({ delta: -2 * share, monthsLeft: 1, reason: 'Naval blockade' });
    }
    if (now !== n.blockaded) {
      log(state, {
        kind: now ? 'war' : 'peace',
        text: now
          ? `${nationName(world, n.iso3)} is under naval blockade: ${Math.round(share * 100)} % of its port capacity faces enemy-controlled waters. Trade, research and production suffer.`
          : `The blockade of ${nationName(world, n.iso3)} is broken.`,
        nations: [n.iso3],
        alert: n.iso3 === state.player,
      });
      if (now) headline(state, `${nationName(world, n.iso3)} blockaded — ports idle, prices climb`);
    }
    n.blockaded = now;
  }
}
