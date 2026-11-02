/** Utility-based AI for every non-player nation, weighted by leader traits (D-032). */
import { nationName, traitsOf, type World } from './world';
import type { Deal, GameState, Iso3, Proposal, ProposalType, RegionId, Unit } from './types';
import { issueDispatch } from './statements';
import {
  alliesOf,
  atWar,
  clamp,
  controlShare,
  enemiesOf,
  getRelation,
  hasTreaty,
  isAtWar,
  isLand,
  log,
  militaryPower,
  roll,
  unitPower,
} from './query';
import { availableTechs } from './research';
import { unitCost, unitUpkeep, buildMonths, monthlyRevenue } from './economy';
import { estimateOdds, findPath, isFriendly, stepKind } from './military';
import { amphibiousTargets, invalidateGeoCache } from './geography';
import { evaluateProposal, executeProposal, PROPOSAL_LABELS } from './diplomacy';
import { AI_LAUNCH_CHANCE, nuclearDecision, nuclearStrike, pickStrikeTarget } from './escalation';
import { missionsFor, regionsInRange } from './air';
import {
  SALVO,
  applyAsat,
  applyCyberOp,
  applyLaunchSatellite,
  applyMissileStrike,
  applySpyOp,
  canAsat,
  canCyberOp,
  canLaunchSatellite,
  canMissileStrike,
  canSpyOp,
  satelliteCost,
} from './strikes';
import type { AirMission, CyberKind, StrikeKind } from './types';
import { baseVolume, coalitionReply, sanctionCoalitions, imposeEmbargo } from './trade';
import { canIssueWarBonds, issueWarBonds } from './economy';

const BRANCH_WEIGHTS: Record<string, (t: ReturnType<typeof traitsOf>) => number> = {
  ai: (t) => 1 + t.economicPriority / 100,
  drones: (t) => 1 + t.aggression / 100,
  missiles: (t) => 0.8 + t.aggression / 80,
  missileDefense: (t) => 0.8 + t.paranoia / 80,
  cyber: (t) => 0.9 + t.paranoia / 100,
  space: () => 0.9,
  energy: (t) => 0.8 + t.economicPriority / 60,
  semiconductors: (t) => 0.8 + t.economicPriority / 80,
};

interface Ctx {
  byRegion: Map<RegionId, Unit[]>;
  power: Map<Iso3, number>;
  coalitions: ReturnType<typeof sanctionCoalitions>;
}

/** Nations sharing a land border or a sea zone with `iso` (cached per turn). */
export function neighboursOf(world: World, state: GameState, iso: Iso3): Set<Iso3> {
  const set = new Set<Iso3>();
  for (const r of Object.values(state.regions)) {
    if (r.controller !== iso) continue;
    for (const nb of world.regions.get(r.id)!.neighbours) {
      const m = world.regions.get(nb)!;
      if (m.sea) {
        for (const nn of m.neighbours) {
          const c = state.regions[nn]?.controller;
          if (c && c !== iso) set.add(c);
        }
      } else {
        const c = state.regions[nb]?.controller;
        if (c && c !== iso) set.add(c);
      }
    }
  }
  return set;
}

export function runAi(world: World, state: GameState): void {
  invalidateGeoCache(state);
  const ctx: Ctx = { byRegion: new Map(), power: new Map(), coalitions: sanctionCoalitions(state) };
  for (const u of Object.values(state.units)) {
    const list = ctx.byRegion.get(u.region) ?? [];
    list.push(u);
    ctx.byRegion.set(u.region, list);
  }
  for (const n of Object.values(state.nations))
    if (n.alive) ctx.power.set(n.iso3, militaryPower(world, state, n.iso3));
  for (const n of Object.values(state.nations)) {
    if (!n.alive || n.iso3 === state.player) continue;
    aiNation(world, state, ctx, n.iso3);
  }
  // Expire stale proposals to the player.
  state.proposals = state.proposals.filter((p) => state.turn - p.turn < 3);
}

