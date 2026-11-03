/**
 * Simple mode (D-086): the game a new player can understand in two minutes. The AI runs the
 * player's economy, budget, production, research, supply and armies (ai.ts, `managed`); the player
 * makes the president's choices on one to three Decision Cards a month, orders attacks or defence
 * per nation, and reads a three-line report. Everything here is pure and deterministic: the cards
 * are derived from the state, so the UI and the worker always agree on what a card does.
 */
import { nationName, traitsOf, type World } from './world';
import type { Command, GameState, Iso3, NationState, Proposal, SimpleState } from './types';
import type { Effect } from './world';
import {
  alliesOf,
  atWar,
  clamp,
  controlShare,
  controlledRegions,
  effectiveGdp,
  enemiesOf,
  getRelation,
  hasTreaty,
  isAtWar,
  militaryPower,
  warBetween,
  worldGdp,
} from './query';
import { evaluateProposal } from './diplomacy';
import { canIssueWarBonds, monthlyRevenue } from './economy';
import { neighboursOf } from './ai';
import { DETERRENCE_TURN, standingRanking } from './victory';
import { blocsOfNation } from './blocs';
import type { BlocId } from './types';

export const CARDS_PER_TURN = 3;
export const BIAS_STEP = 5;
export const BIAS_MIN = -15;
export const BIAS_MAX = 15;

export function emptySimple(): SimpleState {
  return { militaryBias: 0, stances: {}, decided: {}, report: [], reportTurn: -1 };
}

export const isSimple = (state: GameState): boolean => state.mode === 'simple';

// --- words for numbers ------------------------------------------------------------------------

export interface Odds {
  /** Our side's strength ÷ theirs (allies included). */
  readonly ratio: number;
  /** Plain words: "Likely win, heavy losses". */
  readonly words: string;
  readonly tone: 'good' | 'neutral' | 'bad';
}

/** Strength of each side if we fought `target` now (or in the war we are already fighting). */
export function warOdds(world: World, state: GameState, target: Iso3): Odds {
  const p = state.player;
  const war = warBetween(state, p, target);
  let mine = 0;
  let theirs = 0;
  if (war) {
    const mySide = war.attackers.includes(p) ? war.attackers : war.defenders;
    const other = mySide === war.attackers ? war.defenders : war.attackers;
    for (const x of mySide) mine += state.nations[x]?.alive ? militaryPower(world, state, x) : 0;
    for (const x of other) theirs += state.nations[x]?.alive ? militaryPower(world, state, x) : 0;
  } else {
    mine = militaryPower(world, state, p);
    for (const x of alliesOf(world, state, p)) if (x !== target) mine += 0.4 * militaryPower(world, state, x);
    theirs = militaryPower(world, state, target);
    for (const x of alliesOf(world, state, target)) if (x !== p) theirs += 0.4 * militaryPower(world, state, x);
  }
  const ratio = mine / Math.max(1, theirs);
  return { ratio, ...oddsWords(ratio) };
}

export function oddsWords(ratio: number): { words: string; tone: Odds['tone'] } {
  if (ratio >= 2.5) return { words: 'Likely win, light losses', tone: 'good' };
  if (ratio >= 1.5) return { words: 'Likely win, heavy losses', tone: 'good' };
  if (ratio >= 1) return { words: 'Close fight, heavy losses on both sides', tone: 'neutral' };
  if (ratio >= 0.6) return { words: 'Likely to fail, heavy losses', tone: 'bad' };
  return { words: 'Almost certain defeat', tone: 'bad' };
}

export function relationWords(rel: number): string {
  if (rel >= 60) return 'Close friend';
  if (rel >= 25) return 'Friendly';
  if (rel > -25) return 'Neutral';
  if (rel > -60) return 'Unfriendly';
  return 'Hostile';
}

/** "China will be furious", "Japan will be pleased" — how a relations change will land. */
export function feeling(name: string, delta: number): string {
  if (delta <= -15) return `${name} will be furious`;
  if (delta < 0) return `${name} will be annoyed`;
  if (delta >= 10) return `${name} will be very pleased`;
  return `${name} will be pleased`;
}

// --- decision cards ---------------------------------------------------------------------------

export type CardKind = 'crisis' | 'deal' | 'war' | 'threat' | 'money' | 'sanctions' | 'alliance' | 'bloc' | 'spending';

export interface CardOption {
  /** Button text, plain English. */
  readonly label: string;
  /** Likely effect in words. */
  readonly effect: string;
  readonly tone: 'good' | 'neutral' | 'bad' | 'risky';
  /** False for choices a cautious adviser would warn against (a war we would lose, leaving a bloc). */
  readonly sensible: boolean;
  /** The existing orders this choice carries out, in order. */
  readonly actions: readonly Command[];
}

