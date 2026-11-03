/**
 * Headless self-play for balance work (D-081). Plays N complete all-AI games (January 2027 →
 * January 2040) on worker threads and writes metrics and charts to docs/balance/<label>/.
 *
 *   node --import tsx scripts/selfplay.ts --games 50 --label after [--seed 1] [--workers 3] [--turns 156]
 *   node --import tsx scripts/selfplay.ts --probe            # focused-research pace probe (US, CHN)
 *   node --import tsx scripts/selfplay.ts --compare before after
 *
 * Every nation is run by the AI: the nominal player is Tuvalu in observer mode, so the AI also
 * runs it and player-scope events are not drawn. Games are deterministic per seed.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { applyCommand, createGame } from '../src/sim/game.ts';
import { loadWorld, type World } from '../src/sim/world.ts';
import { victoryFor, standingRanking, DETERRENCE_TURN } from '../src/sim/victory.ts';
import { controlledRegions, effectiveGdp, militaryPower, worldGdp } from '../src/sim/query.ts';
import { researchPointsPerMonth } from '../src/sim/research.ts';
import { isFullExchange } from '../src/sim/escalation.ts';
import type { GameState, Iso3 } from '../src/sim/types.ts';

const OBSERVER = 'TUV';
const YEAR0 = 2027;

// --- metrics -------------------------------------------------------------------------------------

export interface WarRecord {
  id: number;
  attackers: Iso3[];
  defenders: Iso3[];
  since: number;
  end: number | null;
  majors: Iso3[];
}

export interface GameMetrics {
  seed: number;
  turns: number;
  endReason: 'horizon' | 'fullExchange' | 'error';
  error?: string;
  /** First great power to meet a victory condition (deterrence is only checked in January 2040). */
  winner: { iso: Iso3; kind: string; turn: number } | null;
  victories: { iso: Iso3; kind: string; turn: number }[];
  wars: WarRecord[];
  nuclear: { detonations: number; firstTurn: number | null; fullExchange: boolean; users: Iso3[] };
  capitulations: { iso: Iso3; to: Iso3 | null; turn: number; major: boolean }[];
  /** January of each year (index 0 = 2027) and the final state. */
  yearly: {
    year: number;
    worldGdp: number;
    alive: number;
    wars: number;
    tension: number;
    gdp: Record<Iso3, number>;
    techs: Record<Iso3, number>;
    era: Record<Iso3, number>;
    power: Record<Iso3, number>;
    regions: Record<Iso3, number>;
  }[];
  unitsBuilt: Record<string, number>;
  techsResearched: Record<string, number>;
  /** First month a great power fields an era-V tech (null: never). */
  finalEraTurn: Record<Iso3, number | null>;
  eventsFired: Record<string, number>;
  turnMs: { mean: number; p95: number; max: number };
  nan: { turn: number; where: string }[];
  stuck: { turn: number; what: string }[];
  peakHeapMb: number;
  /** Final standing table (D-081): economy against trend and territory, best first. */
  standing: { iso: Iso3; economy: number; territory: number; score: number }[];
}

function finite(x: unknown): boolean {
  return typeof x !== 'number' || Number.isFinite(x);
}

function scanNaN(state: GameState, deep: boolean): string[] {
  const bad: string[] = [];
  for (const n of Object.values(state.nations)) {
    for (const [k, v] of Object.entries(n)) {
      if (!finite(v)) bad.push(`${n.iso3}.${k}`);
      else if (v && typeof v === 'object' && !Array.isArray(v))
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (!finite(v2)) bad.push(`${n.iso3}.${k}.${k2}`);
    }
  }
  for (const k of ['globalTension', 'oilPrice', 'nuclearWinter', 'debris'] as const)
    if (!finite((state as unknown as Record<string, unknown>)[k])) bad.push(k);
  if (deep) {
    for (const r of Object.values(state.regions))
      for (const k of ['supply', 'unrest', 'infraDamage', 'fallout'] as const)
        if (!finite((r as unknown as Record<string, unknown>)[k])) bad.push(`region${r.id}.${k}`);
    for (const u of Object.values(state.units))
      if (!finite(u.strength) || !finite(u.experience)) bad.push(`unit${u.id}`);
    for (const [k, v] of Object.entries(state.relations)) if (!finite(v)) bad.push(`rel ${k}`);
  }
  return bad;
}

function maxEra(world: World, techs: readonly string[]): number {
  let e = 0;
  for (const id of techs) e = Math.max(e, world.techs.get(id)?.era ?? 0);
  return e;
}

