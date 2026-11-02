/**
 * Negotiation (D-071). A deal is a bundle of items each side gives. The AI values every item in
 * US$ bn-equivalent from its own leader's point of view (traits, agendas, memory, threats), adds a
 * trust term, and accepts when the net value is non-negative. Close calls get a counter-offer
 * (usually a request for money), clear losers a rejection with the decisive reason. The function is
 * pure and deterministic, so the UI shows exactly what the simulation will decide.
 */
import { nationName, traitsOf, type World } from './world';
import type { Deal, DealItem, DealLine, DealVerdict, GameState, Iso3, RegionId, TreatyType } from './types';
import {
  adjustRelation,
  alliesOf,
  atWar,
  bumpDiplomacy,
  clamp,
  controlShare,
  enemiesOf,
  hasTreaty,
  isAtWar,
  isSanctioned,
  log,
  militaryPower,
  touchRegions,
  warBetween,
} from './query';
import { agendaClaim, agendaWeight, opinionOf, remember } from './personality';
import { monthlyRevenue, unitCost } from './economy';
import { baseVolume, liftEmbargo, liftSecondary } from './trade';
import { completeTech } from './research';
import { declareWar, liftSanction } from './diplomacy';
import { issueDispatch } from './statements';

export const DEAL_ITEM_LABELS: Record<DealItem['kind'], string> = {
  money: 'Money',
  region: 'Region',
  basing: 'Basing rights',
  tech: 'Technology sharing',
  liftSanctions: 'Lift sanctions',
  arms: 'Arms sale',
  joinWar: 'Join a war',
  treaty: 'Treaty',
};

const TREATY_LABEL: Record<TreatyType, string> = {
  trade: 'trade agreement',
  nap: 'non-aggression pact',
  defensive: 'defensive pact',
  alliance: 'alliance',
};

/** Arms sales and aid deliveries are counted in mechanised-brigade equivalents. */
export const ARMS_UNIT = 'mechanized';

// --- small cached helpers ----------------------------------------------------------------------

const powerCache = new WeakMap<GameState, { key: string; map: Map<Iso3, number> }>();
/** Military power of every nation, cached per state while units and regions are unchanged. */
export function powerOf(world: World, state: GameState, iso: Iso3): number {
  const key = `${state.turn}|${state.nextId}|${state.regionsVersion}`;
  let e = powerCache.get(state);
  if (!e || e.key !== key) {
    const map = new Map<Iso3, number>();
    for (const n of Object.values(state.nations)) if (n.alive) map.set(n.iso3, militaryPower(world, state, n.iso3));
    e = { key, map };
    powerCache.set(state, e);
  }
  return e.map.get(iso) ?? 0;
}

/** Annual output attributed to one region (owner's GDP × the region's population share). */
export function regionValue(world: World, state: GameState, region: RegionId): number {
  const meta = world.regions.get(region);
  const owner = state.regions[region]?.owner;
  if (!meta || !owner) return 0;
  return (state.nations[owner]?.gdp ?? 0) * meta.populationShare;
}

/** The most advanced technology `giver` could hand to `receiver` (prerequisites met), or null. */
export function tradableTech(world: World, state: GameState, giver: Iso3, receiver: Iso3): string | null {
  const g = state.nations[giver];
  const r = state.nations[receiver];
  if (!g || !r) return null;
  let best: string | null = null;
  let bestTier = -1;
  for (const id of g.techs) {
    if (r.techs.includes(id)) continue;
    const t = world.techs.get(id);
    if (!t || !t.requires.every((q) => r.techs.includes(q))) continue;
    if (t.tier > bestTier || (t.tier === bestTier && best !== null && id < best)) {
      best = id;
      bestTier = t.tier;
    }
  }
  return best;
}