export interface DecisionCard {
  readonly id: string;
  readonly kind: CardKind;
  readonly title: string;
  readonly text: string;
  /** The nation the card is about (the UI shows its flag and flies the camera there). */
  readonly nation: Iso3 | null;
  readonly options: readonly CardOption[];
  readonly priority: number;
  /** Months before an answered card of this id may come back. */
  readonly cooldown: number;
}

const name = (world: World, iso: Iso3) => nationName(world, iso);

/** Cards answered during the current turn. */
export function answeredThisTurn(state: GameState): number {
  const d = state.simple?.decided ?? {};
  return Object.values(d).filter((t) => t === state.turn).length;
}

/**
 * This month's Decision Cards, most important first: at most three a month in all, and at least
 * one at the start of every month (military spending, when nothing else is on the desk).
 */
export function decisionCards(world: World, state: GameState): DecisionCard[] {
  const me = state.nations[state.player];
  if (!me?.alive || state.victory || state.defeat) return [];
  const answered = answeredThisTurn(state);
  if (answered >= CARDS_PER_TURN) return [];
  const decided = state.simple?.decided ?? {};
  const open = (c: DecisionCard) => {
    const t = decided[c.id];
    return t === undefined || state.turn - t >= c.cooldown;
  };
  const all = allCards(world, state);
  const cards = all.filter(open).sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const shown = cards.slice(0, CARDS_PER_TURN - answered);
  if (shown.length === 0 && answered === 0) {
    const spending = all.find((c) => c.kind === 'spending');
    if (spending) shown.push(spending);
  }
  return shown;
}

/** The card and option a `decide` command names, or an error message. */
export function findDecision(world: World, state: GameState, cardId: string, option: number): CardOption | string {
  const card = decisionCards(world, state).find((c) => c.id === cardId);
  if (!card) return 'That decision is no longer on the desk.';
  const opt = card.options[option];
  if (!opt) return 'Unknown choice.';
  return opt;
}

function allCards(world: World, state: GameState): DecisionCard[] {
  const out: DecisionCard[] = [];
  out.push(...crisisCards(world, state));
  out.push(...dealCards(world, state));
  out.push(...warCards(world, state));
  const threat = threatCard(world, state);
  if (threat) out.push(threat);
  const money = moneyCard(world, state);
  if (money) out.push(money);
  out.push(...sanctionCards(world, state, threat?.nation ?? null));
  const ally = allianceCard(world, state);
  if (ally) out.push(ally);
  const bloc = blocCard(state);
  if (bloc) out.push(bloc);
  out.push(spendingCard(state));
  return out;
}

// Crises: the event deck's player decisions ------------------------------------------------------

