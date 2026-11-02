/** New-game construction: nations, regions, starting forces, relations, wars (D-023). */
import forcesData from '../../data/forces.json';
import { isoYearMonth } from './calendar';
import { seedRng } from './rng';
import { relationKey, type World } from './world';
import { makeUnit } from './query';
import { maybeCommander } from './commanders';
import { RESOURCE_IDS } from './types';
import { econZero, emptyBalances, runTrade } from './trade';
import { scheduleElections, supportBreakdown } from './domestic';
import { recordHistory } from './economy';
import type {
  Budget,
  GameState,
  Iso3,
  NationState,
  NewGameOptions,
  RegionId,
  RegionState,
  Unit,
} from './types';

export const START_DATE = { year: 2027, month: 1 } as const;
export const SAVE_VERSION = 1;
export const GOV_REVENUE_SHARE = 0.28;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function defaultBudget(world: World, iso3: Iso3): Budget {
  const n = world.nations.get(iso3);
  const gdp = n?.gdpUsdBn ?? 1;
  const military = clamp(((n?.defenceSpendUsdBn ?? 0) / (gdp * GOV_REVENUE_SHARE)) * 100, 3, 45);
  const research = n?.major ? 10 : 6;
  const infrastructure = 20;
  const debt = clamp((n?.debtToGdpPct ?? 50) / 10, 3, 15);
  const social = Math.max(5, 100 - military - research - infrastructure - debt);
  const total = military + research + infrastructure + debt + social;
  const f = 100 / total;
  return {
    military: Math.round(military * f),
    research: Math.round(research * f),
    infrastructure: Math.round(infrastructure * f),
    debt: Math.round(debt * f),
    social:
      100 -
      Math.round(military * f) -
      Math.round(research * f) -
      Math.round(infrastructure * f) -
      Math.round(debt * f),
  };
}

/** Force quality from defence spending per active soldier (D-023). */
export function qualityOf(spendBn: number, personnel: number): number {
  if (personnel <= 0 || spendBn <= 0) return 0.6;
  const perSoldierK = (spendBn * 1e9) / personnel / 1e3; // thousand USD per soldier per year
  return clamp(0.5 + 0.5 * Math.log10(Math.max(1, perSoldierK) / 10), 0.5, 1.5);
}

/**
 * Abstract starting constellation and missile stock from defence spending (D-059). These are game
 * abstractions, not counts of real satellites or missiles.
 */
export function startingSatellites(spendBn: number, warheads: number): number {
  return clamp(Math.round(spendBn / 40) + (warheads > 0 ? 2 : 0), 0, 16);
}
export function startingMissiles(spendBn: number): number {
  return clamp(Math.round(spendBn / 2), 0, 400);
}

function startingStability(world: World, iso3: Iso3): number {
  const n = world.nations.get(iso3)!;
  const perCapita = (n.gdpUsdBn * 1e9) / Math.max(1, n.population);
  let s = 50 + 12 * Math.log10(Math.max(500, perCapita) / 5000);
  if (n.debtToGdpPct > 120) s -= 5;
  return clamp(Math.round(s), 25, 85);
}

