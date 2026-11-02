/**
 * Calibration scenarios (docs/BALANCE.md): real map, real starting forces, scripted campaigns.
 * Each test asserts a plausible range rather than an exact number; the ranges and the reasoning
 * behind them are documented in docs/BALANCE.md. Keep them in sync when tuning src/sim/terrain.ts
 * or military.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, dateForTurn } from './game';
import { isoYearMonth } from './calendar';
import { loadWorld } from './world';
import { estimateOdds, findPath, supplyFor } from './military';
import { amphibiousTargets, hasSeaControl, liftCapacity, seaRoute } from './geography';
import { controlledRegions, unitsOf } from './query';
import type { GameState, Iso3, RegionId, Unit } from './types';

const world = loadWorld();
const R = {
  tehran: 586, khuzestan: 571, hormozgan: 576, kermanshah: 584, isfahan: 580, fars: 581, markazi: 579,
  kuwaitJahra: 687, gulf: 1107, innerGulf: 1065,
  taipei: 959, taichung: 958, kaohsiung: 957, fujian: 96, taiwanZoneN: 1062, taiwanZoneS: 1103,
  tallinn: 376, idaViru: 377, riga: 378, daugavpils: 379, vilnius: 302, kaunas: 301, tver: 353, vitebsk: 255, minsk: 256,
  seoul: 209, gyeonggi: 199, gangwon: 198, southHamgyong: 217, pyongyang: 218,
  heilongjiang: 90, jilin: 91, khabarovsk: 335, zabaykalsky: 334,
  ladakh: 58, himachal: 68, uttarakhand: 62, arunachal: 59, tibet: 86, xinjiang: 85,
  california: 836, washington: 830, calZone: 1080, mexZone: 1113,
} as const;

function addUnits(state: GameState, type: string, owner: Iso3, region: RegionId, n: number): void {
  for (let i = 0; i < n; i++) {
    const u: Unit = {
      id: state.nextId++, type, owner, region, strength: 100, morale: 85, path: [], prevRegion: region, moveProgress: 0,
    };
    state.units[u.id] = u;
  }
}

function removeUnits(state: GameState, pred: (u: Unit) => boolean): void {
  for (const u of Object.values(state.units)) if (pred(u)) delete state.units[u.id];
}

function moveAll(state: GameState, pred: (u: Unit) => boolean, region: RegionId): void {
  for (const u of Object.values(state.units))
    if (pred(u)) {
      u.region = region;
      u.prevRegion = region;
      u.path = [];
    }
}

/** War without alliance obligations (the pact variant uses the real declareWar command). */
function rawWar(state: GameState, a: Iso3, b: Iso3): void {
  state.wars.push({ id: state.nextId++, attackers: [a], defenders: [b], since: state.turn, score: 0 });
  state.relations[a < b ? `${a}|${b}` : `${b}|${a}`] = -100;
  state.diplomacyVersion++;
  state.nations[a]!.mobilization = Math.max(state.nations[a]!.mobilization, 1) as 1 | 2;
  state.nations[b]!.mobilization = 2;
}

function newGame(player: Iso3, seed = 7, scenario: 'world-2027' | 'taiwan-crisis' = 'world-2027'): GameState {
  return createGame({ seed, player, scenario }, world);
}

function startAt(state: GameState, turn: number): void {
  state.turn = turn;
  state.date = dateForTurn(turn);
  state.isoDate = isoYearMonth(state.date);
}

const landStrength = (state: GameState, iso: Iso3): number =>
  unitsOf(state, iso)
    .filter((u) => world.unitTypes.get(u.type)?.domain === 'land')
    .reduce((s, u) => s + u.strength, 0);

const heldOf = (state: GameState, attacker: Iso3, victim: Iso3): RegionId[] =>
  controlledRegions(state, attacker).filter((r) => world.regions.get(r)?.iso3 === victim);