function aiNation(world: World, state: GameState, ctx: Ctx, iso: Iso3): void {
  const n = state.nations[iso]!;
  const t = traitsOf(world, iso, state);
  const meta = world.nations.get(iso)!;
  const enemies = enemiesOf(state, iso);
  const atWarNow = enemies.length > 0;
  const myPower = ctx.power.get(iso) ?? 1;
  const neighbours = neighboursOf(world, state, iso);
  // Threat: hostile neighbours' power relative to mine.
  let threat = 0;
  let mainThreat: Iso3 | null = null;
  for (const other of neighbours) {
    const rel = getRelation(world, state, iso, other);
    if (rel > -30 && !atWar(state, iso, other)) continue;
    const th =
      ((ctx.power.get(other) ?? 0) / Math.max(1, myPower)) * (atWar(state, iso, other) ? 1.5 : 1);
    if (th > threat) {
      threat = th;
      mainThreat = other;
    }
  }
  const held = controlShare(world, state, iso);

  // 1. Budget -----------------------------------------------------------------------------------
  let military =
    10 +
    t.aggression * 0.15 +
    (atWarNow ? 18 : 0) +
    Math.min(15, threat * 6) +
    (meta.major ? 3 : 0) +
    // A war plan in preparation and a balancing coalition both mean rearmament (D-071).
    (state.warPlans?.[iso] && state.warPlans[iso].readiness >= 0.5 && state.warPlans[iso].readiness < 1 ? 6 : 0) +
    (state.coalition?.members.includes(iso) ? 5 : 0);
  const research = 5 + t.economicPriority * 0.08 + (meta.major ? 4 : 0);
  let infrastructure = 16 + t.economicPriority * 0.06;
  const debt = n.debt / Math.max(1, n.gdp) > 1 ? 10 : 6;
  let social = 100 - military - research - infrastructure - debt;
  if (n.stability < 40) {
    social += 8;
    military -= 4;
    infrastructure -= 4;
  }
  if (social < 10) {
    const over = 10 - social;
    social = 10;
    military -= over;
  }
  const sum = military + research + infrastructure + debt + social;
  n.budget = {
    military: Math.round((military / sum) * 100),
    research: Math.round((research / sum) * 100),
    infrastructure: Math.round((infrastructure / sum) * 100),
    debt: Math.round((debt / sum) * 100),
    social: 0,
  };
  n.budget.social =
    100 - n.budget.military - n.budget.research - n.budget.infrastructure - n.budget.debt;

  // 2. Mobilization ---------------------------------------------------------------------------------
  if (atWarNow) {
    const majorEnemy = enemies.some((e) => world.nations.get(e)?.major);
    n.mobilization = held < 0.8 ? 2 : majorEnemy || threat > 0.8 ? 1 : n.mobilization;
  } else if (threat > 1.5 && t.paranoia > 55) n.mobilization = 1;
  else if (n.mobilization > 0 && n.warWeariness < 20) n.mobilization = n.mobilization === 2 ? 1 : 0;

  // 3. Research ----------------------------------------------------------------------------------------
  if (!n.researchCurrent) {
    const avail = availableTechs(world, state, iso);
    let best: string | null = null;
    let bestScore = -1;
    for (const id of avail) {
      const tech = world.techs.get(id)!;
      const w = (BRANCH_WEIGHTS[tech.branch]?.(t) ?? 1) / tech.tier;
      if (w > bestScore) {
        bestScore = w;
        best = id;
      }
    }
    n.researchCurrent = best;
  }

  // 4. Production ---------------------------------------------------------------------------------------
  const revenue = monthlyRevenue(n, held);
  const reserve = revenue * (atWarNow ? 0.5 : 1.5);
  const upkeep = unitUpkeep(world, state, iso);
  const upkeepCap = ((revenue * n.budget.military) / 100) * 0.85;
  const queuedUpkeep = n.production.reduce(
    (s, p) => s + (world.unitTypes.get(p.type)?.upkeepBn ?? 0),
    0,
  );
  let budgetLeft = n.treasury - reserve;
  let upkeepLeft = upkeepCap - upkeep - queuedUpkeep;
  // Over-extended militaries shed their weakest formation each month.
  if (upkeep > upkeepCap * 1.3 && !atWarNow) {
    const mine = Object.values(state.units).filter((u) => u.owner === iso);
    if (mine.length > 1) {
      const weakest = mine.reduce((a, b) =>
        unitPower(world, state, b, 'defence') < unitPower(world, state, a, 'defence') ? b : a,
      );
      delete state.units[weakest.id];
      invalidateGeoCache(state);
      budgetLeft = -1; // no purchases this month
    }
  }
  const cap = world.capitalRegion.get(iso);
  const coastal = cap !== undefined && (world.regions.get(cap)?.coastal ?? false);
  const landUnits = Object.values(state.units).filter(
    (u) => u.owner === iso && world.unitTypes.get(u.type)?.domain === 'land',
  ).length;
  const airUnits = Object.values(state.units).filter(
    (u) => u.owner === iso && world.unitTypes.get(u.type)?.domain === 'air',
  ).length;
  const seaUnits = Object.values(state.units).filter(
    (u) => u.owner === iso && world.unitTypes.get(u.type)?.domain === 'sea',
  ).length;
  let queued = 0;
  while (queued < 3 && n.production.length < 8 && cap !== undefined) {
    let type: string;
    const r = roll(state);
    if (coastal && seaUnits < landUnits / 6 && r < 0.25)
      type = r < 0.1 ? 'attackSub' : 'destroyerGroup';
    else if (airUnits < landUnits / 5 && r < 0.45) type = r < 0.35 ? 'fighter' : 'drone';
    else if (atWarNow) type = r < 0.6 ? 'mechanized' : r < 0.8 ? 'armored' : 'artillery';
    else type = r < 0.5 ? 'infantry' : r < 0.8 ? 'mechanized' : 'airDefense';
    const cost = unitCost(world, state, iso, type);
    const up = world.unitTypes.get(type)?.upkeepBn ?? 0.1;
    if (cost > budgetLeft || up > upkeepLeft) break;
    n.treasury -= cost;
    budgetLeft -= cost;
    upkeepLeft -= up;
    n.production.push({
      id: state.nextId++,
      type,
      region: cap,
      monthsLeft: buildMonths(world, state, iso, type),
    });
    queued++;
  }

  // 5. Military orders -------------------------------------------------------------------------------------
  const myUnits = Object.values(state.units).filter((u) => u.owner === iso);
  // Orders from earlier months whose next step is no longer possible (a region changed hands, a
  // peace was signed, a strait closed) are dropped so the stack is re-planned below.
  for (const u of myUnits)
    if (u.path.length > 0 && !stepKind(world, state, u, u.region, u.path[0]!)) {
      u.path = [];
      u.prep = 0;
    }
  // Capital defence (D-072): enemy formations next to the capital — wherever they stand, including
  // a co-belligerent's territory — draw reinforcements before anything else moves.
  const garrison =
    atWarNow && cap !== undefined && state.regions[cap]?.controller === iso
      ? defendCapital(world, state, ctx, iso, cap, myUnits)
      : new Set<number>();
  const stacks = new Map<RegionId, Unit[]>();
  for (const u of myUnits) {
    if (u.path.length > 0 || garrison.has(u.id)) continue;
    const list = stacks.get(u.region) ?? [];
    list.push(u);
    stacks.set(u.region, list);
  }
  const frontier: RegionId[] = [];
  const enemyAdjacent = new Map<RegionId, RegionId[]>();
  if (atWarNow) {
    for (const r of Object.values(state.regions)) {
      if (r.controller !== iso) continue;
      const adj = world.regions.get(r.id)!.neighbours.filter((nb) => {
        const c = state.regions[nb]?.controller;
        return c !== undefined && c !== null && atWar(state, iso, c) && isLand(world, nb);
      });
      if (adj.length > 0) {
        frontier.push(r.id);
        enemyAdjacent.set(r.id, adj);
      }
    }
  }
  const attackThreshold = clamp(1.6 - t.riskTolerance / 120 - t.aggression / 400, 1.05, 1.5);
  const strongestEnemy = Math.max(0, ...enemies.map((e) => ctx.power.get(e) ?? 0));
  const onDefensive = held < 0.999 || strongestEnemy > myPower;
  const landTotal =
    myUnits.filter((u) => world.unitTypes.get(u.type)?.domain === 'land').length || 1;
  const landAtFront = myUnits.filter(
    (u) => frontier.includes(u.region) && world.unitTypes.get(u.type)?.domain === 'land',
  ).length;
  const frontSaturated = landAtFront / landTotal > 0.6;
  for (const [region, stack] of stacks) {
    const land = stack.filter((u) => world.unitTypes.get(u.type)?.domain === 'land');
    const sea = stack.filter((u) => world.unitTypes.get(u.type)?.domain === 'sea');
    const air = stack.filter((u) => world.unitTypes.get(u.type)?.domain === 'air');
    if (atWarNow) {
      if (land.length > 0 && isLand(world, region)) {
        // Attack an adjacent enemy region if the odds are good.
        const targets = enemyAdjacent.get(region) ?? [];
        const amphib = findAmphibTargets(world, state, region, iso, land);
        let best: { target: RegionId; ratio: number } | null = null;
        // The capital on the front line keeps a strong garrison; elsewhere one unit stays behind.
        const capitalFront = region === cap && targets.length > 0;
        const keep = capitalFront ? Math.max(1, Math.ceil(land.length * 0.6)) : 1;
        const movers =
          land.length > 1 && targets.length > 0
            ? land.slice(0, Math.max(1, land.length - keep))
            : land;
        for (const target of [...targets, ...amphib]) {
          if (capitalFront && land.length - movers.length < 1) continue;
          const odds = estimateOdds(
            world,
            state,
            movers.map((u) => u.id),
            target,
          );
          // On the defensive (own land occupied or facing a stronger enemy), a nation liberates its
          // own regions but invades the enemy's homeland only at overwhelming odds (D-072).
          const owner = state.regions[target]?.owner;
          const ownLand = owner === iso;
          if (!ownLand && onDefensive && held < 0.999) continue;
          const need = ownLand || !onDefensive ? attackThreshold : Math.max(2.2, attackThreshold * 1.8);
          if (odds.ratio >= need && (!best || odds.ratio > best.ratio))
            best = { target, ratio: odds.ratio };
        }
        if (best) {
          for (const u of movers)
            if (stepKind(world, state, u, u.region, best.target)) u.path = [best.target];
          n.aiNote = `Attacking ${world.regions.get(best.target)!.name} at ${best.ratio === Infinity ? 'no' : best.ratio.toFixed(1) + ':1'} odds.`;
          continue;
        }
        // Otherwise reinforce the weakest frontier region.
        if (
          frontier.length > 0 &&
          !frontier.includes(region) &&
          !frontSaturated &&
          roll(state) < 0.7
        ) {
          let weakest: RegionId | null = null;
          let worst = Infinity;
          for (const f of frontier) {
            const defenders = (ctx.byRegion.get(f) ?? []).filter((u) => u.owner === iso).length;
            const threatN = (enemyAdjacent.get(f) ?? []).reduce(
              (s, e) =>
                s + (ctx.byRegion.get(e) ?? []).filter((u) => atWar(state, u.owner, iso)).length,
              0,
            );
            const score = defenders - threatN * 1.5;
            if (score < worst) {
              worst = score;
              weakest = f;
            }
          }
          if (weakest !== null) {
            const probe = findPath(world, state, land[0]!, weakest, 8);
            if (probe && probe.length > 0)
              for (const u of land)
                if (stepKind(world, state, u, u.region, probe[0]!)) u.path = [...probe];
          }
        }
      }
      if (sea.length > 0) {
        // Move fleets toward enemy coasts if stronger than what is there.
        const enemyCoastZones: RegionId[] = [];
        for (const r of Object.values(state.regions)) {
          if (!r.controller || !atWar(state, iso, r.controller)) continue;
          for (const nb of world.regions.get(r.id)!.neighbours)
            if (world.regions.get(nb)?.sea && !enemyCoastZones.includes(nb))
              enemyCoastZones.push(nb);
        }
        if (enemyCoastZones.length > 0 && roll(state) < 0.5) {
          const myNaval = sea.reduce((s, u) => s + unitPower(world, state, u, 'attack'), 0);
          let best: RegionId | null = null;
          let bestD = Infinity;
          for (const z of enemyCoastZones) {
            const enemyNaval = (ctx.byRegion.get(z) ?? [])
              .filter((u) => atWar(state, u.owner, iso))
              .reduce((s, u) => s + unitPower(world, state, u, 'defence'), 0);
            if (enemyNaval > myNaval * 0.8) continue;
            const path = findPath(world, state, sea[0]!, z, 8);
            if (path && path.length < bestD) {
              bestD = path.length;
              best = z;
            }
          }
          if (best !== null) {
            const path = findPath(world, state, sea[0]!, best, 8);
            if (path) for (const u of sea) u.path = [...path];
          }
        }
      }
      if (
        air.length > 0 &&
        frontier.length > 0 &&
        !frontier.includes(region) &&
        roll(state) < 0.5
      ) {
        const target = frontier[Math.floor(roll(state) * frontier.length)]!;
        const path = findPath(world, state, air[0]!, target, 10);
        if (path) for (const u of air) u.path = [...path];
      }
      for (const u of air) u.mission = pickMission(world, state, u, true);
    } else if (air.length > 0) {
      for (const u of air) u.mission = pickMission(world, state, u, false);
    }
    if (!atWarNow && mainThreat && land.length > 2 && roll(state) < 0.15) {
      // Peacetime: garrison the border with the main threat.
      const border = Object.values(state.regions).filter(
        (r) =>
          r.controller === iso &&
          world.regions
            .get(r.id)!
            .neighbours.some((nb) => state.regions[nb]?.controller === mainThreat),
      );
      if (border.length > 0) {
        const target = border[Math.floor(roll(state) * border.length)]!.id;
        if (target !== region) {
          const path = findPath(world, state, land[0]!, target, 8);
          if (path && path.length > 0)
            for (const u of land.slice(0, Math.ceil(land.length / 2)))
              if (stepKind(world, state, u, u.region, path[0]!)) u.path = [...path];
        }
      }
    }
  }

  // 5b. Strategic operations (D-059) -------------------------------------------------------------------------
  strategicOperations(world, state, ctx, iso, enemies, mainThreat);

  // 6. Diplomacy -------------------------------------------------------------------------------------------
  const candidates = new Set<Iso3>([
    ...neighbours,
    ...world.majors,
    ...alliesOf(world, state, iso),
  ]);
  candidates.delete(iso);
  for (const other of candidates) {
    const on = state.nations[other];
    if (!on?.alive) continue;
    const rel = getRelation(world, state, iso, other);
    const isPlayer = other === state.player;
    // Alliance / defence pacts.
    if (
      rel >= 50 &&
      !hasTreaty(state, iso, other, 'defensive') &&
      !hasTreaty(state, iso, other, 'alliance') &&
      roll(state) < 0.04 + t.allianceLoyalty / 2500
    ) {
      const sharedThreat =
        mainThreat !== null && getRelation(world, state, other, mainThreat) < -20;
      if (sharedThreat || t.paranoia > 55) {
        propose(
          world,
          state,
          iso,
          other,
          'defensive',
          `${nationName(world, iso)} seeks a defensive pact against ${mainThreat ? nationName(world, mainThreat) : 'rising threats'}.`,
        );
        continue;
      }
    }
    if (
      rel >= 20 &&
      !hasTreaty(state, iso, other, 'trade') &&
      !atWar(state, iso, other) &&
      roll(state) < (other === state.player ? 0.006 : 0.015) + t.economicPriority / 6000
    ) {
      propose(
        world,
        state,
        iso,
        other,
        'trade',
        `${nationName(world, iso)} proposes a trade agreement to deepen economic ties.`,
      );
      continue;
    }
    // Sanctions against hostile majors — unless the trade at stake is too valuable (D-061).
    if (
      rel <= -50 &&
      world.nations.get(other)?.major &&
      !state.sanctions.includes(`${iso}>${other}`) &&
      n.gdp > on.gdp * 0.3 &&
      t.aggression >= 45 &&
      (baseVolume(world, iso, other) / Math.max(1, n.gdp) < 0.025 || t.aggression >= 70) &&
      roll(state) < 0.02
    ) {
      n.aiNote = `Sanctioning ${nationName(world, other)} over hostile relations (${Math.round(rel)}).`;
      executeProposal(world, state, iso, other, 'sanction');
      continue;
    }
    // Peace when weary or losing.
    if (atWar(state, iso, other) && (n.warWeariness >= 70 || held < 0.5) && roll(state) < 0.25) {
      const type: ProposalType =
        held < controlShare(world, state, other) - 0.1 ? 'peaceStatusQuo' : 'peaceWhite';
      if (isPlayer)
        propose(
          world,
          state,
          iso,
          other,
          type,
          `${nationName(world, iso)} sues for peace: ${n.warWeariness >= 60 ? 'its public has tired of the war' : 'the front is collapsing'}.`,
        );
      else {
        n.aiNote = `Seeking peace with ${nationName(world, other)} (weariness ${Math.round(n.warWeariness)}).`;
        executeProposal(world, state, iso, other, type);
      }
      continue;
    }
    // War. Majors go to war only through their war plans (strategy.ts, D-071); minors keep the
    // opportunistic rule but never attack an ally.
    if (
      !meta.major &&
      !atWar(state, iso, other) &&
      !alliesOf(world, state, iso).includes(other) &&
      rel <= -60 &&
      neighbours.has(other) &&
      !hasTreaty(state, iso, other, 'nap')
    ) {
      const theirBloc = [other, ...alliesOf(world, state, other)].reduce(
        (s, x) => s + (ctx.power.get(x) ?? 0) * (x === other ? 1 : 0.4),
        0,
      );
      const ratio = myPower / Math.max(1, theirBloc);
      const need = 1.6 - t.riskTolerance / 150;
      const flash = Math.max(
        0,
        ...world.flashpoints
          .filter((f) => f.nations.includes(iso) && f.nations.includes(other))
          .map((f) => state.flashpoints[f.id] ?? 0),
      );
      let p = (t.aggression / 100) ** 2 * 0.04 * (flash >= 75 ? 4 : flash >= 60 ? 2 : 1);
      if (on.warheads > 0) p *= n.warheads > 0 ? 0.5 : 0.15;
      if (atWarNow) p *= 0.3;
      if (ratio >= need && roll(state) < p) {
        n.aiNote = `${nationName(world, iso)} judges the balance of forces (${ratio.toFixed(1)}:1) favourable and relations (${Math.round(rel)}) beyond repair.`;
        executeProposal(world, state, iso, other, 'declareWar');
        break;
      }
    }
  }

  // 6a. Requests to the player (D-071): a nation at war asks a friendly player for arms.
  if (atWarNow && (state.turn + iso.charCodeAt(0)) % 6 === 0 && state.nations[state.player]?.alive) {
    const p = state.player;
    const friendly = getRelation(world, state, iso, p) >= 30 && !enemies.includes(p) && !enemies.some((e) => alliesOf(world, state, p).includes(e));
    if (friendly && !state.proposals.some((x) => x.from === iso && x.type === 'deal')) {
      const units = held < 0.8 ? 3 : 2;
      const deal: Deal = { from: iso, to: p, give: [], get: [{ kind: 'arms', units }] };
      propose(world, state, iso, p, 'deal', `${nationName(world, iso)} asks for ${units} brigades of arms for its war with ${nationName(world, enemies[0]!)}.`, deal);
      issueDispatch(world, state, iso, p, 'request', `Our soldiers are holding the line against ${nationName(world, enemies[0]!)}; they need weapons.`);
    }
  }

  // 6b. Economic statecraft (D-061) ---------------------------------------------------------------------
  // War bonds when fighting and short of cash.
  if (atWarNow && n.treasury < revenue * 2 && canIssueWarBonds(state, iso) === null && roll(state) < 0.3)
    issueWarBonds(world, state, iso);
  // Join sanctions coalitions led by a friendly major.
  for (const c of ctx.coalitions) {
    if (c.target === iso || c.members.includes(iso) || !state.nations[c.target]?.alive) continue;
    const leader = c.members.find((m) => world.nations.get(m)?.major && getRelation(world, state, iso, m) >= 40);
    if (!leader || atWar(state, iso, c.target) || getRelation(world, state, iso, c.target) > -25) continue;
    if (roll(state) < 0.03 && coalitionReply(world, state, leader, iso, c.target).joins) {
      n.aiNote = `Joining ${nationName(world, leader)}'s sanctions on ${nationName(world, c.target)}.`;
      executeProposal(world, state, iso, c.target, 'sanction');
      break;
    }
  }
  // Lift sanctions on nations it has warmed to; embargo bitter enemies.
  for (const key of state.sanctions) {
    if (!key.startsWith(`${iso}>`)) continue;
    const target = key.slice(iso.length + 1);
    const rel = getRelation(world, state, iso, target);
    if (rel > 10 && !atWar(state, iso, target) && roll(state) < 0.04) {
      n.aiNote = `Lifting sanctions on ${nationName(world, target)} as relations recover (${Math.round(rel)}).`;
      executeProposal(world, state, iso, target, 'liftSanction');
      break;
    }
    if (rel <= -80 && t.aggression >= 60 && !state.embargoes.includes(key) && !atWar(state, iso, target) && roll(state) < 0.01) {
      n.aiNote = `Embargoing ${nationName(world, target)}: relations ${Math.round(rel)}.`;
      imposeEmbargo(world, state, iso, target);
      break;
    }
  }

  // 7. Nuclear use (D-076): only at DEFCON 1, when desperation passes the leader's threshold
  // (raised by an enemy's assured second strike).
  if (n.warheads > 0 && n.defcon === 1 && atWarNow) {
    const d = nuclearDecision(world, state, iso);
    if (d.consider && d.target && roll(state) < AI_LAUNCH_CHANCE) {
      const region = pickStrikeTarget(world, state, d.target);
      if (region !== null) {
        n.aiNote = `Facing national collapse, ${nationName(world, iso)} crosses the nuclear threshold. ${d.reason}`;
        nuclearStrike(world, state, iso, d.target, region);
      }
    }
  }

  if (!n.aiNote || roll(state) < 0.3) {
    n.aiNote = atWarNow
      ? `At war with ${enemies.map((e) => nationName(world, e)).join(', ')}; holding ${Math.round(held * 100)}% of home territory.`
      : mainThreat
        ? `Watching ${nationName(world, mainThreat)} (threat ${threat.toFixed(1)}×); military budget ${n.budget.military}%.`
        : `Focused on the economy (growth ${n.growth.toFixed(1)}%); military budget ${n.budget.military}%.`;
  }
}

