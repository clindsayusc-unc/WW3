/**
 * The simulation reducer. `applyCommand(world, state, command)` returns a new state; it never
 * mutates its input (the state is cloned once, then mutated internally for speed — D-033).
 */
import { addMonths, isoYearMonth, type YearMonth } from './calendar';
import { createGame as buildGame, START_DATE } from './setup';
import { loadWorld, nationName, type World } from './world';
import type {
  Budget,
  Command,
  GameState,
  NewGameOptions,
  ProposalType,
  RegionId,
  TurnSummary,
} from './types';
import {
  DEFAULT_TAX_RATE,
  TAX_MAX,
  TAX_MIN,
  buildMonths,
  issueWarBonds,
  recordHistory,
  runEconomy,
  runProduction,
  unitCost,
} from './economy';
import { econZero, emptyBalances, runTrade } from './trade';
import { runDomestic, scheduleElections } from './domestic';
import { leaderSinceTurn, startingInterest } from './setup';
import { RESOURCE_IDS } from './types';
import { advanceQueue, eraGate, eraGateMet, queueResearch, runResearch, startingTechList, unitLockReason, recomputeModifiers, CALIBRATED_KEYS } from './research';
import { applyShareTech, applyStealTech, runTechWar, setTechControls } from './techwar';
import {
  checkCapitulations,
  findPath,
  runAttrition,
  runCombat,
  runMovement,
  runRecovery,
  runSupply,
} from './military';
import { applyChokepointCommand, updateChokepoints } from './geography';
import { missionsFor, runAirOperations } from './air';
import { runBlockades, runCommerceRaiding, runNavalCombat } from './naval';
import { runIntelTick } from './intel';
import {
  applyAsat,
  applyCyberOp,
  applyLaunchSatellite,
  applyMissileStrike,
  applySpyOp,
  runSpaceTick,
} from './strikes';
import { startingMissiles, startingSatellites } from './setup';
import { decayRelations, executeProposal } from './diplomacy';
import { updateTension, canLaunchNuclear, nuclearStrike, runNuclearAftermath } from './escalation';
import { drawEvents, resolvePendingEvent } from './events';
import { runAi } from './ai';
import { checkVictory, standingStart } from './victory';
import { writeWire } from './news';
import { executeDeal, proposeDeal } from './deals';
import { runStrategy } from './strategy';
import { runAid } from './aid';
import { initBlocs, leaveBloc, runBlocs } from './blocs';
import { castPlayerVote, initUn, runUn, tableResolution } from './un';
import { decayMemories } from './personality';
import { adjustRelation, clamp, controlledRegions, getRelation, log, headline } from './query';

export { START_DATE };
export const MONTHS_PER_TURN = 1;
const LOG_KEEP_TURNS = 24;

export function dateForTurn(turn: number): YearMonth {
  return addMonths(START_DATE, turn * MONTHS_PER_TURN);
}

export function createGame(options: NewGameOptions, world: World = loadWorld()): GameState {
  const state = buildGame(world, options);
  return state;
}

