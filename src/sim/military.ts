/** Movement, supply, combat, attrition, captures and capitulation (D-025, D-029, D-050–D-052). */
import { nationName, type World } from './world';
import type {
  BattleSide,
  GameState,
  Iso3,
  Modifier,
  OddsReport,
  PathPreview,
  RegionId,
  Unit,
} from './types';
import {
  commanderAttackModifier,
  commanderDefenceModifier,
  commanderLossFactor,
  commanderSupplyBonus,
} from './commanders';
import { interdictionAttrition, interdictionFactor, invalidateAirCache } from './air';
import { intelLevel } from './intel';
import {
  alliesOf,
  atWar,
  bumpDiplomacy,
  clamp,
  controlShare,
  headline,
  isLand,
  log,
  roll,
  touchRegions,
  unitPower,
  unitsIn,
} from './query';
import {
  amphibiousTargets,
  chokepointBlocks,
  convoySafe,
  crossingBetween,
  crossingModifier,
  hasSeaControl,
  hasSeaDominance,
  invalidateGeoCache,
  landedFromSea,
  liftCapacity,
  partisanAttrition,
  seaBalance,
  stepCost,
} from './geography';
import {
  describeWeather,
  movePoints,
  terrainRule,
  unitTerrainFactor,
  weatherAirFactor,
  weatherAt,
  weatherAttackFactor,
  weatherAttrition,
} from './terrain';

export const LANCHESTER_K = 3;
/** Attack firepower saturates beyond this many land units in one region (front width). */
export const FRONT_WIDTH = 6;
/** Defenders fighting on their own nation's soil. */
export const HOME_DEFENCE = 1.3;
/** Regions held unchanged for 6+ months are fortified. */
export const ENTRENCHED = 1.5;
/** Below this supply level a region counts as cut off. */
export const SUPPLY_THRESHOLD = 0.25;
/** Firepower of a landing force assaulting a defended coast. */
export const AMPHIBIOUS_ASSAULT = 0.5;
/** Same, when the attacker holds sea dominance and air superiority off the beach. */
export const AMPHIBIOUS_ASSAULT_DOMINANT = 0.7;
/** Defenders of a coast attacked only from the sea. */
export const COASTAL_DEFENCE = 1.3;
/** Supply level reaching a beachhead with no port. */
export const BEACHHEAD_SUPPLY = 0.35;
/** Home regions connected to the capital never fall below this (local stocks, civilian economy). */
export const HOME_SUPPLY_FLOOR = 0.55;
/** A region whose share of the nation's population is at least this is an industrial depot. */
export const INDUSTRIAL_SHARE = 0.05;
/** Months of preparation before a formation can embark on an amphibious hop. */
export const AMPHIB_PREP_MONTHS = { marine: 1, other: 2 } as const;

/** Veterans fight better: ×0.95 at zero experience, ×1.2 at 100. */
export function experienceFactor(xp: number): number {
  return 0.95 + 0.25 * clamp(xp, 0, 100) / 100;
}
/** Visible air-superiority multiplier for a side holding share `share` of the air (0..1). */
export function airSuperiorityFactor(share: number): number {
  return 0.85 + 0.3 * clamp(share, 0, 1);
}
/** Preparation months a unit type needs before embarking. */
export function prepNeeded(world: World, type: string): number {
  const t = world.unitTypes.get(type);
  return t?.amphibious ? AMPHIB_PREP_MONTHS.marine : AMPHIB_PREP_MONTHS.other;
}

export function isFriendly(world: World, state: GameState, iso: Iso3, other: Iso3 | null): boolean {
  if (other === null) return true;
  if (other === iso) return true;
  return alliesOf(world, state, iso).includes(other);
}

/** Can `unit` step into `to` from `from`? Returns 'move' | 'attack' | null. */
export function stepKind(
  world: World,
  state: GameState,
  unit: Unit,
  from: RegionId,
  to: RegionId,
): 'move' | 'attack' | null {
  const t = world.unitTypes.get(unit.type);
  const fromMeta = world.regions.get(from);
  const toMeta = world.regions.get(to);
  if (!t || !fromMeta || !toMeta) return null;
  const adjacent = fromMeta.neighbours.includes(to);
  if (t.domain === 'sea') {
    if (!adjacent || !toMeta.sea) return null;
    return chokepointBlocks(world, state, from, to, unit.owner) ? null : 'move';
  }
  if (toMeta.sea) return null;
  const controller = state.regions[to]?.controller ?? null;
  if (t.domain === 'air')
    return adjacent && isFriendly(world, state, unit.owner, controller) ? 'move' : null;
  // land
  const amphib =
    !adjacent &&
    !fromMeta.sea &&
    amphibiousTargets(world, state, from, unit.owner, unit.type).includes(to);
  if (!adjacent && !amphib) return null;
  if (isFriendly(world, state, unit.owner, controller)) return 'move';
  if (controller !== null && atWar(state, unit.owner, controller)) return 'attack';
  return null;
}

/** Breadth-first path for a unit; enemy regions are allowed only as the final step or when at war. */
export function findPath(
  world: World,
  state: GameState,
  unit: Unit,
  target: RegionId,
  maxDepth = 12,
  throughEnemies = false,
): RegionId[] | null {
  if (unit.region === target) return [];
  const t = world.unitTypes.get(unit.type);
  if (!t) return null;
  const prev = new Map<RegionId, RegionId>();
  const queue: RegionId[] = [unit.region];
  const depth = new Map<RegionId, number>([[unit.region, 0]]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    if (d >= maxDepth) continue;
    const meta = world.regions.get(cur)!;
    const candidates = [...meta.neighbours];
    if (t.domain === 'land' && !meta.sea)
      candidates.push(...amphibiousTargets(world, state, cur, unit.owner, unit.type));
    for (const n of candidates) {
      if (prev.has(n) || n === unit.region) continue;
      const kind = stepKind(world, state, unit, cur, n);
      if (!kind) continue;
      prev.set(n, cur);
      depth.set(n, d + 1);
      if (n === target) {
        const path: RegionId[] = [];
        let x: RegionId = n;
        while (x !== unit.region) {
          path.unshift(x);
          x = prev.get(x)!;
        }
        return path;
      }
      // Attack steps end movement there; do not expand through enemy-held regions with enemies
      // present (unless planning a campaign route through them).
      if (!throughEnemies && kind === 'attack' && unitsIn(state, n).some((u) => atWar(state, u.owner, unit.owner)))
        continue;
      queue.push(n);
    }
  }
  return null;
}

/** Movement cost of one step for a unit (land: terrain × weather + crossing; sea/air: 1). */
export function unitStepCost(world: World, state: GameState, unit: Unit, from: RegionId, to: RegionId): number {
  const t = world.unitTypes.get(unit.type);
  if (!t || t.domain !== 'land') return 1;
  const fromMeta = world.regions.get(from);
  // Embark, cross, land: the delay is the preparation timer (D-059), the hop itself costs a month.
  if (fromMeta && !fromMeta.neighbours.includes(to)) return 1;
  return stepCost(world, from, to, state.date.month);
}

