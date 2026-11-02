/**
 * Blocs (D-071): live membership and cohesion for NATO, CSTO, SCO, AUKUS (and the economic blocs),
 * NATO Article 5 / CSTO Article 4 obligations decided member by member, annual summits, and
 * members walking out when relations collapse.
 */
import { nationName, traitsOf, type World } from './world';
import type { BlocId, BlocState, GameState, Iso3, War } from './types';
import { adjustRelation, alliesOf, atWar, bumpDiplomacy, clamp, headline, log, setRelation } from './query';
import { adjustLegitimacy, agendaWeight, opinionOf, remember } from './personality';
import { issueDispatch } from './statements';
import { tradableTech } from './deals';
import { completeTech } from './research';

export const BLOC_IDS: readonly BlocId[] = ['NATO', 'CSTO', 'SCO', 'AUKUS', 'EU', 'Quad', 'BRICS', 'GCC'];
/** Blocs with behaviour beyond membership. */
export const ACTIVE_BLOCS: readonly BlocId[] = ['NATO', 'CSTO', 'SCO', 'AUKUS'];
/** Blocs whose members are bound to defend each other. */
export const DEFENCE_BLOCS: readonly BlocId[] = ['NATO', 'CSTO'];

/** Month of the annual summit (NATO: early summer; SCO: late summer; AUKUS: December; CSTO: November). */
const SUMMIT_MONTH: Partial<Record<BlocId, number>> = { NATO: 7, SCO: 9, CSTO: 11, AUKUS: 12 };
/** Leading members whose relations with a member decide whether it stays. */
const LEADERS: Partial<Record<BlocId, Iso3[]>> = {
  NATO: ['USA', 'GBR', 'FRA', 'DEU'],
  CSTO: ['RUS'],
  SCO: ['CHN', 'RUS'],
  AUKUS: ['USA', 'GBR', 'AUS'],
};
const ARTICLE: Partial<Record<BlocId, string>> = { NATO: 'Article 5', CSTO: 'Article 4' };
export const BLOC_NAMES: Record<BlocId, string> = {
  NATO: 'North Atlantic Treaty Organization',
  CSTO: 'Collective Security Treaty Organization',
  SCO: 'Shanghai Cooperation Organisation',
  AUKUS: 'AUKUS security partnership',
  EU: 'European Union',
  Quad: 'Quadrilateral Security Dialogue',
  BRICS: 'BRICS',
  GCC: 'Gulf Cooperation Council',
};

export function initBlocs(world: World): Record<BlocId, BlocState> {
  const out = {} as Record<BlocId, BlocState>;
  for (const id of BLOC_IDS) {
    out[id] = {
      members: world.nationList.filter((n) => n.blocs.includes(id)).map((n) => n.iso3),
      cohesion: id === 'NATO' ? 62 : id === 'CSTO' ? 45 : id === 'SCO' ? 50 : id === 'AUKUS' ? 70 : 55,
      // Turn 0 is January 2027: the first summit falls in its month of 2027.
      nextSummit: SUMMIT_MONTH[id] ? SUMMIT_MONTH[id]! - 1 : 9999,
      departed: [],
    };
  }
  return out;
}

export function blocsOfNation(state: GameState, iso: Iso3): BlocId[] {
  return BLOC_IDS.filter((b) => state.blocs[b]?.members.includes(iso));
}

/** Leader nation that speaks for the bloc (first living leading member, else the largest member). */
function spokesman(state: GameState, bloc: BlocId): Iso3 | null {
  const members = state.blocs[bloc]?.members ?? [];
  for (const l of LEADERS[bloc] ?? []) if (members.includes(l) && state.nations[l]?.alive) return l;
  let best: Iso3 | null = null;
  for (const m of members) if (state.nations[m]?.alive && (!best || state.nations[m]!.gdp > state.nations[best]!.gdp)) best = m;
  return best;
}

/** Nations adjacent by land to `iso`'s regions. */
function borders(world: World, state: GameState, a: Iso3, b: Iso3): boolean {
  for (const id of world.regionsByNation.get(a) ?? [])
    for (const nb of world.regions.get(id)!.neighbours) if (state.regions[nb]?.controller === b) return true;
  return false;
}

