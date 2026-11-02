/** Event deck: conditions, effect DSL, monthly draws (D-030). */
import { nationName, traitsOf, type Condition, type Effect, type EventChoice, type EventMeta, type World } from './world';
import type { GameState, Iso3, PendingEvent } from './types';
import {
  atWar,
  clamp,
  enemiesOf,
  getRelation,
  headline,
  isAtWar,
  log,
  pick,
  pickWeighted,
  roll,
  adjustRelation,
  alliesOf,
  makeUnit,
} from './query';
import { declareWar, imposeSanction, liftSanction, makePeace } from './diplomacy';
import { succeedLeader } from './domestic';
import { adjustLegitimacy } from './personality';

export interface EventContext {
  player: Iso3; // the nation the event is about (PLAYER placeholder)
  target: Iso3 | null; // TARGET placeholder
}

export function resolveIso(ctx: EventContext, ref: string | undefined): Iso3 | null {
  if (!ref) return null;
  if (ref === 'PLAYER') return ctx.player;
  if (ref === 'TARGET') return ctx.target;
  return ref;
}

export function substitute(world: World, ctx: EventContext, text: string): string {
  return text
    .replaceAll('{PLAYER}', nationName(world, ctx.player))
    .replaceAll('{TARGET}', ctx.target ? nationName(world, ctx.target) : 'a rival power');
}

export function checkCondition(
  world: World,
  state: GameState,
  ctx: EventContext,
  c: Condition,
): boolean {
  const nation = resolveIso(ctx, c.nation ?? 'PLAYER');
  const a = resolveIso(ctx, c.a);
  const b = resolveIso(ctx, c.b);
  const num = typeof c.value === 'number' ? c.value : 0;
  const n = nation ? state.nations[nation] : undefined;
  switch (c.type) {
    case 'atWar':
      return !!nation && isAtWar(state, nation) === (c.value !== false);
    case 'atWarWith':
      return !!a && !!b && atWar(state, a, b);
    case 'tensionMin':
      return state.globalTension >= num;
    case 'tensionMax':
      return state.globalTension <= num;
    case 'flashpointMin':
      return (state.flashpoints[c.id ?? ''] ?? 0) >= num;
    case 'flashpointMax':
      return (state.flashpoints[c.id ?? ''] ?? 0) <= num;
    case 'stabilityMax':
      return !!n && n.stability <= num;
    case 'stabilityMin':
      return !!n && n.stability >= num;
    case 'relationMax':
      return !!a && !!b && getRelation(world, state, a, b) <= num;
    case 'relationMin':
      return !!a && !!b && getRelation(world, state, a, b) >= num;
    case 'hasBloc':
      return !!nation && (world.nations.get(nation)?.blocs.includes(c.bloc ?? '') ?? false);
    case 'isNation':
      return !!nation && (c.iso3?.includes(nation) ?? false);
    case 'notNation':
      return !!nation && !(c.iso3?.includes(nation) ?? false);
    case 'hasNukes':
      return !!n && n.warheads > 0 === (c.value !== false);
    case 'minTurn':
      return state.turn >= num;
    case 'maxTurn':
      return state.turn <= num;
    case 'notCapitulated':
      return !!n && n.alive;
    case 'isMajor':
      return !!nation && (world.nations.get(nation)?.major ?? false);
    case 'notMajor':
      return !!nation && !(world.nations.get(nation)?.major ?? false);
    case 'regime':
      return !!nation && world.politics.get(nation)?.regime === c.value;
    default:
      return true;
  }
}