export function createGame(world: World, options: NewGameOptions): GameState {
  const { seed, player, scenario } = options;
  if (!world.nations.has(player)) throw new Error(`Unknown player nation ${player}`);
  const nations: Record<Iso3, NationState> = {};
  for (const n of world.nationList) {
    const leader = world.leaders.get(n.iso3);
    nations[n.iso3] = {
      iso3: n.iso3,
      alive: true,
      capitulatedTo: null,
      gdp: n.gdpUsdBn,
      baseGrowth: clamp(n.gdpGrowthPct, -3, 8),
      growth: clamp(n.gdpGrowthPct, -3, 8),
      growthMods: [],
      treasury: n.gdpUsdBn * 0.02,
      debt: (n.debtToGdpPct / 100) * n.gdpUsdBn,
      stability: startingStability(world, n.iso3),
      warWeariness: 0,
      mobilization: 0,
      budget: defaultBudget(world, n.iso3),
      researchCurrent: null,
      researchPoints: 0,
      techs: [],
      modifiers: {},
      defcon: 5,
      defconMod: 0,
      warheads: n.nuclearWarheads,
      population: n.population,
      quality: qualityOf(n.defenceSpendUsdBn, n.activePersonnel),
      production: [],
      finances: {
        revenue: 0,
        military: 0,
        upkeep: 0,
        production: 0,
        research: 0,
        infrastructure: 0,
        social: 0,
        debtService: 0,
        interest: 0,
        deficit: 0,
      },
      monthsUnstable: 0,
      capitalLostMonths: 0,
      aiNote: '',
      leaderName: leader?.name ?? 'Head of State',
      leaderTitle: leader?.title ?? 'Leader',
      leaderFictional: !leader,
      satellites: startingSatellites(n.defenceSpendUsdBn, n.nuclearWarheads),
      missiles: startingMissiles(n.defenceSpendUsdBn),
      intelOps: {},
      blinded: 0,
      cyberCooldown: 0,
      productionDelay: 0,
      blockaded: false,
      potentialGdp: n.gdpUsdBn,
      inflation: world.startInflation.get(n.iso3) ?? 3,
      interestRate: startingInterest(world.startInflation.get(n.iso3) ?? 3),
      taxRate: 28,
      support: 50,
      negativeMonths: 0,
      recession: false,
      resources: emptyBalances(),
      resourceRef: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 1])) as NationState['resourceRef'],
      econ: econZero(),
      warBonds: 0,
      warBondCooldown: 0,
      nextElection: null,
      coupRisk: 0,
      protestMonths: 0,
      monthsSinceDefault: 999,
    };
  }

  const regions: Record<RegionId, RegionState> = {};
  for (const r of world.regionList) {
    const owner = !r.sea && world.nations.has(r.iso3) ? r.iso3 : null;
    regions[r.id] = {
      id: r.id,
      owner,
      controller: owner,
      devastation: 0,
      supply: owner ? 1 : 0,
      supplied: owner !== null,
      flippedTurn: -1,
      infraDamage: 0,
    };
  }

  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seedRng(seed),
    scenario,
    player,
    turn: 0,
    date: START_DATE,
    isoDate: isoYearMonth(START_DATE),
    nations,
    regions,
    regionsVersion: 0,
    diplomacyVersion: 0,
    units: {},
    nextId: 1,
    relations: {},
    sanctions: [],
    // Comprehensive US embargoes and US secondary sanctions in force in 2026 (D-061).
    embargoes: ['USA>CUB', 'USA>PRK', 'USA>IRN'],
    secondarySanctions: ['USA>IRN', 'USA>RUS'],
    treaties: [],
    wars: [],
    proposals: [],
    globalTension: 0,
    flashpoints: {},
    eventsFired: {},
    pendingEvents: [],
    log: [],
    news: [],
    strikes: [],
    detonations: 0,
    chokepoints: Object.fromEntries(
      world.chokepoints.map((c) => [
        c.id,
        { status: 'open', by: null, mined: false, minedBy: null, since: 0 },
      ]),
    ),
    oilPrice: 1,
    resolutionPassed: false,
    victory: null,
    defeat: null,
    summary: null,
    battleReports: [],
    debris: 0,
    economy: {
      prices: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 1])) as GameState['economy']['prices'],
      shortage: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as GameState['economy']['shortage'],
      shortageRef: Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])) as GameState['economy']['shortageRef'],
      routes: [],
      routeRef: {},
    },
    history: {},
  };

  for (const [key, rel] of world.relations) state.relations[key] = rel.value;
  for (const f of world.flashpoints) state.flashpoints[f.id] = f.tension;
  state.globalTension = Math.round(
    (world.flashpoints.reduce((s, f) => s + f.tension, 0) / Math.max(1, world.flashpoints.length)) *
      0.7,
  );

  for (const [a, b] of forcesData.defensiveTreaties) {
    if (world.nations.has(a!) && world.nations.has(b!))
      state.treaties.push({ type: 'defensive', a: a!, b: b!, since: 0 });
  }
  // Existing sanctions regimes.
  for (const target of ['RUS', 'PRK', 'IRN']) {
    for (const from of [
      'USA',
      'GBR',
      'FRA',
      'DEU',
      'JPN',
      'CAN',
      'AUS',
      'KOR',
      'ITA',
      'NLD',
      'POL',
      'SWE',
      'ESP',
    ]) {
      if (from === target) continue;
      if (target === 'IRN' && !['USA', 'GBR', 'FRA', 'DEU', 'CAN', 'AUS'].includes(from)) continue;
      state.sanctions.push(`${from}>${target}`);
    }
  }
  state.sanctions.push('USA>CUB', 'USA>VEN', 'USA>SYR');

  for (const o of forcesData.startingOccupation) {
    const r = regions[o.region];
    if (r) r.controller = o.controller;
  }
  for (const [a, b] of forcesData.startingWars) {
    state.wars.push({
      id: state.nextId++,
      attackers: [a!],
      defenders: [b!],
      since: -34,
      score: 10,
    });
    state.relations[relationKey(a!, b!)] = -100;
    nations[a!]!.mobilization = 1;
    nations[b!]!.mobilization = 2;
    nations[a!]!.warWeariness = 30;
    nations[b!]!.warWeariness = 35;
    nations[a!]!.defcon = 3;
    nations[b!]!.defcon = 3;
  }

  placeStartingForces(world, state);

  if (scenario === 'taiwan-crisis') applyTaiwanCrisis(world, state);
  initEconomy(world, state);

  state.log.push({
    turn: 0,
    kind: 'info',
    text: `January 2027. You lead ${world.nations.get(player)!.name}. The world holds its breath.`,
    nations: [player],
    alert: true,
  });
  return state;
}