export function runMovement(world: World, state: GameState): void {
  invalidateGeoCache(state);
  invalidateAirCache(state);
  const liftLeft = new Map<Iso3, number>();
  for (const u of Object.values(state.units)) {
    u.prevRegion = u.region;
    if (u.path.length === 0) {
      u.moveProgress = 0;
      continue;
    }
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    let points = movePoints(world, u.type) + (t.domain === 'land' ? u.moveProgress : 0);
    u.moveProgress = 0;
    while (points > 0 && u.path.length > 0) {
      const next = u.path[0]!;
      const kind = stepKind(world, state, u, u.region, next);
      if (!kind) {
        u.path = [];
        break;
      }
      const amphibious =
        t.domain === 'land' && !(world.regions.get(u.region)?.neighbours.includes(next) ?? false);
      if (amphibious) {
        // Prep timer (D-059): a landing force loads, rehearses and waits for shipping first.
        const need = prepNeeded(world, u.type);
        if (u.prep < need) {
          u.prep += 1;
          break;
        }
      }
      if (amphibious && !t.amphibious) {
        // Everyone except marines and special forces needs amphibious lift this month.
        if (!liftLeft.has(u.owner)) liftLeft.set(u.owner, liftCapacity(world, state, u.owner));
        const left = liftLeft.get(u.owner)!;
        if (left < 1) break; // wait for shipping
        liftLeft.set(u.owner, left - 1);
      }
      const cost = unitStepCost(world, state, u, u.region, next);
      if (points + 1e-9 < cost) {
        u.moveProgress = points; // bank the progress toward a slow crossing
        break;
      }
      points -= cost;
      u.region = next;
      u.path.shift();
      u.prep = 0;
      invalidateGeoCache(state);
      if (kind === 'attack') {
        const defenders = unitsIn(state, next).filter(
          (o) => atWar(state, o.owner, u.owner) && world.unitTypes.get(o.type)?.domain === 'land',
        );
        if (defenders.length === 0 && t.domain === 'land') {
          captureRegion(world, state, next, u.owner);
        } else {
          u.path = [];
          break;
        }
      }
    }
  }
}

export function captureRegion(world: World, state: GameState, region: RegionId, by: Iso3): void {
  const r = state.regions[region]!;
  const prev = r.controller;
  if (prev === by) return;
  // Liberation: if the new controller is allied with the owner, hand control back to the owner.
  const newController =
    r.owner && r.owner !== by && isFriendly(world, state, by, r.owner) ? r.owner : by;
  r.controller = newController;
  r.flippedTurn = state.turn;
  touchRegions(state);
  invalidateGeoCache(state);
  const meta = world.regions.get(region)!;
  const share = meta.populationShare;
  for (const w of state.wars) {
    if (w.attackers.includes(by) && prev && w.defenders.includes(prev)) w.score += share * 100;
    if (w.defenders.includes(by) && prev && w.attackers.includes(prev)) w.score -= share * 100;
  }
  const involvesPlayer = by === state.player || prev === state.player || r.owner === state.player;
  log(state, {
    kind: 'capture',
    text: `${nationName(world, by)} ${newController === r.owner && by !== r.owner ? 'liberates' : 'takes control of'} ${meta.name}${prev ? ` from ${nationName(world, prev)}` : ''}.`,
    nations: [by, ...(prev ? [prev] : [])],
    region,
    alert: involvesPlayer,
  });
  if (meta.capital || involvesPlayer)
    headline(state, `${nationName(world, by)} forces enter ${meta.name}`);
}

/** Air and naval support available to a side in a region. */
function supportFor(
  world: World,
  state: GameState,
  region: RegionId,
  side: Set<Iso3>,
  enemies: Set<Iso3>,
): { strike: number; air: number } {
  const meta = world.regions.get(region)!;
  let strike = 0;
  let air = 0;
  const near = new Set<RegionId>([region, ...meta.neighbours]);
  for (const n of meta.neighbours)
    for (const nn of world.regions.get(n)?.neighbours ?? []) near.add(nn);
  for (const u of Object.values(state.units)) {
    if (!near.has(u.region)) continue;
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    const friendly = side.has(u.owner);
    const hostile = enemies.has(u.owner);
    if (!friendly && !hostile) continue;
    if (t.domain === 'air') {
      const dist = u.region === region ? 0 : meta.neighbours.includes(u.region) ? 1 : 2;
      if (dist > t.range) continue;
      if (friendly) {
        // Missions (D-059): CAS puts everything into the ground battle, superiority into the air
        // war; interdiction, bombing and recon wings fly elsewhere and only defend themselves.
        const m = u.mission ?? 'superiority';
        const strikeW = m === 'cas' ? 1.5 : m === 'superiority' ? 1 : 0;
        const airW = m === 'superiority' ? 1 : m === 'cas' ? 0.4 : 0.3;
        strike += unitPower(world, state, u, 'attack') * strikeW;
        air += (u.strength / 100) * t.antiAir * (state.nations[u.owner]?.quality ?? 1) * airW;
      }
    } else if (t.domain === 'sea' && friendly) {
      const adjacent = meta.neighbours.includes(u.region);
      // Carrier groups project air power one zone further out, at half weight.
      const reach = adjacent ? 1 : u.type === 'carrierGroup' ? 0.5 : 0;
      if (reach === 0) continue;
      strike += (u.strength / 100) * t.strike * (state.nations[u.owner]?.quality ?? 1) * reach;
      air += (u.strength / 100) * t.antiAir * 0.5 * reach;
    }
  }
  return { strike, air };
}

export interface BattleResult {
  region: RegionId;
  attackers: Iso3[];
  defenders: Iso3[];
  attackerLoss: number;
  defenderLoss: number;
  captured: boolean;
}

// --- modifiers -----------------------------------------------------------------------------------

const pct = (f: number) => `×${f.toFixed(2)}`;

/** Supply level available to a unit of `iso` standing in (or attacking into) `region`. */
export function supplyFor(world: World, state: GameState, iso: Iso3, region: RegionId, fromSea = false): number {
  const r = state.regions[region];
  if (!r) return 0;
  if (r.controller && isFriendly(world, state, iso, r.controller)) return r.supply;
  // Hostile ground: the best supply among friendly neighbouring regions, less this region's terrain.
  const rule = terrainRule(world, region);
  let best = 0;
  for (const n of world.regions.get(region)?.neighbours ?? []) {
    if (!isLand(world, n)) continue;
    const c = state.regions[n]?.controller;
    if (c && isFriendly(world, state, iso, c)) best = Math.max(best, state.regions[n]!.supply);
  }
  // A landing force on a hostile shore lives off the beach until a port is captured.
  if (best === 0 || fromSea) best = Math.max(best, world.regions.get(region)!.coastal ? BEACHHEAD_SUPPLY : 0);
  return best * (1 - rule.supplyLoss);
}