/**
 * Willingness (0..~120) of `ally` to fight for `defender` against `attacker`. ≥ 45 joins the war.
 * Article 5 does not oblige a member to fight — each decides "such action as it deems necessary".
 */
export function obligationWillingness(world: World, state: GameState, ally: Iso3, defender: Iso3, attacker: Iso3, bloc: BlocId | null): number {
  const t = traitsOf(world, ally);
  let w =
    t.allianceLoyalty +
    25 * agendaWeight(world, ally, 'alliancePreservation') -
    25 * agendaWeight(world, ally, 'transactional') -
    30 * agendaWeight(world, ally, 'nonAlignment') +
    (opinionOf(world, state, ally, defender) - 30) / 2;
  if (opinionOf(world, state, ally, attacker) < -40) w += 10;
  if ((state.nations[attacker]?.warheads ?? 0) > 0 && (state.nations[ally]?.warheads ?? 0) === 0) w -= 10;
  if (bloc) w += (state.blocs[bloc]!.cohesion - 50) / 2 + 15;
  if (borders(world, state, ally, attacker) || borders(world, state, ally, defender)) w += 15;
  return w;
}

/**
 * Called when `attacker` declares war on `defender`: every defence partner decides whether to fight.
 * Replaces the blanket D-024 rule. Partners also allied to the attacker stay neutral.
 */
export function honourObligations(world: World, state: GameState, war: War, attacker: Iso3, defender: Iso3): void {
  const defBlocs = DEFENCE_BLOCS.filter((b) => state.blocs[b]?.members.includes(defender) && !state.blocs[b]!.members.includes(attacker));
  for (const b of defBlocs) {
    const voice = spokesman(state, b);
    if (voice)
      issueDispatch(world, state, voice, attacker, 'communique', `The ${b} invokes ${ARTICLE[b]}: an armed attack on ${nationName(world, defender)} is an attack on all members.`);
    log(state, { kind: 'war', text: `${b} invokes ${ARTICLE[b]} after the attack on ${nationName(world, defender)}.`, nations: [defender, attacker], alert: true });
    headline(state, `${b} invokes ${ARTICLE[b]} for ${nationName(world, defender)}`);
  }
  const attackerAllies = new Set(alliesOf(world, state, attacker));
  for (const ally of alliesOf(world, state, defender)) {
    if (ally === attacker || war.attackers.includes(ally) || war.defenders.includes(ally)) continue;
    if (!state.nations[ally]?.alive) continue;
    if (attackerAllies.has(ally)) {
      log(state, { kind: 'diplomacy', text: `${nationName(world, ally)} is bound to both sides and stays out of the war between ${nationName(world, attacker)} and ${nationName(world, defender)}.`, nations: [ally], alert: ally === state.player });
      continue;
    }
    const bloc = defBlocs.find((b) => state.blocs[b]!.members.includes(ally)) ?? null;
    const w = ally === state.player ? 100 : obligationWillingness(world, state, ally, defender, attacker, bloc);
    if (w >= 45) {
      war.defenders.push(ally);
      setRelation(state, ally, attacker, -100);
      remember(state, defender, ally, 'favour', 20, bloc ? `honoured ${ARTICLE[bloc]}` : 'honoured its defence pact');
      remember(state, attacker, ally, 'grievance', 15, 'joined the war against us');
      adjustLegitimacy(state, ally, 2);
      log(state, {
        kind: 'war',
        text: `${nationName(world, ally)} ${bloc ? `honours ${ARTICLE[bloc]}` : `honours its defence pact with ${nationName(world, defender)}`} and enters the war against ${nationName(world, attacker)}.`,
        nations: [ally, attacker, defender],
        alert: ally === state.player || attacker === state.player || defender === state.player,
      });
    } else if (bloc) {
      remember(state, defender, ally, 'grievance', 6, `sat out ${ARTICLE[bloc]}`);
      log(state, {
        kind: 'diplomacy',
        text: `${nationName(world, ally)} answers ${ARTICLE[bloc]} with aid and condemnation but no troops (willingness ${Math.round(w)}).`,
        nations: [ally, defender],
        alert: defender === state.player,
      });
    } else {
      remember(state, defender, ally, 'grievance', 15, 'abandoned its defence pact');
      adjustLegitimacy(state, ally, -5);
      issueDispatch(world, state, defender, ally, 'warning', `${nationName(world, ally)} signed a pact and walked away when it mattered.`);
      log(state, {
        kind: 'diplomacy',
        text: `${nationName(world, ally)} fails to honour its defence pact with ${nationName(world, defender)} (willingness ${Math.round(w)}).`,
        nations: [ally, defender],
        alert: defender === state.player || ally === state.player,
      });
    }
  }
}