function moneyWeight(world: World, state: GameState, iso: Iso3): number {
  const t = traitsOf(world, iso, state);
  const n = state.nations[iso]!;
  const poor = n.treasury < monthlyRevenue(n, controlShare(world, state, iso)) * 2 ? 0.3 : 0;
  return 1 + (t.economicPriority - 50) / 150 + 0.5 * agendaWeight(world, iso, 'transactional') + poor;
}

/** Is `x` a treaty partner or bloc ally of `iso` (the "never attack" set)? */
export function isAlly(world: World, state: GameState, iso: Iso3, x: Iso3): boolean {
  return alliesOf(world, state, iso).includes(x) || hasTreaty(state, iso, x, 'alliance') || hasTreaty(state, iso, x, 'defensive');
}

export function itemLabel(world: World, state: GameState, item: DealItem, giver: Iso3, receiver: Iso3): string {
  switch (item.kind) {
    case 'money':
      return `$${Math.round(item.amount)} bn`;
    case 'region':
      return world.regions.get(item.region)?.name ?? `region ${item.region}`;
    case 'basing':
      return `basing rights in ${nationName(world, giver)}`;
    case 'tech': {
      const id = tradableTech(world, state, giver, receiver);
      return id ? `technology: ${world.techs.get(id)?.name ?? id}` : 'technology (nothing to share)';
    }
    case 'liftSanctions':
      return `${nationName(world, giver)} lifts sanctions`;
    case 'arms':
      return `${item.units} brigade${item.units === 1 ? '' : 's'} of arms`;
    case 'joinWar':
      return `${nationName(world, giver)} joins the war on ${nationName(world, item.against)}`;
    case 'treaty':
      return TREATY_LABEL[item.treaty];
  }
}

/** Why an item cannot be offered by `giver` to `receiver`, or null when it is valid. */
export function itemProblem(world: World, state: GameState, item: DealItem, giver: Iso3, receiver: Iso3): string | null {
  const g = state.nations[giver];
  if (!g?.alive || !state.nations[receiver]?.alive) return 'That nation no longer exists.';
  switch (item.kind) {
    case 'money':
      if (!(item.amount > 0)) return 'The amount must be positive.';
      if (item.amount > g.treasury) return `${nationName(world, giver)} cannot afford $${Math.round(item.amount)} bn.`;
      return null;
    case 'region': {
      const r = state.regions[item.region];
      if (!r) return 'Unknown region.';
      if (r.controller !== giver) return `${nationName(world, giver)} does not control that region.`;
      if (r.owner !== giver && r.owner !== receiver) return 'Only your own territory, or theirs that you occupy, can change hands.';
      return null;
    }
    case 'basing':
      return state.basing.includes(`${giver}>${receiver}`) ? 'Basing rights already granted.' : null;
    case 'tech':
      return tradableTech(world, state, giver, receiver) ? null : 'No technology the receiver can use.';
    case 'liftSanctions':
      return isSanctioned(state, giver, receiver) ? null : `${nationName(world, giver)} has no sanctions to lift.`;
    case 'arms':
      if (!(item.units >= 1 && item.units <= 10)) return 'Between 1 and 10 brigades.';
      return null;
    case 'joinWar':
      if (item.against === giver || item.against === receiver) return 'Not a valid enemy.';
      if (!state.nations[item.against]?.alive) return 'That nation no longer exists.';
      if (atWar(state, giver, item.against)) return `${nationName(world, giver)} is already at war with ${nationName(world, item.against)}.`;
      return null;
    case 'treaty':
      if (hasTreaty(state, giver, receiver, item.treaty)) return `A ${TREATY_LABEL[item.treaty]} already exists.`;
      return null;
  }
}

interface Valued {
  value: number;
  veto: string | null;
  label: string;
}

/**
 * Value to evaluator `e` of an item flowing `dir` ('in' = e receives, 'out' = e gives), with the
 * counterpart `p`. US$ bn equivalent.
 */