export interface SideFactors {
  factor: number;
  mods: Modifier[];
}

export function attackerFactors(
  world: World,
  state: GameState,
  u: Unit,
  target: RegionId,
  from: RegionId,
  opts: { amphibious: boolean; dominant: boolean },
): SideFactors {
  const mods: Modifier[] = [];
  const rule = terrainRule(world, target);
  const n = state.nations[u.owner];
  const tf = unitTerrainFactor(rule, u.type);
  mods.push({
    label: 'Terrain',
    factor: tf,
    detail: `${rule.name}: ${world.unitTypes.get(u.type)?.name ?? u.type} fights at ${pct(tf)} here. ${rule.description}`,
  });
  if (from !== target) {
    const cm = opts.amphibious ? null : crossingModifier(world, state, u.owner, from, target);
    if (cm) mods.push(cm);
    if (opts.amphibious) {
      const f = opts.dominant ? AMPHIBIOUS_ASSAULT_DOMINANT : AMPHIBIOUS_ASSAULT;
      mods.push({
        label: 'Amphibious assault',
        factor: f,
        detail: opts.dominant
          ? 'Landing from the sea against a defended coast, covered by naval dominance and air superiority.'
          : 'Landing from the sea against a defended coast without clear naval and air superiority: the first wave is cut to pieces on the beach.',
      });
    }
  }
  const w = weatherAt(world, target, state.date.month);
  const wf = weatherAttackFactor(w);
  if (wf < 0.999)
    mods.push({
      label: 'Weather',
      factor: wf,
      detail: `${describeWeather(w)} (${w.tempC.toFixed(0)} °C, ${w.precipMm} mm this month) slows the attack.`,
    });
  const supply = Math.min(1, supplyFor(world, state, u.owner, target, opts.amphibious) + commanderSupplyBonus(u.commander));
  mods.push({
    label: 'Supply',
    factor: 0.5 + 0.5 * supply,
    detail: `Supply ${Math.round(supply * 100)} % reaching the attack: fuel, shells and spares decay with every region, sea zone and mountain between here and a depot or port.${u.commander?.trait === 'logistician' ? ` ${u.commander.name} keeps the formation fed (+15).` : ''}`,
  });
  if (n && n.mobilization > 0)
    mods.push({ label: 'Mobilisation', factor: 1 + 0.05 * n.mobilization, detail: 'War economy: reinforced formations.' });
  if (n) {
    mods.push({ label: 'Force quality', factor: n.quality, detail: 'Training and equipment from defence spending per soldier.' });
    const tech = 1 + (n.modifiers.landAttack ?? 0);
    if (tech > 1.001) mods.push({ label: 'Technology', factor: tech, detail: 'Researched land-attack bonuses.' });
  }
  mods.push({
    label: 'Experience',
    factor: Math.round(experienceFactor(u.experience) * 100) / 100,
    detail: `Experience ${Math.round(u.experience)}/100: green formations fight at ×0.95, veterans at up to ×1.20. Each battle survived adds experience.`,
  });
  const cm = commanderAttackModifier(u.commander);
  if (cm) mods.push(cm);
  return { factor: mods.reduce((f, m) => f * m.factor, 1), mods };
}

export function defenderFactors(
  world: World,
  state: GameState,
  u: Unit,
  region: RegionId,
  opts: { onlyFromSea: boolean },
): SideFactors {
  const mods: Modifier[] = [];
  const rule = terrainRule(world, region);
  const r = state.regions[region]!;
  const n = state.nations[u.owner];
  mods.push({
    label: 'Terrain',
    factor: rule.defence,
    detail: `${rule.name}: defenders fight at ${pct(rule.defence)}. ${rule.description}`,
  });
  const tf = unitTerrainFactor(rule, u.type);
  if (Math.abs(tf - 1) > 0.001)
    mods.push({ label: 'Unit type', factor: tf, detail: `${world.unitTypes.get(u.type)?.name ?? u.type} in ${rule.name.toLowerCase()}.` });
  if (r.owner === u.owner)
    mods.push({ label: 'Home soil', factor: HOME_DEFENCE, detail: 'Defending their own country: local knowledge, reserves and motivation.' });
  if (state.turn - r.flippedTurn >= 6)
    mods.push({ label: 'Entrenched', factor: ENTRENCHED, detail: 'Held for six months or more: prepared positions and minefields.' });
  if (opts.onlyFromSea && world.regions.get(region)?.coastal)
    mods.push({ label: 'Coastal defence', factor: COASTAL_DEFENCE, detail: 'Attacked only from the sea: the defender holds every beach exit.' });
  if (n?.mobilization === 2)
    mods.push({ label: 'Total mobilisation', factor: 1.1, detail: 'The whole nation under arms.' });
  if (n && n.mobilization > 0)
    mods.push({ label: 'Mobilisation', factor: 1 + 0.05 * n.mobilization, detail: 'War economy: reinforced formations.' });
  const w = weatherAt(world, region, state.date.month);
  const wf = 1 - 0.1 * w.winter - 0.1 * w.monsoon;
  if (wf < 0.999)
    mods.push({ label: 'Weather', factor: wf, detail: `${describeWeather(w)}: even dug-in troops suffer.` });
  const supply = Math.min(1, supplyFor(world, state, u.owner, region) + commanderSupplyBonus(u.commander));
  mods.push({
    label: 'Supply',
    factor: 0.5 + 0.5 * supply,
    detail: `Supply ${Math.round(supply * 100)} % for the defenders${supply < SUPPLY_THRESHOLD ? ' — cut off' : ''}.`,
  });
  if (n) {
    mods.push({ label: 'Force quality', factor: n.quality, detail: 'Training and equipment from defence spending per soldier.' });
    const tech = 1 + (n.modifiers.landDefence ?? 0);
    if (tech > 1.001) mods.push({ label: 'Technology', factor: tech, detail: 'Researched land-defence bonuses.' });
  }
  mods.push({
    label: 'Experience',
    factor: Math.round(experienceFactor(u.experience) * 100) / 100,
    detail: `Experience ${Math.round(u.experience)}/100: green formations fight at ×0.95, veterans at up to ×1.20.`,
  });
  const cm = commanderDefenceModifier(u.commander);
  if (cm) mods.push(cm);
  return { factor: mods.reduce((f, m) => f * m.factor, 1), mods };
}

/** Raw firepower before situational factors (strength × attack/defence × morale). */
function rawPower(world: World, state: GameState, u: Unit, mode: 'attack' | 'defence'): number {
  const n = state.nations[u.owner];
  const t = world.unitTypes.get(u.type);
  if (!t || !n) return 0;
  // unitPower includes quality and tech; those are reported as separate modifiers, so strip them here.
  const base = unitPower(world, state, u, mode);
  const tech = 1 + (n.modifiers[mode === 'attack' ? 'landAttack' : 'landDefence'] ?? 0);
  return base / (n.quality * tech);
}

