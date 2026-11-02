/**
 * UN Security Council (D-071): five permanent members with a veto and ten elected members (the real
 * 2027 council from data/unsc.json; replacements from 2028 are simulated). Resolutions — sanctions,
 * ceasefire, condemnation — need nine votes and no permanent-member veto. Adopted resolutions bind
 * through the members' choices; legitimacy rises and falls with the votes.
 */
import { nationName, type World } from './world';
import type { GameState, Iso3, Resolution, ResolutionKind, UnState, UnVote } from './types';
import { adjustRelation, alliesOf, atWar, clamp, headline, isAtWar, log, warBetween } from './query';
import { adjustLegitimacy, agendaWeight, inBloc, opinionOf, remember } from './personality';
import { issueDispatch } from './statements';
import { imposeSanction, makePeace } from './diplomacy';
import { isAlly } from './deals';

export const RESOLUTION_LABELS: Record<ResolutionKind, string> = {
  sanctions: 'Sanctions resolution',
  ceasefire: 'Ceasefire resolution',
  condemnation: 'Condemnation',
};

export function initUn(world: World): UnState {
  const electedUntil: Record<Iso3, number> = {};
  for (const e of world.unsc.elected) electedUntil[e.iso3] = e.until;
  return { council: [...world.unsc.permanent, ...world.unsc.elected.map((e) => e.iso3)], electedUntil, resolutions: [] };
}

export const isPermanent = (world: World, iso: Iso3): boolean => world.unsc.permanent.includes(iso);

/** Can `sponsor` table this resolution? Returns the problem, or null. */
export function resolutionProblem(world: World, state: GameState, sponsor: Iso3, kind: ResolutionKind, target: Iso3): string | null {
  if (!state.un.council.includes(sponsor)) return `${nationName(world, sponsor)} does not sit on the Security Council.`;
  if (sponsor === target) return 'A nation cannot table a resolution against itself.';
  if (!state.nations[target]?.alive) return 'That nation no longer exists.';
  if (state.un.resolutions.some((r) => r.status === 'pending')) return 'Another resolution is already before the Council.';
  if (kind === 'ceasefire' && !isAtWar(state, target)) return `${nationName(world, target)} is not at war.`;
  if (state.un.resolutions.some((r) => r.target === target && r.kind === kind && state.turn - r.turn < 6))
    return 'The Council considered the same resolution less than six months ago.';
  return null;
}

/** How a council member votes, with the reason. Deterministic. */
export function voteOf(world: World, state: GameState, member: Iso3, res: Pick<Resolution, 'kind' | 'sponsor' | 'target'>): { vote: UnVote; reason: string } {
  const { sponsor, target, kind } = res;
  if (member === target) return { vote: 'no', reason: 'It is the target.' };
  if (member === sponsor) return { vote: 'yes', reason: 'It tabled the resolution.' };
  if (isAlly(world, state, member, target)) return { vote: 'no', reason: `It protects its ally ${nationName(world, target)}.` };
  const toSponsor = opinionOf(world, state, member, sponsor);
  const toTarget = opinionOf(world, state, member, target);
  let score = (toSponsor - toTarget) / 2;
  const legit = state.nations[target]?.legitimacy ?? 50;
  score += (50 - legit) / 2;
  if (kind === 'ceasefire') score += 15;
  if (kind === 'sanctions') score -= 10 + 20 * agendaWeight(world, member, 'nonAlignment');
  // Solidarity among the SCO and against "unilateral" Western pressure.
  if (inBloc(world, state, member, 'SCO') && inBloc(world, state, target, 'SCO')) score -= 30;
  if (inBloc(world, state, member, 'NATO') && inBloc(world, state, sponsor, 'NATO')) score += 10;
  // The aggressor in a war against the member's friends.
  for (const w of state.wars)
    if (w.attackers.includes(target) && w.defenders.some((d) => opinionOf(world, state, member, d) >= 40)) {
      score += 20;
      break;
    }
  const nonAligned = agendaWeight(world, member, 'nonAlignment') >= 0.8 && Math.abs(score) < 40;
  if (nonAligned) return { vote: 'abstain', reason: 'Non-aligned: it abstains.' };
  if (score >= 15) return { vote: 'yes', reason: `Closer to ${nationName(world, sponsor)} than to ${nationName(world, target)}.` };
  if (score <= -20) return { vote: 'no', reason: `It sides with ${nationName(world, target)}.` };
  return { vote: 'abstain', reason: 'No strong view.' };
}

