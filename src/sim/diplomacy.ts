/** Relations drift, treaties, sanctions, wars and proposal evaluation (D-024). */
import { nationName, traitsOf, type World } from './world';
import type { GameState, Iso3, ProposalType } from './types';
import {
  adjustRelation,
  alliesOf,
  atWar,
  clamp,
  controlShare,
  defaultRelation,
  enemiesOf,
  getRelation,
  hasTreaty,
  headline,
  isAtWar,
  log,
  militaryPower,
  sanctionersOf,
  bumpDiplomacy,
  setRelation,
  touchRegions,
  warBetween,
} from './query';
import { relationKey, sanctionKey } from './world';
import { imposeEmbargo, imposeSecondary, liftEmbargo as liftEmbargoOn, liftSecondary, rallyCoalition } from './trade';
import { adjustLegitimacy, agendaWeight, opinionOf, remember } from './personality';
import { honourObligations } from './blocs';
import { issueDispatch } from './statements';

export const PROPOSAL_LABELS: Record<ProposalType, string> = {
  trade: 'Trade agreement',
  nap: 'Non-aggression pact',
  defensive: 'Defensive pact',
  alliance: 'Alliance',
  sanction: 'Impose sanctions',
  liftSanction: 'Lift sanctions',
  demand: 'Demand concessions',
  declareWar: 'Declare war',
  peaceWhite: 'Offer white peace',
  peaceStatusQuo: 'Offer peace (status quo)',
  resolution: 'World Order Resolution',
  embargo: 'Impose total embargo',
  liftEmbargo: 'Lift embargo',
  secondarySanctions: 'Secondary sanctions',
  liftSecondary: 'Drop secondary sanctions',
  rallySanctions: 'Rally sanctions coalition',
  deal: 'Deal',
};

/** Relations drift one point per month toward their structural baseline. */
export function decayRelations(world: World, state: GameState): void {
  const treatyByPair = new Map<string, number>();
  const rank = { alliance: 70, defensive: 55, trade: 25, nap: 10 } as const;
  for (const t of state.treaties) {
    const k = relationKey(t.a, t.b);
    treatyByPair.set(k, Math.max(treatyByPair.get(k) ?? -Infinity, rank[t.type]));
  }
  const sanctioned = new Set<string>();
  for (const s of state.sanctions) {
    const [f, t] = s.split('>') as [Iso3, Iso3];
    sanctioned.add(relationKey(f, t));
  }
  // Remembered grievances and favours pull the baseline (D-071): half the mean of both sides' memory.
  const memoryPull = new Map<string, number>();
  for (const [holder, list] of Object.entries(state.memory ?? {}))
    for (const m of list) {
      const k = relationKey(holder, m.about);
      memoryPull.set(k, (memoryPull.get(k) ?? 0) + (m.kind === 'favour' ? m.weight : -m.weight) * 0.25);
    }
  for (const key of Object.keys(state.relations)) {
    const [a, b] = key.split('|') as [Iso3, Iso3];
    if (atWar(state, a, b)) {
      state.relations[key] = Math.min(state.relations[key]!, -80);
      continue;
    }
    let baseline = defaultRelation(world, a, b, state);
    const tr = treatyByPair.get(key);
    if (tr !== undefined) baseline = Math.max(baseline, tr);
    if (sanctioned.has(key)) baseline = Math.min(baseline, -40);
    const pull = memoryPull.get(key);
    if (pull) baseline = clamp(baseline + clamp(pull, -30, 30), -100, 100);
    const cur = state.relations[key]!;
    if (Math.abs(cur - baseline) <= 1) continue;
    state.relations[key] = cur + Math.sign(baseline - cur) * 0.5;
  }
}

