/**
 * Strategic AI (D-071). Each AI major keeps a war plan: a target chosen from hostility, agenda
 * claims and flashpoints; a coalition it has sounded out; and a readiness threshold derived from its
 * leader's risk tolerance. It prepares (budgets, warnings) while readiness builds and attacks only
 * when the odds clear its threshold and a risk-weighted roll allows. Balancing coalitions form
 * against a runaway power — the player above all.
 */
import { nationName, traitsOf, type World } from './world';
import type { GameState, Iso3, WarPlan } from './types';
import { adjustRelation, alliesOf, atWar, clamp, effectiveGdp, enemiesOf, hasTreaty, headline, log, roll, worldGdp } from './query';
import { agendaClaim, agendaWeight, goalWeights, opinionOf, remember } from './personality';
import { evaluateDeal, isAlly, joinWar, powerOf, signTreaty } from './deals';
import { obligationWillingness } from './blocs';
import { issueDispatch } from './statements';
import { declareWar } from './diplomacy';
import { neighboursOf } from './ai';
import { deterrentAgainst } from './escalation';

/** Coalition forms at this threat index against the player (AI powers: COALITION_AI). */
export const COALITION_TRIGGER = 0.3;
export const COALITION_AI = 0.42;
export const COALITION_DISSOLVE = 0.22;

/** Highest tension of a flashpoint both nations are part of (0 if none). */
export function sharedFlashpoint(world: World, state: GameState, a: Iso3, b: Iso3): { id: string | null; tension: number } {
  let best: { id: string | null; tension: number } = { id: null, tension: 0 };
  for (const f of world.flashpoints) {
    if (!f.nations.includes(a) || !f.nations.includes(b)) continue;
    const t = state.flashpoints[f.id] ?? 0;
    if (t > best.tension) best = { id: f.id, tension: t };
  }
  return best;
}

/** Combined power of `iso`'s side against `enemy`: its own plus the allies likely to fight. */
function sidePower(world: World, state: GameState, iso: Iso3, enemy: Iso3, extra: readonly Iso3[] = []): number {
  let p = powerOf(world, state, iso);
  for (const c of extra) if (c !== iso && state.nations[c]?.alive) p += 0.6 * powerOf(world, state, c);
  for (const a of alliesOf(world, state, iso)) {
    if (extra.includes(a) || a === enemy || isAlly(world, state, a, enemy)) continue;
    const w = a === state.player ? 0.5 : obligationWillingness(world, state, a, iso, enemy, null) >= 45 ? 0.8 : 0.2;
    p += w * powerOf(world, state, a);
  }
  return p;
}

/** Force ratio a leader needs before attacking. Nuclear-armed targets raise the bar. */
export function attackThreshold(world: World, state: GameState, iso: Iso3, target: Iso3): number {
  const t = traitsOf(world, iso, state);
  let th = clamp(1.75 - t.riskTolerance / 120 - t.aggression / 400, 1.1, 1.7);
  const deter = deterrentAgainst(world, state, target, iso).status;
  const mine = state.nations[iso]?.warheads ?? 0;
  if (deter === 'assured') th *= 2.2;
  // A limited deterrent still makes a nuclear-armed attacker pause (D-081: India–Pakistan wars
  // were the commonest road to nuclear use in self-play at ×1.3).
  else if (deter === 'limited') th *= mine > 0 ? 1.6 : 1.8;
  return th;
}

interface Candidate {
  target: Iso3;
  score: number;
  reason: string;
}