/** Attack-side air superiority share (0..1) for a battle in `region`. */
function airSuperiority(world: World, state: GameState, region: RegionId, attackers: Unit[], defenders: Unit[]) {
  const attSide = new Set(attackers.map((u) => u.owner));
  const defSide = new Set(defenders.map((u) => u.owner));
  const attSupport = supportFor(world, state, region, attSide, defSide);
  const defSupport = supportFor(world, state, region, defSide, attSide);
  const groundAA = (list: Unit[]) =>
    list.reduce((s, u) => s + (u.strength / 100) * (world.unitTypes.get(u.type)?.antiAir ?? 0), 0);
  const rule = terrainRule(world, region);
  const wf = weatherAirFactor(weatherAt(world, region, state.date.month));
  const airFactor = rule.air * wf;
  const attAir = attSupport.air * airFactor + groundAA(attackers) * 0.5;
  const defAir = defSupport.air * airFactor + groundAA(defenders) * 0.5;
  const attSup = attAir + defAir > 0 ? attAir / (attAir + defAir) : 0.5;
  return { attSup, attStrike: attSupport.strike * airFactor, defStrike: defSupport.strike * airFactor, airFactor };
}

/** Air-superiority modifiers for both sides of a battle, from the attacker's share. */
function superiorityMods(attSup: number): { att: Modifier; def: Modifier } {
  const a = airSuperiorityFactor(attSup);
  const d = airSuperiorityFactor(1 - attSup);
  const pctA = Math.round(attSup * 100);
  return {
    att: {
      label: 'Air superiority',
      factor: Math.round(a * 100) / 100,
      detail: `Attackers hold ${pctA} % of the air over the battle (fighters and drones on superiority, carriers, air-defence brigades, cut by terrain and weather): ×0.85 with none, ×1.15 with all.`,
    },
    def: {
      label: 'Air superiority',
      factor: Math.round(d * 100) / 100,
      detail: `Defenders hold ${100 - pctA} % of the air over the battle: ×0.85 with none, ×1.15 with all.`,
    },
  };
}

function sideSummary(set: Set<Iso3>, before: Map<number, number>, units: Unit[], state: GameState, region: RegionId): BattleSide[] {
  return [...set].map((nation) => {
    const mine = units.filter((u) => u.owner === nation);
    const counts = new Map<string, number>();
    for (const u of mine) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    return {
      nation,
      units: [...counts].map(([type, count]) => ({ type, count })),
      strengthBefore: mine.reduce((s, u) => s + (before.get(u.id) ?? 0), 0),
      strengthAfter: mine.reduce((s, u) => s + (state.units[u.id] && u.region === region ? u.strength : 0), 0),
    };
  });
}

export function runCombat(world: World, state: GameState): BattleResult[] {
  const results: BattleResult[] = [];
  invalidateAirCache(state);
  const byRegion = new Map<RegionId, Unit[]>();
  for (const u of Object.values(state.units)) {
    if (!isLand(world, u.region)) continue;
    const list = byRegion.get(u.region) ?? [];
    list.push(u);
    byRegion.set(u.region, list);
  }
  for (const [region, units] of byRegion) {
    const r = state.regions[region]!;
    const controller = r.controller;
    if (!controller) continue;
    const land = units.filter((u) => world.unitTypes.get(u.type)?.domain === 'land');
    const attackers = land.filter((u) => atWar(state, u.owner, controller));
    if (attackers.length === 0) continue;
    const defenders = land.filter(
      (u) =>
        !atWar(state, u.owner, controller) && attackers.some((a) => atWar(state, a.owner, u.owner)),
    );
    if (defenders.length === 0) {
      captureRegion(world, state, region, strongestOwner(world, state, attackers));
      continue;
    }
    const meta = world.regions.get(region)!;
    const attSide = new Set(attackers.map((u) => u.owner));
    const defSide = new Set(defenders.map((u) => u.owner));
    const { attSup, attStrike, defStrike } = airSuperiority(world, state, region, attackers, defenders);
    const fromSea = attackers.map((u) => landedFromSea(world, u));
    const onlyFromSea = fromSea.every(Boolean);
    const sup = superiorityMods(attSup);
    const attLists: { weight: number; mods: Modifier[] }[] = [];
    const defLists: { weight: number; mods: Modifier[] }[] = [];
    const fAttUnits = attackers.reduce((s, u, i) => {
      const dominant =
        attSup >= 0.6 &&
        meta.neighbours.some((z) => world.regions.get(z)?.sea && hasSeaDominance(world, state, z, u.owner));
      const f = attackerFactors(world, state, u, region, u.prevRegion, { amphibious: fromSea[i]!, dominant });
      const raw = rawPower(world, state, u, 'attack');
      attLists.push({ weight: raw, mods: f.mods });
      return s + raw * f.factor;
    }, 0) * sup.att.factor;
    const fDefUnits = defenders.reduce((s, u) => {
      const f = defenderFactors(world, state, u, region, { onlyFromSea });
      const raw = rawPower(world, state, u, 'defence');
      defLists.push({ weight: raw, mods: f.mods });
      return s + raw * f.factor;
    }, 0) * sup.def.factor;
    const congestion = attackers.length > FRONT_WIDTH ? (FRONT_WIDTH / attackers.length) ** 0.7 : 1;
    const attSupport = attStrike * clamp(attSup * 1.6, 0.2, 1);
    const defSupport = defStrike * clamp((1 - attSup) * 1.6, 0.2, 1);
    const fAtt = fAttUnits * congestion + attSupport;
    const fDef = fDefUnits + defSupport;
    const dmgToDef = LANCHESTER_K * fAtt;
    const dmgToAtt = LANCHESTER_K * fDef;
    const before = new Map<number, number>();
    for (const u of [...attackers, ...defenders]) before.set(u.id, u.strength);
    const attackerLoss = applyDamage(state, attackers, dmgToAtt);
    const defenderLoss = applyDamage(state, defenders, dmgToDef);
    r.devastation = clamp(r.devastation + 0.04, 0, 0.7);
    // Experience: survivors learn; the winning side learns more.
    for (const u of [...attackers, ...defenders]) {
      if (!state.units[u.id]) continue;
      u.experience = clamp(u.experience + 6, 0, 100);
    }
    // Retreats.
    for (const u of [...attackers, ...defenders]) {
      if (!state.units[u.id]) continue;
      if (u.strength < 20) retreat(world, state, u);
    }
    const attackerMods = mergeModifiers(attLists);
    attackerMods.push(sup.att);
    if (congestion < 1)
      attackerMods.push({ label: 'Front width', factor: Math.round(congestion * 100) / 100, detail: `Only ${FRONT_WIDTH} formations can engage at once; ${attackers.length} were stacked here.` });
    if (attSupport > 0 && fAttUnits > 0)
      attackerMods.push({ label: 'Air & naval support', factor: Math.round(((fAttUnits * congestion + attSupport) / (fAttUnits * congestion)) * 100) / 100, detail: `Strikes from aircraft and ships within range, weighted by ${Math.round(attSup * 100)} % air superiority.` });
    const defenderMods = mergeModifiers(defLists);
    defenderMods.push(sup.def);
    if (defSupport > 0 && fDefUnits > 0)
      defenderMods.push({ label: 'Air & naval support', factor: Math.round(((fDefUnits + defSupport) / fDefUnits) * 100) / 100, detail: `Defending strikes from aircraft and ships within range, weighted by ${Math.round((1 - attSup) * 100)} % air superiority.` });
    const remainingDef = unitsIn(state, region).filter(
      (u) => defSide.has(u.owner) && world.unitTypes.get(u.type)?.domain === 'land',
    );
    const remainingAtt = unitsIn(state, region).filter(
      (u) => attSide.has(u.owner) && world.unitTypes.get(u.type)?.domain === 'land',
    );
    let captured = false;
    if (remainingDef.length === 0 && remainingAtt.length > 0) {
      captureRegion(world, state, region, strongestOwner(world, state, remainingAtt));
      captured = true;
      // Air units of the loser based here relocate or are lost.
      for (const u of unitsIn(state, region)) {
        if (defSide.has(u.owner) && world.unitTypes.get(u.type)?.domain === 'air')
          retreat(world, state, u);
      }
    }
    const res: BattleResult = {
      region,
      attackers: [...attSide],
      defenders: [...defSide],
      attackerLoss,
      defenderLoss,
      captured,
    };
    results.push(res);
    state.battleReports.push({
      id: state.nextId++,
      turn: state.turn,
      region,
      domain: 'land',
      attackers: sideSummary(attSide, before, attackers, state, region),
      defenders: sideSummary(defSide, before, defenders, state, region),
      attackerMods,
      defenderMods,
      airSuperiority: Math.round(attSup * 100) / 100,
      attackPower: Math.round(fAtt * 10) / 10,
      defencePower: Math.round(fDef * 10) / 10,
      attackerLoss: Math.round(attackerLoss),
      defenderLoss: Math.round(defenderLoss),
      captured,
      outcome: captured ? 'attackerWins' : remainingAtt.length === 0 ? 'defenderHolds' : 'stalemate',
    });
    const involvesPlayer = attSide.has(state.player) || defSide.has(state.player);
    log(state, {
      kind: 'battle',
      text: `Battle of ${meta.name}: ${[...attSide].map((x) => nationName(world, x)).join(', ')} vs ${[...defSide].map((x) => nationName(world, x)).join(', ')} — attackers lose ${Math.round(attackerLoss)}, defenders lose ${Math.round(defenderLoss)} strength${captured ? '; the region falls' : ''}.`,
      nations: [...attSide, ...defSide],
      region,
      alert: involvesPlayer,
    });
    if (meta.capital || (involvesPlayer && roll(state) < 0.4))
      headline(state, `Heavy fighting reported around ${meta.name}`);
  }
  return results;
}

