/**
 * Military and financial aid as AI diplomacy (D-072). Each month every NATO/EU member (and a few
 * like-minded autocracies on the other side) decides how much to send to a partner at war with a
 * rival, scaled by relations, the leader's traits and agenda, domestic approval and proximity to
 * the aggressor. Aid arrives as money (treasury), arms (formations delivered through the
 * recipient's production queue) and munitions (a supply and recovery bonus).
 *
 * Calibration: Kiel Institute Ukraine Support Tracker — 2022–2025 allocations average roughly
 * 0.1–0.3 % of donor GDP a year for the large Western donors and up to ~1 % for the Nordic and
 * Baltic states; since 2025 US aid has largely shifted to allied purchases of US weapons (PURL).
 */
import { nationName, traitsOf, type World } from './world';
import type { AidFlow, GameState, Iso3, War } from './types';
import { atWar, clamp, controlShare, isLand, log } from './query';
import { agendaWeight, inBloc, opinionOf, remember } from './personality';
import { unitCost } from './economy';
import { isAlly } from './deals';
import { issueDispatch } from './statements';

/** Baseline aid: 0.25 % of GDP a year before multipliers; cap 1.2 %. */
export const AID_BASE_SHARE = 0.0025;
export const AID_CAP_SHARE = 0.012;
/** Split of each donor's package. */
const SPLIT = { money: 0.4, arms: 0.45, munitions: 0.15 };
/** Formations delivered as arms aid, in rotation. */
const AID_TYPES = ['mechanized', 'artillery', 'airDefense'] as const;
const MAX_DELIVERIES = 2;

export interface AidAssessment {
  readonly perYear: number;
  readonly reason: string;
}

/** Nations with land regions adjacent to `iso`'s (land neighbours). */
function landNeighbours(world: World, state: GameState, iso: Iso3, cache: Map<Iso3, Set<Iso3>>): Set<Iso3> {
  let set = cache.get(iso);
  if (set) return set;
  set = new Set();
  for (const id of world.regionsByNation.get(iso) ?? []) {
    for (const nb of world.regions.get(id)!.neighbours) {
      if (!isLand(world, nb)) continue;
      const c = state.regions[nb]?.controller;
      if (c && c !== iso) set.add(c);
    }
  }
  cache.set(iso, set);
  return set;
}

/**
 * How much `donor` would send to `recipient` for its war against `enemy` this year (US$ bn), with a
 * one-line reason. Zero when the donor is not a supporter.
 */
export function assessAid(
  world: World,
  state: GameState,
  donor: Iso3,
  recipient: Iso3,
  enemy: Iso3,
  war: War,
  borders: Map<Iso3, Set<Iso3>> = new Map(),
): AidAssessment {
  const d = state.nations[donor];
  const r = state.nations[recipient];
  if (!d?.alive || !r?.alive || donor === recipient || donor === enemy) return { perYear: 0, reason: '' };
  if (state.aidSuspended.includes(donor)) return { perYear: 0, reason: `${nationName(world, donor)} has suspended aid.` };
  if (war.attackers.includes(donor) || war.defenders.includes(donor)) return { perYear: 0, reason: 'A combatant itself.' };
  if (isAlly(world, state, donor, enemy) || atWar(state, donor, recipient)) return { perYear: 0, reason: 'Allied with the other side.' };
  // Aid flows to nations that need it: never to a great power more than twice the donor's size.
  if (world.nations.get(recipient)?.major && r.gdp > d.gdp * 2) return { perYear: 0, reason: `${nationName(world, recipient)} does not need our help.` };
  const western = inBloc(world, state, donor, 'NATO') || inBloc(world, state, donor, 'EU');
  const toR = opinionOf(world, state, donor, recipient);
  const toE = opinionOf(world, state, donor, enemy);
  let blocF: number;
  if (western) {
    // Western donors back the victim of aggression.
    if (!war.defenders.includes(recipient)) return { perYear: 0, reason: 'Not the victim of aggression.' };
    if (toR < 5 || toE > -20) return { perYear: 0, reason: 'No rivalry with the aggressor.' };
    blocF = 1;
  } else {
    // Autocratic patrons back a like-minded regime against a common enemy.
    const patron = Math.max(agendaWeight(world, donor, 'regimeSurvival'), agendaWeight(world, donor, 'regionalHegemony'));
    if (patron < 0.5 || toR < 40 || toE > -40) return { perYear: 0, reason: '' };
    blocF = 0.4;
  }
  const t = traitsOf(world, donor, state);
  const relF = clamp((toR + 20) / 80, 0, 1.25);
  const traitF = clamp(
    0.5 +
      t.allianceLoyalty / 100 +
      0.3 * agendaWeight(world, donor, 'alliancePreservation') -
      0.5 * agendaWeight(world, donor, 'transactional') -
      0.3 * agendaWeight(world, donor, 'nonAlignment') +
      (t.aggression - 50) / 200,
    0.1,
    1.6,
  );
  const hostility = 0.5 + 0.6 * clamp((-toE - 25) / 50, 0, 1.2);
  const approvalF = clamp((d.support - 25) / 40, 0.25, 1.2);
  const near = landNeighbours(world, state, enemy, borders).has(donor);
  const threatF = near ? 1.6 : 1;
  const urgency = controlShare(world, state, recipient) < 0.9 ? 1.25 : 1;
  const share = Math.min(AID_CAP_SHARE, AID_BASE_SHARE * relF * traitF * hostility * approvalF * threatF * urgency * blocF);
  const perYear = d.gdp * share;
  const parts: string[] = [];
  if (near) parts.push('borders the aggressor');
  if (agendaWeight(world, donor, 'transactional') > 0) parts.push('sells rather than gives');
  if (approvalF < 0.6) parts.push(`aid fatigue at home (approval ${Math.round(d.support)})`);
  if (traitF > 1.2) parts.push('a loyal ally');
  return {
    perYear,
    reason: `${(share * 100).toFixed(2)} % of GDP a year${parts.length ? ` — ${parts.join(', ')}` : ''}.`,
  };
}