function resolutionText(world: World, kind: ResolutionKind, sponsor: Iso3, target: Iso3): string {
  const t = nationName(world, target);
  switch (kind) {
    case 'sanctions':
      return `Draft tabled by ${nationName(world, sponsor)}: binding sanctions on ${t}.`;
    case 'ceasefire':
      return `Draft tabled by ${nationName(world, sponsor)}: an immediate ceasefire in the wars involving ${t}.`;
    case 'condemnation':
      return `Draft tabled by ${nationName(world, sponsor)}: condemns the conduct of ${t}.`;
  }
}

/** Tables a resolution. The player's resolutions are voted at once; the AI's next month (so the player can vote). */
export function tableResolution(world: World, state: GameState, sponsor: Iso3, kind: ResolutionKind, target: Iso3): Resolution | null {
  if (resolutionProblem(world, state, sponsor, kind, target)) return null;
  const res: Resolution = {
    id: state.nextId++,
    kind,
    sponsor,
    target,
    turn: state.turn,
    text: resolutionText(world, kind, sponsor, target),
    votes: {},
    status: 'pending',
    vetoedBy: [],
  };
  state.un.resolutions.push(res);
  if (state.un.resolutions.length > 12) state.un.resolutions.splice(0, state.un.resolutions.length - 12);
  log(state, {
    kind: 'diplomacy',
    text: `UN Security Council: ${res.text}${sponsor === state.player ? '' : ' The vote is next month.'}`,
    nations: [sponsor, target],
    alert: state.un.council.includes(state.player) || target === state.player,
  });
  if (sponsor === state.player) voteResolution(world, state, res);
  return res;
}

/** The player's vote on a pending resolution (ignored when the player is not on the Council). */
export function castPlayerVote(state: GameState, resolutionId: number, vote: UnVote): void {
  const res = state.un.resolutions.find((r) => r.id === resolutionId && r.status === 'pending');
  if (!res || !state.un.council.includes(state.player)) return;
  res.votes[state.player] = vote;
}