function valueItem(world: World, state: GameState, e: Iso3, p: Iso3, item: DealItem, dir: 'in' | 'out'): Valued {
  const t = traitsOf(world, e, state);
  const n = state.nations[e]!;
  const G = Math.max(10, n.gdp);
  const giver = dir === 'in' ? p : e;
  const receiver = dir === 'in' ? e : p;
  const label = `${dir === 'in' ? 'Receive' : 'Give'} ${itemLabel(world, state, item, giver, receiver)}`;
  const problem = itemProblem(world, state, item, giver, receiver);
  if (problem) return { value: 0, veto: problem, label };
  const opinion = opinionOf(world, state, e, p);
  switch (item.kind) {
    case 'money': {
      const w = moneyWeight(world, state, e);
      if (dir === 'in') return { value: item.amount * w, veto: null, label };
      return { value: -item.amount * w * (1 + item.amount / Math.max(1, n.treasury)), veto: null, label };
    }
    case 'region': {
      const r = state.regions[item.region]!;
      const v = regionValue(world, state, item.region);
      if (dir === 'in') {
        if (r.owner === e) return { value: v * 4 + (t.nationalism / 100) * 0.03 * G, veto: null, label };
        return { value: v * 2.5 + agendaClaim(world, e, p).weight * 0.05 * G, veto: null, label };
      }
      if (r.owner === e) {
        if (world.capitalRegion.get(e) === item.region) return { value: 0, veto: `${nationName(world, e)} will never surrender its capital.`, label };
        if (t.nationalism >= 80) return { value: 0, veto: `${n.leaderName} will not cede an inch of national territory (nationalism ${t.nationalism}).`, label };
        const recovery = agendaWeight(world, e, 'territorialRecovery');
        return { value: -(v * 4 + 0.04 * G * (t.nationalism / 50) * (1 + recovery)), veto: null, label };
      }
      // Returning occupied land to its owner.
      return { value: -v * 1.5 * (1 + agendaClaim(world, e, p).weight), veto: null, label };
    }
    case 'basing': {
      if (dir === 'in') return { value: 0.002 * G * (1 + t.aggression / 100), veto: null, label };
      // Hosting foreign forces: sovereignty cost, the risk of drawing fire, offset by protection.
      let cost = 0.004 * G * (t.nationalism / 50) * (1 + 2 * agendaWeight(world, e, 'nonAlignment'));
      let risks = 0;
      let protection = 0;
      for (const x of world.majors) {
        if (x === e || x === p || !state.nations[x]?.alive) continue;
        const theirs = opinionOf(world, state, x, p);
        const mine = opinionOf(world, state, e, x);
        if (theirs <= -50 && mine > -20 && risks < 3) {
          cost += 0.004 * G;
          risks++;
        }
        if (mine <= -40 && theirs <= -40) protection = Math.max(protection, 0.006 * G * (t.paranoia / 50));
      }
      return { value: -cost + protection, veto: null, label };
    }
    case 'tech': {
      const id = tradableTech(world, state, giver, receiver)!;
      const tier = world.techs.get(id)?.tier ?? 1;
      if (dir === 'in') return { value: 0.0025 * G * tier * (1 + t.economicPriority / 100), veto: null, label };
      if (opinion < -30) return { value: 0, veto: `${n.leaderName} will not hand technology to a rival (opinion ${Math.round(opinion)}).`, label };
      return { value: -0.0025 * G * tier * (opinion < 0 ? 2.5 : opinion < 40 ? 1.5 : 1), veto: null, label };
    }
    case 'liftSanctions': {
      if (dir === 'in') return { value: baseVolume(world, e, p) * 0.07 + 0.003 * G, veto: null, label };
      if (atWar(state, e, p)) return { value: 0, veto: 'Sanctions stay while the war lasts.', label };
      return { value: -0.002 * G * (1 + Math.max(0, -opinion) / 40), veto: null, label };
    }
    case 'arms': {
      const unit = unitCost(world, state, e, ARMS_UNIT);
      if (dir === 'in') {
        const need = isAtWar(state, e) ? 2 : enemiesOf(state, e).length > 0 ? 1.5 : 0.8;
        return { value: item.units * unit * need, veto: null, label };
      }
      for (const enemy of enemiesOf(state, p))
        if (isAlly(world, state, e, enemy))
          return { value: 0, veto: `${nationName(world, e)} will not arm a nation at war with its ally ${nationName(world, enemy)}.`, label };
      return { value: -item.units * unit * 0.7, veto: null, label };
    }
    case 'joinWar': {
      const x = item.against;
      if (dir === 'in') {
        if (isAlly(world, state, e, x)) return { value: 0, veto: `${nationName(world, e)} will not see its ally ${nationName(world, x)} attacked.`, label };
        if (!atWar(state, e, x)) return { value: opinionOf(world, state, e, x) <= -40 ? 0.01 * G : -0.01 * G, veto: null, label };
        return { value: 0.08 * G * Math.min(2, powerOf(world, state, p) / Math.max(1, powerOf(world, state, x))), veto: null, label };
      }
      if (isAlly(world, state, e, x) || hasTreaty(state, e, x, 'nap'))
        return { value: 0, veto: `${n.leaderName} will never attack a treaty partner (${nationName(world, x)}).`, label };
      const theirSide = powerOf(world, state, x) + 0.5 * alliesOf(world, state, x).reduce((s, a) => s + powerOf(world, state, a), 0);
      const ourSide = powerOf(world, state, e) + powerOf(world, state, p);
      const ratio = clamp(theirSide / Math.max(1, ourSide), 0.2, 4);
      const xNukes = (state.nations[x]?.warheads ?? 0) > 0;
      const nukes = xNukes ? (n.warheads > 0 ? 1.5 : 3) : 1;
      // War itself is costly whatever the odds; defending a victim of aggression less so.
      const defending = warBetween(state, p, x)?.defenders.includes(p) ?? false;
      let cost =
        (0.12 * G * ratio * (1.6 - t.riskTolerance / 100) * nukes + 0.03 * G * (defending ? 0.5 : 1.5)) *
        (1 + 2 * agendaWeight(world, e, 'nonAlignment'));
      const hostility = (Math.max(0, -opinionOf(world, state, e, x) - 30) / 70) * 0.06 * G * (t.aggression / 60);
      cost -= hostility + agendaClaim(world, e, x).weight * 0.06 * G;
      // Members of a balancing coalition have already decided the target must be stopped.
      if (state.coalition?.target === x && state.coalition.members.includes(e)) cost -= 0.06 * G;
      return { value: -Math.max(-0.02 * G, cost), veto: null, label };
    }
    case 'treaty': {
      // Symmetric: valued once from the evaluator's side whichever list it sits in.
      const enemiesP = enemiesOf(state, p);
      switch (item.treaty) {
        case 'trade':
          if (opinion < -10) return { value: 0, veto: `Relations (${Math.round(opinion)}) are too poor for a trade agreement.`, label };
          return { value: 0.002 * G * (1 + t.economicPriority / 100), veto: null, label };
        case 'nap': {
          const need = -20 + (t.paranoia - 50) * 0.3;
          if (opinion < need) return { value: 0, veto: `${n.leaderName} does not trust ${nationName(world, p)} (opinion ${Math.round(opinion)} < ${Math.round(need)}).`, label };
          return { value: 0.001 * G * (t.pragmatism / 50), veto: null, label };
        }
        case 'defensive':
        case 'alliance': {
          const need = item.treaty === 'alliance' ? 55 : 35;
          if (opinion < need) return { value: 0, veto: `Opinion of ${nationName(world, p)} (${Math.round(opinion)}) must reach ${need} first.`, label };
          if (item.treaty === 'alliance' && agendaWeight(world, e, 'nonAlignment') >= 0.8)
            return { value: 0, veto: `${nationName(world, e)} keeps its freedom of action and joins no alliances.`, label };
          const shared = enemiesP.some((x) => opinionOf(world, state, e, x) <= -40);
          const protection = 0.01 * G * (shared ? 1.5 : 0.5) * (t.paranoia / 50) * (1 + agendaWeight(world, e, 'alliancePreservation'));
          const entangle = 0.01 * G * (enemiesP.length > 0 ? (1.5 - t.riskTolerance / 100) * 2 : 0.3) * (item.treaty === 'alliance' ? 1.3 : 1);
          return { value: protection - entangle, veto: null, label };
        }
      }
    }
  }
}