/** Average interest on public debt at start: 1.5 % plus 0.9 × inflation (D-061). */
export function startingInterest(inflation: number): number {
  return clamp(1.5 + 0.9 * Math.max(0, inflation), 0.5, 60);
}

/**
 * Calibrates the economy on the starting world (D-061): the trade network, resource market and
 * sanctions in force become the baseline penalties are measured against; elections are scheduled
 * and approval starts at its equilibrium.
 */
export function initEconomy(world: World, state: GameState): void {
  runTrade(world, state, true);
  scheduleElections(world, state);
  for (const n of Object.values(state.nations)) {
    n.support = clamp(Math.round(supportBreakdown(world, state, n.iso3).target), 20, 80);
  }
  recordHistory(world, state);
}

/** Armies already at war when the campaign opens start as veterans. */
function startingExperience(state: GameState, owner: Iso3): number {
  return state.wars.some((w) => w.attackers.includes(owner) || w.defenders.includes(owner)) ? 35 : 10;
}

function addUnit(
  world: World,
  state: GameState,
  type: string,
  owner: Iso3,
  region: RegionId,
  strength = 100,
): Unit {
  const domain = world.unitTypes.get(type)?.domain;
  const u: Unit = makeUnit(state.nextId++, type, owner, region, {
    strength,
    mission: domain === 'air' ? 'superiority' : null,
    commander: domain === 'land' ? maybeCommander(world, state, owner) : null,
    experience: startingExperience(state, owner),
  });
  state.units[u.id] = u;
  return u;
}

/** Picks a home-waters sea zone adjacent to the nation's coast, preferring the capital's coast. */
export function homeSeaZones(world: World, state: GameState, iso3: Iso3): RegionId[] {
  const owned = world.regionsByNation.get(iso3) ?? [];
  const cap = world.capitalRegion.get(iso3);
  const zones: RegionId[] = [];
  const ordered = cap ? [cap, ...owned.filter((r) => r !== cap)] : [...owned];
  for (const rid of ordered) {
    if (state.regions[rid]?.controller !== iso3) continue;
    for (const n of world.regions.get(rid)!.neighbours) {
      if (world.regions.get(n)?.sea && !zones.includes(n)) zones.push(n);
    }
  }
  return zones;
}

function placeStartingForces(world: World, state: GameState): void {
  const navies = forcesData.navies as Record<string, Record<string, number>>;
  const bombers = forcesData.bombers as Record<string, number>;
  for (const n of world.nationList) {
    // Garrison every region the nation controls at start, including occupied ones (e.g. Donetsk).
    const controlled = Object.values(state.regions)
      .filter((r) => r.controller === n.iso3 && r.owner !== n.iso3)
      .map((r) => r.id);
    const owned = [...controlled, ...(world.regionsByNation.get(n.iso3) ?? [])].filter(
      (rid) => state.regions[rid]?.controller === n.iso3,
    );
    if (owned.length === 0) continue;
    const cap = world.capitalRegion.get(n.iso3) ?? owned[0]!;
    // Land divisions from active personnel (one formation ≈ 25,000 troops), capped for sanity.
    const quality = qualityOf(n.defenceSpendUsdBn, n.activePersonnel);
    // Average formation upkeep ≈ 0.12 bn/month × cost factor; keep upkeep within ~75% of the real budget.
    const affordable = Math.floor(
      ((n.defenceSpendUsdBn / 12) * 0.75) / (0.12 * clamp(quality ** 1.5, 0.3, 1.6)),
    );
    const divisions = clamp(
      Math.min(Math.round(n.activePersonnel / 25_000), affordable),
      n.activePersonnel > 5_000 ? 1 : 0,
      90,
    );
    const mix: [string, number][] = [
      ['infantry', 0.5],
      ['mechanized', 0.25],
      ['armored', 0.15],
      ['artillery', 0.1],
    ];
    const weights = owned.map(
      (rid) =>
        (world.regions.get(rid)?.populationShare ?? 0) +
        (rid === cap ? 0.08 : 0) +
        (controlled.includes(rid) ? 0.25 : 0),
    );
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    const pickRegion = (i: number): RegionId => {
      // deterministic round-robin by cumulative weight
      const t = ((i + 0.5) / Math.max(1, divisions)) * totalW;
      let acc = 0;
      for (let k = 0; k < owned.length; k++) {
        acc += weights[k]!;
        if (t <= acc) return owned[k]!;
      }
      return cap;
    };
    let placed = 0;
    for (const [type, share] of mix) {
      const count = Math.round(divisions * share);
      for (let i = 0; i < count; i++) addUnit(world, state, type, n.iso3, pickRegion(placed++));
    }
    const airDef = Math.round(divisions / 10);
    for (let i = 0; i < airDef; i++) addUnit(world, state, 'airDefense', n.iso3, pickRegion(placed++));
    if (n.defenceSpendUsdBn >= 8) addUnit(world, state, 'specialForces', n.iso3, cap);
    // Air wings from spending.
    const fighters = Math.min(
      40,
      Math.floor(n.defenceSpendUsdBn / 25) + (n.defenceSpendUsdBn >= 5 ? 1 : 0),
    );
    for (let i = 0; i < fighters; i++) addUnit(world, state, 'fighter', n.iso3, pickRegion(placed++));
    const drones = Math.min(
      12,
      Math.floor(n.defenceSpendUsdBn / 40) + (n.defenceSpendUsdBn >= 2 ? 1 : 0),
    );
    for (let i = 0; i < drones; i++) addUnit(world, state, 'drone', n.iso3, pickRegion(placed++));
    for (let i = 0; i < (bombers[n.iso3] ?? 0); i++) addUnit(world, state, 'bomber', n.iso3, cap);
    // Marines for nations with amphibious groups.
    const navy = navies[n.iso3];
    const zones = homeSeaZones(world, state, n.iso3);
    if (zones.length > 0) {
      const spec = navy ?? { destroyerGroup: n.defenceSpendUsdBn >= 4 ? 1 : 0 };
      let z = 0;
      for (const [type, count] of Object.entries(spec)) {
        for (let i = 0; i < count; i++) addUnit(world, state, type, n.iso3, zones[z++ % zones.length]!);
      }
      const marines = (spec.amphibiousGroup ?? 0) * 2;
      for (let i = 0; i < marines; i++) addUnit(world, state, 'marines', n.iso3, cap);
    }
  }
}