function strongestOwner(world: World, state: GameState, units: Unit[]): Iso3 {
  const score = new Map<Iso3, number>();
  for (const u of units)
    score.set(u.owner, (score.get(u.owner) ?? 0) + unitPower(world, state, u, 'attack'));
  let best: Iso3 = units[0]!.owner;
  for (const [iso, s] of score) if (s > (score.get(best) ?? 0)) best = iso;
  return best;
}

function applyDamage(state: GameState, units: Unit[], total: number): number {
  const sum = units.reduce((s, u) => s + u.strength, 0);
  if (sum <= 0) return 0;
  let applied = 0;
  for (const u of units) {
    const d = ((total * u.strength) / sum) * commanderLossFactor(u.commander);
    const real = Math.min(u.strength, d);
    u.strength -= real;
    applied += real;
    u.morale = clamp(u.morale - real / 2, 5, 100);
    if (u.strength <= 1) delete state.units[u.id];
  }
  return applied;
}

function retreat(world: World, state: GameState, u: Unit): void {
  const meta = world.regions.get(u.region)!;
  const t = world.unitTypes.get(u.type)!;
  const options = meta.neighbours.filter((n) => {
    const m = world.regions.get(n);
    if (!m || m.sea !== (t.domain === 'sea')) return false;
    const c = state.regions[n]?.controller ?? null;
    if (!isFriendly(world, state, u.owner, c)) return false;
    return !unitsIn(state, n).some((o) => atWar(state, o.owner, u.owner));
  });
  if (options.length === 0) {
    delete state.units[u.id];
    return;
  }
  u.region = options[Math.floor(roll(state) * options.length)]!;
  u.path = [];
}

// --- supply ----------------------------------------------------------------------------------------

/** Supply loss entering `to` from `from` for nation `iso` (terrain × infrastructure, crossings, tech). */
function supplyLoss(world: World, state: GameState, iso: Iso3, from: RegionId, to: RegionId): number {
  const meta = world.regions.get(to)!;
  const rule = terrainRule(world, to);
  // Bombed roads, rail and ports (missile strikes, strategic bombing) count as lost infrastructure.
  const infra = meta.infrastructure * (1 - (state.regions[to]?.infraDamage ?? 0));
  let loss = rule.supplyLoss * (1.4 - 0.8 * infra);
  const c = crossingBetween(world, from, to);
  const engineering = clamp(state.nations[iso]?.modifiers.crossing ?? 0, 0, 0.9);
  if (c) {
    if (c.rivers.length > 0) loss += 0.03 * (1 - engineering);
    if (c.mountain) loss += (c.pass ? 0.04 : 0.06) * (1 - engineering);
  }
  loss *= 1 - clamp(state.nations[iso]?.modifiers.supply ?? 0, 0, 0.6);
  return clamp(loss, 0, 0.9);
}

const portCap = (capacity: number) => Math.min(1, BEACHHEAD_SUPPLY + 0.15 * capacity);

/** Supply sources (D-059): the capital, industrial regions and major ports of a nation. */
export function isDepot(world: World, iso: Iso3, region: RegionId): boolean {
  const meta = world.regions.get(region);
  if (!meta || meta.sea) return false;
  if (world.capitalRegion.get(iso) === region) return true;
  if (meta.majorPort) return true;
  return meta.populationShare >= INDUSTRIAL_SHARE || (meta.infrastructure >= 0.75 && meta.populationShare >= 0.02);
}

