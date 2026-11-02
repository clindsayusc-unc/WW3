/** Movement, supply, combat, captures and capitulation (D-025, D-029). */
import { nationName, type World } from './world';
import type { GameState, Iso3, RegionId, Unit } from './types';
import {
  alliesOf,
  amphibiousTargets,
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

export const LANCHESTER_K = 3;
/** Attack firepower saturates beyond this many land units in one region (front width). */
export const FRONT_WIDTH = 8;
/** Defenders fighting on their own nation's soil. */
export const HOME_DEFENCE = 1.3;
/** Regions held unchanged for 6+ months are fortified. */
export const ENTRENCHED = 1.25;

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
  if (t.domain === 'sea') return adjacent && toMeta.sea ? 'move' : null;
  if (toMeta.sea) return null;
  const controller = state.regions[to]?.controller ?? null;
  if (t.domain === 'air')
    return adjacent && isFriendly(world, state, unit.owner, controller) ? 'move' : null;
  // land
  const amphib =
    !adjacent && t.amphibious && amphibiousTargets(world, state, from, unit.owner).includes(to);
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
    if (t.domain === 'land' && t.amphibious && !meta.sea)
      candidates.push(...amphibiousTargets(world, state, cur, unit.owner));
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
      // Attack steps end movement there; do not expand through enemy-held regions with enemies present.
      if (kind === 'attack' && unitsIn(state, n).some((u) => atWar(state, u.owner, unit.owner)))
        continue;
      queue.push(n);
    }
  }
  return null;
}

export function runMovement(world: World, state: GameState): void {
  for (const u of Object.values(state.units)) {
    u.prevRegion = u.region;
    if (u.path.length === 0) continue;
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    let steps = t.domain === 'air' ? 2 : Math.max(1, t.speed);
    while (steps > 0 && u.path.length > 0) {
      const next = u.path[0]!;
      const kind = stepKind(world, state, u, u.region, next);
      if (!kind) {
        u.path = [];
        break;
      }
      u.region = next;
      u.path.shift();
      steps--;
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
        strike += unitPower(world, state, u, 'attack');
        air += (u.strength / 100) * t.antiAir * (state.nations[u.owner]?.quality ?? 1);
      }
    } else if (t.domain === 'sea' && friendly && meta.neighbours.includes(u.region)) {
      strike += (u.strength / 100) * t.strike * (state.nations[u.owner]?.quality ?? 1);
      air += (u.strength / 100) * t.antiAir * 0.5;
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

export function runCombat(world: World, state: GameState): BattleResult[] {
  const results: BattleResult[] = [];
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
    const terrain = world.terrain[meta.terrain] ?? { defence: 1, armorBonus: 1 };
    const attSide = new Set(attackers.map((u) => u.owner));
    const defSide = new Set(defenders.map((u) => u.owner));
    const attSupport = supportFor(world, state, region, attSide, defSide);
    const defSupport = supportFor(world, state, region, defSide, attSide);
    const groundAA = (list: Unit[]) =>
      list.reduce(
        (s, u) => s + (u.strength / 100) * (world.unitTypes.get(u.type)?.antiAir ?? 0),
        0,
      );
    const attAir = attSupport.air + groundAA(attackers) * 0.5;
    const defAir = defSupport.air + groundAA(defenders) * 0.5;
    const attSup = attAir + defAir > 0 ? attAir / (attAir + defAir) : 0.5;
    const firepower = (list: Unit[], mode: 'attack' | 'defence') =>
      list.reduce((s, u) => {
        const t = world.unitTypes.get(u.type)!;
        let f = unitPower(world, state, u, mode);
        if (u.type === 'armored' || u.type === 'mechanized') f *= terrain.armorBonus;
        if (mode === 'defence') {
          f *= terrain.defence;
          if (r.owner === u.owner) f *= HOME_DEFENCE;
          if (state.turn - r.flippedTurn >= 6) f *= ENTRENCHED;
          if (state.nations[u.owner]?.mobilization === 2) f *= 1.1;
        }
        if (!state.regions[u.region]!.supplied && u.owner !== controller) f *= 0.6;
        f *= 1 + 0.05 * (state.nations[u.owner]?.mobilization ?? 0);
        void t;
        return s + f;
      }, 0);
    const congestion =
      attackers.length > FRONT_WIDTH ? Math.sqrt(FRONT_WIDTH / attackers.length) : 1;
    const fAtt =
      firepower(attackers, 'attack') * congestion + attSupport.strike * clamp(attSup * 1.6, 0.2, 1);
    const fDef =
      firepower(defenders, 'defence') + defSupport.strike * clamp((1 - attSup) * 1.6, 0.2, 1);
    const dmgToDef = LANCHESTER_K * fAtt;
    const dmgToAtt = LANCHESTER_K * fDef;
    const attackerLoss = applyDamage(state, attackers, dmgToAtt);
    const defenderLoss = applyDamage(state, defenders, dmgToDef);
    r.devastation = clamp(r.devastation + 0.04, 0, 0.7);
    // Retreats.
    for (const u of [...attackers, ...defenders]) {
      if (!state.units[u.id]) continue;
      if (u.strength < 20) retreat(world, state, u);
    }
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
    const d = (total * u.strength) / sum;
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

/** Supply: land regions reachable from the capital through friendly-controlled land (D-029). */
export function runSupply(world: World, state: GameState): void {
  const reach = new Map<Iso3, Set<RegionId>>();
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const start = world.capitalRegion.get(n.iso3);
    const set = new Set<RegionId>();
    if (start !== undefined) {
      const sources =
        state.regions[start]?.controller === n.iso3
          ? [start]
          : Object.values(state.regions)
              .filter((r) => r.controller === n.iso3)
              .slice(0, 3)
              .map((r) => r.id);
      const queue = [...sources];
      for (const s of sources) set.add(s);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nb of world.regions.get(cur)!.neighbours) {
          if (set.has(nb) || !isLand(world, nb)) continue;
          if (!isFriendly(world, state, n.iso3, state.regions[nb]?.controller ?? null)) continue;
          set.add(nb);
          queue.push(nb);
        }
      }
    }
    reach.set(n.iso3, set);
  }
  for (const r of Object.values(state.regions)) {
    if (!r.controller) continue;
    r.supplied = reach.get(r.controller)?.has(r.id) ?? false;
  }
  for (const u of Object.values(state.units)) {
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    const meta = world.regions.get(u.region)!;
    let supplied: boolean;
    if (t.domain === 'sea') {
      supplied =
        meta.neighbours.some(
          (n) =>
            isLand(world, n) &&
            isFriendly(world, state, u.owner, state.regions[n]?.controller ?? null),
        ) ||
        meta.neighbours.some((n) =>
          world.regions
            .get(n)
            ?.neighbours.some(
              (nn) =>
                isLand(world, nn) &&
                isFriendly(world, state, u.owner, state.regions[nn]?.controller ?? null),
            ),
        );
    } else {
      supplied = reach.get(u.owner)?.has(u.region) ?? false;
      // Allied territory counts as supplied if the ally supplies it.
      if (!supplied) {
        const c = state.regions[u.region]?.controller;
        if (
          c &&
          c !== u.owner &&
          isFriendly(world, state, u.owner, c) &&
          (reach.get(c)?.has(u.region) ?? false)
        )
          supplied = true;
      }
    }
    if (!supplied) {
      u.strength = clamp(u.strength - (t.domain === 'sea' ? 3 : 4), 5, 100);
      u.morale = clamp(u.morale - 3, 5, 100);
    }
  }
}