function trustTerm(world: World, state: GameState, e: Iso3, p: Iso3): number {
  const G = Math.max(10, state.nations[e]!.gdp);
  const o = opinionOf(world, state, e, p);
  const legit = state.nations[p]?.legitimacy ?? 50;
  return (o / 100) * 0.015 * G + ((legit - 50) / 50) * 0.004 * G;
}

const scaleOf = (state: GameState, e: Iso3) => 0.004 * Math.max(10, state.nations[e]?.gdp ?? 10) + 1;

/** Evaluates `deal` from the side of `deal.to`. Pure and deterministic. */
export function evaluateDeal(world: World, state: GameState, deal: Deal, allowCounter = true): DealVerdict {
  const e = deal.to;
  const p = deal.from;
  const n = state.nations[e];
  const S = scaleOf(state, e);
  const fail = (reason: string, lines: DealLine[] = []): DealVerdict => ({ verdict: 'reject', score: -Infinity, likelihood: 0, reason, lines, counter: null });
  if (!n?.alive || !state.nations[p]?.alive) return fail('That nation no longer exists.');
  if (deal.give.length + deal.get.length === 0) return fail('There is nothing on the table.');
  if (atWar(state, e, p)) return fail(`${n.leaderName}: “We are at war. Talk peace first.”`);
  const lines: DealLine[] = [];
  let score = 0;
  let veto: string | null = null;
  let worst: { label: string; value: number } | null = null;
  let bestLine: { label: string; value: number } | null = null;
  const seenTreaty = new Set<string>();
  const add = (item: DealItem, dir: 'in' | 'out') => {
    if (item.kind === 'treaty') {
      if (seenTreaty.has(item.treaty)) return;
      seenTreaty.add(item.treaty);
    }
    const v = valueItem(world, state, e, p, item, dir);
    if (v.veto && !veto) veto = v.veto;
    const value = Math.round(v.value * 10) / 10;
    lines.push({ label: v.label, value });
    score += v.value;
    if (!worst || value < worst.value) worst = { label: v.label, value };
    if (!bestLine || value > bestLine.value) bestLine = { label: v.label, value };
  };
  for (const item of deal.give) add(item, 'in');
  for (const item of deal.get) add(item, 'out');
  const trust = trustTerm(world, state, e, p);
  lines.push({ label: `Trust in ${nationName(world, p)} (opinion and legitimacy)`, value: Math.round(trust * 10) / 10 });
  score += trust;
  if (veto) return fail(veto, lines);
  const likelihood = 1 / (1 + Math.exp((-1.5 * score) / S));
  const leader = n.leaderName;
  if (score >= 0) {
    const b = bestLine as { label: string; value: number } | null;
    return {
      verdict: 'accept',
      score,
      likelihood,
      reason: `${leader} accepts: ${b ? b.label.toLowerCase() : 'the terms'} is worth it to ${nationName(world, e)}.`,
      lines,
      counter: null,
    };
  }
  const w = worst as { label: string; value: number } | null;
  const reason = `${leader} declines: ${w ? `${w.label.toLowerCase()} costs too much (${w.value.toFixed(1)} bn-equivalent)` : 'the terms fall short'}.`;
  if (allowCounter && score >= -4 * S) {
    const counter = buildCounter(world, state, deal, -score);
    if (counter) {
      const check = evaluateDeal(world, state, counter, false);
      if (check.verdict === 'accept')
        return { verdict: 'counter', score, likelihood, reason: `${leader} counters: ${describeCounter(world, state, deal, counter)}`, lines, counter };
    }
  }
  return { verdict: 'reject', score, likelihood, reason, lines, counter: null };
}