/** Why a region is (or is not) a depot, for the UI. */
export function depotKind(world: World, iso: Iso3, region: RegionId): 'capital' | 'port' | 'industrial' | null {
  const meta = world.regions.get(region);
  if (!meta || meta.sea) return null;
  if (world.capitalRegion.get(iso) === region) return 'capital';
  if (meta.majorPort) return 'port';
  if (isDepot(world, iso, region)) return 'industrial';
  return null;
}

/**
 * Supply (D-050): every region a nation owns and controls is a depot, at full strength when it
 * connects to the capital through friendly land and reduced for cut-off exclaves. From the depots,
 * supply spreads along friendly land (decaying by terrain, infrastructure and crossings) and over
 * controlled sea zones from ports (decaying per zone, cut by enemy submarines, capped by the
 * destination port). Allied territory passes supply too. The result is `region.supply` for the
 * controller; units read it through supplyFor().
 */
export function runSupply(world: World, state: GameState): void {
  invalidateGeoCache(state);
  const levels = new Map<Iso3, Map<RegionId, number>>();
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const iso = n.iso3;
    const level = new Map<RegionId, number>();
    const cap = world.capitalRegion.get(iso);
    const home: RegionId[] = [];
    for (const r of Object.values(state.regions))
      if (r.owner === iso && r.controller === iso) home.push(r.id);
    if (home.length === 0) {
      levels.set(iso, level);
      continue;
    }
    // Home regions connected to the capital by friendly land are full depots.
    const connected = new Set<RegionId>();
    const start = cap !== undefined && state.regions[cap]?.controller === iso ? cap : home[0]!;
    const queue = [start];
    connected.add(start);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of world.regions.get(cur)!.neighbours) {
        if (connected.has(nb) || !isLand(world, nb)) continue;
        if (!isFriendly(world, state, iso, state.regions[nb]?.controller ?? null)) continue;
        connected.add(nb);
        queue.push(nb);
      }
    }
    // Dijkstra in log space: a max-product search over supply levels.
    const heap: { id: RegionId; v: number }[] = [];
    const push = (id: RegionId, v: number) => {
      if ((level.get(id) ?? 0) >= v) return;
      level.set(id, v);
      heap.push({ id, v });
    };
    // Depots (D-059): the capital, industrial regions and major ports. Other home regions draw
    // from them along the network, never below a floor when they connect to the capital.
    for (const id of home) {
      const meta = world.regions.get(id)!;
      const damage = state.regions[id]?.infraDamage ?? 0;
      const depot = isDepot(world, iso, id);
      const full = (0.8 + 0.2 * meta.infrastructure) * (1 - 0.5 * damage);
      if (connected.has(id)) push(id, depot ? full : HOME_SUPPLY_FLOOR * (1 - 0.5 * damage));
      else push(id, Math.min(depot ? full : HOME_SUPPLY_FLOOR, meta.portCapacity > 0 ? portCap(meta.portCapacity) : 0.5));
    }
    const done = new Set<RegionId>();
    while (heap.length > 0) {
      // Small graphs: a linear extract-max is fast enough (regions ≈ 1,200).
      let bi = 0;
      for (let i = 1; i < heap.length; i++) if (heap[i]!.v > heap[bi]!.v) bi = i;
      const { id, v } = heap[bi]!;
      heap[bi] = heap[heap.length - 1]!;
      heap.pop();
      if (done.has(id) || (level.get(id) ?? 0) > v) continue;
      done.add(id);
      const meta = world.regions.get(id)!;
      for (const nb of meta.neighbours) {
        const nbMeta = world.regions.get(nb)!;
        if (nbMeta.sea) {
          // Convoy leg: needs a port (or a sea zone we are already in) and a zone the enemy does not
          // command (merchant shipping does not need an escort where there is nothing to escort from).
          if (!meta.sea && meta.portCapacity <= 0) continue;
          if (!convoySafe(world, state, nb, iso)) continue;
          if (meta.sea && chokepointBlocks(world, state, id, nb, iso)) continue;
          const b = seaBalance(world, state, nb, iso);
          const subs = b.enemySubs > 0 ? (b.myEscorts > 0 ? 0.12 : 0.3) * Math.min(2, b.enemySubs) : 0;
          push(nb, v * (1 - 0.05 - subs));
        } else {
          const ctrl = state.regions[nb]?.controller ?? null;
          if (!isFriendly(world, state, iso, ctrl)) continue;
          if (meta.sea) {
            // Landing supply: capped by the destination port (a bare beach gets BEACHHEAD_SUPPLY).
            const cap = nbMeta.portCapacity > 0 ? portCap(nbMeta.portCapacity) * (1 - 0.6 * (state.regions[nb]?.infraDamage ?? 0)) : BEACHHEAD_SUPPLY;
            push(nb, Math.min(v * 0.95, Math.max(BEACHHEAD_SUPPLY, cap)));
          } else {
            push(nb, v * (1 - supplyLoss(world, state, iso, id, nb)));
          }
        }
      }
    }
    levels.set(iso, level);
  }
  for (const r of Object.values(state.regions)) {
    if (!r.controller || !isLand(world, r.id)) {
      r.supply = 0;
      r.supplied = false;
      continue;
    }
    let s = levels.get(r.controller)?.get(r.id) ?? 0;
    // Allies supplying each other's territory.
    for (const ally of alliesOf(world, state, r.controller)) s = Math.max(s, levels.get(ally)?.get(r.id) ?? 0);
    // Enemy interdiction wings over the region (D-059).
    s *= interdictionFactor(world, state, r.id, r.controller);
    r.supply = Math.round(s * 100) / 100;
    r.supplied = r.supply >= SUPPLY_THRESHOLD;
    // Bombed infrastructure recovers slowly.
    if (r.infraDamage > 0) r.infraDamage = Math.max(0, Math.round((r.infraDamage - 0.05) * 100) / 100);
  }
}

/** Supply level for a unit where it stands (own/allied territory: the region's level; hostile: estimated). */
export function unitSupply(world: World, state: GameState, u: Unit): number {
  const t = world.unitTypes.get(u.type);
  const meta = world.regions.get(u.region)!;
  if (t?.domain === 'sea' || meta.sea) {
    const near = (n: RegionId) =>
      isLand(world, n) && isFriendly(world, state, u.owner, state.regions[n]?.controller ?? null);
    if (meta.neighbours.some(near)) return 1;
    if (meta.neighbours.some((n) => world.regions.get(n)?.neighbours.some(near))) return 0.8;
    return 0;
  }
  return supplyFor(world, state, u.owner, u.region, landedFromSea(world, u));
}