interface CampaignLog {
  turns: number;
  captured: Map<RegionId, number>;
  attackerLossTotal: number;
  defenderLossTotal: number;
  attackerStart: number;
  defenderStart: number;
  attackerEnd: number;
  defenderEnd: number;
  battles: number;
  history: string[];
}

/**
 * Drives the player's land forces toward `objective` each month: stacks attack the next region on
 * the path when the odds reach `threshold`, otherwise they move up or hold. Everyone else is the
 * built-in AI.
 */
function campaign(
  state0: GameState,
  attacker: Iso3,
  defender: Iso3,
  objective: RegionId,
  months: number,
  opts: { threshold?: number; onlyFrom?: Set<RegionId>; stopWhenCaptured?: boolean } = {},
): { state: GameState; log: CampaignLog } {
  let state = state0;
  const threshold = opts.threshold ?? 0.8;
  const log: CampaignLog = {
    turns: 0, captured: new Map(), attackerLossTotal: 0, defenderLossTotal: 0,
    attackerStart: landStrength(state, attacker), defenderStart: landStrength(state, defender),
    attackerEnd: 0, defenderEnd: 0, battles: 0, history: [],
  };
  const seen = new Set<RegionId>();
  for (let m = 0; m < months; m++) {
    // Orders for every idle land stack of the attacker.
    const stacks = new Map<RegionId, Unit[]>();
    for (const u of unitsOf(state, attacker)) {
      if (world.unitTypes.get(u.type)?.domain !== 'land') continue;
      if (opts.onlyFrom && !opts.onlyFrom.has(u.region) && state.regions[u.region]?.controller !== attacker) continue;
      stacks.set(u.region, [...(stacks.get(u.region) ?? []), u]);
    }
    for (const [region, stack] of stacks) {
      if (region === objective) continue;
      const path = findPath(world, state, stack[0]!, objective, 12, true);
      if (!path || path.length === 0) continue;
      const next = path[0]!;
      const ctrl = state.regions[next]?.controller;
      const hostile = ctrl !== null && ctrl !== undefined && ctrl !== attacker && !state.wars.every((w) => !(w.attackers.includes(attacker) && w.defenders.includes(ctrl)) && !(w.defenders.includes(attacker) && w.attackers.includes(ctrl)));
      // A corps attacks with a front-width-sized wave (the rest follow as the front moves).
      const wave = hostile ? stack.slice(0, 8) : stack;
      if (hostile) {
        const odds = estimateOdds(world, state, wave.map((u) => u.id), next);
        if (odds.ratio < threshold) continue;
      }
      state = applyCommand(world, state, { type: 'moveUnits', unitIds: wave.map((u) => u.id), target: next });
    }
    const before = { a: landStrength(state, attacker), d: landStrength(state, defender) };
    state = applyCommand(world, state, { type: 'endTurn' });
    log.turns++;
    for (const b of state.log.filter((l) => l.turn === state.turn - 1 && l.kind === 'battle' && (l.nations?.includes(attacker) ?? false))) {
      log.battles++;
      void b;
    }
    for (const r of heldOf(state, attacker, defender)) if (!seen.has(r)) { seen.add(r); log.captured.set(r, log.turns); }
    const after = { a: landStrength(state, attacker), d: landStrength(state, defender) };
    log.attackerLossTotal += Math.max(0, before.a - after.a);
    log.defenderLossTotal += Math.max(0, before.d - after.d);
    log.history.push(`m${log.turns} ${state.isoDate}: att ${after.a.toFixed(0)} def ${after.d.toFixed(0)} held ${heldOf(state, attacker, defender).length} ${state.regions[objective]!.controller === attacker ? 'OBJECTIVE TAKEN' : ''}`);
    if (opts.stopWhenCaptured && state.regions[objective]!.controller === attacker) break;
    if (!state.nations[defender]!.alive) break;
  }
  log.attackerEnd = landStrength(state, attacker);
  log.defenderEnd = landStrength(state, defender);
  return { state, log };
}