export function applyEffect(world: World, state: GameState, ctx: EventContext, e: Effect): void {
  switch (e.type) {
    case 'relation': {
      const a = resolveIso(ctx, e.a);
      const b = resolveIso(ctx, e.b);
      if (a && b) adjustRelation(world, state, a, b, e.delta);
      break;
    }
    case 'tension':
      state.globalTension = clamp(state.globalTension + e.delta, 0, 100);
      break;
    case 'flashpoint':
      if (e.id in state.flashpoints)
        state.flashpoints[e.id] = clamp(state.flashpoints[e.id]! + e.delta, 0, 100);
      break;
    case 'stability': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n])
        state.nations[n]!.stability = clamp(state.nations[n]!.stability + e.delta, 0, 100);
      break;
    }
    case 'treasury': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n])
        state.nations[n]!.treasury += (state.nations[n]!.gdp * e.pctGdp) / 100;
      break;
    }
    case 'gdp': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n]) state.nations[n]!.gdp *= 1 + e.pct / 100;
      break;
    }
    case 'growth': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n])
        state.nations[n]!.growthMods.push({
          delta: e.delta,
          monthsLeft: e.months,
          reason: 'Event',
        });
      break;
    }
    case 'sanction': {
      const f = resolveIso(ctx, e.from);
      const t = resolveIso(ctx, e.to);
      if (f && t && f !== t) imposeSanction(world, state, f, t);
      break;
    }
    case 'liftSanction': {
      const f = resolveIso(ctx, e.from);
      const t = resolveIso(ctx, e.to);
      if (f && t) liftSanction(world, state, f, t);
      break;
    }
    case 'war': {
      const a = resolveIso(ctx, e.a);
      const b = resolveIso(ctx, e.b);
      if (a && b && a !== b)
        declareWar(world, state, a, b, 'Events on the ground left no other course.');
      break;
    }
    case 'peace': {
      const a = resolveIso(ctx, e.a);
      const b = resolveIso(ctx, e.b);
      if (a && b) makePeace(world, state, a, b, 'white');
      break;
    }
    case 'defcon': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n]) {
        const ns = state.nations[n]!;
        ns.defconMod = clamp(ns.defconMod - e.delta, -2, 2);
        ns.defcon = clamp(ns.defcon + e.delta, 1, 5) as 1 | 2 | 3 | 4 | 5;
      }
      break;
    }
    case 'research': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n])
        state.nations[n]!.researchPoints = Math.max(0, state.nations[n]!.researchPoints + e.points);
      break;
    }
    case 'units': {
      const n = resolveIso(ctx, e.nation);
      if (!n || !state.nations[n] || !world.unitTypes.has(e.unitType)) break;
      const cap = world.capitalRegion.get(n);
      if (cap === undefined) break;
      const t = world.unitTypes.get(e.unitType)!;
      let region = cap;
      if (t.domain === 'sea') {
        const zone = world.regions.get(cap)?.neighbours.find((z) => world.regions.get(z)?.sea);
        if (!zone) break;
        region = zone;
      }
      for (let i = 0; i < e.count; i++) {
        state.units[state.nextId] = makeUnit(state.nextId, e.unitType, n, region, {
          mission: t.domain === 'air' ? 'superiority' : null,
        });
        state.nextId++;
      }
      break;
    }
    case 'mobilize': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n]) state.nations[n]!.mobilization = clamp(e.level, 0, 2) as 0 | 1 | 2;
      break;
    }
    case 'warheads': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n])
        state.nations[n]!.warheads = Math.max(0, state.nations[n]!.warheads + e.delta);
      break;
    }
    case 'news':
      headline(state, substitute(world, ctx, e.text));
      break;
    case 'chain': {
      const next = world.eventById.get(e.event);
      if (!next?.chain) break;
      state.chains.push({ eventId: next.id, chain: next.chain, due: state.turn + Math.max(1, e.delay ?? 1), target: ctx.target });
      break;
    }
    case 'succession': {
      const n = resolveIso(ctx, e.nation);
      if (n) succeedLeader(world, state, n, e.cause);
      break;
    }
    case 'legitimacy': {
      const n = resolveIso(ctx, e.nation);
      if (n) adjustLegitimacy(state, n, e.delta);
      break;
    }
    case 'support': {
      const n = resolveIso(ctx, e.nation);
      if (n && state.nations[n]) state.nations[n]!.support = clamp(state.nations[n]!.support + e.delta, 0, 100);
      break;
    }
  }
}