function chooseTarget(world: World, state: GameState, iso: Iso3, neighbours: Set<Iso3>): Candidate | null {
  const g = goalWeights(world, iso, state);
  const pool = new Set<Iso3>(neighbours);
  for (const a of world.agendas.get(iso) ?? []) for (const x of [...a.targets, ...a.sphere]) pool.add(x);
  const coalition = state.coalition && state.coalition.members.includes(iso) ? state.coalition.target : null;
  if (coalition) pool.add(coalition);
  let best: Candidate | null = null;
  for (const x of pool) {
    if (x === iso || !state.nations[x]?.alive) continue;
    if (isAlly(world, state, iso, x) || hasTreaty(state, iso, x, 'nap')) continue;
    const op = opinionOf(world, state, iso, x);
    const isCoalitionTarget = x === coalition;
    if (op > -30 && !isCoalitionTarget) continue;
    const claim = agendaClaim(world, iso, x);
    const flash = sharedFlashpoint(world, state, iso, x);
    const ratio = powerOf(world, state, iso) / Math.max(1, sidePower(world, state, x, iso));
    let score = -op + 60 * claim.weight + 0.5 * flash.tension + 25 * clamp(ratio - 1, -1, 1) + (isCoalitionTarget ? 50 : 0);
    // Nuclear deterrence (D-076): an assured second strike (by the target or a nuclear ally) all but
    // rules a target out; a coalition shares the nuclear risk among its members.
    const deter = deterrentAgainst(world, state, x, iso).status;
    if (deter === 'assured') score -= isCoalitionTarget ? 35 : 90;
    else if (deter === 'limited') score -= (state.nations[iso]?.warheads ?? 0) > 0 ? 35 : 45;
    score *= 0.6 + g.expansion + (isCoalitionTarget ? g.security * 0.5 : 0);
    const bar = 70 + g.restraint * 25;
    if (score < bar || (best && score <= best.score)) continue;
    const reason = isCoalitionTarget
      ? `Containing ${nationName(world, x)}'s bid for hegemony.`
      : claim.agenda && claim.weight >= 0.4
        ? `${agendaText(claim.agenda.id, nationName(world, x))}${flash.id ? ` (${flash.id.replace(/-/g, ' ')} tension ${Math.round(flash.tension)})` : ''}.`
        : `Hostility toward ${nationName(world, x)} (opinion ${Math.round(op)})${flash.id ? ` and the ${flash.id.replace(/-/g, ' ')} flashpoint` : ''}.`;
    best = { target: x, score, reason };
  }
  return best;
}

function agendaText(id: string, target: string): string {
  switch (id) {
    case 'reunification':
      return `Reunification with ${target}`;
    case 'territorialRecovery':
      return `Recovering territory held by ${target}`;
    case 'regionalHegemony':
      return `Asserting regional primacy over ${target}`;
    default:
      return `Pressing its agenda against ${target}`;
  }
}

/** Sounds out allies and friends for a war on the plan's target (a joinWar ask, no payment). */
function recruit(world: World, state: GameState, iso: Iso3, target: Iso3): Iso3[] {
  const out: Iso3[] = [];
  const pool = new Set<Iso3>([...alliesOf(world, state, iso), ...world.majors, ...(state.coalition?.target === target ? state.coalition.members : [])]);
  const sorted = [...pool].filter((c) => c !== iso && c !== target && c !== state.player && state.nations[c]?.alive).sort();
  for (const c of sorted) {
    if (out.length >= 5) break;
    if (opinionOf(world, state, c, target) > -20 || isAlly(world, state, c, target)) continue;
    const v = evaluateDeal(world, state, { from: iso, to: c, give: [], get: [{ kind: 'joinWar', against: target }] }, false);
    if (v.verdict === 'accept') out.push(c);
  }
  return out;
}

