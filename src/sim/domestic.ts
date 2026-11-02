/**
 * Domestic politics (D-061): public support for the government, protests, elections in
 * democracies and hybrid regimes, coup risk in autocracies. Only nations with a researched
 * leader (data/politics.json) have domestic politics; minors are AI-only.
 */
import { nationName, type World } from './world';
import type { GameState, Iso3, NationState, Regime } from './types';
import { clamp, controlShare, headline, isAtWar, log, roll } from './query';
import { DEFAULT_TAX_RATE, inflationAnchor } from './economy';
import { fictionalName } from './commanders';

export const MOBILIZATION_SUPPORT = [0, -3, -8];
/** Approval below which mass protests begin (repression raises the bar in autocracies). */
export const PROTEST_THRESHOLD: Record<Regime, number> = { democracy: 30, hybrid: 26, autocracy: 22 };
/** Elections falling in the player's first months move to this turn (a first-year grace). */
export const ELECTION_GRACE_TURNS = 6;

export interface SupportBreakdown {
  base: number;
  growth: number;
  inflation: number;
  taxes: number;
  social: number;
  warWeariness: number;
  rally: number;
  mobilization: number;
  shortages: number;
  territory: number;
  unemployment: number;
  stability: number;
  protests: number;
  target: number;
}

export function regimeOf(world: World, iso: Iso3): Regime | null {
  return world.politics.get(iso)?.regime ?? null;
}

/** The approval the public is drifting toward (support moves 12 % of the way each month). */
export function supportBreakdown(world: World, state: GameState, iso: Iso3): SupportBreakdown {
  const n = state.nations[iso]!;
  const base = 50;
  const growth = 2 * clamp(n.growth - 1, -5, 4);
  const inflation = -clamp(0.5 * Math.max(0, n.inflation - Math.max(4, inflationAnchor(world, state, iso))), 0, 25);
  const taxes = -0.6 * ((n.taxRate ?? DEFAULT_TAX_RATE) - DEFAULT_TAX_RATE);
  const social = 0.4 * (n.budget.social - 30);
  const warWeariness = -0.3 * n.warWeariness;
  const rally = isAtWar(state, iso) && n.warWeariness < 40 ? (40 - n.warWeariness) * 0.2 : 0;
  const mobilization = MOBILIZATION_SUPPORT[n.mobilization]!;
  const short = (r: 'food' | 'oil') => Math.max(0, (n.resourceRef?.[r] ?? 1) - (n.resources?.[r]?.satisfaction ?? 1));
  const shortages = -30 * short('food') - 10 * short('oil');
  const territory = -(1 - controlShare(world, state, iso)) * 40;
  const gap = n.gdp / Math.max(0.01, n.potentialGdp) - 1;
  const unemployment = (gap < 0 ? gap * 50 : 0) - (n.recession ? 4 : 0);
  const stability = (n.stability - 50) * 0.15;
  const protests = n.protestMonths > 0 ? -2 : 0;
  const target = clamp(
    base + growth + inflation + taxes + social + warWeariness + rally + mobilization + shortages + territory + unemployment + stability + protests,
    0,
    100,
  );
  return { base, growth, inflation, taxes, social, warWeariness, rally, mobilization, shortages, territory, unemployment, stability, protests, target };
}

/** Projected vote share of the governing side at the next election. */
export function projectedVoteShare(world: World, n: NationState): number {
  const regime = regimeOf(world, n.iso3);
  const incumbency = regime === 'hybrid' ? 10 : 1;
  return clamp(50 + (n.support - 50) * 0.7 + incumbency, 0, 100);
}

/** Chance the government survives the next election, 0..1. */
export function reelectionChance(world: World, n: NationState): number {
  const share = projectedVoteShare(world, n);
  return 1 / (1 + Math.exp(-(share - 50) / 2.5));
}