/**
 * Capital defence (D-072). Returns the ids of the formations that must hold the capital this month
 * (empty when it is not threatened). Enemy formations next to the capital count wherever they
 * stand — including a co-belligerent's territory. The garrison holds; reinforcements come from
 * the nearest regions, each keeping at least one formation.
 */
function defendCapital(world: World, state: GameState, ctx: Ctx, iso: Iso3, cap: RegionId, myUnits: Unit[]): Set<number> {
  const isLandUnit = (u: Unit) => world.unitTypes.get(u.type)?.domain === 'land';
  let threat = 0;
  for (const nb of world.regions.get(cap)!.neighbours)
    for (const u of ctx.byRegion.get(nb) ?? []) if (isLandUnit(u) && atWar(state, u.owner, iso)) threat += unitPower(world, state, u, 'attack');
  const garrison = new Set<number>();
  if (threat <= 0) return garrison;
  // Capital and home-soil bonuses make 1.1× the attackers' raw power a safe garrison.
  const need = threat * 1.1;
  let defence = 0;
  const atCap = myUnits.filter((u) => u.region === cap && isLandUnit(u)).sort((a, b) => unitPower(world, state, b, 'defence') - unitPower(world, state, a, 'defence') || a.id - b.id);
  // The whole garrison stands fast while the threat lasts.
  for (const u of atCap) {
    u.path = [];
    garrison.add(u.id);
    defence += unitPower(world, state, u, 'defence');
  }
  if (defence >= need) return garrison;
  // Reinforcements: nearest regions first, each keeping at least one formation.
  const byRegion = new Map<RegionId, Unit[]>();
  for (const u of myUnits) {
    if (!isLandUnit(u) || u.region === cap || state.regions[u.region]?.controller !== iso) continue;
    const l = byRegion.get(u.region);
    if (l) l.push(u);
    else byRegion.set(u.region, [u]);
  }
  const capMeta = world.regions.get(cap)!;
  const regions = [...byRegion.keys()].sort((a, b) => Number(capMeta.neighbours.includes(b)) - Number(capMeta.neighbours.includes(a)) || a - b);
  for (const r of regions) {
    if (defence >= need) break;
    const units = byRegion.get(r)!.sort((a, b) => a.id - b.id);
    for (const u of units.slice(1)) {
      if (defence >= need) break;
      const path = findPath(world, state, u, cap, 3);
      if (!path || path.length === 0) continue;
      u.path = path;
      defence += unitPower(world, state, u, 'defence');
    }
  }
  return garrison;
}