function buildCounter(world: World, state: GameState, deal: Deal, deficit: number): Deal | null {
  const e = deal.to;
  const p = deal.from;
  const w = moneyWeight(world, state, e);
  const existing = deal.give.find((i) => i.kind === 'money') as { kind: 'money'; amount: number } | undefined;
  const ask = Math.ceil((deficit / w) * 1.1 + 0.5);
  const total = (existing?.amount ?? 0) + ask;
  const proposer = state.nations[p]!;
  if (total <= proposer.treasury && total <= 0.05 * proposer.gdp + 5) {
    const give = deal.give.filter((i) => i.kind !== 'money');
    return { ...deal, give: [...give, { kind: 'money', amount: total }] };
  }
  // Otherwise drop the single item that costs the evaluator most.
  if (deal.get.length > 1) {
    let worstIdx = -1;
    let worstVal = Infinity;
    deal.get.forEach((item, i) => {
      const v = valueItem(world, state, e, p, item, 'out').value;
      if (v < worstVal) {
        worstVal = v;
        worstIdx = i;
      }
    });
    if (worstIdx >= 0) return { ...deal, get: deal.get.filter((_, i) => i !== worstIdx) };
  }
  return null;
}

function describeCounter(world: World, state: GameState, original: Deal, counter: Deal): string {
  const money = counter.give.find((i) => i.kind === 'money') as { amount: number } | undefined;
  const before = original.give.find((i) => i.kind === 'money') as { amount: number } | undefined;
  if (money && money.amount !== before?.amount) return `add $${Math.round(money.amount)} bn and we have a deal.`;
  const dropped = original.get.find((i) => !counter.get.includes(i));
  if (dropped) return `leave out ${itemLabel(world, state, dropped, original.to, original.from)} and we have a deal.`;
  return 'a revised package.';
}