function crisisCards(world: World, state: GameState): DecisionCard[] {
  return state.pendingEvents.map((p, i) => {
    const ev = world.eventById.get(p.eventId);
    const ctx = { player: state.player, target: p.target };
    const options: CardOption[] = p.choices.slice(0, 3).map((c, idx) => {
      const effects = ev?.choices[idx]?.effects ?? [];
      const s = effectWords(world, state, ctx, effects);
      return {
        label: c.label,
        effect: s.text,
        tone: s.tone,
        sensible: s.sensible,
        actions: [{ type: 'resolveEvent', pendingId: p.id, choice: idx }],
      };
    });
    return {
      id: `crisis:${p.id}`,
      kind: 'crisis' as const,
      title: p.title,
      text: shorten(p.text, 170),
      nation: p.target,
      options,
      priority: 100 - i,
      cooldown: 0,
    };
  });
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** Plain words for an event choice's effects. */
export function effectWords(
  world: World,
  state: GameState,
  ctx: { player: Iso3; target: Iso3 | null },
  effects: readonly Effect[],
): { text: string; tone: CardOption['tone']; sensible: boolean } {
  const who = (ref: string | undefined): Iso3 | null => (ref === 'PLAYER' ? ctx.player : ref === 'TARGET' ? ctx.target : ref ?? null);
  const me = state.player;
  const phrases: string[] = [];
  let good = 0;
  let bad = 0;
  let sensible = true;
  let risky = false;
  const add = (p: string) => {
    if (!phrases.includes(p)) phrases.push(p);
  };
  for (const e of effects) {
    switch (e.type) {
      case 'war': {
        const a = who(e.a);
        const b = who(e.b);
        if (a === me && b) {
          const odds = warOdds(world, state, b);
          add(`War with ${name(world, b)}: ${odds.words.toLowerCase()}`);
          risky = true;
          if (odds.ratio < 1) sensible = false;
        } else if (b === me && a) {
          add(`${name(world, a)} attacks us`);
          bad += 2;
        } else add('A war breaks out');
        break;
      }
      case 'peace':
        add('Brings peace');
        good += 2;
        break;
      case 'relation': {
        const a = who(e.a);
        const b = who(e.b);
        const other = a === me ? b : b === me ? a : null;
        if (other && Math.abs(e.delta) >= 5) {
          add(feeling(name(world, other), e.delta));
          if (e.delta < 0) bad++;
          else good++;
        }
        break;
      }
      case 'tension':
      case 'flashpoint':
        if (e.delta >= 5) {
          add('Raises the danger of war');
          bad++;
        } else if (e.delta <= -5) {
          add('Calms things down');
          good++;
        }
        break;
      case 'stability':
      case 'support':
        if (who(e.nation) === me) {
          add(e.delta < 0 ? 'Unpopular at home' : 'Popular at home');
          if (e.delta < 0) bad++;
          else good++;
        }
        break;
      case 'treasury':
      case 'gdp':
      case 'growth': {
        if (who(e.nation) !== me) break;
        const v = e.type === 'treasury' ? e.pctGdp : e.type === 'gdp' ? e.pct : e.delta;
        add(v < 0 ? (e.type === 'treasury' ? 'Costs money' : 'Hurts the economy') : 'Good for the economy');
        if (v < 0) bad++;
        else good++;
        break;
      }
      case 'defcon':
        if (who(e.nation) === me && e.delta < 0) {
          add('Puts our forces on higher alert');
          bad++;
        }
        break;
      case 'sanction':
        if (who(e.from) === me) add(`We sanction ${name(world, who(e.to) ?? '')}`);
        else if (who(e.to) === me) {
          add(`${name(world, who(e.from) ?? '')} sanctions us`);
          bad++;
        }
        break;
      case 'liftSanction':
        if (who(e.to) === me) {
          add('Sanctions on us are lifted');
          good++;
        }
        break;
      case 'units':
        if (who(e.nation) === me) {
          add('More troops for us');
          good++;
        }
        break;
      case 'mobilize':
        if (who(e.nation) === me) add('Calls up the reserves');
        break;
      case 'legitimacy':
        if (who(e.nation) === me && Math.abs(e.delta) >= 2) {
          add(e.delta < 0 ? 'Looks bad abroad' : 'Earns respect abroad');
          if (e.delta < 0) bad++;
          else good++;
        }
        break;
      default:
        break;
    }
  }
  const text = phrases.length === 0 ? 'Little changes' : phrases.slice(0, 3).join('; ');
  const tone: CardOption['tone'] = risky ? 'risky' : good > bad ? 'good' : bad > good ? 'bad' : 'neutral';
  return { text, tone, sensible };
}

// Deals: proposals from other governments --------------------------------------------------------

const ACCEPT_WORDS: Partial<Record<Proposal['type'], string>> = {
  trade: 'More trade and money; better relations',
  nap: 'We promise not to fight each other',
  defensive: 'They will defend us, and we them',
  alliance: 'A full alliance: we join each other’s wars',
  peaceWhite: 'The war ends; both sides go home',
  peaceStatusQuo: 'The war ends; each side keeps what it holds',
};

function dealCards(world: World, state: GameState): DecisionCard[] {
  const out: DecisionCard[] = [];
  for (const p of state.proposals) {
    if (p.to !== state.player || !state.nations[p.from]?.alive) continue;
    const from = name(world, p.from);
    const peace = p.type === 'peaceWhite' || p.type === 'peaceStatusQuo';
    let accept = ACCEPT_WORDS[p.type] ?? 'We agree to their terms';
    let title = `${from} offers a deal`;
    if (p.type === 'deal' && p.deal) {
      const arms = p.deal.get.find((g) => g.kind === 'arms');
      title = arms ? `${from} asks us for weapons` : `${from} proposes a package`;
      accept = arms ? `Costs us ${arms.kind === 'arms' ? arms.units : 0} brigades of equipment; ${from} will be very grateful` : 'We take their package';
    } else if (peace) title = `${from} wants peace`;
    else if (p.type === 'defensive' || p.type === 'alliance') title = `${from} wants an alliance`;
    else if (p.type === 'trade') title = `${from} wants a trade deal`;
    out.push({
      id: `deal:${p.id}`,
      kind: 'deal',
      title,
      text: shorten(p.text, 220),
      nation: p.from,
      options: [
        { label: 'Accept', effect: accept, tone: 'good', sensible: true, actions: [{ type: 'respond', proposalId: p.id, accept: true }] },
        {
          label: 'Reject',
          effect: peace ? 'The war goes on' : feeling(from, -4),
          tone: peace ? 'bad' : 'neutral',
          sensible: true,
          actions: [{ type: 'respond', proposalId: p.id, accept: false }],
        },
      ],
      // Peace first, then pacts with great powers; trade offers only fill an empty desk.
      priority: peace ? 95 : p.type === 'defensive' || p.type === 'alliance' ? (world.nations.get(p.from)?.major ? 72 : 50) : p.type === 'deal' ? 62 : 30,
      cooldown: 0,
    });
  }
  return out;
}

// Wars: push, hold or talk --------------------------------------------------------------------------

function warCards(world: World, state: GameState): DecisionCard[] {
  const p = state.player;
  const enemies = enemiesOf(state, p)
    .filter((e) => state.nations[e]?.alive)
    .sort((a, b) => militaryPower(world, state, b) - militaryPower(world, state, a) || (a < b ? -1 : 1))
    .slice(0, 2);
  const held = Math.round(controlShare(world, state, p) * 100);
  return enemies.map((e, i) => {
    const odds = warOdds(world, state, e);
    const peace = evaluateProposal(world, state, p, e, 'peaceWhite');
    const stance = state.simple?.stances[e];
    const order = stance === 'attack' ? 'Our armies are attacking.' : stance === 'defend' ? 'Our armies are holding the line.' : 'Our generals are fighting as they see fit.';
    return {
      id: `war:${e}`,
      kind: 'war' as const,
      title: `War with ${name(world, e)}`,
      text: `We hold ${held === 100 ? 'all' : `${held}%`} of our homeland. ${order} If we push now: ${odds.words.toLowerCase()}.`,
      nation: e,
      options: [
        { label: 'Attack', effect: odds.words, tone: odds.tone === 'bad' ? 'risky' : odds.tone, sensible: odds.ratio >= 1, actions: [{ type: 'setStance', target: e, stance: 'attack' }] },
        { label: 'Hold the line', effect: 'Fewer losses; the war drags on', tone: 'neutral', sensible: true, actions: [{ type: 'setStance', target: e, stance: 'defend' }] },
        {
          label: 'Offer peace',
          effect: peace.accept ? `${name(world, e)} would probably agree` : `${name(world, e)} will probably refuse`,
          tone: peace.accept ? 'good' : 'neutral',
          sensible: true,
          actions: [{ type: 'propose', proposal: 'peaceWhite', target: e }],
        },
      ],
      priority: 90 - i,
      cooldown: 3,
    };
  });
}

// Threats: a hostile power that may attack us -------------------------------------------------------

function threatCard(world: World, state: GameState): DecisionCard | null {
  const p = state.player;
  const myPower = militaryPower(world, state, p);
  const near = neighboursOf(world, state, p);
  let best: { iso: Iso3; score: number; planned: boolean } | null = null;
  for (const n of Object.values(state.nations)) {
    if (!n.alive || n.iso3 === p || atWar(state, p, n.iso3)) continue;
    const plan = state.warPlans?.[n.iso3];
    const planned = plan?.target === p;
    const rel = getRelation(world, state, p, n.iso3);
    const relevant = world.nations.get(n.iso3)?.major || near.has(n.iso3);
    if (!planned && !(relevant && rel <= -50 && militaryPower(world, state, n.iso3) >= myPower * 0.4)) continue;
    const score = (planned ? 100 + (plan?.readiness ?? 0) * 50 : 0) - rel;
    if (!best || score > best.score) best = { iso: n.iso3, score, planned };
  }
  if (!best) return null;
  const x = best.iso;
  const xn = name(world, x);
  const odds = warOdds(world, state, x);
  const bias = state.simple?.militaryBias ?? 0;
  const sanctioned = state.sanctions.includes(`${p}>${x}`);
  const talks = evaluateProposal(world, state, p, x, 'nap');
  const middle: CardOption = sanctioned
    ? {
        label: 'Offer talks',
        effect: talks.accept ? `${xn} would probably agree to a no-war pact` : `${xn} will probably refuse`,
        tone: talks.accept ? 'good' : 'neutral',
        sensible: true,
        actions: [{ type: 'propose', proposal: 'nap', target: x }],
      }
    : {
        label: 'Impose sanctions',
        effect: `Hurts their economy and a little of ours; ${xn} will be furious`,
        tone: 'neutral',
        sensible: true,
        actions: [{ type: 'propose', proposal: 'sanction', target: x }],
      };
  return {
    id: `threat:${x}`,
    kind: 'threat',
    title: best.planned ? `${xn} is preparing for war` : `${xn} is hostile`,
    text: best.planned
      ? `Our spies say ${xn}'s leadership is planning a war against us. If it came to a fight today: ${odds.words.toLowerCase()}.`
      : `Relations with ${xn} are ${relationWords(getRelation(world, state, p, x)).toLowerCase()}. If it came to a fight today: ${odds.words.toLowerCase()}.`,
    nation: x,
    options: [
      {
        label: 'Guard the border',
        effect: 'Armies move to the border; more money goes to the military',
        tone: 'neutral',
        sensible: true,
        actions: [
          { type: 'setStance', target: x, stance: 'defend' },
          { type: 'setMilitaryBias', bias: clamp(bias + BIAS_STEP, BIAS_MIN, BIAS_MAX) },
        ],
      },
      middle,
      {
        label: 'Strike first',
        effect: `Starts a war: ${odds.words.toLowerCase()}`,
        tone: 'risky',
        sensible: odds.ratio >= 1.5,
        actions: [{ type: 'setStance', target: x, stance: 'attack' }],
      },
    ],
    priority: best.planned ? 82 : 60,
    cooldown: 6,
  };
}

// Money ---------------------------------------------------------------------------------------------

function moneyCard(world: World, state: GameState): DecisionCard | null {
  const me = state.nations[state.player]!;
  const revenue = monthlyRevenue(me, controlShare(world, state, state.player));
  const short = me.treasury < 0 || (me.finances.deficit > 0 && me.treasury < revenue * 0.5);
  if (!short) return null;
  const bias = state.simple?.militaryBias ?? 0;
  const options: CardOption[] = [
    {
      label: 'Spend less on the military',
      effect: 'Saves money; a weaker army over time',
      tone: 'neutral',
      sensible: true,
      actions: [{ type: 'setMilitaryBias', bias: clamp(bias - BIAS_STEP, BIAS_MIN, BIAS_MAX) }],
    },
    {
      label: 'Raise taxes',
      effect: 'More money; less popular at home',
      tone: 'neutral',
      sensible: true,
      actions: [{ type: 'setTaxRate', rate: me.taxRate + 3 }],
    },
  ];
  if (canIssueWarBonds(state, state.player) === null)
    options.push({ label: 'Sell war bonds', effect: 'Money now; more debt later', tone: 'neutral', sensible: true, actions: [{ type: 'issueWarBonds' }] });
  else options.push({ label: 'Wait and see', effect: 'Debt keeps growing', tone: 'bad', sensible: true, actions: [] });
  return {
    id: 'money',
    kind: 'money',
    title: 'We are running short of money',
    text: me.treasury < 0 ? 'The treasury is empty and we are borrowing to pay the bills.' : 'We are spending more than we earn and the treasury is nearly empty.',
    nation: null,
    options,
    priority: 75,
    cooldown: 4,
  };
}

// Sanctions -----------------------------------------------------------------------------------------

function sanctionCards(world: World, state: GameState, skip: Iso3 | null): DecisionCard[] {
  const p = state.player;
  const out: DecisionCard[] = [];
  // Lift sanctions on a nation we have warmed to.
  for (const key of state.sanctions) {
    if (!key.startsWith(`${p}>`)) continue;
    const x = key.slice(p.length + 1);
    if (!state.nations[x]?.alive || atWar(state, p, x)) continue;
    const rel = getRelation(world, state, p, x);
    if (rel <= 0) continue;
    out.push({
      id: `lift:${x}`,
      kind: 'sanctions',
      title: `Lift sanctions on ${name(world, x)}?`,
      text: `Relations with ${name(world, x)} have improved, but our sanctions are still in place.`,
      nation: x,
      options: [
        { label: 'Lift sanctions', effect: `Trade recovers; ${name(world, x)} will be pleased`, tone: 'good', sensible: true, actions: [{ type: 'propose', proposal: 'liftSanction', target: x }] },
        { label: 'Keep them', effect: 'Nothing changes', tone: 'neutral', sensible: true, actions: [] },
      ],
      priority: 48,
      cooldown: 12,
    });
    break;
  }
  // Sanction a hostile nation.
  const near = neighboursOf(world, state, p);
  const hostile = Object.values(state.nations)
    .filter((n) => n.alive && n.iso3 !== p && n.iso3 !== skip && !atWar(state, p, n.iso3) && !state.sanctions.includes(`${p}>${n.iso3}`))
    .filter((n) => (world.nations.get(n.iso3)?.major || near.has(n.iso3)) && getRelation(world, state, p, n.iso3) <= -40)
    .sort((a, b) => getRelation(world, state, p, a.iso3) - getRelation(world, state, p, b.iso3) || (a.iso3 < b.iso3 ? -1 : 1))[0];
  if (hostile) {
    const x = hostile.iso3;
    out.push({
      id: `sanction:${x}`,
      kind: 'sanctions',
      title: `Sanction ${name(world, x)}?`,
      text: `${name(world, x)} is ${relationWords(getRelation(world, state, p, x)).toLowerCase()} toward us. Sanctions cut trade to punish them.`,
      nation: x,
      options: [
        { label: 'Impose sanctions', effect: `Hurts their economy and a little of ours; ${name(world, x)} will be furious`, tone: 'neutral', sensible: true, actions: [{ type: 'propose', proposal: 'sanction', target: x }] },
        { label: 'Hold off', effect: 'Nothing changes', tone: 'neutral', sensible: true, actions: [] },
      ],
      priority: 45,
      cooldown: 12,
    });
  }
  return out;
}

// Alliances -----------------------------------------------------------------------------------------

function allianceCard(world: World, state: GameState): DecisionCard | null {
  const p = state.player;
  const candidates = [...new Set([...world.majors, ...neighboursOf(world, state, p)])].filter(
    (x) =>
      x !== p &&
      state.nations[x]?.alive &&
      !atWar(state, p, x) &&
      !hasTreaty(state, p, x, 'defensive') &&
      !hasTreaty(state, p, x, 'alliance') &&
      !alliesOf(world, state, p).includes(x) &&
      getRelation(world, state, p, x) >= 45,
  );
  candidates.sort((a, b) => militaryPower(world, state, b) - militaryPower(world, state, a) || (a < b ? -1 : 1));
  const x = candidates.find((c) => evaluateProposal(world, state, p, c, 'defensive').accept);
  if (!x) return null;
  const theirWars = enemiesOf(state, x).filter((e) => state.nations[e]?.alive);
  return {
    id: `ally:${x}`,
    kind: 'alliance',
    title: `Alliance with ${name(world, x)}?`,
    text: `${name(world, x)} is friendly and would sign a defence pact: each side promises to fight if the other is attacked.${theirWars.length ? ` They are at war with ${theirWars.slice(0, 2).map((e) => name(world, e)).join(' and ')}.` : ''}`,
    nation: x,
    options: [
      {
        label: 'Sign the pact',
        effect: theirWars.length ? 'They will help defend us; we may be pulled into their war' : 'They will help defend us; we may be pulled into their wars',
        tone: 'good',
        sensible: true,
        actions: [{ type: 'propose', proposal: 'defensive', target: x }],
      },
      { label: 'Not now', effect: 'Nothing changes', tone: 'neutral', sensible: true, actions: [] },
    ],
    priority: 44,
    cooldown: 12,
  };
}

// Blocs: break an alliance that is falling apart ---------------------------------------------------

function blocCard(state: GameState): DecisionCard | null {
  const p = state.player;
  const weak = blocsOfNation(state, p)
    .map((b) => ({ b, c: state.blocs[b]?.cohesion ?? 100 }))
    .filter((x) => (x.b === 'NATO' || x.b === 'CSTO' || x.b === 'AUKUS' || x.b === 'SCO') && x.c < 30)
    .sort((a, b) => a.c - b.c)[0];
  if (!weak) return null;
  const bloc: BlocId = weak.b;
  return {
    id: `bloc:${bloc}`,
    kind: 'bloc',
    title: `${bloc} is falling apart`,
    text: `Members of ${bloc} no longer trust one another. We can stay and hope it recovers, or walk out.`,
    nation: null,
    options: [
      { label: `Stay in ${bloc}`, effect: 'We keep its protection, for what it is worth', tone: 'neutral', sensible: true, actions: [] },
      { label: `Leave ${bloc}`, effect: 'We lose its protection; members will be upset', tone: 'bad', sensible: false, actions: [{ type: 'leaveBloc', bloc }] },
    ],
    priority: 40,
    cooldown: 12,
  };
}

// Military spending (the card that is always on the desk) -----------------------------------------

function spendingCard(state: GameState): DecisionCard {
  const me = state.nations[state.player]!;
  const bias = state.simple?.militaryBias ?? 0;
  const war = isAtWar(state, state.player);
  const up = clamp(bias + BIAS_STEP, BIAS_MIN, BIAS_MAX);
  const down = clamp(bias - BIAS_STEP, BIAS_MIN, BIAS_MAX);
  const options: CardOption[] = [];
  if (up !== bias)
    options.push({ label: 'Spend more on the military', effect: 'A stronger army; less money for everything else', tone: war ? 'good' : 'neutral', sensible: true, actions: [{ type: 'setMilitaryBias', bias: up }] });
  options.push({ label: 'Keep it as it is', effect: 'Nothing changes', tone: 'neutral', sensible: true, actions: [] });
  if (down !== bias)
    options.push({ label: 'Spend less on the military', effect: 'More money and public support; a weaker army', tone: war ? 'bad' : 'good', sensible: true, actions: [{ type: 'setMilitaryBias', bias: down }] });
  return {
    id: 'spending',
    kind: 'spending',
    title: 'Military spending',
    text: `The armed forces get ${me.budget.military}% of the budget.${war ? ' We are at war.' : ''} Your ministers run the rest of the economy for you.`,
    nation: null,
    options,
    priority: 10,
    cooldown: 6,
  };
}

// --- goal tracker --------------------------------------------------------------------------------

export interface Goal {
  /** One line: "Be the top power in 2040 without a nuclear war: 64% of the way there". */
  readonly text: string;
  readonly pct: number;
  /** Longer explanation for the tooltip. */
  readonly detail: string;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** How to win and how close the player is (D-086). */
export function goalProgress(world: World, state: GameState): Goal {
  const p = state.player;
  if (state.detonations === 0) {
    const ranking = standingRanking(world, state);
    const rank = Math.max(1, ranking.findIndex((s) => s.iso === p) + 1 || ranking.length);
    const time = clamp(state.turn / DETERRENCE_TURN, 0, 1);
    const place = rank === 1 ? 1 : Math.max(0.3, 1 - 0.15 * (rank - 1));
    const pct = Math.round(100 * time * place);
    return {
      text: `Be the top power in 2040 without a nuclear war: ${pct}% of the way there`,
      pct,
      detail: `Win by reaching January 2040 with no nuclear weapon ever used, as the great power that gained the most: a growing economy and the land you hold. Today you rank ${ordinal(rank)} of ${ranking.length}; ${DETERRENCE_TURN - state.turn} months to go. The percentage is the share of time that has passed, reduced while you are not first.`,
    };
  }
  const total = worldGdp(world, state) || 1;
  const bloc = [p, ...alliesOf(world, state, p)];
  const share = bloc.reduce((s, iso) => s + effectiveGdp(world, state, iso), 0) / total;
  const pct = Math.round(clamp(share / 0.55, 0, 1) * 100);
  return {
    text: `Lead an alliance with over half the world economy: ${pct}% of the way there`,
    pct,
    detail: `A nuclear weapon has been used, so the peaceful path to 2040 is gone. You can still win by leading a group of allies with 55% of the world's economy and a third of its people. Your side has ${Math.round(share * 100)}% of the world economy.`,
  };
}

// --- meters ----------------------------------------------------------------------------------------

export interface Meter {
  readonly value: number;
  readonly words: string;
  readonly tone: 'good' | 'neutral' | 'bad';
}

/** Military strength as a share of the strongest great power's (100 = strongest), and the rank. */
export function strengthMeter(world: World, state: GameState): Meter & { rank: number; of: number } {
  const powers = world.majors.filter((m) => state.nations[m]?.alive).map((m) => ({ m, v: militaryPower(world, state, m) })).sort((a, b) => b.v - a.v);
  const mine = militaryPower(world, state, state.player);
  const top = Math.max(1, powers[0]?.v ?? 1);
  const rank = powers.findIndex((x) => x.m === state.player) + 1 || powers.length;
  const value = Math.round((100 * mine) / top);
  return { value, rank, of: powers.length, words: rank === 1 ? 'Strongest in the world' : `${ordinal(rank)} strongest`, tone: rank <= 3 ? 'good' : rank <= 8 ? 'neutral' : 'bad' };
}

/** Danger of nuclear war, 0–100: world tension, raised by our own alert level. */
export function nuclearDanger(state: GameState): Meter {
  const me = state.nations[state.player]!;
  const value = Math.round(clamp(Math.max(state.globalTension, (5 - me.defcon) * 22), 0, 100));
  const words = value >= 80 ? 'Extreme' : value >= 60 ? 'High' : value >= 35 ? 'Rising' : 'Low';
  return { value, words, tone: value >= 60 ? 'bad' : value >= 35 ? 'neutral' : 'good' };
}

export function supportMeter(n: NationState): Meter {
  const v = Math.round(n.support);
  return { value: v, words: v >= 60 ? 'Popular' : v >= 45 ? 'Mixed' : v >= 35 ? 'Unpopular' : 'Very unpopular', tone: v >= 50 ? 'good' : v >= 38 ? 'neutral' : 'bad' };
}

// --- end-of-turn report -----------------------------------------------------------------------------

export interface ReportBefore {
  readonly enemies: Iso3[];
  readonly support: number;
  readonly defcon: number;
  readonly treasury: number;
  readonly regions: number;
  readonly detonations: number;
}

export function reportBefore(state: GameState): ReportBefore {
  const me = state.nations[state.player]!;
  return {
    enemies: enemiesOf(state, state.player),
    support: me.support,
    defcon: me.defcon,
    treasury: me.treasury,
    regions: controlledRegions(state, state.player).length,
    detonations: state.detonations,
  };
}

const money = (bn: number) => (Math.abs(bn) >= 1000 ? `$${(Math.abs(bn) / 1000).toFixed(1)} trillion` : `$${Math.round(Math.abs(bn))} billion`);
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Three short bullets about the month just resolved, most important first (D-086). */
export function turnReport(world: World, before: ReportBefore, state: GameState): string[] {
  const p = state.player;
  const me = state.nations[p]!;
  const items: { score: number; text: string }[] = [];
  const now = enemiesOf(state, p);
  const fresh = now.filter((e) => !before.enemies.includes(e));
  const ended = before.enemies.filter((e) => !now.includes(e) && state.nations[e]?.alive);
  if (!me.alive) items.push({ score: 200, text: 'Our government has surrendered.' });
  if (state.detonations > before.detonations) items.push({ score: 150, text: 'A nuclear weapon was used this month. The world is far more dangerous now.' });
  if (fresh.length) items.push({ score: 120, text: `War: ${list(fresh.slice(0, 3).map((e) => name(world, e)))} ${fresh.length === 1 ? 'is' : 'are'} now at war with us.` });
  if (ended.length) items.push({ score: 110, text: `Peace: our war with ${list(ended.slice(0, 3).map((e) => name(world, e)))} is over.` });
  const summary = state.summary;
  const lost = summary?.regionsLost ?? 0;
  const gained = summary?.regionsGained ?? 0;
  if (lost > 0) items.push({ score: 100, text: `We lost ${lost} region${lost === 1 ? '' : 's'} to the enemy.` });
  if (gained > 0) items.push({ score: 95, text: `Our armies captured ${gained} region${gained === 1 ? '' : 's'}.` });
  if ((summary?.battles ?? 0) > 0 && lost === 0 && gained === 0)
    items.push({ score: 60, text: `Our forces fought ${summary!.battles} battle${summary!.battles === 1 ? '' : 's'}; the front did not move.` });
  const ongoing = now.filter((e) => before.enemies.includes(e) && state.nations[e]?.alive);
  if (ongoing.length && lost === 0 && gained === 0)
    items.push({ score: 45, text: `The war with ${list(ongoing.slice(0, 2).map((e) => name(world, e)))} goes on. We hold ${Math.round(controlShare(world, state, p) * 100) === 100 ? 'all' : `${Math.round(controlShare(world, state, p) * 100)}%`} of our homeland.` });
  if (me.defcon < before.defcon)
    items.push({ score: 80, text: `Danger rose: our forces moved to a higher alert level (DEFCON ${me.defcon}; 5 is peacetime, 1 means ready for nuclear war).` });
  else if (me.defcon > before.defcon) items.push({ score: 50, text: `Danger eased: our alert level dropped to DEFCON ${me.defcon} (5 is peacetime).` });
  const ds = Math.round(me.support - before.support);
  if (Math.abs(ds) >= 2) items.push({ score: 52 + Math.abs(ds), text: `Public support ${ds > 0 ? 'rose' : 'fell'} to ${Math.round(me.support)} out of 100.` });
  const left = me.nextElection !== null ? me.nextElection - state.turn : null;
  if (left !== null && left > 0 && left <= 3) items.push({ score: 65, text: `An election is ${left} month${left === 1 ? '' : 's'} away. If public support is low, we could lose power.` });
  const dt = me.treasury - before.treasury;
  if (Math.abs(dt) >= 1) items.push({ score: 40, text: dt > 0 ? `We put ${money(dt)} into the bank.` : `We spent ${money(dt)} more than we earned.` });
  const techs = summary?.techsCompleted ?? [];
  if (techs.length) items.push({ score: 30, text: `Our scientists finished: ${list(techs.slice(0, 2).map((t) => world.techs.get(t)?.name ?? t))}.` });
  const headlineText = state.news[0];
  if (headlineText) items.push({ score: 20, text: `Around the world: ${headlineText.replace(/\.$/, '')}.` });
  items.sort((a, b) => b.score - a.score);
  const out = items.slice(0, 3).map((i) => i.text);
  return out.length ? out : ['A quiet month.'];
}

/** Leader traits in words, for the Simple HUD's "your ministers" tooltip. */
export function managementStyle(world: World, state: GameState): string {
  const t = traitsOf(world, state.player, state);
  const parts: string[] = [];
  parts.push(t.aggression >= 60 ? 'bold' : t.aggression <= 35 ? 'cautious' : 'steady');
  if (t.economicPriority >= 60) parts.push('economy-first');
  if (t.paranoia >= 60) parts.push('security-minded');
  return parts.join(', ');
}