const report = (name: string, log: CampaignLog) => {
  console.log(`\n[${name}] ${log.turns} months, ${log.battles} battles, attacker ${log.attackerStart.toFixed(0)}→${log.attackerEnd.toFixed(0)} (lost ${log.attackerLossTotal.toFixed(0)}), defender ${log.defenderStart.toFixed(0)}→${log.defenderEnd.toFixed(0)} (lost ${log.defenderLossTotal.toFixed(0)})`);
  console.log(`  captured: ${[...log.captured.entries()].map(([r, t]) => `${world.regions.get(r)!.name}@m${t}`).join(', ') || 'none'}`);
  console.log('  ' + log.history.slice(-4).join('\n  '));
};

describe('calibration: US-led invasion of Iran via the Gulf', () => {
  it('secures the coast within months but the Zagros push toward Tehran is slow and bloody', () => {
    const g = newGame('USA');
    rawWar(g, 'USA', 'IRN');
    // Build-up: carriers, escorts and amphibious groups in the Gulf; a corps staged in Kuwait.
    moveAll(g, (u) => u.owner === 'USA' && (u.type === 'carrierGroup' || u.type === 'destroyerGroup' || u.type === 'amphibiousGroup' || u.type === 'attackSub'), R.gulf);
    removeUnits(g, (u) => u.owner === 'USA' && world.unitTypes.get(u.type)?.domain === 'land');
    addUnits(g, 'marines', 'USA', R.kuwaitJahra, 6);
    addUnits(g, 'mechanized', 'USA', R.kuwaitJahra, 6);
    addUnits(g, 'armored', 'USA', R.kuwaitJahra, 3);
    addUnits(g, 'infantry', 'USA', R.kuwaitJahra, 6);
    addUnits(g, 'artillery', 'USA', R.kuwaitJahra, 3);
    moveAll(g, (u) => u.owner === 'USA' && (u.type === 'fighter' || u.type === 'bomber'), R.kuwaitJahra);
    // Iran mobilises toward its real order of battle (≈ 600 k regulars and IRGC, plus Basij):
    // the starting economy cap under-counts it. Deployed on the Zagros, the interior and Tehran.
    addUnits(g, 'infantry', 'IRN', R.kermanshah, 6);
    addUnits(g, 'infantry', 'IRN', R.khuzestan, 4);
    addUnits(g, 'infantry', 'IRN', R.hormozgan, 2);
    addUnits(g, 'infantry', 'IRN', R.isfahan, 4);
    addUnits(g, 'infantry', 'IRN', R.markazi, 4);
    addUnits(g, 'infantry', 'IRN', R.fars, 2);
    addUnits(g, 'infantry', 'IRN', R.tehran, 8);
    addUnits(g, 'airDefense', 'IRN', R.tehran, 2);
    for (const r of world.regionsByNation.get('IRN')!) addUnits(g, 'infantry', 'IRN', r, 1); // Basij reserves
    expect(hasSeaControl(world, g, R.gulf, 'USA')).toBe(true);
    const { state, log } = campaign(g, 'USA', 'IRN', R.tehran, 18, { threshold: 0.7 });
    report('Iran', log);
    const coastTurn = Math.min(log.captured.get(R.khuzestan) ?? 99, log.captured.get(R.hormozgan) ?? 99);
    expect(coastTurn).toBeLessThanOrEqual(6);
    const tehranTurn = log.captured.get(R.tehran) ?? 99;
    expect(tehranTurn).toBeGreaterThanOrEqual(9);
    expect(log.attackerLossTotal).toBeGreaterThan(250);
    // The Zagros itself: Kermanshah is mountains with a ×2.5 defence and the attack crosses a mountain border.
    const zagros = estimateOdds(world, state, unitsOf(state, 'USA').filter((u) => u.region === R.khuzestan).map((u) => u.id), R.kermanshah);
    void zagros;
    expect(world.regions.get(R.kermanshah)!.terrain).toBe('mountains');
  }, 120_000);
});