export function applyCommand(world: World, input: GameState, command: Command): GameState {
  const state = structuredClone(input);
  if (state.victory || state.defeat) {
    if (command.type !== 'endTurn') return state;
  }
  const player = state.player;
  const me = state.nations[player]!;
  switch (command.type) {
    case 'endTurn':
      return endTurn(world, state);
    case 'setBudget': {
      me.budget = normaliseBudget(command.budget);
      return state;
    }
    case 'setMobilization':
      if (command.level > me.mobilization)
        state.globalTension = clamp(state.globalTension + (command.level === 2 ? 4 : 2), 0, 100);
      me.mobilization = command.level;
      return state;
    case 'setTaxRate':
      me.taxRate = clamp(Math.round(Number.isFinite(command.rate) ? command.rate : DEFAULT_TAX_RATE), TAX_MIN, TAX_MAX);
      return state;
    case 'issueWarBonds':
      issueWarBonds(world, state, player);
      return state;
    case 'queueProduction': {
      const cost = unitCost(world, state, player, command.unitType);
      if (!Number.isFinite(cost)) throw new Error(`Unknown unit type ${command.unitType}`);
      const locked = unitLockReason(world, state, player, command.unitType);
      if (locked) throw new Error(locked);
      if (state.regions[command.region]?.controller !== player)
        throw new Error('You can only build in regions you control');
      if (me.treasury < cost)
        throw new Error(`Insufficient treasury (${cost.toFixed(1)} bn needed)`);
      me.treasury -= cost;
      me.production.push({
        id: state.nextId++,
        type: command.unitType,
        region: command.region,
        monthsLeft: buildMonths(world, state, player, command.unitType),
      });
      return state;
    }
    case 'cancelProduction': {
      const item = me.production.find((p) => p.id === command.id);
      if (item) {
        me.production = me.production.filter((p) => p.id !== command.id);
        me.treasury += unitCost(world, state, player, item.type) * 0.5;
      }
      return state;
    }
    case 'setResearch': {
      const tech = world.techs.get(command.tech);
      if (!tech) throw new Error('Unknown tech');
      if (me.techs.includes(tech.id)) return state;
      if (!tech.requires.every((r) => me.techs.includes(r)))
        throw new Error('Prerequisites not met');
      if (!eraGateMet(world, tech, me))
        throw new Error(`Needs ${eraGate(world, tech)} technologies of the previous era first`);
      me.researchCurrent = tech.id;
      me.researchQueue = me.researchQueue.filter((id) => id !== tech.id);
      return state;
    }
    case 'queueResearch':
      queueResearch(world, state, player, command.tech, command.append ?? false);
      return state;
    case 'setResearchQueue':
      me.researchQueue = command.queue.filter((id, i) => world.techs.has(id) && !me.techs.includes(id) && command.queue.indexOf(id) === i);
      advanceQueue(world, state, player);
      return state;
    case 'stealTech':
      applyStealTech(world, state, player, command.target, command.tech);
      return state;
    case 'shareTech':
      applyShareTech(world, state, player, command.to, command.tech);
      return state;
    case 'techControls':
      setTechControls(world, state, player, command.target, command.on);
      return state;
    case 'moveUnits': {
      for (const id of command.unitIds) {
        const u = state.units[id];
        if (!u || u.owner !== player) continue;
        const path = findPath(world, state, u, command.target);
        if (path) {
          // A new destination restarts amphibious preparation unless the first hop is unchanged.
          if (u.path[0] !== path[0]) u.prep = 0;
          u.path = path;
        }
      }
      return state;
    }
    case 'setAirMission': {
      for (const id of command.unitIds) {
        const u = state.units[id];
        if (!u || u.owner !== player) continue;
        if (!missionsFor(u.type).includes(command.mission)) continue;
        u.mission = command.mission;
      }
      return state;
    }
    case 'missileStrike':
      applyMissileStrike(world, state, player, command.region, command.kind, command.hypersonic ?? false);
      return state;
    case 'cyberOp':
      applyCyberOp(world, state, player, command.target, command.kind);
      return state;
    case 'spyOp':
      applySpyOp(world, state, player, command.target);
      return state;
    case 'launchSatellite':
      applyLaunchSatellite(world, state, player);
      return state;
    case 'asat':
      applyAsat(world, state, player, command.target);
      return state;
    case 'disband':
      for (const id of command.unitIds)
        if (state.units[id]?.owner === player) delete state.units[id];
      return state;
    case 'propose': {
      if (command.target === player) return state;
      if (!state.nations[command.target]?.alive) throw new Error('That nation no longer exists');
      if (command.proposal === 'resolution') {
        runResolutionVote(world, state);
        return state;
      }
      executeProposal(world, state, player, command.target, command.proposal);
      return state;
    }
    case 'respond': {
      const p = state.proposals.find((x) => x.id === command.proposalId);
      if (!p) return state;
      state.proposals = state.proposals.filter((x) => x.id !== command.proposalId);
      if (command.accept && p.type === 'deal' && p.deal) {
        executeDeal(world, state, p.deal);
      } else if (command.accept) {
        // The player's acceptance is final: execute without re-evaluating the AI side.
        executeAccepted(world, state, p.from, p.to, p.type);
      } else {
        adjustRelation(world, state, p.from, p.to, -4);
        log(state, {
          kind: 'diplomacy',
          text: `You declined ${nationName(world, p.from)}'s proposal.`,
          nations: [p.from],
          alert: false,
        });
      }
      return state;
    }
    case 'resolveEvent':
      resolvePendingEvent(world, state, command.pendingId, command.choice);
      return state;
    case 'chokepoint':
      applyChokepointCommand(world, state, player, command.id, command.action);
      updateChokepoints(world, state);
      return state;
    case 'proposeDeal': {
      if (command.deal.from !== player || command.deal.to === player) return state;
      proposeDeal(world, state, command.deal);
      return state;
    }
    case 'unPropose':
      tableResolution(world, state, player, command.kind, command.target);
      return state;
    case 'unVote':
      castPlayerVote(state, command.resolutionId, command.vote);
      return state;
    case 'setAid': {
      const level = clamp(Math.round(Number.isFinite(command.level) ? command.level : 0), 0, 3);
      if (level === 0) delete state.playerAid[command.recipient];
      else if (command.recipient !== player && state.nations[command.recipient]?.alive) state.playerAid[command.recipient] = level;
      return state;
    }
    case 'leaveBloc':
      leaveBloc(world, state, player, command.bloc);
      return state;
    case 'nuclearStrike': {
      // Release needs DEFCON 1 and two separate confirmations from the commander (D-076).
      if (!(command.confirmations >= 2)) throw new Error('Nuclear release requires two confirmations.');
      const why = canLaunchNuclear(state, player, command.target);
      if (why) throw new Error(why);
      nuclearStrike(world, state, player, command.target, command.region);
      checkVictory(world, state);
      return state;
    }
  }
}