// --- execution -----------------------------------------------------------------------------------

export function signTreaty(state: GameState, a: Iso3, b: Iso3, type: TreatyType): void {
  const lesser: Record<TreatyType, TreatyType[]> = { trade: [], nap: [], defensive: ['nap'], alliance: ['nap', 'defensive'] };
  state.treaties = state.treaties.filter(
    (t) => !(lesser[type].includes(t.type) && ((t.a === a && t.b === b) || (t.a === b && t.b === a))),
  );
  if (!hasTreaty(state, a, b, type)) state.treaties.push({ type, a, b, since: state.turn });
  bumpDiplomacy(state);
}

/** `joiner` enters `partner`'s war against `enemy` (joining the existing war when there is one). */
export function joinWar(world: World, state: GameState, joiner: Iso3, partner: Iso3, enemy: Iso3, reason: string): boolean {
  if (atWar(state, joiner, enemy) || isAlly(world, state, joiner, enemy)) return false;
  const war = warBetween(state, partner, enemy);
  if (!war) {
    declareWar(world, state, joiner, enemy, reason);
    return atWar(state, joiner, enemy);
  }
  const side = war.attackers.includes(partner) ? 'attackers' : 'defenders';
  const other = side === 'attackers' ? 'defenders' : 'attackers';
  // Never fight an ally on the other side.
  if (war[other].some((x) => isAlly(world, state, joiner, x))) return false;
  war[side].push(joiner);
  for (const x of war[other]) adjustRelation(world, state, joiner, x, -100);
  bumpDiplomacy(state);
  log(state, {
    kind: 'war',
    text: `${nationName(world, joiner)} enters the war on the side of ${nationName(world, partner)} against ${nationName(world, enemy)}. ${reason}`,
    nations: [joiner, partner, enemy],
    alert: true,
  });
  return true;
}