export interface CoupBreakdown {
  support: number;
  stability: number;
  defeat: number;
  army: number;
  recession: number;
  protests: number;
  regimeFactor: number;
  total: number;
}

/** Monthly coup probability in autocracies (hybrid regimes at half; democracies none). */
export function coupBreakdown(world: World, state: GameState, iso: Iso3): CoupBreakdown {
  const n = state.nations[iso]!;
  const regime = regimeOf(world, iso);
  const regimeFactor = regime === 'autocracy' ? 1 : regime === 'hybrid' ? 0.5 : 0;
  const support = Math.max(0, 35 - n.support) * 0.0006;
  const stability = Math.max(0, 30 - n.stability) * 0.0008;
  const held = controlShare(world, state, iso);
  const defeat = isAtWar(state, iso) && held < 0.8 ? (0.8 - held) * 0.02 : 0;
  const army = n.budget.military < 8 ? 0.002 : 0;
  const recession = n.recession ? 0.001 : 0;
  const protests = n.protestMonths >= 3 ? 0.003 : 0;
  const total = clamp((support + stability + defeat + army + recession + protests) * regimeFactor, 0, 0.08);
  return { support, stability, defeat, army, recession, protests, regimeFactor, total };
}

/** Turn of a "YYYY-MM" date (turn 0 = January 2027). */
function turnOf(date: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return null;
  return (Number(m[1]) - 2027) * 12 + (Number(m[2]) - 1);
}

/** Schedules the first election for every democracy and hybrid regime (from data/leaders.json). */
export function scheduleElections(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    const pol = world.politics.get(n.iso3);
    const leader = world.leaders.get(n.iso3);
    n.nextElection = null;
    if (!pol || pol.regime === 'autocracy' || !pol.termYears || !leader?.nextElection) continue;
    let t = turnOf(leader.nextElection);
    if (t === null) continue;
    while (t < 0) t += pol.termYears * 12;
    if (n.iso3 === state.player && t < ELECTION_GRACE_TURNS) t = ELECTION_GRACE_TURNS;
    n.nextElection = t;
  }
}

function replaceLeader(world: World, state: GameState, n: NationState, title: string | null): string {
  const name = fictionalName(world, state, n.iso3);
  n.leaderName = name;
  if (title) n.leaderTitle = title;
  n.leaderFictional = true;
  n.leaderSince = state.turn;
  n.leaderTermLimited = false;
  return name;
}

const CAUSE_TEXT: Record<string, string> = {
  health: 'steps down on health grounds',
  resignation: 'resigns',
  assassination: 'is killed',
  impeachment: 'resigns as impeachment proceedings close in',
  termLimit: 'leaves office at the end of the constitutional term limit',
};

/**
 * The leader leaves office outside an election (D-075): a designated successor — always a
 * generated, fictional person — takes over. Traits stay with the office (the party or regime line).
 */
export function succeedLeader(world: World, state: GameState, iso: Iso3, cause: string): string | null {
  const n = state.nations[iso];
  if (!n?.alive) return null;
  const before = n.leaderName;
  const successor = replaceLeader(world, state, n, null);
  const name = nationName(world, iso);
  n.stability = clamp(n.stability - (cause === 'assassination' ? 6 : 2), 0, 100);
  log(state, {
    kind: 'info',
    text: `${name}: ${before} ${CAUSE_TEXT[cause] ?? 'leaves office'}. ${successor} (fictional) succeeds as ${n.leaderTitle}.`,
    nations: [iso],
    alert: iso === state.player || !!world.nations.get(iso)?.major,
  });
  if (world.nations.get(iso)?.major || iso === state.player) headline(state, `${name}: ${successor} takes over after ${before} ${CAUSE_TEXT[cause] ?? 'leaves office'}`);
  return successor;
}

/** Monthly chance of a serious health crisis for a leader: rises with years in office (no ages are modelled). */
export function healthRisk(state: GameState, n: NationState): number {
  const years = Math.max(0, (state.turn - n.leaderSince) / 12);
  return clamp(0.0006 + Math.max(0, years - 4) * 0.00015, 0, 0.004);
}