function executeAccepted(
  world: World,
  state: GameState,
  from: string,
  to: string,
  type: ProposalType,
): void {
  // Reuse executeProposal but force acceptance by temporarily boosting relations is hacky;
  // instead replicate the acceptance branch via a very friendly evaluation: the proposer already agreed.
  const saved = state.relations[from < to ? `${from}|${to}` : `${to}|${from}`];
  const key = from < to ? `${from}|${to}` : `${to}|${from}`;
  // The player is `to`; `executeProposal` evaluates `to`'s (the player's) verdict, so make it accept.
  state.relations[key] = 100;
  const st = state.nations[to]!;
  const weary = st.warWeariness;
  st.warWeariness = 100; // guarantees peace acceptance
  executeProposal(world, state, from, to, type);
  st.warWeariness = weary;
  state.relations[key] = saved === undefined ? getRelation(world, state, from, to) : saved;
  adjustRelation(world, state, from, to, type === 'trade' ? 8 : type === 'nap' ? 10 : 15);
}

function normaliseBudget(b: Budget): Budget {
  const keys = ['military', 'research', 'infrastructure', 'social', 'debt'] as const;
  const clean = { ...b };
  for (const k of keys)
    clean[k] = clamp(Math.round(Number.isFinite(clean[k]) ? clean[k] : 0), 0, 100);
  const sum = keys.reduce((s, k) => s + clean[k], 0) || 1;
  for (const k of keys) clean[k] = Math.round((clean[k] / sum) * 100);
  const diff = 100 - keys.reduce((s, k) => s + clean[k], 0);
  clean.social = clamp(clean.social + diff, 0, 100);
  return clean;
}

/** World Order Resolution: weighted vote of all living nations; P5 members can veto (D-031). */
function runResolutionVote(world: World, state: GameState): void {
  const player = state.player;
  let yes = 0;
  let total = 0;
  let veto: string | null = null;
  for (const n of Object.values(state.nations)) {
    if (!n.alive || n.iso3 === player) continue;
    const gdp = n.gdp;
    total += gdp;
    const rel = getRelation(world, state, player, n.iso3);
    if (rel >= 15) yes += gdp;
    if (['USA', 'CHN', 'RUS', 'GBR', 'FRA'].includes(n.iso3) && rel < -30) veto = n.iso3;
  }
  const share = total > 0 ? yes / total : 0;
  if (veto) {
    log(state, {
      kind: 'diplomacy',
      text: `World Order Resolution vetoed by ${nationName(world, veto)} (${Math.round(share * 100)}% of world GDP in favour).`,
      nations: [player, veto],
      alert: true,
    });
    adjustRelation(world, state, player, veto, -5);
  } else if (share >= 0.6) {
    state.resolutionPassed = true;
    log(state, {
      kind: 'diplomacy',
      text: `World Order Resolution adopted with ${Math.round(share * 100)}% of world GDP in favour.`,
      nations: [player],
      alert: true,
    });
    headline(state, `${nationName(world, player)} wins historic vote on new world order`);
  } else {
    log(state, {
      kind: 'diplomacy',
      text: `World Order Resolution fails: only ${Math.round(share * 100)}% of world GDP in favour (60% needed).`,
      nations: [player],
      alert: true,
    });
  }
  state.nations[player]!.treasury -= state.nations[player]!.gdp * 0.002;
}