function applyItem(world: World, state: GameState, item: DealItem, giver: Iso3, receiver: Iso3): void {
  const g = state.nations[giver]!;
  const r = state.nations[receiver]!;
  switch (item.kind) {
    case 'money':
      g.treasury -= item.amount;
      r.treasury += item.amount;
      return;
    case 'region': {
      const reg = state.regions[item.region]!;
      reg.owner = receiver;
      reg.controller = receiver;
      reg.flippedTurn = state.turn;
      touchRegions(state);
      const home = world.capitalRegion.get(giver);
      for (const u of Object.values(state.units))
        if (u.region === item.region && u.owner === giver && home !== undefined) {
          u.region = home;
          u.prevRegion = home;
          u.path = [];
        }
      return;
    }
    case 'basing':
      state.basing.push(`${giver}>${receiver}`);
      bumpDiplomacy(state);
      return;
    case 'tech': {
      const id = tradableTech(world, state, giver, receiver);
      if (id) completeTech(world, state, receiver, id);
      return;
    }
    case 'liftSanctions':
      liftSanction(world, state, giver, receiver);
      liftEmbargo(world, state, giver, receiver);
      liftSecondary(world, state, giver, receiver);
      return;
    case 'arms': {
      const cap = world.capitalRegion.get(receiver);
      if (cap === undefined) return;
      g.treasury -= item.units * unitCost(world, state, giver, ARMS_UNIT) * 0.7;
      for (let i = 0; i < item.units; i++)
        r.production.push({ id: state.nextId++, type: ARMS_UNIT, region: cap, monthsLeft: 1, aidFrom: giver });
      return;
    }
    case 'joinWar':
      joinWar(world, state, giver, receiver, item.against, `Agreed in a deal with ${nationName(world, receiver)}.`);
      return;
    case 'treaty':
      signTreaty(state, giver, receiver, item.treaty);
      return;
  }
}

/** Applies every item of an agreed deal and records the goodwill. */
export function executeDeal(world: World, state: GameState, deal: Deal, score = 0): void {
  for (const item of deal.give) applyItem(world, state, item, deal.from, deal.to);
  for (const item of deal.get) applyItem(world, state, item, deal.to, deal.from);
  adjustRelation(world, state, deal.from, deal.to, 4);
  const S = scaleOf(state, deal.to);
  const generosity = clamp(score / S, 0, 10);
  if (generosity > 0.5) remember(state, deal.to, deal.from, 'favour', 2 + generosity, 'generous deal');
  remember(state, deal.from, deal.to, 'favour', 2, 'kept its word in a deal');
  const summary = [
    ...deal.give.map((i) => itemLabel(world, state, i, deal.from, deal.to)),
    ...deal.get.map((i) => itemLabel(world, state, i, deal.to, deal.from)),
  ].join(', ');
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, deal.from)} and ${nationName(world, deal.to)} agree a deal: ${summary}.`,
    nations: [deal.from, deal.to],
    alert: deal.from === state.player || deal.to === state.player,
  });
  issueDispatch(world, state, deal.to, deal.from, 'praise', 'The agreement we signed serves both our nations.');
}

/** A deal proposed by `deal.from`: evaluated by `deal.to`, executed when accepted. Returns the verdict. */
export function proposeDeal(world: World, state: GameState, deal: Deal): DealVerdict {
  const v = evaluateDeal(world, state, deal);
  if (v.verdict === 'accept') executeDeal(world, state, deal, v.score);
  else {
    const S = scaleOf(state, deal.to);
    if (v.score < -6 * S) {
      remember(state, deal.to, deal.from, 'grievance', 3, 'insulting offer');
      adjustRelation(world, state, deal.from, deal.to, -2);
    }
    log(state, {
      kind: 'diplomacy',
      text: `${nationName(world, deal.to)} ${v.verdict === 'counter' ? 'counters' : 'rejects'} ${nationName(world, deal.from)}'s offer: ${v.reason}`,
      nations: [deal.from, deal.to],
      alert: deal.from === state.player || deal.to === state.player,
    });
  }
  return v;
}