/** Units in supplied friendly regions that did not fight recover strength and morale. */
export function runRecovery(world: World, state: GameState, fought: Set<RegionId>): void {
  for (const u of Object.values(state.units)) {
    if (fought.has(u.region)) continue;
    const c = state.regions[u.region]?.controller ?? null;
    const meta = world.regions.get(u.region);
    const friendly = meta?.sea ? true : isFriendly(world, state, u.owner, c);
    if (!friendly) continue;
    const t = world.unitTypes.get(u.type);
    const supplied = t?.domain === 'sea' ? true : (state.regions[u.region]?.supplied ?? false);
    if (!supplied) continue;
    u.strength = clamp(u.strength + 8, 0, 100);
    u.morale = clamp(u.morale + 3, 0, 100);
  }
}

export function checkCapitulations(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const cap = world.capitalRegion.get(n.iso3);
    if (cap === undefined) continue;
    const capCtrl = state.regions[cap]?.controller;
    if (!capCtrl || capCtrl === n.iso3 || !atWar(state, n.iso3, capCtrl)) continue;
    if (controlShare(world, state, n.iso3) > 0.3) continue;
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

/** Odds estimate shown before an attack: attacker attack power vs defender defence power in the target. */
export function estimateOdds(
  world: World,
  state: GameState,
  unitIds: number[],
  target: RegionId,
): { ratio: number; text: string } {
  const movers = unitIds.map((id) => state.units[id]).filter((u): u is Unit => !!u);
  if (movers.length === 0) return { ratio: 0, text: 'No units selected.' };
  const meta = world.regions.get(target);
  if (!meta) return { ratio: 0, text: 'Unknown target.' };
  const owner = movers[0]!.owner;
  const controller = state.regions[target]?.controller ?? null;
  if (meta.sea || isFriendly(world, state, owner, controller))
    return { ratio: Infinity, text: 'Move (no opposition expected).' };
  if (!controller || !atWar(state, owner, controller))
    return { ratio: 0, text: `Cannot enter: not at war with ${nationName(world, controller)}.` };
  const terrain = world.terrain[meta.terrain] ?? { defence: 1, armorBonus: 1 };
  const att = movers.reduce(
    (s, u) =>
      s + unitPower(world, state, u, 'attack') * (u.type === 'armored' ? terrain.armorBonus : 1),
    0,
  );
  const defenders = unitsIn(state, target).filter(
    (u) =>
      !atWar(state, u.owner, controller) &&
      atWar(state, u.owner, owner) &&
      world.unitTypes.get(u.type)?.domain === 'land',
  );
  const def = defenders.reduce(
    (s, u) => s + unitPower(world, state, u, 'defence') * terrain.defence,
    0,
  );
  if (def === 0) return { ratio: Infinity, text: 'Undefended: the region will be captured.' };
  const ratio = att / def;
  const text =
    ratio >= 3
      ? 'Overwhelming'
      : ratio >= 1.5
        ? 'Favourable'
        : ratio >= 1
          ? 'Even'
          : ratio >= 0.6
            ? 'Unfavourable'
            : 'Hopeless';
  return {
    ratio,
    text: `${text} (${ratio.toFixed(1)}:1, ${defenders.length} defending unit${defenders.length === 1 ? '' : 's'}, ${meta.terrain})`,
  };
}