export function endTurn(world: World, state: GameState): GameState {
  const player = state.player;
  const before = state.nations[player]!;
  const beforeGdp = before.gdp;
  const beforeTreasury = before.treasury;
  const beforeStability = before.stability;
  const beforeRegions = controlledRegions(state, player).length;
  const beforeControlled = new Set(controlledRegions(state, player));
  state.news = [];
  state.strikes = state.strikes.filter((s) => state.turn - s.turn < 2);
  state.battleReports = state.battleReports.filter((b) => state.turn - b.turn < 1);
  // Unresolved player events pick their first option.
  for (const p of [...state.pendingEvents]) resolvePendingEvent(world, state, p.id, 0);

  // 1. AI decides (budgets, production, orders, diplomacy), then the strategic layer (war plans,
  // balancing coalitions) and foreign aid (D-071, D-072).
  runAi(world, state);
  runStrategy(world, state);
  runAid(world, state);
  // 2. Trade network and resource market, then the economy, domestic politics and production.
  runTrade(world, state);
  runEconomy(world, state);
  runDomestic(world, state);
  runProduction(world, state);
  const techs = runResearch(world, state);
  runTechWar(world, state);
  runSpaceTick(world, state);
  runIntelTick(world, state);
  // 3. Military resolution: supply first (it shapes everything), then the air war, movement,
  // fleet actions, land combat, attrition.
  runSupply(world, state);
  runAirOperations(world, state);
  runMovement(world, state);
  const seaBattles = runNavalCombat(world, state);
  state.battleReports.push(...seaBattles);
  const battles = runCombat(world, state);
  runSupply(world, state);
  runAttrition(world, state);
  runRecovery(world, state, new Set([...battles.map((b) => b.region), ...seaBattles.map((b) => b.region)]));
  runCommerceRaiding(world, state);
  runBlockades(world, state);
  checkCapitulations(world, state);
  updateChokepoints(world, state);
  // 4. Diplomacy drift, blocs, the UN, memory decay, escalation, events.
  decayRelations(world, state);
  runBlocs(world, state);
  runUn(world, state);
  decayMemories(world, state);
  updateTension(world, state);
  runNuclearAftermath(world, state);
  drawEvents(world, state);
  // 5. The month's wire stories (D-077), then advance the calendar.
  writeWire(world, state);
  state.turn += 1;
  state.date = dateForTurn(state.turn);
  state.isoDate = isoYearMonth(state.date);
  recordHistory(world, state);
  checkVictory(world, state);

  const after = state.nations[player]!;
  const afterControlled = controlledRegions(state, player);
  let gained = 0;
  for (const r of afterControlled) if (!beforeControlled.has(r)) gained++;
  const lost = beforeRegions - (afterControlled.length - gained);
  const summary: TurnSummary = {
    turn: state.turn,
    gdpDelta: after.gdp - beforeGdp,
    treasuryDelta: after.treasury - beforeTreasury,
    stabilityDelta: after.stability - beforeStability,
    battles:
      battles.filter((b) => b.attackers.includes(player) || b.defenders.includes(player)).length +
      seaBattles.filter(
        (b) => b.attackers.some((x) => x.nation === player) || b.defenders.some((x) => x.nation === player),
      ).length,
    regionsGained: gained,
    regionsLost: Math.max(0, lost),
    techsCompleted: techs,
    headlines: [...state.news],
  };
  state.summary = summary;
  if (state.news.length === 0) state.news.push(defaultHeadline(world, state));
  // Trim the log.
  state.log = state.log.filter((e) => state.turn - e.turn <= LOG_KEEP_TURNS);
  return state;
}