/** Mission for an air wing: fighters sweep or support, bombers bomb, drones watch (D-059). */
function pickMission(world: World, state: GameState, u: Unit, atWarNow: boolean): AirMission {
  const allowed = missionsFor(u.type);
  if (allowed.length === 0) return 'superiority';
  const t = world.unitTypes.get(u.type)!;
  const enemyInRange = atWarNow
    ? regionsInRange(world, u.region, Math.max(1, t.range)).some((r) => {
        const c = state.regions[r]?.controller;
        return !!c && atWar(state, u.owner, c);
      })
    : false;
  const r = roll(state);
  let m: AirMission;
  if (!atWarNow || !enemyInRange) m = u.type === 'drone' && r < 0.5 ? 'recon' : u.type === 'bomber' ? 'bombing' : 'superiority';
  else if (u.type === 'fighter') m = r < 0.55 ? 'superiority' : r < 0.85 ? 'cas' : 'interdiction';
  else if (u.type === 'bomber') m = r < 0.6 ? 'bombing' : r < 0.85 ? 'interdiction' : 'cas';
  else m = r < 0.35 ? 'recon' : r < 0.75 ? 'cas' : 'interdiction';
  return allowed.includes(m) ? m : allowed[0]!;
}

/** Missile strikes, cyber operations, satellites, ASAT and spies, weighted by traits. */
function strategicOperations(
  world: World,
  state: GameState,
  ctx: Ctx,
  iso: Iso3,
  enemies: Iso3[],
  mainThreat: Iso3 | null,
): void {
  const n = state.nations[iso]!;
  const t = traitsOf(world, iso, state);
  const meta = world.nations.get(iso)!;
  // Missile strikes on the enemy region with the most troops next to our lines, or its industry.
  if (enemies.length > 0 && n.missiles >= SALVO && roll(state) < 0.15 + t.aggression / 400) {
    let best: RegionId | null = null;
    let bestScore = 0;
    for (const r of Object.values(state.regions)) {
      if (!r.controller || !enemies.includes(r.controller) || !isLand(world, r.id)) continue;
      const troops = (ctx.byRegion.get(r.id) ?? []).filter((u) => u.owner === r.controller).length;
      const share = world.regions.get(r.id)!.populationShare;
      const score = troops * 2 + share * 40 - r.devastation * 10;
      if (score > bestScore) {
        bestScore = score;
        best = r.id;
      }
    }
    if (best !== null && canMissileStrike(world, state, iso, best) === null) {
      const troops = (ctx.byRegion.get(best) ?? []).length;
      const kind: StrikeKind = troops >= 3 ? 'military' : roll(state) < 0.5 ? 'infrastructure' : 'industry';
      applyMissileStrike(world, state, iso, best, kind);
      n.aiNote = `Striking ${world.regions.get(best)!.name} with cruise missiles (${kind}).`;
    }
  }
  // Cyber operations against enemies and hostile majors.
  if (n.cyberCooldown === 0 && (meta.major || (n.modifiers.cyberAttack ?? 0) > 0)) {
    const targets = [...enemies, ...(mainThreat ? [mainThreat] : [])].filter(
      (x) => state.nations[x]?.alive && (atWar(state, iso, x) || getRelation(world, state, iso, x) <= -60),
    );
    const target = targets[Math.floor(roll(state) * Math.max(1, targets.length))];
    if (target && roll(state) < 0.08 + t.paranoia / 1000 && canCyberOp(world, state, iso, target) === null) {
      const r = roll(state);
      const kind: CyberKind = r < 0.4 ? 'economy' : r < 0.7 ? 'intel' : 'production';
      applyCyberOp(world, state, iso, target, kind);
    }
  }
  // Satellites: great powers keep a constellation; everyone replaces losses when rich.
  if (
    n.satellites < (meta.major ? 10 : 3) &&
    n.treasury > satelliteCost(state, iso) * 6 &&
    roll(state) < (meta.major ? 0.08 : 0.02) &&
    canLaunchSatellite(state, iso) === null
  )
    applyLaunchSatellite(world, state, iso);
  // ASAT: only with the tech, only at war, only against a real constellation.
  if (enemies.length > 0 && n.techs.includes('space-counterspace') && roll(state) < 0.06 + t.riskTolerance / 1000) {
    const target = enemies.find((e) => (state.nations[e]?.satellites ?? 0) >= 3 && canAsat(world, state, iso, e) === null);
    if (target) {
      applyAsat(world, state, iso, target);
      n.aiNote = `Blinding ${nationName(world, target)} from orbit.`;
    }
  }
  // Spies on the main threat.
  if (mainThreat && meta.major && !(n.intelOps[mainThreat] ?? 0) && roll(state) < 0.04 && canSpyOp(world, state, iso, mainThreat) === null)
    applySpyOp(world, state, iso, mainThreat);
}