export function declareWar(
  world: World,
  state: GameState,
  attacker: Iso3,
  defender: Iso3,
  reason: string,
): void {
  if (attacker === defender || atWar(state, attacker, defender)) return;
  if (!state.nations[attacker]?.alive || !state.nations[defender]?.alive) return;
  // AI leaders never attack an ally (D-071): defence partners and bloc allies are off limits.
  if (attacker !== state.player && alliesOf(world, state, attacker).includes(defender)) return;
  // Relations before the declaration decide whether the war looks provoked.
  const rel = getRelation(world, state, attacker, defender);
  const broken =
    hasTreaty(state, attacker, defender, 'nap') ||
    hasTreaty(state, attacker, defender, 'defensive') ||
    hasTreaty(state, attacker, defender, 'alliance');
  state.treaties = state.treaties.filter(
    (t) => !((t.a === attacker && t.b === defender) || (t.a === defender && t.b === attacker)),
  );
  bumpDiplomacy(state);
  const war = {
    id: state.nextId++,
    attackers: [attacker],
    defenders: [defender],
    since: state.turn,
    score: 0,
  };
  state.wars.push(war);
  setRelation(state, attacker, defender, -100);
  const att = state.nations[attacker]!;
  if (rel > -40) att.stability -= 4; // unjustified war
  if (broken) {
    att.stability -= 6;
    for (const n of Object.values(state.nations))
      if (n.iso3 !== attacker) adjustRelation(world, state, attacker, n.iso3, -15);
  }
  state.globalTension = clamp(
    state.globalTension +
      (world.nations.get(attacker)?.major || world.nations.get(defender)?.major ? 10 : 4),
    0,
    100,
  );
  // Defence partners decide one by one (NATO Article 5 / CSTO Article 4 logic, D-071).
  honourObligations(world, state, war, attacker, defender);
  // Memory and legitimacy: the victim never forgets; an unprovoked war costs standing.
  remember(state, defender, attacker, 'grievance', 40, 'attacked us');
  adjustLegitimacy(state, attacker, rel > -40 ? -12 : -6);
  for (const m of world.majors) {
    if (m === attacker || m === defender || !state.nations[m]?.alive) continue;
    if (opinionOf(world, state, m, defender) >= 30) remember(state, m, attacker, 'grievance', 10, `attacked ${nationName(world, defender)}`);
  }
  issueDispatch(world, state, defender, attacker, 'condemnation', 'We will defend every inch of our land.');
  for (const n of Object.values(state.nations)) {
    if (n.iso3 === attacker || n.iso3 === defender) continue;
    const r = getRelation(world, state, n.iso3, defender);
    if (r > 30) adjustRelation(world, state, n.iso3, attacker, -10);
  }
  log(state, {
    kind: 'war',
    text: `${nationName(world, attacker)} declares war on ${nationName(world, defender)}. ${reason}`,
    nations: [attacker, defender],
    alert: true,
  });
  headline(state, `WAR: ${nationName(world, attacker)} attacks ${nationName(world, defender)}`);
}

export function makePeace(
  world: World,
  state: GameState,
  a: Iso3,
  b: Iso3,
  terms: 'white' | 'statusQuo',
): void {
  const war = warBetween(state, a, b);
  if (!war) return;
  const aSide = war.attackers.includes(a) ? 'attackers' : 'defenders';
  const bSide = aSide === 'attackers' ? 'defenders' : 'attackers';
  // Remove the pair from the war; if a side empties, the war ends.
  if (war[aSide].length === 1 || war[bSide].length === 1) {
    // Whole war ends between these coalitions.
    const sidesA = [...war.attackers];
    const sidesB = [...war.defenders];
    state.wars = state.wars.filter((w) => w !== war);
    for (const x of sidesA) for (const y of sidesB) settlePair(world, state, x, y, terms);
  } else {
    war[aSide] = war[aSide].filter((x) => x !== a);
    settlePair(world, state, a, b, terms);
  }
  log(state, {
    kind: 'peace',
    text: `${nationName(world, a)} and ${nationName(world, b)} sign a ${terms === 'white' ? 'white peace: all occupied regions return' : 'peace recognising the front line'}.`,
    nations: [a, b],
    alert: true,
  });
  headline(state, `PEACE: ${nationName(world, a)} and ${nationName(world, b)} end hostilities`);
  state.globalTension = clamp(state.globalTension - 6, 0, 100);
  // Orders that would have attacked the former enemy are stale: stand the units down.
  for (const u of Object.values(state.units)) {
    if (u.path.length === 0) continue;
    const owner = u.owner;
    if (u.path.some((r) => {
      const c = state.regions[r]?.controller;
      return !!c && c !== owner && !atWar(state, owner, c) && !alliesOf(world, state, owner).includes(c);
    }))
      u.path = [];
  }
}