/**
 * How an AI decision-maker (or fate, for world events) picks a choice (D-074). Outcomes with a
 * `chance` are drawn by chance; otherwise each choice's stance is weighted by the actor's traits:
 * escalation by aggression and risk tolerance, de-escalation by pragmatism and caution.
 */
export function aiChoice(world: World, state: GameState, actor: Iso3, ev: EventMeta): number {
  const choices = ev.choices;
  if (choices.length <= 1) return 0;
  if (choices.some((c) => typeof c.chance === 'number')) {
    const picked = pickWeighted(state, choices, (c) => c.chance ?? 0);
    return picked ? choices.indexOf(picked) : 0;
  }
  const w = stanceWeights(world, actor, state);
  const picked = pickWeighted(state, choices, (c: EventChoice) => w[c.stance ?? 'hold']);
  return picked ? choices.indexOf(picked) : 0;
}

export function stanceWeights(world: World, actor: Iso3, state?: GameState): Record<'escalate' | 'hold' | 'deescalate', number> {
  const t = traitsOf(world, actor, state);
  const sq = (x: number) => (x / 100) ** 2;
  return {
    escalate: sq((t.aggression + t.riskTolerance + t.nationalism) / 3) * 0.8,
    hold: 0.35,
    deescalate: sq((t.pragmatism + (100 - t.riskTolerance) + t.economicPriority) / 3),
  };
}

/** Who decides a chain step: the player when listed, else the first living candidate. */
export function chainActor(state: GameState, ev: EventMeta): Iso3 | null {
  if (ev.actor.includes(state.player) && state.nations[state.player]?.alive) return state.player;
  return ev.actor.find((a) => state.nations[a]?.alive) ?? null;
}

function pendingFor(world: World, ev: EventMeta, ctx: EventContext, state: GameState): PendingEvent {
  return {
    id: `${ev.id}-${state.turn}`,
    eventId: ev.id,
    target: ctx.target,
    title: ev.title,
    text: substitute(world, ctx, ev.text),
    choices: ev.choices.map((c) => ({ label: substitute(world, ctx, c.label), tooltip: substitute(world, ctx, c.tooltip) })),
  };
}

/** Plays one chain event: the player's decision is queued; an AI actor decides at once. */
function playChainEvent(world: World, state: GameState, ev: EventMeta, target: Iso3 | null): void {
  const actor = chainActor(state, ev);
  if (!actor) return; // every candidate is gone: the chain ends
  const ctx: EventContext = { player: actor, target: target ?? (ev.target && state.nations[ev.target]?.alive ? ev.target : null) };
  state.eventsFired[`${ev.id}:${actor}`] = state.turn;
  if (actor === state.player) {
    if (!state.pendingEvents.some((p) => p.eventId === ev.id)) state.pendingEvents.push(pendingFor(world, ev, ctx, state));
    return;
  }
  const idx = aiChoice(world, state, actor, ev);
  const choice = ev.choices[idx]!;
  for (const e of choice.effects) applyEffect(world, state, ctx, e);
  log(state, {
    kind: 'event',
    text: `${ev.title}: ${nationName(world, actor)} chooses "${substitute(world, ctx, choice.label)}". ${substitute(world, ctx, ev.text)}`,
    nations: [actor, ...(ctx.target ? [ctx.target] : [])],
    alert: ev.actor.includes(state.player) || ctx.target === state.player || (world.flashpoints.find((f) => f.id === ev.flashpoint)?.nations.includes(state.player) ?? false),
  });
}