/** Enemy coastal regions the stack could land in under the amphibious rules (D-051). */
function findAmphibTargets(
  world: World,
  state: GameState,
  region: RegionId,
  iso: Iso3,
  land: Unit[],
): RegionId[] {
  if (!(world.regions.get(region)?.coastal ?? false)) return [];
  const type = land.find((u) => world.unitTypes.get(u.type)?.amphibious)?.type ?? land[0]?.type;
  return amphibiousTargets(world, state, region, iso, type).filter((t) => {
    const c = state.regions[t]?.controller;
    return !!c && atWar(state, iso, c);
  });
}

/** AI→AI proposals resolve immediately; AI→player proposals wait for the player's answer. */
function propose(
  world: World,
  state: GameState,
  from: Iso3,
  to: Iso3,
  type: ProposalType,
  text: string,
  deal?: Deal,
): void {
  if (to === state.player) {
    if (
      state.proposals.length >= 4 ||
      state.proposals.some((p) => p.from === from && p.type === type)
    )
      return;
    const proposal: Proposal = deal
      ? { id: state.nextId++, from, to, type, turn: state.turn, text, deal }
      : { id: state.nextId++, from, to, type, turn: state.turn, text };
    state.proposals.push(proposal);
    log(state, {
      kind: 'diplomacy',
      text: `${nationName(world, from)} proposes: ${PROPOSAL_LABELS[type]}. ${text}`,
      nations: [from, to],
      alert: true,
    });
    return;
  }
  const verdict = evaluateProposal(world, state, from, to, type);
  if (verdict.accept) executeProposal(world, state, from, to, type);
}

export { isFriendly, isAtWar };