export function voteResolution(world: World, state: GameState, res: Resolution): void {
  let yes = 0;
  for (const m of state.un.council) {
    if (!state.nations[m]?.alive) continue;
    if (m === state.player) {
      // A player who has not voted backs its own draft and opposes one aimed at itself.
      res.votes[m] ??= m === res.sponsor ? 'yes' : m === res.target ? 'no' : 'abstain';
    } else res.votes[m] = voteOf(world, state, m, res).vote;
    if (res.votes[m] === 'yes') yes++;
    if (res.votes[m] === 'no' && isPermanent(world, m)) res.vetoedBy.push(m);
  }
  const sponsor = nationName(world, res.sponsor);
  const target = nationName(world, res.target);
  if (res.vetoedBy.length > 0) {
    res.status = 'vetoed';
    for (const v of res.vetoedBy) {
      adjustLegitimacy(state, v, -3);
      remember(state, res.sponsor, v, 'grievance', 6, 'vetoed our resolution');
      adjustRelation(world, state, res.sponsor, v, -4);
    }
    adjustLegitimacy(state, res.target, -2);
    const who = res.vetoedBy.map((v) => nationName(world, v)).join(' and ');
    log(state, { kind: 'diplomacy', text: `UN: ${RESOLUTION_LABELS[res.kind]} on ${target} vetoed by ${who} (${yes} in favour).`, nations: [res.sponsor, res.target, ...res.vetoedBy], alert: true });
    headline(state, `${who} veto${res.vetoedBy.length > 1 ? '' : 'es'} UN ${res.kind} resolution on ${target}`);
    for (const v of res.vetoedBy) issueDispatch(world, state, v, res.sponsor, 'warning', `We will not allow the Council to be used as a weapon against ${target}.`);
    return;
  }
  if (yes < world.unsc.votesToPass) {
    res.status = 'failed';
    adjustLegitimacy(state, res.sponsor, -2);
    log(state, { kind: 'diplomacy', text: `UN: ${RESOLUTION_LABELS[res.kind]} on ${target} fails with ${yes} votes (${world.unsc.votesToPass} needed).`, nations: [res.sponsor, res.target], alert: true });
    return;
  }
  res.status = 'adopted';
  adjustLegitimacy(state, res.sponsor, 3);
  log(state, { kind: 'diplomacy', text: `UN Security Council adopts ${sponsor}'s ${RESOLUTION_LABELS[res.kind].toLowerCase()} on ${target} (${yes} votes).`, nations: [res.sponsor, res.target], alert: true });
  headline(state, `UN Security Council adopts ${res.kind} resolution on ${target}`);
  applyResolution(world, state, res);
}

function applyResolution(world: World, state: GameState, res: Resolution): void {
  const target = res.target;
  const yesVoters = Object.entries(res.votes).filter(([, v]) => v === 'yes').map(([k]) => k);
  switch (res.kind) {
    case 'condemnation':
      adjustLegitimacy(state, target, -10);
      state.nations[target]!.stability = clamp(state.nations[target]!.stability - 2, 0, 100);
      for (const y of yesVoters) {
        adjustRelation(world, state, target, y, -5);
        remember(state, target, y, 'grievance', 5, 'voted to condemn us');
      }
      return;
    case 'sanctions': {
      adjustLegitimacy(state, target, -15);
      let joined = 0;
      // Binding on all members; friends and allies of the target drag their feet.
      for (const n of Object.values(state.nations)) {
        if (!n.alive || n.iso3 === target || n.iso3 === state.player) continue;
        if (isAlly(world, state, n.iso3, target) || opinionOf(world, state, n.iso3, target) >= 30) continue;
        if (state.sanctions.includes(`${n.iso3}>${target}`)) continue;
        imposeSanction(world, state, n.iso3, target, true);
        joined++;
      }
      log(state, { kind: 'diplomacy', text: `${joined} nations implement UN sanctions on ${nationName(world, target)}.`, nations: [target], alert: true });
      return;
    }
    case 'ceasefire': {
      for (const w of [...state.wars]) {
        if (!w.attackers.includes(target) && !w.defenders.includes(target)) continue;
        const a = w.attackers[0]!;
        const d = w.defenders[0]!;
        // Each AI party weighs the ceasefire against its war aims; the player decides for itself.
        const accepts = (iso: Iso3) => {
          if (iso === state.player) return false;
          const n = state.nations[iso]!;
          const recovery = agendaWeight(world, iso, 'territorialRecovery');
          return n.warWeariness + (100 - (n.legitimacy ?? 50)) / 2 > 55 + 25 * recovery;
        };
        if (accepts(a) && accepts(d) && warBetween(state, a, d)) {
          makePeace(world, state, a, d, 'statusQuo');
          log(state, { kind: 'peace', text: `Under the UN ceasefire, ${nationName(world, a)} and ${nationName(world, d)} stop fighting.`, nations: [a, d], alert: true });
        } else
          for (const x of [a, d])
            if (!accepts(x)) {
              adjustLegitimacy(state, x, -6);
              for (const y of yesVoters) adjustRelation(world, state, x, y, -3);
            }
      }
      return;
    }
  }
}