function settlePair(
  world: World,
  state: GameState,
  a: Iso3,
  b: Iso3,
  terms: 'white' | 'statusQuo',
): void {
  setRelation(state, a, b, -45);
  touchRegions(state);
  for (const r of Object.values(state.regions)) {
    if (r.owner === a && r.controller === b) {
      if (terms === 'white') r.controller = a;
      else r.owner = b;
      r.flippedTurn = state.turn;
    } else if (r.owner === b && r.controller === a) {
      if (terms === 'white') r.controller = b;
      else r.owner = a;
      r.flippedTurn = state.turn;
    }
  }
  for (const iso of [a, b]) {
    const n = state.nations[iso]!;
    if (!isAtWar(state, iso)) {
      n.mobilization = n.mobilization === 2 ? 1 : 0;
    }
  }
  void world;
}

export function imposeSanction(world: World, state: GameState, from: Iso3, to: Iso3, quiet = false): void {
  const key = sanctionKey(from, to);
  if (state.sanctions.includes(key)) return;
  state.sanctions.push(key);
  adjustRelation(world, state, from, to, -20);
  remember(state, to, from, 'grievance', 8 * (1 + 0.5 * agendaWeight(world, to, 'regimeSurvival')), 'sanctioned us');
  if (quiet) return;
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, from)} imposes sanctions on ${nationName(world, to)}.`,
    nations: [from, to],
    alert: from === state.player || to === state.player,
  });
}

export function liftSanction(world: World, state: GameState, from: Iso3, to: Iso3): void {
  const key = sanctionKey(from, to);
  if (!state.sanctions.includes(key)) return;
  state.sanctions = state.sanctions.filter((k) => k !== key);
  adjustRelation(world, state, from, to, 10);
  log(state, {
    kind: 'diplomacy',
    text: `${nationName(world, from)} lifts sanctions on ${nationName(world, to)}.`,
    nations: [from, to],
    alert: from === state.player || to === state.player,
  });
}

export interface Verdict {
  accept: boolean;
  reason: string;
}

/** AI evaluation of a proposal from `from` to `to`. Deterministic given the state. */
export function evaluateProposal(
  world: World,
  state: GameState,
  from: Iso3,
  to: Iso3,
  type: ProposalType,
): Verdict {
  const t = traitsOf(world, to, state);
  // The AI judges by what its leader thinks: relations plus remembered grievances and favours (D-071).
  const rel = opinionOf(world, state, to, from);
  const toName = nationName(world, to);
  const myPower = militaryPower(world, state, to);
  const theirPower = militaryPower(world, state, from);
  const ratio = theirPower / Math.max(1, myPower);
  const sharedEnemy = enemiesOf(state, from).some(
    (e) => enemiesOf(state, to).includes(e) || getRelation(world, state, to, e) < -40,
  );
  switch (type) {
    case 'trade': {
      if (atWar(state, from, to))
        return { accept: false, reason: `${toName} will not trade with a nation it is fighting.` };
      if (rel < -10)
        return {
          accept: false,
          reason: `Relations (${Math.round(rel)}) are too poor for ${toName} to sign a trade deal.`,
        };
      if (sanctionersOf(state, to).includes(from))
        return {
          accept: false,
          reason: `${toName} demands sanctions be lifted before any trade agreement.`,
        };
      return {
        accept: true,
        reason: `${toName} welcomes the economic upside (economic priority ${t.economicPriority}).`,
      };
    }
    case 'nap': {
      if (atWar(state, from, to))
        return { accept: false, reason: 'Hostilities must end before a non-aggression pact.' };
      const threshold = -20 + (t.paranoia - 50) * 0.3;
      if (rel < threshold)
        return {
          accept: false,
          reason: `${toName} does not trust the offer; relations ${Math.round(rel)} are below its comfort level.`,
        };
      if (t.aggression > 70 && ratio < 0.7)
        return {
          accept: false,
          reason: `${toName}'s leadership sees no reason to tie its hands against a weaker neighbour.`,
        };
      return {
        accept: true,
        reason: `${toName} values predictability (pragmatism ${t.pragmatism}).`,
      };
    }
    case 'defensive':
    case 'alliance': {
      const need = type === 'alliance' ? 55 : 35;
      if (atWar(state, from, to)) return { accept: false, reason: 'You are at war.' };
      if (rel < need)
        return {
          accept: false,
          reason: `Relations (${Math.round(rel)}) must reach ${need} first.`,
        };
      if (!sharedEnemy && t.allianceLoyalty < 45)
        return {
          accept: false,
          reason: `${toName} sees no shared threat worth an entangling commitment (alliance loyalty ${t.allianceLoyalty}).`,
        };
      if (isAtWar(state, from) && t.riskTolerance < 40)
        return {
          accept: false,
          reason: `${toName} will not be dragged into your current war (risk tolerance ${t.riskTolerance}).`,
        };
      return {
        accept: true,
        reason: sharedEnemy
          ? `${toName} shares your adversaries and wants a guarantee.`
          : `${toName} trusts you enough to formalise the partnership.`,
      };
    }
    case 'demand': {
      if (ratio > 3 && t.riskTolerance < 55 && !atWar(state, from, to))
        return {
          accept: true,
          reason: `${toName} backs down before overwhelming force (power ratio ${ratio.toFixed(1)}:1).`,
        };
      return {
        accept: false,
        reason: `${toName} refuses to be bullied${t.nationalism > 60 ? ' — nationalist opinion would not allow it' : ''}.`,
      };
    }
    case 'peaceWhite': {
      const war = warBetween(state, from, to);
      if (!war) return { accept: false, reason: 'There is no war to end.' };
      const myShare = controlShare(world, state, to);
      const theirShare = controlShare(world, state, from);
      const winning = myShare > theirShare + 0.1;
      const weary = state.nations[to]!.warWeariness;
      if (winning && weary < 60)
        return {
          accept: false,
          reason: `${toName} is winning (${Math.round((1 - theirShare) * 100)}% of your land under its control) and sees no reason to stop.`,
        };
      return {
        accept: true,
        reason:
          weary >= 60
            ? `${toName}'s public is exhausted by war (weariness ${Math.round(weary)}).`
            : `${toName} accepts a return to the pre-war borders.`,
      };
    }
    case 'peaceStatusQuo': {
      const war = warBetween(state, from, to);
      if (!war) return { accept: false, reason: 'There is no war to end.' };
      const myShare = controlShare(world, state, to);
      const theirShare = controlShare(world, state, from);
      const weary = state.nations[to]!.warWeariness;
      if (myShare < theirShare - 0.1 || weary > 75)
        return {
          accept: true,
          reason: `${toName} is losing ground and takes the deal to stop the bleeding.`,
        };
      if (myShare > theirShare + 0.05)
        return { accept: true, reason: `${toName} keeps what it holds — a favourable peace.` };
      return { accept: false, reason: `${toName} will not sign while the front is undecided.` };
    }
    case 'deal':
      return { accept: false, reason: 'Deals are negotiated on the negotiation screen.' };
    case 'sanction':
    case 'liftSanction':
    case 'declareWar':
    case 'embargo':
    case 'liftEmbargo':
    case 'secondarySanctions':
    case 'liftSecondary':
    case 'rallySanctions':
      return { accept: true, reason: 'Unilateral action.' };
    case 'resolution': {
      if (atWar(state, from, to))
        return { accept: false, reason: `${toName} vetoes: it is at war with you.` };
      if (rel >= 15)
        return {
          accept: true,
          reason: `${toName} supports your vision of world order (relations ${Math.round(rel)}).`,
        };
      return {
        accept: false,
        reason: `${toName} abstains or votes no (relations ${Math.round(rel)} < 15).`,
      };
    }
  }
}