/** Health crises: the player answers an event; AI leaders recover or hand over (D-075). */
function runHealth(world: World, state: GameState, n: NationState): void {
  if (!world.leaders.has(n.iso3) && !n.leaderFictional) return;
  if (roll(state) >= healthRisk(state, n)) return;
  if (n.iso3 === state.player) {
    if (state.pendingEvents.some((p) => p.eventId === 'leader-health')) return;
    const ev = world.eventById.get('leader-health');
    if (!ev) return;
    state.pendingEvents.push({
      id: `leader-health-${state.turn}`,
      eventId: ev.id,
      target: null,
      title: ev.title,
      text: ev.text.replaceAll('{PLAYER}', nationName(world, n.iso3)),
      choices: ev.choices.map((c) => ({ label: c.label, tooltip: c.tooltip })),
    });
    return;
  }
  if (roll(state) < 0.5) {
    if (world.nations.get(n.iso3)?.major)
      log(state, { kind: 'info', text: `${nationName(world, n.iso3)}: ${n.leaderName} is treated for a serious illness and returns to work.`, nations: [n.iso3], alert: false });
    return;
  }
  succeedLeader(world, state, n.iso3, 'health');
}

function holdElection(world: World, state: GameState, n: NationState): void {
  const pol = world.politics.get(n.iso3)!;
  // A term-limited leader cannot stand: the party's candidate loses the incumbency bonus (D-075).
  const limited = n.leaderTermLimited;
  const share = clamp(projectedVoteShare(world, n) - (limited ? (pol.regime === 'hybrid' ? 10 : 1) : 0) + (roll(state) - 0.5) * 6, 0, 100);
  const name = nationName(world, n.iso3);
  n.nextElection = pol.termYears ? state.turn + pol.termYears * 12 : null;
  if (share >= 50 && limited) {
    const before = n.leaderName;
    const successor = replaceLeader(world, state, n, null);
    n.support = clamp(n.support + 3, 0, 100);
    log(state, {
      kind: 'info',
      text: `${name} votes: ${before} was term-limited; the governing party's candidate ${successor} (fictional) wins with ${share.toFixed(1)} %.`,
      nations: [n.iso3],
      alert: n.iso3 === state.player || !!world.nations.get(n.iso3)?.major,
    });
    if (world.nations.get(n.iso3)?.major || n.iso3 === state.player) headline(state, `${name}: ${successor} elected to succeed term-limited ${before}`);
    return;
  }
  if (share >= 50) {
    n.support = clamp(n.support + 5, 0, 100);
    log(state, {
      kind: 'info',
      text: `${name} votes: the government is returned with ${share.toFixed(1)} % of the vote.`,
      nations: [n.iso3],
      alert: n.iso3 === state.player,
    });
    if (world.nations.get(n.iso3)?.major) headline(state, `${name}: government re-elected`);
    return;
  }
  if (n.iso3 === state.player) {
    state.defeat = {
      kind: 'election',
      text: `Voters turned your government out with only ${share.toFixed(1)} % of the vote. A new government takes office in ${name}; your term is over.`,
    };
    log(state, { kind: 'info', text: `Election lost: ${share.toFixed(1)} % of the vote.`, nations: [n.iso3], alert: true });
    return;
  }
  const successor = replaceLeader(world, state, n, null);
  n.support = 55;
  n.stability = clamp(n.stability + 2, 0, 100);
  log(state, {
    kind: 'info',
    text: `${name} votes the government out (${share.toFixed(1)} %). ${successor} (fictional) takes office.`,
    nations: [n.iso3],
    alert: false,
  });
  if (world.nations.get(n.iso3)?.major) headline(state, `${name}: opposition wins; ${successor} to lead`);
}