function defaultHeadline(world: World, state: GameState): string {
  const wars = state.wars.length;
  if (wars === 0) return 'Markets steady as diplomats talk; no major conflicts reported this month';
  const w = state.wars[state.turn % wars]!;
  return `Fighting continues between ${nationName(world, w.attackers[0])} and ${nationName(world, w.defenders[0])}`;
}

/**
 * Saves made before D-049 stored the head of state as the leader. Re-derive each real leader's
 * name and title from data; fictional successors are kept.
 */
export function refreshLeaders(world: World, input: GameState): GameState {
  const state = structuredClone(input);
  // Saves from before D-050 lack supply levels, movement progress and chokepoints.
  for (const r of Object.values(state.regions)) {
    if (typeof r.supply !== 'number') r.supply = r.supplied ? 1 : 0;
  }
  for (const u of Object.values(state.units)) {
    if (typeof u.moveProgress !== 'number') u.moveProgress = 0;
    // Saves from before D-059 lack experience, missions, commanders and prep timers.
    if (typeof u.experience !== 'number') u.experience = 10;
    if (u.mission === undefined) u.mission = world.unitTypes.get(u.type)?.domain === 'air' ? 'superiority' : null;
    if (u.commander === undefined) u.commander = null;
    if (typeof u.prep !== 'number') u.prep = 0;
  }
  for (const r of Object.values(state.regions)) if (typeof r.infraDamage !== 'number') r.infraDamage = 0;
  if (!Array.isArray(state.battleReports)) state.battleReports = [];
  if (typeof state.debris !== 'number') state.debris = 0;
  for (const n of Object.values(state.nations)) {
    const meta = world.nations.get(n.iso3);
    if (typeof n.satellites !== 'number') n.satellites = startingSatellites(meta?.defenceSpendUsdBn ?? 0, n.warheads);
    if (typeof n.missiles !== 'number') n.missiles = startingMissiles(meta?.defenceSpendUsdBn ?? 0);
    if (!n.intelOps) n.intelOps = {};
    if (typeof n.blinded !== 'number') n.blinded = 0;
    if (typeof n.cyberCooldown !== 'number') n.cyberCooldown = 0;
    if (typeof n.productionDelay !== 'number') n.productionDelay = 0;
    if (typeof n.blockaded !== 'boolean') n.blockaded = false;
  }
  if (!state.chokepoints) state.chokepoints = {};
  for (const c of world.chokepoints)
    if (!state.chokepoints[c.id])
      state.chokepoints[c.id] = { status: 'open', by: null, mined: false, minedBy: null, since: 0 };
  if (typeof state.oilPrice !== 'number') state.oilPrice = 1;
  migrateEconomy(world, state);
  migrateDiplomacy(world, state);
  migrateResearch(world, state);
  for (const n of Object.values(state.nations)) {
    if (n.leaderFictional) continue;
    const l = world.leaders.get(n.iso3);
    if (!l) continue;
    n.leaderName = l.name;
    n.leaderTitle = l.title;
  }
  return state;
}

/**
 * Saves from before D-079 used the 41-tech tree and started everyone with no technology: drop
 * unknown ids, grant the January 2027 technologies, and treat the save's world as the baseline.
 */
function migrateResearch(world: World, state: GameState): void {
  state.techControls ??= ['USA>CHN', 'NLD>CHN', 'JPN>CHN'];
  for (const n of Object.values(state.nations)) {
    if (Array.isArray(n.researchQueue)) continue;
    n.researchQueue = [];
    n.techCredit = {};
    n.espionageCooldown = 0;
    n.techs = [...new Set([...startingTechList(world, n.iso3), ...n.techs.filter((id) => world.techs.has(id))])];
    for (let changed = true; changed; ) {
      changed = false;
      n.techs = n.techs.filter((id) => {
        const ok = world.techs.get(id)!.requires.every((r) => n.techs.includes(r));
        if (!ok) changed = true;
        return ok;
      });
    }
    if (n.researchCurrent && (!world.techs.has(n.researchCurrent) || n.techs.includes(n.researchCurrent))) n.researchCurrent = null;
    recomputeModifiers(world, state, n.iso3);
    n.techBaseline = Object.fromEntries(CALIBRATED_KEYS.map((k) => [k, n.modifiers[k] ?? 0]));
  }
}