/** Due chain steps play first; then, at most one new chain may start this month. */
export function runChains(world: World, state: GameState): void {
  const due = state.chains.filter((c) => c.due <= state.turn);
  state.chains = state.chains.filter((c) => c.due > state.turn);
  for (const step of due) {
    const ev = world.eventById.get(step.eventId);
    if (ev) playChainEvent(world, state, ev, step.target);
  }
  const active = new Set(state.chains.map((c) => c.chain));
  for (const p of state.pendingEvents) {
    const ev = world.eventById.get(p.eventId);
    if (ev?.chain) active.add(ev.chain);
  }
  for (const c of world.chains) {
    if (active.has(c.id)) continue;
    const entry = world.eventById.get(c.entry);
    if (!entry) continue;
    const actor = chainActor(state, entry);
    if (!actor) continue;
    const ctx: EventContext = { player: actor, target: entry.target };
    if (!eligible(world, state, entry, ctx)) continue;
    if (roll(state) >= entry.weight / 100) continue;
    playChainEvent(world, state, entry, entry.target);
    return;
  }
}

function pickTarget(
  world: World,
  state: GameState,
  subject: Iso3,
  how: string | null,
): Iso3 | null {
  const others = world.nationList.filter((n) => n.iso3 !== subject && state.nations[n.iso3]?.alive);
  switch (how) {
    case 'rival': {
      let best: Iso3 | null = null;
      let worst = 101;
      for (const n of others) {
        if (!n.major) continue;
        const r = getRelation(world, state, subject, n.iso3);
        if (r < worst) {
          worst = r;
          best = n.iso3;
        }
      }
      return best;
    }
    case 'ally': {
      const allies = alliesOf(world, state, subject);
      if (allies.length > 0) return pick(state, allies) ?? null;
      let best: Iso3 | null = null;
      let top = -101;
      for (const n of others) {
        const r = getRelation(world, state, subject, n.iso3);
        if (r > top) {
          top = r;
          best = n.iso3;
        }
      }
      return best;
    }
    case 'warEnemy':
      return pick(state, enemiesOf(state, subject)) ?? null;
    case 'neighbour': {
      const set = new Set<Iso3>();
      for (const r of Object.values(state.regions)) {
        if (r.controller !== subject) continue;
        for (const nb of world.regions.get(r.id)?.neighbours ?? []) {
          const c = state.regions[nb]?.controller;
          if (c && c !== subject) set.add(c);
        }
      }
      return pick(state, [...set]) ?? null;
    }
    case 'random':
      return (
        pick(
          state,
          others.map((n) => n.iso3),
        ) ?? null
      );
    default:
      return null;
  }
}

export function eligible(
  world: World,
  state: GameState,
  ev: EventMeta,
  ctx: EventContext,
): boolean {
  const last = state.eventsFired[`${ev.id}:${ctx.player}`];
  if (last !== undefined) {
    if (ev.once) return false;
    if (state.turn - last < ev.cooldown) return false;
  }
  return ev.conditions.every((c) => checkCondition(world, state, ctx, c));
}

/**
 * Nations a world event is about: its subject when the text or effects refer to it, otherwise the
 * nations its effects name (so a summit is not datelined from a random capital).
 */
function eventNations(ev: EventMeta, ctx: EventContext): Iso3[] {
  const refersToSubject = ev.targetPick !== null || ev.text.includes('{PLAYER}') || JSON.stringify(ev.choices).includes('"PLAYER"');
  if (refersToSubject) return [ctx.target ?? ctx.player, ...(ctx.target ? [ctx.player] : [])].filter((x, i, a) => a.indexOf(x) === i);
  const named = new Set<Iso3>();
  for (const c of ev.choices)
    for (const e of c.effects) {
      const x = e as unknown as Record<string, unknown>;
      for (const k of ['nation', 'a', 'b', 'from', 'to']) if (typeof x[k] === 'string' && /^[A-Z]{3}$/.test(x[k] as string)) named.add(x[k] as string);
    }
  return [...named].slice(0, 3);
}