function snapshot(world: World, state: GameState, year: number): GameMetrics['yearly'][number] {
  const s: GameMetrics['yearly'][number] = {
    year,
    worldGdp: Math.round(worldGdp(world, state)),
    alive: Object.values(state.nations).filter((n) => n.alive).length,
    wars: state.wars.length,
    tension: Math.round(state.globalTension),
    gdp: {},
    techs: {},
    era: {},
    power: {},
    regions: {},
  };
  for (const m of world.majors) {
    const n = state.nations[m]!;
    s.gdp[m] = Math.round(n.alive ? effectiveGdp(world, state, m) : 0);
    s.techs[m] = n.techs.length;
    s.era[m] = maxEra(world, n.techs);
    s.power[m] = Math.round(n.alive ? militaryPower(world, state, m) : 0);
    s.regions[m] = controlledRegions(state, m).length;
  }
  return s;
}

export function playGame(world: World, seed: number, turns: number): GameMetrics {
  let g = createGame({ seed, player: OBSERVER, scenario: 'world-2027', observer: true }, world);
  const m: GameMetrics = {
    seed,
    turns: 0,
    endReason: 'horizon',
    winner: null,
    victories: [],
    wars: [],
    nuclear: { detonations: 0, firstTurn: null, fullExchange: false, users: [] },
    capitulations: [],
    yearly: [snapshot(world, g, YEAR0)],
    unitsBuilt: {},
    techsResearched: {},
    finalEraTurn: Object.fromEntries(world.majors.map((x) => [x, null])),
    eventsFired: {},
    turnMs: { mean: 0, p95: 0, max: 0 },
    nan: [],
    stuck: [],
    peakHeapMb: 0,
    standing: [],
  };
  const warById = new Map<number, WarRecord>();
  const won = new Set<string>();
  const times: number[] = [];
  let knownUnits = new Set(Object.keys(g.units));
  const techsBefore = new Map(Object.values(g.nations).map((n) => [n.iso3, new Set(n.techs)]));
  const lastControlChange = new Map<number, { sig: string; turn: number }>();
  const zombie = new Map<Iso3, number>();
  for (let i = 0; i < turns; i++) {
    const turn = g.turn;
    const t0 = performance.now();
    try {
      g = applyCommand(world, g, { type: 'endTurn' });
    } catch (e) {
      m.endReason = 'error';
      m.error = `turn ${turn}: ${(e as Error).stack ?? String(e)}`.slice(0, 2000);
      break;
    }
    const ms = performance.now() - t0;
    times.push(ms);
    if (ms > 3000) m.stuck.push({ turn, what: `slow turn ${ms.toFixed(0)} ms` });
    m.turns = g.turn;
    // Wars.
    const live = new Set<number>();
    for (const w of g.wars) {
      live.add(w.id);
      const rec = warById.get(w.id);
      const majors = [...w.attackers, ...w.defenders].filter((x) => world.majors.includes(x));
      if (!rec) {
        const r: WarRecord = { id: w.id, attackers: [...w.attackers], defenders: [...w.defenders], since: w.since, end: null, majors };
        warById.set(w.id, r);
        m.wars.push(r);
      } else {
        rec.attackers = [...w.attackers];
        rec.defenders = [...w.defenders];
        rec.majors = [...new Set([...rec.majors, ...majors])];
      }
      // A war in which no side has gained or lost a region for three years is a frozen front.
      const sig = [...w.attackers, ...w.defenders].map((x) => controlledRegions(g, x).length).join(',');
      const last = lastControlChange.get(w.id);
      if (!last || last.sig !== sig) lastControlChange.set(w.id, { sig, turn: g.turn });
      else if (g.turn - last.turn === 36)
        m.stuck.push({ turn: g.turn, what: `frozen war ${w.attackers[0]}–${w.defenders[0]} (no region changed hands for 36 months)` });
    }
    for (const r of m.wars) if (r.end === null && !live.has(r.id)) r.end = g.turn;
    // Nuclear use.
    if (g.detonations > 0 && m.nuclear.firstTurn === null) m.nuclear.firstTurn = turn;
    m.nuclear.detonations = g.detonations;
    m.nuclear.users = [...new Set(g.nuclearLog.map((x) => x.attacker))];
    // Capitulations, zombie states.
    for (const n of Object.values(g.nations)) {
      if (!n.alive && !m.capitulations.some((c) => c.iso === n.iso3))
        m.capitulations.push({ iso: n.iso3, to: n.capitulatedTo, turn, major: world.majors.includes(n.iso3) });
      if (n.alive && n.iso3 !== OBSERVER) {
        if (controlledRegions(g, n.iso3).length === 0) {
          const z = (zombie.get(n.iso3) ?? 0) + 1;
          zombie.set(n.iso3, z);
          if (z === 12) m.stuck.push({ turn: g.turn, what: `${n.iso3} alive with no regions for 12 months` });
        } else zombie.delete(n.iso3);
      }
    }
    // Units built (production and aid deliveries).
    for (const u of Object.values(g.units)) if (!knownUnits.has(String(u.id))) m.unitsBuilt[u.type] = (m.unitsBuilt[u.type] ?? 0) + 1;
    knownUnits = new Set(Object.keys(g.units));
    // Events fired this month (world-scope and chain steps record the month they fired).
    for (const [k, v] of Object.entries(g.eventsFired)) if (v === turn) {
      const id = k.slice(0, k.lastIndexOf(':'));
      m.eventsFired[id] = (m.eventsFired[id] ?? 0) + 1;
    }
    // Final-era research.
    for (const iso of world.majors) {
      if (m.finalEraTurn[iso] === null && maxEra(world, g.nations[iso]!.techs) >= 5) m.finalEraTurn[iso] = g.turn;
    }
    // Victories (first per nation and kind).
    const deterrence = g.turn >= DETERRENCE_TURN;
    for (const iso of world.majors) {
      const v = victoryFor(world, g, iso);
      if (!v || (v.kind === 'deterrence' && !deterrence)) continue;
      const key = `${iso}:${v.kind}`;
      if (won.has(key)) continue;
      won.add(key);
      m.victories.push({ iso, kind: v.kind, turn: g.turn });
      if (!m.winner) m.winner = { iso, kind: v.kind, turn: g.turn };
    }
    // NaN scan: nations every month, everything once a year.
    for (const where of scanNaN(g, g.turn % 12 === 0)) if (m.nan.length < 50) m.nan.push({ turn: g.turn, where });
    if (g.turn % 12 === 0) m.yearly.push(snapshot(world, g, YEAR0 + g.turn / 12));
    m.peakHeapMb = Math.max(m.peakHeapMb, process.memoryUsage().heapUsed / 2 ** 20);
    if (isFullExchange(g)) {
      m.nuclear.fullExchange = true;
      m.endReason = 'fullExchange';
      break;
    }
  }
  if (m.yearly[m.yearly.length - 1]!.year !== YEAR0 + g.turn / 12) m.yearly.push(snapshot(world, g, YEAR0 + g.turn / 12));
  for (const n of Object.values(g.nations)) {
    const before = techsBefore.get(n.iso3)!;
    for (const id of n.techs) if (!before.has(id)) m.techsResearched[id] = (m.techsResearched[id] ?? 0) + 1;
  }
  m.standing = standingRanking(world, g).map((x) => ({ iso: x.iso, economy: Math.round(x.economy * 1000) / 1000, territory: Math.round(x.territory * 1000) / 1000, score: Math.round(x.score * 1000) / 1000 }));
  const sorted = [...times].sort((a, b) => a - b);
  m.turnMs = {
    mean: Math.round(times.reduce((s, x) => s + x, 0) / Math.max(1, times.length)),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
  m.peakHeapMb = Math.round(m.peakHeapMb);
  return m;
}

// --- focused research probe ----------------------------------------------------------------------

export interface ProbeResult {
  iso: Iso3;
  research: number;
  seed: number;
  /** Techs held each January. */
  techs: number[];
  finalEraTurn: number | null;
  finalEraYear: number | null;
  rpStart: number;
  rpEnd: number;
}

/**
 * A focused great power: the player nation with a research-heavy budget that always queues the
 * cheapest path towards the frontier era. Everyone else is the normal AI.
 */
export function researchProbe(world: World, iso: Iso3, research: number, seed: number, turns: number): ProbeResult {
  let g = createGame({ seed, player: iso, scenario: 'world-2027' }, world);
  const budget = { ...g.nations[iso]!.budget };
  const other = 100 - research;
  const rest = budget.military + budget.infrastructure + budget.social + budget.debt || 1;
  const scaled = {
    military: Math.round((budget.military / rest) * other),
    infrastructure: Math.round((budget.infrastructure / rest) * other),
    social: Math.round((budget.social / rest) * other),
    debt: Math.round((budget.debt / rest) * other),
    research,
  };
  g = applyCommand(world, g, { type: 'setBudget', budget: scaled });
  const r: ProbeResult = { iso, research, seed, techs: [g.nations[iso]!.techs.length], finalEraTurn: null, finalEraYear: null, rpStart: researchPointsPerMonth(world, g, iso), rpEnd: 0 };
  // The cheapest era-V tech by total missing path cost.
  const target = () => {
    const n = g.nations[iso]!;
    let best: string | null = null;
    let bestCost = Infinity;
    for (const t of world.techList) {
      if (t.era !== 5 || n.techs.includes(t.id)) continue;
      const missing = new Set<string>();
      const visit = (id: string) => {
        if (missing.has(id) || n.techs.includes(id)) return;
        missing.add(id);
        for (const q of world.techs.get(id)!.requires) visit(q);
      };
      visit(t.id);
      const c = [...missing].reduce((s, id) => s + world.techs.get(id)!.cost, 0);
      if (c < bestCost) {
        bestCost = c;
        best = t.id;
      }
    }
    return best;
  };
  for (let i = 0; i < turns && g.nations[iso]!.alive; i++) {
    const n = g.nations[iso]!;
    if (!n.researchCurrent && n.researchQueue.length === 0) {
      const t = target();
      if (t) g = applyCommand(world, g, { type: 'queueResearch', tech: t });
    }
    g = applyCommand(world, g, { type: 'endTurn' });
    if (r.finalEraTurn === null && maxEra(world, g.nations[iso]!.techs) >= 5) {
      r.finalEraTurn = g.turn;
      r.finalEraYear = Math.round((YEAR0 + g.turn / 12) * 10) / 10;
    }
    if (g.turn % 12 === 0) r.techs.push(g.nations[iso]!.techs.length);
  }
  r.rpEnd = researchPointsPerMonth(world, g, iso);
  return r;
}

// --- aggregation ---------------------------------------------------------------------------------

export function summarise(world: World, games: GameMetrics[]) {
  const n = games.length;
  const pct = (k: number) => Math.round((k / Math.max(1, n)) * 1000) / 10;
  const winners: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  for (const g of games) {
    const k = g.winner ? g.winner.iso : 'none';
    winners[k] = (winners[k] ?? 0) + 1;
    const kk = g.winner ? g.winner.kind : 'none';
    kinds[kk] = (kinds[kk] ?? 0) + 1;
  }
  // Who tops the standing table in January 2040, nuclear use or not (the Deterrence victory also needs none).
  const standingTop: Record<string, number> = {};
  for (const g of games) if (g.standing?.[0]) standingTop[g.standing[0].iso] = (standingTop[g.standing[0].iso] ?? 0) + 1;
  const anyVictory: Record<string, number> = {};
  for (const g of games) for (const iso of new Set(g.victories.map((v) => v.iso))) anyVictory[iso] = (anyVictory[iso] ?? 0) + 1;
  const wars = games.flatMap((g) => g.wars);
  const majorWars = wars.filter((w) => w.majors.length >= 2);
  const greatPowerWar = games.filter((g) => g.wars.some((w) => w.majors.length >= 2 && w.since > 0)).length;
  const nukes = games.filter((g) => g.nuclear.detonations > 0).length;
  const exchange = games.filter((g) => g.nuclear.fullExchange).length;
  const nukeUsers: Record<string, number> = {};
  for (const g of games) for (const u of g.nuclear.users) nukeUsers[u] = (nukeUsers[u] ?? 0) + 1;
  const yearIdx = (g: GameMetrics, year: number) => g.yearly.find((y) => y.year === year);
  const worldGdpBy = (year: number) => {
    const xs = games.map((g) => yearIdx(g, year)?.worldGdp).filter((x): x is number => typeof x === 'number');
    return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  };
  const years = Array.from({ length: 14 }, (_, i) => YEAR0 + i);
  const meanBy = (f: (y: GameMetrics['yearly'][number]) => number, year: number) => {
    const xs = games.map((g) => yearIdx(g, year)).filter((y): y is GameMetrics['yearly'][number] => !!y).map(f);
    return xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;
  };
  const gdpTrajectories = Object.fromEntries(world.majors.map((m) => [m, years.map((y) => meanBy((s) => s.gdp[m] ?? 0, y))]));
  const techTrajectories = Object.fromEntries(world.majors.map((m) => [m, years.map((y) => meanBy((s) => s.techs[m] ?? 0, y))]));
  const regionTrajectories = Object.fromEntries(world.majors.map((m) => [m, years.map((y) => meanBy((s) => s.regions[m] ?? 0, y))]));
  const unitsBuilt: Record<string, number> = {};
  for (const g of games) for (const [k, v] of Object.entries(g.unitsBuilt)) unitsBuilt[k] = (unitsBuilt[k] ?? 0) + v;
  const neverBuilt = [...world.unitTypes.keys()].filter((t) => !unitsBuilt[t]);
  const techs: Record<string, number> = {};
  for (const g of games) for (const [k, v] of Object.entries(g.techsResearched)) techs[k] = (techs[k] ?? 0) + v;
  const neverResearched = world.techList.map((t) => t.id).filter((t) => !techs[t]);
  const events: Record<string, number> = {};
  for (const g of games) for (const [k, v] of Object.entries(g.eventsFired)) events[k] = (events[k] ?? 0) + v;
  const worldEvents = world.events.filter((e) => e.scope !== 'player');
  const neverFired = worldEvents.map((e) => e.id).filter((id) => !events[id]);
  const capByYear = (year: number, majorOnly: boolean) =>
    Math.round((games.reduce((s, g) => s + g.capitulations.filter((c) => (!majorOnly || c.major) && c.turn < (year - YEAR0) * 12).length, 0) / Math.max(1, n)) * 10) / 10;
  const majorCaps: Record<string, number> = {};
  for (const g of games) for (const c of g.capitulations) if (c.major) majorCaps[c.iso] = (majorCaps[c.iso] ?? 0) + 1;
  const finalEra: Record<string, { reached: number; meanYear: number | null; earliestYear: number | null }> = {};
  for (const m of world.majors) {
    const ts = games.map((g) => g.finalEraTurn[m]).filter((x): x is number => x !== null && x !== undefined);
    finalEra[m] = {
      reached: ts.length,
      meanYear: ts.length ? Math.round((YEAR0 + ts.reduce((s, x) => s + x, 0) / ts.length / 12) * 10) / 10 : null,
      earliestYear: ts.length ? Math.round((YEAR0 + Math.min(...ts) / 12) * 10) / 10 : null,
    };
  }
  const allTimes = games.map((g) => g.turnMs.mean);
  return {
    games: n,
    seeds: games.map((g) => g.seed),
    errors: games.filter((g) => g.endReason === 'error').map((g) => ({ seed: g.seed, error: g.error })),
    winners,
    winnerKinds: kinds,
    standingTop,
    anyVictory,
    majorsNeverWon: world.majors.filter((m) => !winners[m]),
    wars: {
      perGame: Math.round((wars.length / Math.max(1, n)) * 10) / 10,
      majorVsMajorPerGame: Math.round((majorWars.length / Math.max(1, n)) * 10) / 10,
      gamesWithGreatPowerWarPct: pct(greatPowerWar),
      meanLengthMonths: Math.round((wars.reduce((s, w) => s + ((w.end ?? 156) - w.since), 0) / Math.max(1, wars.length)) * 10) / 10,
      startedByYear: years.map((y) => Math.round((wars.filter((w) => w.since >= (y - YEAR0) * 12 && w.since < (y - YEAR0 + 1) * 12).length / Math.max(1, n)) * 100) / 100),
    },
    nuclear: { anyUsePct: pct(nukes), fullExchangePct: pct(exchange), users: nukeUsers },
    collapse: {
      worldGdp2027: worldGdpBy(2027),
      worldGdp2030: worldGdpBy(2030),
      worldGdp2035: worldGdpBy(2035),
      worldGdp2040: worldGdpBy(2040),
      capitulationsBy2030: capByYear(2030, false),
      majorCapitulationsBy2030: capByYear(2030, true),
      capitulationsBy2040: capByYear(2041, false),
      majorCapitulations: majorCaps,
      aliveIn2040: meanBy((s) => s.alive, 2040),
    },
    years,
    worldGdp: years.map((y) => worldGdpBy(y)),
    gdpTrajectories,
    techTrajectories,
    regionTrajectories,
    finalEra,
    unitsBuilt,
    neverBuilt,
    techsResearched: techs,
    neverResearched,
    eventsFired: events,
    neverFired,
    eventsPerGame: Math.round((Object.values(events).reduce((s, x) => s + x, 0) / Math.max(1, n)) * 10) / 10,
    turnMs: {
      mean: Math.round(allTimes.reduce((s, x) => s + x, 0) / Math.max(1, allTimes.length)),
      p95: Math.round(Math.max(0, ...games.map((g) => g.turnMs.p95))),
      max: Math.max(0, ...games.map((g) => g.turnMs.max)),
    },
    nan: games.flatMap((g) => g.nan.map((x) => ({ seed: g.seed, ...x }))).slice(0, 50),
    stuck: games.flatMap((g) => g.stuck.map((x) => ({ seed: g.seed, ...x }))),
    peakHeapMbPerWorker: Math.max(0, ...games.map((g) => g.peakHeapMb)),
  };
}

export type Summary = ReturnType<typeof summarise>;

// --- charts (inline SVG, no dependencies) ----------------------------------------------------------

const PALETTE = ['#2a78d6', '#d4492c', '#2e9e5b', '#9b59b6', '#e0a106', '#16a3b8', '#8a8f98', '#c2185b', '#5d4037', '#6b8e23', '#ff7f50', '#4b0082', '#008080', '#b8860b'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function frame(title: string, w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12">
<rect width="${w}" height="${h}" fill="#ffffff"/>
<text x="16" y="24" font-size="15" font-weight="600" fill="#1d2330">${esc(title)}</text>
${body}
</svg>
`;
}

/** Grouped horizontal bars: one row per label, one bar per series. */
export function barChart(title: string, labels: string[], series: { name: string; values: number[] }[], unit = ''): string {
  const rowH = 10 * series.length + 10;
  const left = 190;
  const w = 760;
  const h = 70 + labels.length * rowH;
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values));
  let body = '';
  series.forEach((s, j) => {
    body += `<rect x="${left + j * 130}" y="36" width="10" height="10" fill="${PALETTE[j]}"/><text x="${left + 14 + j * 130}" y="45" fill="#3b4252">${esc(s.name)}</text>`;
  });
  labels.forEach((l, i) => {
    const y = 60 + i * rowH;
    body += `<text x="${left - 8}" y="${y + rowH / 2}" text-anchor="end" fill="#1d2330">${esc(l)}</text>`;
    series.forEach((s, j) => {
      const v = s.values[i] ?? 0;
      const bw = ((w - left - 70) * v) / max;
      body += `<rect x="${left}" y="${y + j * 10}" width="${Math.max(0.5, bw)}" height="8" fill="${PALETTE[j]}"/><text x="${left + bw + 4}" y="${y + j * 10 + 8}" font-size="11" fill="#3b4252">${Math.round(v * 10) / 10}${unit}</text>`;
    });
  });
  return frame(title, w, h, body);
}

/** Lines over the years; `dashed` series are drawn dashed (used for "before"). */
export function lineChart(title: string, years: number[], series: { name: string; values: (number | null)[]; color?: string; dashed?: boolean }[], yLabel: string, band?: [number, number]): string {
  const w = 760;
  const h = 420;
  const L = 70;
  const R = 150;
  const T = 56;
  const B = 40;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(1e-9, ...all, band?.[1] ?? 0) * 1.05;
  const min = Math.min(0, ...all);
  const x = (i: number) => L + ((w - L - R) * i) / Math.max(1, years.length - 1);
  const y = (v: number) => T + (h - T - B) * (1 - (v - min) / (max - min));
  let body = '';
  if (band) body += `<rect x="${L}" y="${y(band[1])}" width="${w - L - R}" height="${y(band[0]) - y(band[1])}" fill="#2e9e5b" opacity="0.1"/>`;
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    body += `<line x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e6ec"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="#6b7280" font-size="11">${v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v * 10) / 10}</text>`;
  }
  years.forEach((yr, i) => {
    if (i % 2 === 0) body += `<text x="${x(i)}" y="${h - B + 16}" text-anchor="middle" fill="#6b7280" font-size="11">${yr}</text>`;
  });
  body += `<text x="16" y="${T - 12}" fill="#6b7280" font-size="11">${esc(yLabel)}</text>`;
  series.forEach((s, j) => {
    const color = s.color ?? PALETTE[j % PALETTE.length];
    const pts = s.values.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    body += `<polyline fill="none" stroke="${color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} points="${pts.join(' ')}"/>`;
    body += `<line x1="${w - R + 10}" x2="${w - R + 26}" y1="${T + 6 + j * 16}" y2="${T + 6 + j * 16}" stroke="${color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/><text x="${w - R + 30}" y="${T + 10 + j * 16}" fill="#3b4252" font-size="11">${esc(s.name)}</text>`;
  });
  return frame(title, w, h, body);
}

function writeCharts(dir: string, s: Summary): void {
  const majors = Object.keys(s.gdpTrajectories);
  writeFileSync(`${dir}/gdp.svg`, lineChart('Mean GDP of the great powers (US$ bn, effective)', s.years, majors.map((m) => ({ name: m, values: s.gdpTrajectories[m]! })), 'US$ bn'));
  writeFileSync(`${dir}/techs.svg`, lineChart('Mean technologies held', s.years, majors.map((m) => ({ name: m, values: s.techTrajectories[m]! })), 'techs'));
  writeFileSync(`${dir}/winners.svg`, barChart('First victory per game', majors.concat('none'), [{ name: 'games won', values: majors.concat('none').map((m) => s.winners[m] ?? 0) }]));
}

// --- compare --------------------------------------------------------------------------------------

function compare(beforeDir: string, afterDir: string, out: string): void {
  const a = JSON.parse(readFileSync(`${beforeDir}/summary.json`, 'utf8')) as Summary;
  const b = JSON.parse(readFileSync(`${afterDir}/summary.json`, 'utf8')) as Summary;
  mkdirSync(out, { recursive: true });
  const majors = Object.keys(b.gdpTrajectories);
  const labels = [...majors, 'none'];
  writeFileSync(`${out}/winners.svg`, barChart('Games won (first victory), before vs after', labels, [
    { name: `before (${a.games})`, values: labels.map((m) => a.winners[m] ?? 0) },
    { name: `after (${b.games})`, values: labels.map((m) => b.winners[m] ?? 0) },
  ]));
  const key = ['USA', 'CHN', 'RUS', 'IND', 'JPN', 'DEU'];
  writeFileSync(`${out}/techs.svg`, lineChart('Mean technologies held (dashed = before)', b.years, [
    ...key.map((m, j) => ({ name: `${m} before`, values: a.techTrajectories[m]!, color: PALETTE[j], dashed: true })),
    ...key.map((m, j) => ({ name: `${m} after`, values: b.techTrajectories[m]!, color: PALETTE[j] })),
  ], 'techs'));
  writeFileSync(`${out}/world-gdp.svg`, lineChart('Mean world GDP (US$ bn; dashed = before)', b.years, [
    { name: 'before', values: a.worldGdp, color: PALETTE[1], dashed: true },
    { name: 'after', values: b.worldGdp, color: PALETTE[0] },
  ], 'US$ bn'));
  writeFileSync(`${out}/gdp.svg`, lineChart('Mean GDP of six great powers (dashed = before)', b.years, [
    ...key.map((m, j) => ({ name: `${m} before`, values: a.gdpTrajectories[m]!, color: PALETTE[j], dashed: true })),
    ...key.map((m, j) => ({ name: `${m} after`, values: b.gdpTrajectories[m]!, color: PALETTE[j] })),
  ], 'US$ bn'));
  writeFileSync(`${out}/wars.svg`, lineChart('Wars started per game per year (dashed = before)', b.years, [
    { name: 'before', values: a.wars.startedByYear, color: PALETTE[1], dashed: true },
    { name: 'after', values: b.wars.startedByYear, color: PALETTE[0] },
  ], 'wars / game'));
  const headline = [
    ['Nuclear use (% of games)', a.nuclear.anyUsePct, b.nuclear.anyUsePct],
    ['Full exchange (% of games)', a.nuclear.fullExchangePct, b.nuclear.fullExchangePct],
    ['Great-power war (% of games)', a.wars.gamesWithGreatPowerWarPct, b.wars.gamesWithGreatPowerWarPct],
    ['Wars per game', a.wars.perGame, b.wars.perGame],
    ['Major-vs-major wars per game', a.wars.majorVsMajorPerGame, b.wars.majorVsMajorPerGame],
    ['Capitulations by 2030', a.collapse.capitulationsBy2030, b.collapse.capitulationsBy2030],
  ] as const;
  writeFileSync(`${out}/headline.svg`, barChart('Headline metrics, before vs after', headline.map((h) => h[0]), [
    { name: 'before', values: headline.map((h) => h[1]) },
    { name: 'after', values: headline.map((h) => h[2]) },
  ]));
  console.log(`charts written to ${out}`);
}

// --- report ---------------------------------------------------------------------------------------

function markdown(label: string, s: Summary, probe: ProbeResult[] | null): string {
  const row = (k: string, v: unknown) => `| ${k} | ${typeof v === 'object' ? JSON.stringify(v) : String(v)} |`;
  return [
    `# Self-play: ${label}`,
    '',
    `${s.games} all-AI games, January 2027 → January 2040, seeds ${s.seeds[0]}–${s.seeds[s.seeds.length - 1]}. Generated by \`scripts/selfplay.ts\`.`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    row('Winners (first victory)', s.winners),
    row('Victory kinds', s.winnerKinds),
    row('Top of the standing table in 2040', s.standingTop ?? '—'),
    row('Majors that never won', s.majorsNeverWon.join(', ') || '—'),
    row('Nuclear use (% games)', s.nuclear.anyUsePct),
    row('Full exchange (% games)', s.nuclear.fullExchangePct),
    row('Nuclear users', s.nuclear.users),
    row('Wars per game', s.wars.perGame),
    row('Major-vs-major wars per game', s.wars.majorVsMajorPerGame),
    row('Games with a great-power war (%)', s.wars.gamesWithGreatPowerWarPct),
    row('Mean war length (months)', s.wars.meanLengthMonths),
    row('World GDP 2027 / 2030 / 2035 / 2040', `${s.collapse.worldGdp2027} / ${s.collapse.worldGdp2030} / ${s.collapse.worldGdp2035} / ${s.collapse.worldGdp2040}`),
    row('Capitulations by 2030 (all / majors)', `${s.collapse.capitulationsBy2030} / ${s.collapse.majorCapitulationsBy2030}`),
    row('Capitulations by 2040', s.collapse.capitulationsBy2040),
    row('Major capitulations (games)', s.collapse.majorCapitulations),
    row('Nations alive in 2040', s.collapse.aliveIn2040),
    row('Final era reached', s.finalEra),
    row('Turn time mean / p95 / max (ms)', `${s.turnMs.mean} / ${s.turnMs.p95} / ${s.turnMs.max}`),
    row('Peak heap per worker (MB)', s.peakHeapMbPerWorker),
    row('Errors', s.errors.length),
    row('NaN findings', s.nan.length),
    row('Stuck-state findings', s.stuck.length),
    row('Units never built', s.neverBuilt.join(', ') || '—'),
    row('Techs never researched (beyond start)', s.neverResearched.join(', ') || '—'),
    row('World events never fired', `${s.neverFired.length}: ${s.neverFired.join(', ')}`),
    row('Events per game', s.eventsPerGame),
    ...(probe ? ['', '## Focused research probe', '', '| Nation | Research % | Seed | Final era | Techs by year | RP start → end |', '| --- | --- | --- | --- | --- | --- |', ...probe.map((p) => `| ${p.iso} | ${p.research} | ${p.seed} | ${p.finalEraYear ?? 'never'} | ${p.techs.join(' ')} | ${p.rpStart.toFixed(0)} → ${p.rpEnd.toFixed(0)} |`)] : []),
    '',
  ].join('\n');
}

// --- threads --------------------------------------------------------------------------------------

type Job = { kind: 'game'; seed: number; turns: number } | { kind: 'probe'; iso: Iso3; research: number; seed: number; turns: number };

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : fallback;
}