/** Cohesion target from member relations, shared threats, wars between members and departures. */
export function cohesionTarget(world: World, state: GameState, bloc: BlocId): number {
  const b = state.blocs[bloc]!;
  const members = b.members.filter((m) => state.nations[m]?.alive);
  if (members.length < 2) return 0;
  // The largest members carry the bloc: sample relations among the top six by GDP.
  const core = [...members].sort((x, y) => state.nations[y]!.gdp - state.nations[x]!.gdp).slice(0, 6);
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < core.length; i++)
    for (let j = i + 1; j < core.length; j++) {
      sum += opinionOf(world, state, core[i]!, core[j]!);
      pairs++;
    }
  let target = 45 + (pairs ? sum / pairs : 0) / 2;
  // A common adversary binds: the major the core likes least.
  let threat = 0;
  for (const x of world.majors) {
    if (members.includes(x) || !state.nations[x]?.alive) continue;
    const avg = core.reduce((s, m) => s + opinionOf(world, state, m, x), 0) / core.length;
    threat = Math.max(threat, -avg);
  }
  target += clamp((threat - 30) / 3, 0, 15);
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) if (atWar(state, members[i]!, members[j]!)) target -= 30;
  target -= b.departed.filter((d) => state.turn - d.turn < 24).length * 8;
  // Transactional leaders strain an alliance.
  for (const m of core) target -= 6 * agendaWeight(world, m, 'transactional');
  return clamp(target, 0, 100);
}

function leave(world: World, state: GameState, bloc: BlocId, iso: Iso3, reason: string): void {
  const b = state.blocs[bloc]!;
  b.members = b.members.filter((m) => m !== iso);
  b.departed.push({ iso3: iso, turn: state.turn });
  if (b.departed.length > 8) b.departed.shift();
  b.cohesion = clamp(b.cohesion - 8, 0, 100);
  bumpDiplomacy(state);
  for (const l of LEADERS[bloc] ?? []) {
    if (l === iso || !state.nations[l]?.alive) continue;
    adjustRelation(world, state, l, iso, -15);
    remember(state, l, iso, 'grievance', 10, `walked out of ${bloc}`);
  }
  log(state, { kind: 'diplomacy', text: `${nationName(world, iso)} leaves ${bloc}: ${reason}`, nations: [iso], alert: true });
  headline(state, `${nationName(world, iso)} quits ${bloc}`);
  issueDispatch(world, state, iso, null, 'communique', `${nationName(world, iso)} withdraws from the ${BLOC_NAMES[bloc]}. ${reason}`);
}

/** The player's command to leave a bloc. */
export function leaveBloc(world: World, state: GameState, iso: Iso3, bloc: BlocId): void {
  if (!state.blocs[bloc]?.members.includes(iso)) return;
  leave(world, state, bloc, iso, 'The government no longer sees its interests served by membership.');
}