/** Main enemy of `iso` in `war`: the strongest nation on the other side. */
function mainEnemy(state: GameState, war: War, iso: Iso3): Iso3 | null {
  const other = war.attackers.includes(iso) ? war.defenders : war.attackers;
  let best: Iso3 | null = null;
  let gdp = -1;
  for (const x of other) {
    const g = state.nations[x]?.alive ? state.nations[x]!.gdp : -1;
    if (g > gdp) {
      gdp = g;
      best = x;
    }
  }
  return best;
}

/** Candidate donors: NATO and EU members, the majors and every nation with a researched leader. */
function candidateDonors(world: World, state: GameState): Iso3[] {
  const set = new Set<Iso3>();
  for (const b of ['NATO', 'EU'] as const) for (const m of state.blocs[b]?.members ?? []) set.add(m);
  for (const m of world.majors) set.add(m);
  for (const iso of world.leaders.keys()) set.add(iso);
  return [...set].sort();
}

export function runAid(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    n.aidSupply = 0;
    n.aidReceived = 0;
  }
  state.aid = [];
  if (state.wars.length === 0) return;
  const donors = candidateDonors(world, state);
  const borders = new Map<Iso3, Set<Iso3>>();
  const munitions = new Map<Iso3, number>();
  const usa = state.nations.USA;
  for (const war of state.wars) {
    for (const recipient of [...war.defenders, ...war.attackers]) {
      if (!state.nations[recipient]?.alive) continue;
      const enemy = mainEnemy(state, war, recipient);
      if (!enemy) continue;
      for (const donor of donors) {
        if (donor === state.player) continue;
        if (state.aid.some((f) => f.donor === donor && f.recipient === recipient)) continue;
        const a = assessAid(world, state, donor, recipient, enemy, war, borders);
        if (a.perYear <= 0.05) continue;
        const d = state.nations[donor]!;
        let month = a.perYear / 12;
        if (d.treasury < month * 3) month = Math.max(0, d.treasury * 0.2);
        if (month <= 0.01) continue;
        const transactional = agendaWeight(world, donor, 'transactional');
        const money = month * SPLIT.money * (1 - transactional);
        const arms = month * SPLIT.arms * (1 - 0.7 * transactional);
        const mun = month * SPLIT.munitions;
        deliver(world, state, donor, recipient, enemy, money, arms, mun, munitions);
        // PURL: European donors buy part of what they send from US industry.
        if (usa?.alive && donor !== 'USA' && transactional === 0 && inBloc(world, state, donor, 'NATO') && !atWar(state, 'USA', recipient))
          usa.treasury += arms * 0.25;
      }
      // The player's own programme (setAid).
      const level = state.playerAid[recipient] ?? 0;
      if (level > 0 && state.player !== recipient && !atWar(state, state.player, recipient)) {
        const p = state.nations[state.player]!;
        const month = Math.min(p.treasury * 0.5, (p.gdp * 0.001 * level) / 12);
        if (month > 0.01) deliver(world, state, state.player, recipient, enemy, month * SPLIT.money, month * SPLIT.arms, month * SPLIT.munitions, munitions);
      }
    }
  }
  // Programmes to nations no longer at war lapse.
  for (const k of Object.keys(state.playerAid)) if (!state.wars.some((w) => w.attackers.includes(k) || w.defenders.includes(k))) delete state.playerAid[k];
  // Munitions become a supply and recovery bonus; banked arms become formations.
  for (const [iso, mun] of munitions) {
    const n = state.nations[iso]!;
    n.aidSupply = clamp((mun / (Math.max(0, n.finances.military) + 0.5)) * 0.5, 0, 0.35);
    deliverFormations(world, state, iso);
  }
}

