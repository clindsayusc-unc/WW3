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
import { runEconomy, runProduction, unitCost, buildMonths } from './economy';
import { runResearch } from './research';
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
import { decayRelations, executeProposal } from './diplomacy';
import { updateTension, canLaunchNuclear, nuclearStrike } from './escalation';
import { drawEvents, resolvePendingEvent } from './events';
import { runAi } from './ai';
import { checkVictory } from './victory';
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
      me.mobilization = command.level;
      if (command.level > 0)
        state.globalTension = clamp(state.globalTension + (command.level === 2 ? 4 : 2), 0, 100);
      return state;
    case 'queueProduction': {
      const cost = unitCost(world, state, player, command.unitType);
      if (!Number.isFinite(cost)) throw new Error(`Unknown unit type ${command.unitType}`);
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
      me.researchCurrent = tech.id;
      return state;
    }
    case 'moveUnits': {
      for (const id of command.unitIds) {
        const u = state.units[id];
        if (!u || u.owner !== player) continue;
        const path = findPath(world, state, u, command.target);
        if (path) u.path = path;
      }
      return state;
    }
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
      if (command.accept) {
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
    case 'nuclearStrike': {
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
  // Unresolved player events pick their first option.
  for (const p of [...state.pendingEvents]) resolvePendingEvent(world, state, p.id, 0);

  // 1. AI decides (budgets, production, orders, diplomacy).
  runAi(world, state);
  // 2. Economy and production.
  runEconomy(world, state);
  runProduction(world, state);
  const techs = runResearch(world, state);
  // 3. Military resolution: supply first (it shapes everything), then movement, combat, attrition.
  runSupply(world, state);
  runMovement(world, state);
  const battles = runCombat(world, state);
  runSupply(world, state);
  runAttrition(world, state);
  runRecovery(world, state, new Set(battles.map((b) => b.region)));
  checkCapitulations(world, state);
  updateChokepoints(world, state);
  // 4. Diplomacy drift, escalation, events.
  decayRelations(world, state);
  updateTension(world, state);
  drawEvents(world, state);
  // 5. Advance the calendar.
  state.turn += 1;
  state.date = dateForTurn(state.turn);
  state.isoDate = isoYearMonth(state.date);
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
    battles: battles.filter((b) => b.attackers.includes(player) || b.defenders.includes(player))
      .length,
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
  for (const u of Object.values(state.units)) if (typeof u.moveProgress !== 'number') u.moveProgress = 0;
  if (!state.chokepoints) state.chokepoints = {};
  for (const c of world.chokepoints)
    if (!state.chokepoints[c.id])
      state.chokepoints[c.id] = { status: 'open', by: null, mined: false, minedBy: null, since: 0 };
  if (typeof state.oilPrice !== 'number') state.oilPrice = 1;
  for (const n of Object.values(state.nations)) {
    if (n.leaderFictional) continue;
    const l = world.leaders.get(n.iso3);
    if (!l) continue;
    n.leaderName = l.name;
    n.leaderTitle = l.title;
  }
  return state;
}

/** Convenience for tests and tooling: applies orders then ends the turn. */
export function advanceTurn(world: World, state: GameState, orders: readonly Command[]): GameState {
  let s = state;
  for (const o of orders) s = applyCommand(world, s, o);
  return applyCommand(world, s, { type: 'endTurn' });
}

export type { RegionId };