/** Elected seats rotate each January from 2028 (simulated: the largest economy of the outgoing member's region not recently on the Council). */
function rotateCouncil(world: World, state: GameState): void {
  const year = state.date.year;
  const recent = new Set(state.un.council);
  for (const [iso, until] of Object.entries(state.un.electedUntil)) {
    if (until >= year) continue;
    const region = world.nations.get(iso)?.region;
    const pick = world.nationList
      .filter((n) => n.region === region && !recent.has(n.iso3) && !world.unsc.permanent.includes(n.iso3) && state.nations[n.iso3]?.alive)
      .sort((a, b) => (state.nations[b.iso3]!.gdp - state.nations[a.iso3]!.gdp) || a.iso3.localeCompare(b.iso3))[0];
    delete state.un.electedUntil[iso];
    state.un.council = state.un.council.filter((c) => c !== iso);
    if (pick) {
      state.un.council.push(pick.iso3);
      state.un.electedUntil[pick.iso3] = year + 1;
      recent.add(pick.iso3);
    }
  }
}

/**
 * Monthly: vote last month's pending AI resolution; legitimacy drifts back toward 50; occasionally a
 * council member tables a resolution against an aggressor or a nuclear user.
 */
export function runUn(world: World, state: GameState): void {
  if (state.date.month === 1 && state.date.year >= 2028) rotateCouncil(world, state);
  // Everything pending was tabled last month (the player has had a turn to vote).
  for (const res of state.un.resolutions) if (res.status === 'pending') voteResolution(world, state, res);
  for (const n of Object.values(state.nations)) if (n.alive && n.legitimacy !== 50) n.legitimacy += Math.sign(50 - n.legitimacy) * Math.min(0.5, Math.abs(50 - n.legitimacy));
  if (state.un.resolutions.some((r) => r.status === 'pending')) return;
  // Fresh aggression: a war started in the last two months by an attacker.
  for (const w of state.wars) {
    if (state.turn - w.since > 2 || w.since < 0) continue;
    const aggressor = w.attackers[0]!;
    const sponsor = pickSponsor(world, state, aggressor);
    if (!sponsor) continue;
    const kind: ResolutionKind = world.nations.get(aggressor)?.major ? 'condemnation' : 'ceasefire';
    if (tableResolution(world, state, sponsor, kind, aggressor)) {
      issueDispatch(world, state, sponsor, aggressor, 'condemnation', `We have asked the Security Council to act on the aggression of ${nationName(world, aggressor)}.`);
      return;
    }
  }
  // Long wars: a ceasefire push once a year.
  for (const w of state.wars) {
    if (state.turn - w.since < 12 || (state.turn - w.since) % 12 !== 0) continue;
    const party = w.attackers[0]!;
    const sponsor = pickSponsor(world, state, party, true);
    if (sponsor && tableResolution(world, state, sponsor, 'ceasefire', party)) return;
  }
  // Nuclear use: sanctions.
  if (state.detonations > 0)
    for (const s of state.strikes) {
      if (s.kind !== 'nuclear' || state.turn - s.turn > 1) continue;
      const sponsor = pickSponsor(world, state, s.attacker);
      if (sponsor && tableResolution(world, state, sponsor, 'sanctions', s.attacker)) return;
    }
}

/** The council member most hostile to `target` (or the most pragmatic for a ceasefire). */
function pickSponsor(world: World, state: GameState, target: Iso3, peacemaker = false): Iso3 | null {
  let best: Iso3 | null = null;
  let bestScore = peacemaker ? -Infinity : -20;
  for (const m of state.un.council) {
    if (m === state.player || m === target || !state.nations[m]?.alive || atWar(state, m, target)) continue;
    if (alliesOf(world, state, target).includes(m)) continue;
    const score = peacemaker ? 50 - Math.abs(opinionOf(world, state, m, target)) : -opinionOf(world, state, m, target);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