function applyTaiwanCrisis(world: World, state: GameState): void {
  state.flashpoints['taiwan-strait'] = 90;
  state.flashpoints['south-china-sea'] = 70;
  state.globalTension = 72;
  state.relations[relationKey('USA', 'CHN')] = -78;
  state.relations[relationKey('CHN', 'TWN')] = -95;
  state.relations[relationKey('CHN', 'JPN')] = -60;
  const chn = state.nations['CHN']!;
  chn.mobilization = 1;
  chn.defcon = 3;
  state.nations['TWN']!.mobilization = 2;
  state.nations['TWN']!.defcon = 2;
  state.nations['USA']!.defcon = 3;
  state.nations['JPN']!.defcon = 4;
  // Concentrate PLA forces in Fujian/Zhejiang/Guangdong and the strait.
  const fujian = 96;
  for (const u of Object.values(state.units)) {
    if (u.owner === 'CHN' && (u.type === 'marines' || u.type === 'specialForces'))
      u.region = fujian;
  }
  for (let i = 0; i < 6; i++) addUnit(world, state, 'mechanized', 'CHN', fujian);
  for (let i = 0; i < 4; i++) addUnit(world, state, 'marines', 'CHN', fujian);
  for (let i = 0; i < 3; i++) addUnit(world, state, 'fighter', 'CHN', fujian);
  // The Taiwan Strait is its own sea zone (D-058); fall back to any sea off Fujian.
  const fujianSeas = world.regions.get(fujian)!.neighbours.filter((n) => world.regions.get(n)?.sea);
  const strait =
    fujianSeas.find((n) => world.regions.get(n)?.name === 'Taiwan Strait') ?? fujianSeas[0];
  if (strait) {
    for (const u of Object.values(state.units))
      if (u.owner === 'CHN' && world.regions.get(u.region)?.sea) u.region = strait;
    for (let i = 0; i < 3; i++) addUnit(world, state, 'amphibiousGroup', 'CHN', strait);
    const straitSeas = world.regions
      .get(strait)!
      .neighbours.filter((n) => world.regions.get(n)?.sea);
    const usZone =
      straitSeas.find((n) => world.regions.get(n)?.name === 'East China Sea') ??
      straitSeas[0] ??
      strait;
    let carriers = 0;
    for (const u of Object.values(state.units))
      if (u.owner === 'USA' && u.type === 'carrierGroup' && carriers++ < 3) u.region = usZone;
  }
  state.log.push({
    turn: 0,
    kind: 'war',
    text: 'Taiwan Strait Crisis: Chinese forces mass in Fujian as amphibious groups put to sea. Washington orders carrier groups west.',
    nations: ['CHN', 'TWN', 'USA'],
    alert: true,
  });
}