/** Applies an accepted (or unilateral) proposal. Returns the verdict for the UI/log. */
export function executeProposal(
  world: World,
  state: GameState,
  from: Iso3,
  to: Iso3,
  type: ProposalType,
): Verdict {
  const verdict = evaluateProposal(world, state, from, to, type);
  const fromName = nationName(world, from);
  const toName = nationName(world, to);
  const isPlayer = from === state.player || to === state.player;
  if (type === 'declareWar') {
    declareWar(
      world,
      state,
      from,
      to,
      from === state.player
        ? 'The decision was taken at the highest level.'
        : state.nations[from]!.aiNote || '',
    );
    return verdict;
  }
  if (type === 'sanction') {
    imposeSanction(world, state, from, to);
    return verdict;
  }
  if (type === 'liftSanction') {
    liftSanction(world, state, from, to);
    // Lifting sanctions also ends any embargo and secondary sanctions on the same target.
    liftEmbargoOn(world, state, from, to);
    liftSecondary(world, state, from, to);
    return verdict;
  }
  if (type === 'embargo') {
    imposeEmbargo(world, state, from, to);
    return verdict;
  }
  if (type === 'liftEmbargo') {
    liftEmbargoOn(world, state, from, to);
    return verdict;
  }
  if (type === 'secondarySanctions') {
    imposeSecondary(world, state, from, to);
    return verdict;
  }
  if (type === 'liftSecondary') {
    liftSecondary(world, state, from, to);
    return verdict;
  }
  if (type === 'rallySanctions') {
    rallyCoalition(world, state, from, to);
    return verdict;
  }
  if (type === 'resolution') return verdict;
  if (!verdict.accept) {
    adjustRelation(world, state, from, to, type === 'demand' ? -12 : -3);
    if (isPlayer || (world.nations.get(from)?.major && world.nations.get(to)?.major)) {
      log(state, {
        kind: 'diplomacy',
        text: `${toName} rejects ${fromName}'s proposal (${PROPOSAL_LABELS[type].toLowerCase()}): ${verdict.reason}`,
        nations: [from, to],
        alert: isPlayer,
      });
    }
    return verdict;
  }
  bumpDiplomacy(state);
  switch (type) {
    case 'trade':
      if (!hasTreaty(state, from, to, 'trade'))
        state.treaties.push({ type: 'trade', a: from, b: to, since: state.turn });
      adjustRelation(world, state, from, to, 8);
      break;
    case 'nap':
      if (!hasTreaty(state, from, to, 'nap'))
        state.treaties.push({ type: 'nap', a: from, b: to, since: state.turn });
      adjustRelation(world, state, from, to, 10);
      break;
    case 'defensive':
      state.treaties = state.treaties.filter(
        (t) =>
          !(t.type === 'nap' && ((t.a === from && t.b === to) || (t.a === to && t.b === from))),
      );
      if (!hasTreaty(state, from, to, 'defensive'))
        state.treaties.push({ type: 'defensive', a: from, b: to, since: state.turn });
      adjustRelation(world, state, from, to, 15);
      break;
    case 'alliance':
      state.treaties = state.treaties.filter(
        (t) =>
          !(
            (t.type === 'nap' || t.type === 'defensive') &&
            ((t.a === from && t.b === to) || (t.a === to && t.b === from))
          ),
      );
      if (!hasTreaty(state, from, to, 'alliance'))
        state.treaties.push({ type: 'alliance', a: from, b: to, since: state.turn });
      adjustRelation(world, state, from, to, 20);
      break;
    case 'demand': {
      const pay = state.nations[to]!.gdp * 0.01;
      state.nations[to]!.treasury -= pay;
      state.nations[from]!.treasury += pay;
      state.nations[to]!.stability -= 3;
      adjustRelation(world, state, from, to, -10);
      break;
    }
    case 'peaceWhite':
      makePeace(world, state, from, to, 'white');
      break;
    case 'peaceStatusQuo':
      makePeace(world, state, from, to, 'statusQuo');
      break;
  }
  // Minor-power housekeeping (trade deals between non-majors) stays out of the log (D-048).
  const notable =
    isPlayer || type !== 'trade' || world.nations.get(from)?.major || world.nations.get(to)?.major;
  if (notable) {
    log(state, {
      kind: 'diplomacy',
      text: `${toName} accepts ${fromName}'s ${PROPOSAL_LABELS[type].toLowerCase()}: ${verdict.reason}`,
      nations: [from, to],
      alert: isPlayer,
    });
  }
  if (isPlayer)
    headline(state, `${fromName} and ${toName}: ${PROPOSAL_LABELS[type].toLowerCase()} agreed`);
  return verdict;
}

export const relationLabel = (v: number): string =>
  v <= -80
    ? 'Hostile'
    : v <= -40
      ? 'Adversarial'
      : v < -10
        ? 'Cool'
        : v < 20
          ? 'Neutral'
          : v < 50
            ? 'Friendly'
            : v < 80
              ? 'Allied'
              : 'Special relationship';

export { relationKey };