function stageCoup(world: World, state: GameState, n: NationState): void {
  const name = nationName(world, n.iso3);
  if (n.iso3 === state.player) {
    state.defeat = {
      kind: 'coup',
      text: `Officers loyal to a rival faction have seized power in ${name}. You have been removed from office.`,
    };
    log(state, { kind: 'info', text: 'Coup d’état: you have been deposed.', nations: [n.iso3], alert: true });
    return;
  }
  const junta = replaceLeader(world, state, n, 'Chair of the Military Council');
  n.stability = clamp(n.stability - 10, 0, 100);
  n.support = 45;
  n.protestMonths = 0;
  log(state, {
    kind: 'info',
    text: `Coup in ${name}: the army deposes the government; ${junta} (fictional) heads a military council.`,
    nations: [n.iso3],
    alert: false,
  });
  headline(state, `COUP IN ${name.toUpperCase()}: army seizes power`);
}

export function runDomestic(world: World, state: GameState): void {
  for (const n of Object.values(state.nations)) {
    if (!n.alive) continue;
    const pol = world.politics.get(n.iso3);
    const isPlayer = n.iso3 === state.player;
    const sb = supportBreakdown(world, state, n.iso3);
    n.support = clamp(n.support + 0.12 * (sb.target - n.support), 0, 100);
    if (!pol) continue;
    const name = nationName(world, n.iso3);

    // Protests: repression raises the bar in autocracies.
    const threshold = PROTEST_THRESHOLD[pol.regime];
    if (n.support < threshold && n.stability < 55) n.protestMonths += 1;
    else if (n.support >= threshold + 5) n.protestMonths = 0;
    if (n.protestMonths > 0) {
      n.stability = clamp(n.stability - 1, 0, 100);
      if (n.protestMonths >= 3) n.growthMods.push({ delta: -0.3, monthsLeft: 1, reason: 'Mass protests' });
      if (n.protestMonths === 1 || n.protestMonths % 3 === 0) {
        if (isPlayer || world.nations.get(n.iso3)?.major)
          log(state, {
            kind: 'event',
            text:
              n.protestMonths === 1
                ? `Protests erupt across ${name} (approval ${Math.round(n.support)}).`
                : `${name}: protests enter month ${n.protestMonths}; stability is draining.`,
            nations: [n.iso3],
            alert: isPlayer,
          });
        if (n.protestMonths === 1 && world.nations.get(n.iso3)?.major) headline(state, `Mass protests sweep ${name}`);
      }
    }

    // Health crises and succession (D-075).
    if (!state.defeat) runHealth(world, state, n);

    // Elections.
    if (n.nextElection !== null && !state.defeat) {
      const left = n.nextElection - state.turn;
      if (isPlayer && [12, 6, 3, 1].includes(left)) {
        const share = projectedVoteShare(world, n);
        const chance = reelectionChance(world, n);
        log(state, {
          kind: 'info',
          text: `Election in ${left} month${left === 1 ? '' : 's'}: polls give you ${share.toFixed(1)} % (${Math.round(chance * 100)} % chance to stay in office).${n.leaderTermLimited ? ` ${n.leaderName} is term-limited: your party fields a successor.` : ''}${chance < 0.5 ? ' Losing ends your game.' : ''}`,
          nations: [n.iso3],
          alert: true,
        });
      }
      if (left <= 0) holdElection(world, state, n);
    }

    // Coups.
    const coup = coupBreakdown(world, state, n.iso3);
    n.coupRisk = coup.total;
    if (coup.total > 0 && !state.defeat) {
      if (isPlayer && coup.total >= 0.01 && state.turn % 3 === 0)
        log(state, {
          kind: 'info',
          text: `Intelligence warns of plotting in the army: coup risk ${(coup.total * 100).toFixed(1)} % a month. Raise approval, stability or the military budget.`,
          nations: [n.iso3],
          alert: true,
        });
      if (roll(state) < coup.total) stageCoup(world, state, n);
    }
  }
}