function deliver(
  world: World,
  state: GameState,
  donor: Iso3,
  recipient: Iso3,
  enemy: Iso3,
  money: number,
  arms: number,
  mun: number,
  munitions: Map<Iso3, number>,
): void {
  const d = state.nations[donor]!;
  const r = state.nations[recipient]!;
  const total = money + arms + mun;
  d.treasury -= total;
  r.treasury += money;
  r.aidArmsBank += arms;
  r.aidReceived += total;
  munitions.set(recipient, (munitions.get(recipient) ?? 0) + mun);
  state.aid.push({ donor, recipient, against: enemy, money, arms, munitions: mun });
  // Aid fatigue: nationalist publics sour on large foreign commitments.
  const t = traitsOf(world, donor, state);
  d.support = clamp(d.support - ((total * 12) / Math.max(1, d.gdp)) * 100 * 0.25 * (t.nationalism / 70), 0, 100);
  remember(state, recipient, donor, 'favour', 0.8, 'military and financial aid');
  if (world.nations.get(donor)?.major || world.nations.get(enemy)?.major) remember(state, enemy, donor, 'grievance', 0.5, 'arming our enemy');
  if (state.turn % 6 === 0 && total >= 0.4) {
    if (world.nations.get(enemy)?.major)
      issueDispatch(world, state, enemy, donor, 'warning', `Every shipment of weapons to ${nationName(world, recipient)} makes ${nationName(world, donor)} a party to this war.`);
    issueDispatch(world, state, recipient, donor, 'praise', `${nationName(world, donor)}'s support keeps our front standing.`);
  }
}

function deliverFormations(world: World, state: GameState, iso: Iso3): void {
  const n = state.nations[iso]!;
  const cap = world.capitalRegion.get(iso);
  if (cap === undefined) return;
  const region = state.regions[cap]?.controller === iso ? cap : (world.regionsByNation.get(iso) ?? []).find((r) => state.regions[r]?.controller === iso);
  if (region === undefined) return;
  let delivered = 0;
  while (delivered < MAX_DELIVERIES) {
    const type = AID_TYPES[(state.turn + delivered) % AID_TYPES.length]!;
    const cost = unitCost(world, state, iso, type);
    if (!Number.isFinite(cost) || n.aidArmsBank < cost) break;
    n.aidArmsBank -= cost;
    const donor = topDonor(state, iso);
    n.production.push(donor ? { id: state.nextId++, type, region, monthsLeft: 1, aidFrom: donor } : { id: state.nextId++, type, region, monthsLeft: 1 });
    delivered++;
  }
  // Excess equipment cannot be absorbed: the bank is capped at three formations' worth.
  n.aidArmsBank = Math.min(n.aidArmsBank, unitCost(world, state, iso, 'mechanized') * 3);
  if (delivered > 0 && iso === state.player)
    log(state, {
      kind: 'production',
      text: `Foreign arms aid: ${delivered} formation${delivered > 1 ? 's' : ''} arriving next month.`,
      nations: [iso],
      alert: false,
    });
}

function topDonor(state: GameState, iso: Iso3): Iso3 | null {
  let best: AidFlow | null = null;
  for (const f of state.aid) if (f.recipient === iso && (!best || f.arms > best.arms)) best = f;
  return best?.donor ?? null;
}

/** Total aid `iso` received last month by donor, largest first (for the UI). */
export function aidByDonor(state: GameState, iso: Iso3): AidFlow[] {
  return state.aid.filter((f) => f.recipient === iso).sort((a, b) => b.money + b.arms + b.munitions - (a.money + a.arms + a.munitions));
}