/** Draws this month's events. Player events are queued; world events resolve immediately. */
export function drawEvents(world: World, state: GameState): void {
  const player = state.player;
  runChains(world, state);
  // Player-scope: one event with 40% chance (higher in crisis).
  const pChance = 0.35 + state.globalTension / 400 + (isAtWar(state, player) ? 0.1 : 0);
  if (state.pendingEvents.length < 2 && roll(state) < pChance) {
    const candidates: { ev: EventMeta; ctx: EventContext }[] = [];
    for (const ev of world.events) {
      if (ev.scope !== 'player' || ev.weight <= 0) continue;
      const ctx: EventContext = { player, target: pickTarget(world, state, player, ev.targetPick) };
      if (ev.targetPick && !ctx.target) continue;
      if (eligible(world, state, ev, ctx)) candidates.push({ ev, ctx });
    }
    const chosen = pickWeighted(
      state,
      candidates,
      (c) => c.ev.weight * (c.ev.flashpoint ? 1.5 : 1),
    );
    if (chosen) {
      state.eventsFired[`${chosen.ev.id}:${player}`] = state.turn;
      const pending: PendingEvent = {
        id: `${chosen.ev.id}-${state.turn}`,
        eventId: chosen.ev.id,
        target: chosen.ctx.target,
        title: chosen.ev.title,
        text: substitute(world, chosen.ctx, chosen.ev.text),
        choices: chosen.ev.choices.map((c) => ({
          label: substitute(world, chosen.ctx, c.label),
          tooltip: substitute(world, chosen.ctx, c.tooltip),
        })),
      };
      state.pendingEvents.push(pending);
    }
  }
  // World-scope: one event with 55% chance, applied to a random eligible subject.
  if (roll(state) < 0.55) {
    const subjects = world.nationList
      .filter((n) => state.nations[n.iso3]?.alive)
      .map((n) => n.iso3);
    const candidates: { ev: EventMeta; ctx: EventContext }[] = [];
    for (const ev of world.events) {
      if (ev.scope !== 'world') continue;
      // Try a few random subjects for nation-conditioned events.
      for (let i = 0; i < 3; i++) {
        const subject = pick(state, subjects)!;
        const ctx: EventContext = {
          player: subject,
          target: pickTarget(world, state, subject, ev.targetPick),
        };
        if (ev.targetPick && !ctx.target) continue;
        if (eligible(world, state, ev, ctx)) {
          candidates.push({ ev, ctx });
          break;
        }
      }
    }
    const chosen = pickWeighted(state, candidates, (c) => c.ev.weight);
    if (chosen) {
      state.eventsFired[`${chosen.ev.id}:${chosen.ctx.player}`] = state.turn;
      const choice = chosen.ev.choices[aiChoice(world, state, chosen.ctx.player, chosen.ev)];
      if (choice) for (const e of choice.effects) applyEffect(world, state, chosen.ctx, e);
      const text = substitute(world, chosen.ctx, chosen.ev.text);
      const outcome = choice && chosen.ev.choices.length > 1 ? ` ${substitute(world, chosen.ctx, choice.label)}.` : '';
      log(state, {
        kind: 'event',
        text: `${chosen.ev.title}: ${text}${outcome}`,
        nations: eventNations(chosen.ev, chosen.ctx),
        alert: chosen.ctx.player === player || chosen.ctx.target === player,
      });
      headline(state, substitute(world, chosen.ctx, chosen.ev.title));
    }
  }
}

export function resolvePendingEvent(
  world: World,
  state: GameState,
  pendingId: string,
  choiceIndex: number,
): void {
  const idx = state.pendingEvents.findIndex((p) => p.id === pendingId);
  if (idx < 0) return;
  const pending = state.pendingEvents[idx]!;
  state.pendingEvents.splice(idx, 1);
  const ev = world.eventById.get(pending.eventId);
  if (!ev) return;
  const choice = ev.choices[clamp(choiceIndex, 0, ev.choices.length - 1)];
  if (!choice) return;
  const ctx: EventContext = { player: state.player, target: pending.target };
  for (const e of choice.effects) applyEffect(world, state, ctx, e);
  log(state, {
    kind: 'event',
    text: `${pending.title} — you chose "${substitute(world, ctx, choice.label)}".`,
    nations: [state.player],
    alert: false,
  });
}