describe('calibration: invading the continental United States', () => {
  it('is impossible without total control of the ocean route, and a landing cannot be sustained', () => {
    const g = newGame('CHN');
    rawWar(g, 'CHN', 'USA');
    // Nothing reaches the US coast: the Pacific is more than three zones wide and the US Navy holds it.
    const route = seaRoute(world, g, [R.taiwanZoneN, R.taiwanZoneS], [R.calZone], 'CHN', 20);
    expect(route).toBeNull();
    const routeUncontested = seaRoute(world, g, [R.taiwanZoneN, R.taiwanZoneS], [R.calZone], 'CHN', 20, false);
    expect(routeUncontested).not.toBeNull();
    expect(routeUncontested!.length).toBeGreaterThan(3);
    for (const u of unitsOf(g, 'CHN'))
      if (world.unitTypes.get(u.type)?.domain === 'land')
        expect(amphibiousTargets(world, g, u.region, 'CHN', u.type).some((t) => world.regions.get(t)?.iso3 === 'USA')).toBe(false);

    // Even granted total naval dominance off California (every US ship removed, a Chinese fleet
    // parked offshore) and a landing force on the beach, the beachhead starves and dies.
    const h = newGame('CHN', 11);
    rawWar(h, 'CHN', 'USA');
    removeUnits(h, (u) => u.owner === 'USA' && world.unitTypes.get(u.type)?.domain === 'sea');
    moveAll(h, (u) => u.owner === 'CHN' && world.unitTypes.get(u.type)?.domain === 'sea', R.calZone);
    expect(liftCapacity(world, h, 'CHN')).toBeLessThanOrEqual(8);
    addUnits(h, 'marines', 'CHN', R.california, 6);
    addUnits(h, 'mechanized', 'CHN', R.california, 2);
    for (const u of unitsOf(h, 'CHN')) if (u.region === R.california) u.prevRegion = R.fujian; // landed this month
    const supply = supplyFor(world, h, 'CHN', R.california, true);
    expect(supply).toBeLessThan(0.6);
    const { state, log } = campaign(h, 'CHN', 'USA', world.capitalRegion.get('USA')!, 12, { threshold: 0.5 });
    report('CONUS', log);
    expect(heldOf(state, 'CHN', 'USA').length).toBeLessThanOrEqual(1);
    const landed = unitsOf(state, 'CHN').filter((u) => world.regions.get(u.region)?.iso3 === 'USA');
    expect(landed.reduce((s, u) => s + u.strength, 0)).toBeLessThan(300);
  }, 120_000);
});