/** Monthly attrition from lack of supply, weather and partisans (D-051). */
export function runAttrition(world: World, state: GameState): void {
  for (const u of Object.values(state.units)) {
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    const supply = unitSupply(world, state, u);
    let loss = 0;
    const cutOff = supply < SUPPLY_THRESHOLD;
    if (cutOff) loss += t.domain === 'sea' ? 3 : 4;
    if (t.domain === 'land') {
      const r = state.regions[u.region];
      const foreign = r?.owner !== u.owner;
      const w = weatherAt(world, u.region, state.date.month);
      // Badly supplied troops suffer the weather more (no winter kit, no water, no shelter).
      loss += weatherAttrition(w, foreign) * (0.6 + 0.4 * (1 - supply));
      const p = partisanAttrition(world, state, u);
      if (p) loss += p.loss;
      // Enemy interdiction wings hit columns on the move (D-059).
      if (u.prevRegion !== u.region) loss += interdictionAttrition(world, state, u.region, u.owner);
    }
    if (loss > 0) {
      u.strength = clamp(u.strength - loss, 5, 100);
      u.morale = clamp(u.morale - Math.min(3, loss / 2), 5, 100);
    }
    // Out of supply, morale drains on its own: hungry troops stop believing in the plan.
    if (cutOff) u.morale = clamp(u.morale - 4, 5, 100);
  }
}

/**
 * Units in supplied friendly regions that did not fight recover strength and morale: fully on
 * their own (or an ally's) soil, a third as fast in occupied territory, and not at all in deep
 * winter in the field.
 */
export function runRecovery(world: World, state: GameState, fought: Set<RegionId>): void {
  for (const u of Object.values(state.units)) {
    if (fought.has(u.region)) continue;
    const r = state.regions[u.region];
    const c = r?.controller ?? null;
    const meta = world.regions.get(u.region);
    const friendly = meta?.sea ? true : isFriendly(world, state, u.owner, c);
    if (!friendly) continue;
    const supply = unitSupply(world, state, u);
    if (supply < SUPPLY_THRESHOLD) continue;
    const home = meta?.sea ? true : r?.owner !== null && r?.owner !== undefined && isFriendly(world, state, u.owner, r.owner);
    const w = meta?.sea ? 0 : weatherAt(world, u.region, state.date.month).winter;
    const rate = 8 * supply * (home ? 1 : 0.35) * (1 - w);
    u.strength = clamp(u.strength + rate, 0, 100);
    u.morale = clamp(u.morale + 3 * (home ? 1 : 0.5), 0, 100);
  }
}

export function checkCapitulations(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const cap = world.capitalRegion.get(n.iso3);
    if (cap === undefined) continue;
    const capCtrl = state.regions[cap]?.controller;
    if (!capCtrl || capCtrl === n.iso3 || !atWar(state, n.iso3, capCtrl)) {
      n.capitalLostMonths = 0;
      continue;
    }
    n.capitalLostMonths += 1;
    // Capitulation needs the capital held by the enemy for three months and ≤ 30% of the population controlled.
    if (n.capitalLostMonths < 3 || controlShare(world, state, n.iso3) > 0.3) continue;
    capitulate(world, state, n.iso3, capCtrl);
  }
}

export function capitulate(world: World, state: GameState, iso: Iso3, to: Iso3): void {
  const n = state.nations[iso]!;
  n.alive = false;
  n.capitulatedTo = to;
  n.mobilization = 0;
  for (const r of Object.values(state.regions)) {
    if (r.owner !== iso) continue;
    const taker =
      r.controller && r.controller !== iso && atWar(state, iso, r.controller) ? r.controller : to;
    r.owner = taker;
    r.controller = taker;
    r.flippedTurn = state.turn;
  }
  touchRegions(state);
  invalidateGeoCache(state);
  for (const u of Object.values(state.units)) if (u.owner === iso) delete state.units[u.id];
  for (const w of state.wars) {
    w.attackers = w.attackers.filter((x) => x !== iso);
    w.defenders = w.defenders.filter((x) => x !== iso);
  }
  state.wars = state.wars.filter((w) => w.attackers.length > 0 && w.defenders.length > 0);
  state.treaties = state.treaties.filter((t) => t.a !== iso && t.b !== iso);
  bumpDiplomacy(state);
  n.production = [];
  const victor = state.nations[to];
  if (victor) {
    victor.stability = clamp(victor.stability + 5, 0, 100);
    victor.gdp += n.gdp * 0.3;
  }
  state.globalTension = clamp(state.globalTension + 8, 0, 100);
  log(state, {
    kind: 'capitulation',
    text: `${nationName(world, iso)} capitulates to ${nationName(world, to)}.`,
    nations: [iso, to],
    alert: true,
  });
  headline(state, `${nationName(world, iso).toUpperCase()} CAPITULATES`);
}

// --- odds and movement preview -------------------------------------------------------------------

/** Strength-weighted merge of per-unit modifier lists into one list for display. */
function mergeModifiers(lists: { weight: number; mods: Modifier[] }[]): Modifier[] {
  const acc = new Map<string, { sum: number; w: number; detail: string }>();
  const order: string[] = [];
  let totalW = 0;
  for (const { weight, mods } of lists) {
    totalW += weight;
    for (const m of mods) {
      let e = acc.get(m.label);
      if (!e) {
        acc.set(m.label, (e = { sum: 0, w: 0, detail: m.detail }));
        order.push(m.label);
      }
      e.sum += m.factor * weight;
      e.w += weight;
    }
  }
  return order.map((label) => {
    const e = acc.get(label)!;
    // Units lacking a modifier count as ×1 for it.
    const factor = (e.sum + (totalW - e.w)) / Math.max(1e-9, totalW);
    return { label, factor: Math.round(factor * 100) / 100, detail: e.detail };
  });
}

export function previewPath(world: World, state: GameState, unit: Unit, target: RegionId): PathPreview | null {
  const path = findPath(world, state, unit, target);
  if (!path) return null;
  const costs: number[] = [];
  const supply: number[] = [];
  let from = unit.region;
  let total = 0;
  for (const step of path) {
    const c = unitStepCost(world, state, unit, from, step);
    costs.push(Math.round(c * 100) / 100);
    total += c;
    const fromMeta = world.regions.get(from);
    const bySea = !!fromMeta && !fromMeta.neighbours.includes(step);
    supply.push(Math.round(supplyFor(world, state, unit.owner, step, bySea) * 100) / 100);
    from = step;
  }
  const perTurn = movePoints(world, unit.type);
  return { regions: path, costs, supply, turns: Math.max(1, Math.ceil(total / perTurn - 1e-9)), totalCost: Math.round(total * 100) / 100 };
}