async function runJobs<T>(jobs: Job[], workers: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const t0 = performance.now();
  let peakRss = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, () =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { worker: true }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
        const feed = () => {
          if (next >= jobs.length) {
            void w.terminate().then(() => resolve());
            return;
          }
          const i = next++;
          w.once('message', (msg: { result: T }) => {
            results[i] = msg.result;
            done++;
            peakRss = Math.max(peakRss, process.memoryUsage().rss);
            const j = jobs[i]!;
            console.log(`[${done}/${jobs.length}] ${j.kind} seed ${j.seed}${j.kind === 'probe' ? ` ${j.iso} ${j.research}%` : ''} done (${((performance.now() - t0) / 1000).toFixed(0)} s, rss ${(peakRss / 2 ** 20).toFixed(0)} MB)`);
            feed();
          });
          w.postMessage(jobs[i]);
        };
        w.on('error', reject);
        feed();
      }),
    ),
  );
  console.log(`peak process RSS ${(peakRss / 2 ** 20).toFixed(0)} MB`);
  return results;
}

async function main(): Promise<void> {
  if (process.argv.includes('--compare')) {
    const i = process.argv.indexOf('--compare');
    compare(`docs/balance/${process.argv[i + 1]}`, `docs/balance/${process.argv[i + 2]}`, 'docs/balance/compare');
    return;
  }
  const label = arg('label', 'run');
  const games = Number(arg('games', '50'));
  const seed0 = Number(arg('seed', '1'));
  const turns = Number(arg('turns', String(DETERRENCE_TURN)));
  const workers = Number(arg('workers', String(Math.max(1, Math.min(3, cpus().length - 1)))));
  const dir = `docs/balance/${label}`;
  mkdirSync(dir, { recursive: true });
  const world = loadWorld();
  let probe: ProbeResult[] | null = null;
  if (process.argv.includes('--probe')) {
    const research = Number(arg('research', '30'));
    const probeJobs: Job[] = [];
    for (const iso of ['USA', 'CHN']) for (const s of [1, 2]) probeJobs.push({ kind: 'probe', iso, research, seed: s, turns });
    probe = await runJobs<ProbeResult>(probeJobs, workers);
    for (const p of probe) console.log(`${p.iso} research ${p.research}% seed ${p.seed}: final era ${p.finalEraYear ?? 'never'}; techs by year ${p.techs.join(' ')}; RP ${p.rpStart.toFixed(0)} → ${p.rpEnd.toFixed(0)}`);
    writeFileSync(`${dir}/probe.json`, JSON.stringify(probe, null, 1));
    if (games === 0) return;
  }
  const jobs: Job[] = Array.from({ length: games }, (_, i) => ({ kind: 'game', seed: seed0 + i, turns }));
  const results = await runJobs<GameMetrics>(jobs, workers);
  writeFileSync(`${dir}/games.json`, JSON.stringify(results));
  const s = summarise(world, results);
  writeFileSync(`${dir}/summary.json`, JSON.stringify(s, null, 1));
  writeFileSync(`${dir}/summary.md`, markdown(label, s, probe));
  writeCharts(dir, s);
  console.log(markdown(label, s, probe));
}

if (isMainThread) {
  void main();
} else if ((workerData as { worker?: boolean } | null)?.worker) {
  const world = loadWorld();
  parentPort!.on('message', (job: Job) => {
    const result = job.kind === 'game' ? playGame(world, job.seed, job.turns) : researchProbe(world, job.iso, job.research, job.seed, job.turns);
    parentPort!.postMessage({ result });
  });
}