describe('calibration: Russia and the Baltic states', () => {
  it('without a NATO response the Baltics fall within a few months', () => {
    const g = newGame('RUS');
    for (const b of ['EST', 'LVA', 'LTU']) rawWar(g, 'RUS', b);
    // The real Western Military District: a corps on the Narva/Pskov axis and another facing Lithuania.
    moveAll(g, (u) => u.owner === 'RUS' && ['armored', 'mechanized'].includes(u.type), R.tver);
    addUnits(g, 'infantry', 'RUS', R.tver, 6);
    let state = g;
    const objectives: [RegionId, Iso3][] = [[R.tallinn, 'EST'], [R.riga, 'LVA'], [R.vilnius, 'LTU']];
    const fell: Record<string, number> = {};
    for (let m = 1; m <= 6; m++) {
      for (const [obj, iso] of objectives) {
        if (state.regions[obj]!.controller === 'RUS' || !state.nations[iso]!.alive) continue;
        const r = campaign(state, 'RUS', iso, obj, 1, { threshold: 0.7 });
        state = r.state;
        break; // one objective per month: concentrate
      }
      for (const [obj, iso] of objectives)
        if (fell[iso] === undefined && state.regions[obj]!.controller === 'RUS') fell[iso] = m;
    }
    console.log('\n[Baltics, no NATO] capitals fell:', JSON.stringify(fell));
    expect(Object.keys(fell).length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...Object.values(fell))).toBeLessThanOrEqual(3);
  }, 120_000);

  it('with the NATO defensive pact the alliance enters and the outcome is contested', () => {
    let g = newGame('RUS');
    moveAll(g, (u) => u.owner === 'RUS' && ['armored', 'mechanized'].includes(u.type), R.tver);
    addUnits(g, 'infantry', 'RUS', R.tver, 6);
    g = applyCommand(world, g, { type: 'propose', proposal: 'declareWar', target: 'EST' });
    const war = g.wars.find((w) => w.attackers.includes('RUS') && w.defenders.includes('EST'))!;
    expect(war.defenders.length).toBeGreaterThanOrEqual(10);
    expect(war.defenders).toContain('USA');
    expect(war.defenders).toContain('POL');
    const { state, log } = campaign(g, 'RUS', 'EST', R.tallinn, 6, { threshold: 0.7 });
    report('Baltics with NATO', log);
    const lostHome = world.regionsByNation.get('RUS')!.filter((r) => state.regions[r]!.controller !== 'RUS').length;
    const tallinnTaken = state.regions[R.tallinn]!.controller === 'RUS';
    console.log(`  Tallinn taken: ${tallinnTaken}; Russian home regions lost: ${lostHome}; Russian strength ${log.attackerEnd.toFixed(0)}`);
    // Contested: either Tallinn holds, or Russia pays for it with its own territory / a shattered army.
    expect(!tallinnTaken || lostHome >= 1 || log.attackerEnd < log.attackerStart * 0.7).toBe(true);
    expect(log.attackerLossTotal).toBeGreaterThan(150);
  }, 120_000);
});

describe('calibration: China and Taiwan', () => {
  it('needs sea control of the strait first, and the landing is extremely costly even then', () => {
    const g = newGame('CHN', 5, 'taiwan-crisis');
    rawWar(g, 'CHN', 'TWN');
    rawWar(g, 'CHN', 'USA');
    moveAll(g, (u) => u.owner === 'USA' && (u.type === 'carrierGroup' || u.type === 'destroyerGroup' || u.type === 'attackSub'), R.taiwanZoneN);
    // The US Pacific Fleet sits in the strait: no Chinese sea control, so no landing is possible.
    expect(hasSeaControl(world, g, R.taiwanZoneN, 'CHN')).toBe(false);
    expect(amphibiousTargets(world, g, R.fujian, 'CHN', 'marines')).not.toContain(R.taipei);
    // Washington stays out: the carriers withdraw and the PLA Navy owns the strait.
    const h = newGame('CHN', 5, 'taiwan-crisis');
    rawWar(h, 'CHN', 'TWN');
    removeUnits(h, (u) => u.owner === 'USA' && world.unitTypes.get(u.type)?.domain === 'sea');
    moveAll(h, (u) => u.owner === 'TWN' && world.unitTypes.get(u.type)?.domain === 'sea', R.taiwanZoneS);
    removeUnits(h, (u) => u.owner === 'TWN' && world.unitTypes.get(u.type)?.domain === 'sea');
    expect(hasSeaControl(world, h, R.taiwanZoneN, 'CHN')).toBe(true);
    expect(amphibiousTargets(world, h, R.fujian, 'CHN', 'marines')).toContain(R.taipei);
    // Beijing orders the landing regardless of the odds.
    const { state, log } = campaign(h, 'CHN', 'TWN', R.taipei, 9, { threshold: 0.05 });
    report('Taiwan', log);
    // At least fifteen formations' worth of strength lost for an island with three regions.
    expect(log.attackerLossTotal).toBeGreaterThan(1500);
    const taipeiTurn = log.captured.get(R.taipei) ?? 99;
    expect(taipeiTurn).toBeGreaterThanOrEqual(3);
    void state;
  }, 120_000);
});