function hash(turn: number, iso: string): number {
  let h = 2166136261 ^ turn;
  for (let i = 0; i < iso.length; i++) h = Math.imul(h ^ iso.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function runWarPlans(world: World, state: GameState): void {
  for (const iso of world.majors) {
    const n = state.nations[iso];
    if (!n?.alive || iso === state.player) {
      delete state.warPlans[iso];
      continue;
    }
    let plan = state.warPlans[iso];
    const invalid =
      plan &&
      (!state.nations[plan.target]?.alive || isAlly(world, state, iso, plan.target) || hasTreaty(state, iso, plan.target, 'nap'));
    const stale = plan && state.turn - plan.formed >= 18 && plan.readiness < 0.5;
    const review = (state.turn + (hash(0, iso) % 6)) % 6 === 0;
    if (!plan || invalid || stale || (review && !atWar(state, iso, plan.target))) {
      const c = chooseTarget(world, state, iso, neighboursOf(world, state, iso));
      if (!c) {
        delete state.warPlans[iso];
        continue;
      }
      if (!plan || plan.target !== c.target || invalid || stale) {
        plan = {
          target: c.target,
          coalition: [],
          threshold: attackThreshold(world, state, iso, c.target),
          odds: 0,
          readiness: 0,
          formed: state.turn,
          reason: c.reason,
          warned: false,
        };
        state.warPlans[iso] = plan;
      } else plan.reason = c.reason;
      plan.coalition = recruit(world, state, iso, plan.target);
    }
    const p: WarPlan = plan;
    p.threshold = attackThreshold(world, state, iso, p.target);
    p.odds = sidePower(world, state, iso, p.target, p.coalition) / Math.max(1, sidePower(world, state, p.target, iso));
    p.readiness = clamp(p.odds / p.threshold, 0, 1.5);
    if (atWar(state, iso, p.target)) continue;
    const t = traitsOf(world, iso, state);
    // Warn before striking: the readiness crossing is public.
    if (p.readiness >= 0.85 && !p.warned) {
      p.warned = true;
      issueDispatch(world, state, iso, p.target, 'threat', p.reason);
      remember(state, p.target, iso, 'grievance', 4, 'threatened us');
      const flash = sharedFlashpoint(world, state, iso, p.target);
      if (flash.id) state.flashpoints[flash.id] = clamp((state.flashpoints[flash.id] ?? 0) + 4, 0, 100);
    }
    if (p.readiness < 1) continue;
    // Strike only when the flashpoint is hot (or relations are beyond repair) and the dice allow.
    const flash = sharedFlashpoint(world, state, iso, p.target);
    const op = opinionOf(world, state, iso, p.target);
    const coalitionWar = state.coalition?.target === p.target && state.coalition.members.includes(iso);
    const hot = flash.id ? flash.tension >= 55 : op <= -60;
    if (!hot && !coalitionWar) continue;
    const busy = enemiesOf(state, iso).some((e) => world.nations.get(e)?.major && e !== p.target);
    if (busy) continue;
    // Build-up takes time: no attack in the first six months of a plan or before a public warning.
    if (state.turn - p.formed < 6 || !p.warned) continue;
    const claim = agendaClaim(world, iso, p.target).weight;
    const restraint = Math.min(1, goalWeights(world, iso, state).restraint);
    const chance =
      (t.aggression / 100) * (t.riskTolerance / 100) * 0.05 * (1 + claim) * (coalitionWar ? 1.5 : 1) * (1 - 0.5 * restraint);
    if (roll(state) >= chance) continue;
    n.aiNote = `${p.reason} Odds ${p.odds.toFixed(1)}:1 against a threshold of ${p.threshold.toFixed(1)}.`;
    declareWar(world, state, iso, p.target, n.aiNote);
    if (!atWar(state, iso, p.target)) continue;
    for (const c of p.coalition) {
      const v = evaluateDeal(world, state, { from: iso, to: c, give: [], get: [{ kind: 'joinWar', against: p.target }] }, false);
      if (v.verdict === 'accept') joinWar(world, state, c, iso, p.target, `Part of ${nationName(world, iso)}'s coalition.`);
    }
  }
}

// --- balancing coalitions ------------------------------------------------------------------------

/**
 * Threat a nation poses to the balance of power, 0..1: its share of world output and military
 * power, plus three times the output of foreign land it holds.
 */
export function dominanceOf(world: World, state: GameState, iso: Iso3): { dominance: number; expansion: number; threat: number } {
  const wg = Math.max(1, worldGdp(world, state));
  let totalPower = 0;
  for (const n of Object.values(state.nations)) if (n.alive) totalPower += powerOf(world, state, n.iso3);
  const dominance = 0.5 * (effectiveGdp(world, state, iso) / wg) + 0.5 * (powerOf(world, state, iso) / Math.max(1, totalPower));
  let conquered = 0;
  for (const r of Object.values(state.regions)) {
    if (r.controller !== iso) continue;
    const home = world.regions.get(r.id)?.iso3;
    if (!home || home === iso || !world.nations.has(home)) continue;
    // Value at the original nation's output (a conqueror's own GDP would inflate it).
    const homeGdp = state.nations[home]?.gdp ?? world.nations.get(home)?.gdpUsdBn ?? 0;
    conquered += homeGdp * (world.regions.get(r.id)?.populationShare ?? 0);
  }
  const expansion = conquered / wg;
  return { dominance, expansion, threat: dominance + 3 * expansion };
}

export function runCoalitions(world: World, state: GameState): void {
  const c = state.coalition;
  if (c) {
    if (!state.nations[c.target]?.alive) {
      state.coalition = null;
      return;
    }
    const d = dominanceOf(world, state, c.target);
    c.dominance = d.threat;
    c.members = c.members.filter((m) => state.nations[m]?.alive && !isAlly(world, state, m, c.target));
    if (d.threat < COALITION_DISSOLVE || c.members.length < 2) {
      log(state, { kind: 'diplomacy', text: `The coalition against ${nationName(world, c.target)} dissolves as the threat recedes.`, nations: [c.target], alert: true });
      state.coalition = null;
      return;
    }
    // Late joiners as the threat grows.
    if (state.turn % 3 === 0) for (const m of joiners(world, state, c.target, d.threat)) if (!c.members.includes(m)) c.members.push(m);
    return;
  }
  // Candidates: the player, then any AI power that runs away.
  const candidates: { iso: Iso3; threat: number }[] = [];
  const player = dominanceOf(world, state, state.player);
  if (state.nations[state.player]?.alive && player.threat >= COALITION_TRIGGER) candidates.push({ iso: state.player, threat: player.threat });
  if (state.turn % 6 === 0)
    for (const m of world.majors) {
      if (m === state.player || !state.nations[m]?.alive) continue;
      const d = dominanceOf(world, state, m);
      if (d.threat >= COALITION_AI) candidates.push({ iso: m, threat: d.threat });
    }
  const top = candidates.sort((a, b) => b.threat - a.threat)[0];
  if (!top) return;
  const members = joiners(world, state, top.iso, top.threat);
  if (members.length < 2) return;
  state.coalition = { target: top.iso, members, formed: state.turn, dominance: top.threat };
  // Bind the members: warmer relations, defensive pacts among the strongest, grievances against the hegemon.
  const core = [...members].sort((a, b) => powerOf(world, state, b) - powerOf(world, state, a)).slice(0, 5);
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++) adjustRelation(world, state, members[i]!, members[j]!, 10);
  for (let i = 0; i < core.length; i++)
    for (let j = i + 1; j < core.length; j++)
      if (!hasTreaty(state, core[i]!, core[j]!, 'defensive') && !hasTreaty(state, core[i]!, core[j]!, 'alliance') && !atWar(state, core[i]!, core[j]!))
        signTreaty(state, core[i]!, core[j]!, 'defensive');
  for (const m of members) {
    remember(state, m, top.iso, 'grievance', 10, 'hegemonic ambitions');
    // Members re-plan around the new enemy next month.
    delete state.warPlans[m];
  }
  const names = core.map((m) => nationName(world, m)).join(', ');
  log(state, {
    kind: 'diplomacy',
    text: `A balancing coalition forms against ${nationName(world, top.iso)}: ${names}${members.length > core.length ? ` and ${members.length - core.length} more` : ''} pledge mutual defence (threat index ${top.threat.toFixed(2)}).`,
    nations: [top.iso, ...core],
    alert: true,
  });
  headline(state, `${names} unite against ${nationName(world, top.iso)}`);
  issueDispatch(world, state, core[0]!, top.iso, 'communique', `${names} declare that no single power will be allowed to dominate. We stand together against ${nationName(world, top.iso)}.`);
}

/** AI nations willing to balance against `target` at the given threat level. */
function joiners(world: World, state: GameState, target: Iso3, threat: number): Iso3[] {
  const pool = new Set<Iso3>([...world.majors, ...world.leaders.keys()]);
  const out: Iso3[] = [];
  for (const m of [...pool].sort()) {
    if (m === target || m === state.player || !state.nations[m]?.alive) continue;
    if (isAlly(world, state, m, target)) continue;
    if (agendaWeight(world, m, 'nonAlignment') >= 0.8 && threat < 0.4) continue;
    const bar = 25 + (threat - COALITION_TRIGGER) * 150 + traitsOf(world, m, state).paranoia / 5;
    if (opinionOf(world, state, m, target) < bar) out.push(m);
  }
  return out;
}

/** Strategic layer for the month: coalitions first (they retarget war plans), then war plans. */
export function runStrategy(world: World, state: GameState): void {
  runCoalitions(world, state);
  runWarPlans(world, state);
}