/** Saves from before D-071 lack memories, blocs, the UN, war plans and aid. */
function migrateDiplomacy(world: World, state: GameState): void {
  state.memory ??= {};
  state.dispatches ??= [];
  state.blocs ??= initBlocs(world);
  state.un ??= initUn(world);
  state.warPlans ??= {};
  state.coalition ??= null;
  state.basing ??= [];
  state.aid ??= [];
  state.aidSuspended ??= [];
  state.playerAid ??= {};
  // D-074–D-077: chains, wire, nuclear aftermath, succession.
  state.chains ??= [];
  state.wire ??= [];
  state.nuclearWinter ??= 0;
  state.nuclearLog ??= [];
  state.worldGdpStart ??= world.nationList.reduce((s, n) => s + n.gdpUsdBn, 0);
  // D-081: saves from before the standing victory measure from the turn they are loaded.
  state.standingStart ??= standingStart(world, state);
  for (const r of Object.values(state.regions)) if (typeof r.fallout !== 'number') r.fallout = 0;
  for (const n of Object.values(state.nations)) {
    if (typeof n.legitimacy !== 'number') n.legitimacy = 50;
    if (typeof n.aidSupply !== 'number') n.aidSupply = 0;
    if (typeof n.aidReceived !== 'number') n.aidReceived = 0;
    if (typeof n.aidArmsBank !== 'number') n.aidArmsBank = 0;
    if (typeof n.leaderSince !== 'number') n.leaderSince = leaderSinceTurn(world.leaders.get(n.iso3)?.since);
    if (typeof n.leaderTermLimited !== 'boolean') n.leaderTermLimited = !n.leaderFictional && world.politics.get(n.iso3)?.incumbentEligible === false;
    // D-078: older saves' successors kept the predecessor's traits; they keep them (null → data).
    if (n.leaderFaction === undefined) n.leaderFaction = world.factions.get(n.iso3)?.incumbent ?? null;
    if (n.leaderTraits === undefined) n.leaderTraits = null;
  }
}

/** Saves from before D-061 lack the trade network, inflation, support and elections. */
function migrateEconomy(world: World, state: GameState): void {
  if (state.economy && state.history) return;
  if (!Array.isArray(state.embargoes)) state.embargoes = [];
  if (!Array.isArray(state.secondarySanctions)) state.secondarySanctions = [];
  state.economy = {
    prices: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 1])) as GameState['economy']['prices'],
    shortage: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as GameState['economy']['shortage'],
    shortageRef: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as GameState['economy']['shortageRef'],
    routes: [],
    routeRef: {},
  };
  state.history = {};
  for (const n of Object.values(state.nations)) {
    const p0 = world.startInflation.get(n.iso3) ?? 3;
    n.potentialGdp = n.gdp;
    n.inflation = p0;
    n.interestRate = startingInterest(p0);
    n.taxRate = DEFAULT_TAX_RATE;
    n.support = 50;
    n.negativeMonths = 0;
    n.recession = false;
    n.resources = emptyBalances();
    n.resourceRef = Object.fromEntries(RESOURCE_IDS.map((r) => [r, 1])) as typeof n.resourceRef;
    n.econ = econZero();
    n.warBonds = 0;
    n.warBondCooldown = 0;
    n.coupRisk = 0;
    n.protestMonths = 0;
    n.monthsSinceDefault = 999;
  }
  // The loaded world becomes the baseline; elections are counted from the current turn.
  runTrade(world, state, true);
  scheduleElections(world, state);
  for (const n of Object.values(state.nations)) if (n.nextElection !== null && n.nextElection < state.turn + 6) n.nextElection = state.turn + 6;
  recordHistory(world, state);
}

/** Convenience for tests and tooling: applies orders then ends the turn. */
export function advanceTurn(world: World, state: GameState, orders: readonly Command[]): GameState {
  let s = state;
  for (const o of orders) s = applyCommand(world, s, o);
  return applyCommand(world, s, { type: 'endTurn' });
}

export type { RegionId };