function summit(world: World, state: GameState, bloc: BlocId): void {
  const b = state.blocs[bloc]!;
  const members = b.members.filter((m) => state.nations[m]?.alive);
  const host = spokesman(state, bloc);
  if (!host || members.length < 2) return;
  const strength = b.cohesion / 100;
  // Summits warm relations among the core in proportion to cohesion; a fractious summit sours them.
  const core = [...members].sort((x, y) => state.nations[y]!.gdp - state.nations[x]!.gdp).slice(0, 8);
  for (let i = 0; i < core.length; i++)
    for (let j = i + 1; j < core.length; j++) adjustRelation(world, state, core[i]!, core[j]!, b.cohesion >= 45 ? 3 * strength : -2);
  // Name the common threat.
  let threat: Iso3 | null = null;
  let worst = 0;
  for (const x of world.majors) {
    if (members.includes(x) || !state.nations[x]?.alive) continue;
    const avg = core.reduce((s, m) => s + opinionOf(world, state, m, x), 0) / core.length;
    if (avg < worst) {
      worst = avg;
      threat = x;
    }
  }
  if (threat && worst < -30) for (const m of core) adjustRelation(world, state, m, threat, -2);
  // Burden sharing (NATO): transactional leaders press members spending little on defence.
  let laggards = 0;
  if (bloc === 'NATO')
    for (const m of members) {
      if (m === state.player) continue;
      if ((state.nations[m]?.budget.military ?? 0) < 15) {
        laggards++;
        for (const l of core) if (agendaWeight(world, l, 'transactional') > 0) remember(state, l, m, 'grievance', 3, 'not paying its share');
        const n = state.nations[m]!;
        // Pressed members raise defence spending a little (AI budgets are recomputed each month,
        // so this works through the memory above and the cohesion bonus below).
        n.stability = clamp(n.stability - 0.5, 0, 100);
      }
    }
  // AUKUS Pillar II: advanced-capability sharing among members.
  if (bloc === 'AUKUS')
    for (const a of members)
      for (const r of members) {
        if (a === r) continue;
        const tech = tradableTech(world, state, a, r);
        if (tech && b.cohesion >= 50) {
          completeTech(world, state, r, tech);
          break;
        }
      }
  const verdict =
    b.cohesion >= 65 ? 'reaffirms unity' : b.cohesion >= 45 ? 'papers over its differences' : 'ends in open division';
  const threatText = threat && worst < -30 ? ` and names ${nationName(world, threat)} the principal threat` : '';
  const burden = bloc === 'NATO' && laggards > 0 ? ` ${laggards} members are pressed to spend more on defence.` : '';
  const text = `${bloc} summit ${verdict}${threatText}.${burden}`;
  issueDispatch(world, state, host, null, 'communique', text);
  log(state, { kind: 'diplomacy', text, nations: members.includes(state.player) ? [state.player, host] : [host], alert: members.includes(state.player) });
}

export function runBlocs(world: World, state: GameState): void {
  for (const bloc of ACTIVE_BLOCS) {
    const b = state.blocs[bloc];
    if (!b) continue;
    b.members = b.members.filter((m) => state.nations[m]?.alive);
    b.cohesion = clamp(b.cohesion + 0.1 * (cohesionTarget(world, state, bloc) - b.cohesion), 0, 100);
    if (state.turn >= b.nextSummit) {
      summit(world, state, bloc);
      b.nextSummit = state.turn + 12;
    }
    // Departures: a member at war with another member, or whose relations with the bloc's
    // leading powers have collapsed while the bloc is weak.
    for (const m of [...b.members]) {
      if (m === state.player) continue;
      const enemyInside = b.members.find((x) => x !== m && atWar(state, m, x));
      if (enemyInside) {
        leave(world, state, bloc, m, `It is at war with fellow member ${nationName(world, enemyInside)}.`);
        continue;
      }
      const leaders = (LEADERS[bloc] ?? []).filter((l) => l !== m && b.members.includes(l) && state.nations[l]?.alive);
      if (leaders.length === 0) continue;
      const avg = leaders.reduce((s, l) => s + opinionOf(world, state, m, l), 0) / leaders.length;
      if (avg < -30 && b.cohesion < 40 && hashRoll(state.turn, m, bloc) < 0.08)
        leave(world, state, bloc, m, `Relations with the ${bloc} leadership have collapsed (opinion ${Math.round(avg)}).`);
    }
  }
}

/** Deterministic per-(turn, nation, bloc) draw that does not consume the simulation RNG. */
function hashRoll(turn: number, iso: string, bloc: string): number {
  let h = 2166136261 ^ turn;
  for (const s of [iso, bloc]) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