/** Odds estimate shown before an attack, with the full modifier breakdown and the route preview. */
export function estimateOdds(
  world: World,
  state: GameState,
  unitIds: number[],
  target: RegionId,
): OddsReport {
  const empty = (text: string, ratio = 0): OddsReport => ({
    target, ratio, text, attacker: [], defender: [], attackPower: 0, defencePower: 0, defenders: 0, path: null, pathNote: null, intel: 4,
  });
  const movers = unitIds.map((id) => state.units[id]).filter((u): u is Unit => !!u);
  if (movers.length === 0) return empty('No units selected.');
  const meta = world.regions.get(target);
  if (!meta) return empty('Unknown target.');
  const owner = movers[0]!.owner;
  const controller = state.regions[target]?.controller ?? null;
  const lead = movers.find((u) => world.unitTypes.get(u.type)?.domain === 'land') ?? movers[0]!;
  const path = previewPath(world, state, lead, target);
  const intel = intelLevel(world, state, owner, target);
  let pathNote = path
    ? null
    : meta.sea
      ? 'No route: ships need adjacent sea zones free of hostile closed straits.'
      : 'No route: land units need a land path or a controlled sea route with amphibious lift.';
  if (path) {
    // Amphibious hops need preparation months before the units embark (D-059).
    let from = lead.region;
    for (const step of path.regions) {
      const bySea = !(world.regions.get(from)?.neighbours.includes(step) ?? false);
      if (bySea) {
        const need = Math.max(...movers.map((u) => prepNeeded(world, u.type)));
        const done = Math.min(...movers.map((u) => u.prep));
        pathNote = `Amphibious hop into ${world.regions.get(step)?.name}: ${need} month${need === 1 ? '' : 's'} of preparation before embarking${done > 0 ? ` (${done} done)` : ''}; the landing follows once shipping is available.`;
        break;
      }
      from = step;
    }
  }
  if (meta.sea || isFriendly(world, state, owner, controller))
    return { ...empty('Move (no opposition expected).', Infinity), path, pathNote, intel };
  if (!controller || !atWar(state, owner, controller))
    return empty(`Cannot enter: not at war with ${nationName(world, controller)}.`);
  const landMovers = movers.filter((u) => world.unitTypes.get(u.type)?.domain === 'land');
  const alreadyThere = unitsIn(state, target).filter(
    (u) => u.owner === owner && world.unitTypes.get(u.type)?.domain === 'land' && !movers.includes(u),
  );
  const attackersAll = [...landMovers, ...alreadyThere];
  const defenders = unitsIn(state, target).filter(
    (u) =>
      !atWar(state, u.owner, controller) &&
      atWar(state, u.owner, owner) &&
      world.unitTypes.get(u.type)?.domain === 'land',
  );
  const { attSup, attStrike, defStrike } = airSuperiority(world, state, target, attackersAll, defenders);
  const dominant =
    attSup >= 0.6 && meta.neighbours.some((z) => world.regions.get(z)?.sea && hasSeaDominance(world, state, z, owner));
  const attLists: { weight: number; mods: Modifier[] }[] = [];
  let att = 0;
  const fromSeaFlags: boolean[] = [];
  for (const u of attackersAll) {
    const inside = u.region === target;
    // The route's last hop tells whether this attack comes over the beach.
    const from = inside ? target : path && path.regions.length >= 2 ? path.regions[path.regions.length - 2]! : u.region;
    // Without a route the estimate assumes an attack from an adjacent region, not a landing.
    const amphibious = !inside && path !== null && !(world.regions.get(from)?.neighbours.includes(target) ?? false);
    fromSeaFlags.push(amphibious);
    const f = attackerFactors(world, state, u, target, from, { amphibious, dominant });
    const raw = rawPower(world, state, u, 'attack');
    att += raw * f.factor;
    attLists.push({ weight: raw, mods: f.mods });
  }
  const congestion = attackersAll.length > FRONT_WIDTH ? (FRONT_WIDTH / attackersAll.length) ** 0.7 : 1;
  const attackerMods = mergeModifiers(attLists);
  const sup = superiorityMods(attSup);
  attackerMods.push(sup.att);
  att *= sup.att.factor;
  if (congestion < 1)
    attackerMods.push({ label: 'Front width', factor: Math.round(congestion * 100) / 100, detail: `Only ${FRONT_WIDTH} formations can engage at once; ${attackersAll.length} are stacked here.` });
  att *= congestion;
  const attSupport = attStrike * clamp(attSup * 1.6, 0.2, 1);
  if (attSupport > 0 && att > 0) {
    attackerMods.push({ label: 'Air & naval support', factor: Math.round(((att + attSupport) / att) * 100) / 100, detail: `Strikes from aircraft and ships within range, weighted by ${Math.round(attSup * 100)} % air superiority and cut by terrain and weather.` });
    att += attSupport;
  }
  const onlyFromSea = fromSeaFlags.length > 0 && fromSeaFlags.every(Boolean);
  const defLists: { weight: number; mods: Modifier[] }[] = [];
  let def = 0;
  for (const u of defenders) {
    const f = defenderFactors(world, state, u, target, { onlyFromSea });
    const raw = rawPower(world, state, u, 'defence');
    def += raw * f.factor;
    defLists.push({ weight: raw, mods: f.mods });
  }
  const defenderMods = mergeModifiers(defLists);
  if (defenders.length > 0) {
    defenderMods.push(sup.def);
    def *= sup.def.factor;
  }
  const defSupport = defStrike * clamp((1 - attSup) * 1.6, 0.2, 1);
  if (defSupport > 0 && def > 0) {
    defenderMods.push({ label: 'Air & naval support', factor: Math.round(((def + defSupport) / def) * 100) / 100, detail: `Defending strikes from aircraft and ships within range, weighted by ${Math.round((1 - attSup) * 100)} % air superiority.` });
    def += defSupport;
  }
  if (def === 0)
    return {
      ...empty(intel <= 1 ? 'No defenders detected (intelligence is thin: there may be more).' : 'Undefended: the region will be captured.', Infinity),
      attacker: attackerMods,
      attackPower: att,
      path,
      pathNote,
      intel,
    };
  const ratio = att / def;
  const text =
    ratio >= 3 ? 'Overwhelming' : ratio >= 1.5 ? 'Favourable' : ratio >= 1 ? 'Even' : ratio >= 0.6 ? 'Unfavourable' : 'Hopeless';
  // Fog of war: with a thin picture the estimate is given as a band, not a number.
  const band =
    intel >= 3
      ? `${ratio.toFixed(1)}:1`
      : intel === 2
        ? `≈ ${(ratio * 0.7).toFixed(1)}–${(ratio * 1.4).toFixed(1)}:1, rough estimate`
        : `≈ ${(ratio * 0.5).toFixed(1)}–${(ratio * 2).toFixed(1)}:1, little intelligence`;
  const count = intel >= 3 ? `${defenders.length}` : intel === 2 ? `~${defenders.length}` : 'unknown';
  return {
    target,
    ratio,
    text: `${text} (${band}, ${count} defending unit${defenders.length === 1 && intel >= 3 ? '' : 's'}, ${terrainRule(world, target).name.toLowerCase()})`,
    attacker: attackerMods,
    defender: defenderMods,
    attackPower: att,
    defencePower: def,
    defenders: defenders.length,
    path,
    pathNote,
    intel,
  };
}

export { hasSeaControl, amphibiousTargets, crossingBetween };