describe('calibration: ground offensive across the Korean DMZ', () => {
  it('is slow, bloody and fought in cities', () => {
    const g = newGame('PRK', 3);
    rawWar(g, 'PRK', 'KOR');
    // The KPA at its real size (≈ 1.2 m active; the economy cap otherwise under-counts it).
    addUnits(g, 'infantry', 'PRK', R.southHamgyong, 24);
    addUnits(g, 'artillery', 'PRK', R.southHamgyong, 8);
    addUnits(g, 'armored', 'PRK', R.southHamgyong, 4);
    moveAll(g, (u) => u.owner === 'PRK' && world.unitTypes.get(u.type)?.domain === 'land', R.southHamgyong);
    moveAll(g, (u) => u.owner === 'KOR' && ['infantry', 'mechanized', 'armored', 'artillery'].includes(u.type), R.gyeonggi);
    expect(world.regions.get(R.gyeonggi)!.terrain).toBe('urban');
    expect(world.regions.get(R.seoul)!.terrain).toBe('urban');
    const { log } = campaign(g, 'PRK', 'KOR', R.seoul, 8, { threshold: 0.6 });
    report('Korea', log);
    const seoulTurn = log.captured.get(R.seoul) ?? 99;
    expect(seoulTurn).toBeGreaterThanOrEqual(4);
    expect(log.attackerLossTotal).toBeGreaterThan(500);
    expect(log.defenderLossTotal).toBeGreaterThan(300);
  }, 120_000);
});

describe('calibration: deep winter offensive into Russia', () => {
  /** A Chinese army group already two regions deep (Zabaykalsky and Khabarovsk held) pushes on toward Moscow. */
  function deepOffensive(startTurn: number): CampaignLog {
    const g = newGame('CHN', 9);
    startAt(g, startTurn);
    rawWar(g, 'CHN', 'RUS');
    for (const r of [R.zabaykalsky, R.khabarovsk]) {
      g.regions[r]!.controller = 'CHN';
      g.regions[r]!.flippedTurn = startTurn - 1;
      removeUnits(g, (u) => u.region === r);
    }
    g.regionsVersion++;
    moveAll(g, (u) => u.owner === 'CHN' && ['infantry', 'mechanized', 'armored', 'artillery'].includes(u.type), R.zabaykalsky);
    return campaign(g, 'CHN', 'RUS', world.capitalRegion.get('RUS')!, 4, { threshold: 0.05 }).log;
  }
  it('bleeds the attacker far more than the same offensive in summer', () => {
    const winter = deepOffensive(11); // December 2027 → March 2028
    const summer = deepOffensive(5); // June → September 2027
    report('Deep winter', winter);
    report('Deep summer', summer);
    expect(winter.attackerLossTotal).toBeGreaterThan(summer.attackerLossTotal * 1.5);
    expect(winter.attackerLossTotal).toBeGreaterThan(1200);
  }, 120_000);
});

describe('calibration: India and China along the LAC', () => {
  it('mountains limit both sides to small gains', () => {
    const a = newGame('IND', 4);
    rawWar(a, 'IND', 'CHN');
    moveAll(a, (u) => u.owner === 'IND' && ['infantry', 'mechanized', 'armored', 'artillery'].includes(u.type), R.ladakh);
    const india = campaign(a, 'IND', 'CHN', R.tibet, 12, { threshold: 0.6 });
    report('LAC: India attacks', india.log);
    const b = newGame('CHN', 4);
    rawWar(b, 'CHN', 'IND');
    moveAll(b, (u) => u.owner === 'CHN' && ['infantry', 'mechanized', 'armored', 'artillery'].includes(u.type) && u.region !== R.fujian, R.tibet);
    const china = campaign(b, 'CHN', 'IND', R.ladakh, 12, { threshold: 0.6 });
    report('LAC: China attacks', china.log);
    expect(india.log.captured.size).toBeLessThanOrEqual(2);
    expect(china.log.captured.size).toBeLessThanOrEqual(2);
    expect(world.regions.get(R.ladakh)!.terrain).toBe('mountains');
    expect(world.regions.get(R.tibet)!.terrain).toBe('mountains');
  }, 120_000);
});
