/**
 * Military depth (D-059): supply network, interception, sea control, combat modifiers, fog of
 * war, air missions, strikes, cyber, space, commanders and battle reports.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import {
  HOME_SUPPLY_FLOOR,
  SUPPLY_THRESHOLD,
  airSuperiorityFactor,
  attackerFactors,
  defenderFactors,
  estimateOdds,
  experienceFactor,
  isDepot,
  runAttrition,
  runCombat,
  runMovement,
  runSupply,
} from './military';
import { airDefenceAt, interceptionLoss, interdictionFactor, runAirOperations } from './air';
import { blockadeShare, runNavalCombat, zoneControl } from './naval';
import { applyAsat, applyCyberOp, applyMissileStrike, canAsat, interceptionChance, SALVO } from './strikes';
import { estimateStack, intelLevel } from './intel';
import { commanderAttackModifier, maybeCommander } from './commanders';
import { makeUnit, unitsIn, unitsOf } from './query';
import { amphibiousTargets, hasSeaControl } from './geography';
import type { GameState, Iso3, RegionId, Unit } from './types';

const world = loadWorld();
const Z = (name: string): RegionId => {
  const z = world.regionList.find((r) => r.sea && r.name === name);
  if (!z) throw new Error(`no sea zone ${name}`);
  return z.id;
};

function newGame(player: Iso3, seed = 7): GameState {
  return createGame({ seed, player, scenario: 'world-2027' }, world);
}
function rawWar(state: GameState, a: Iso3, b: Iso3): void {
  state.wars.push({ id: state.nextId++, attackers: [a], defenders: [b], since: state.turn, score: 0 });
  state.relations[a < b ? `${a}|${b}` : `${b}|${a}`] = -100;
  state.diplomacyVersion++;
}
function add(state: GameState, type: string, owner: Iso3, region: RegionId, n = 1, extra: Partial<Unit> = {}): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < n; i++) {
    const u = makeUnit(state.nextId++, type, owner, region, {
      mission: world.unitTypes.get(type)?.domain === 'air' ? 'superiority' : null,
      ...extra,
    });
    state.units[u.id] = u;
    out.push(u);
  }
  return out;
}
function clear(state: GameState, pred: (u: Unit) => boolean): void {
  for (const u of Object.values(state.units)) if (pred(u)) delete state.units[u.id];
}
const cap = (iso: Iso3) => world.capitalRegion.get(iso)!;
/** A land neighbour of `r`, handed to `iso` for the test (a bridgehead). */
const landNeighbour = (r: RegionId, iso: Iso3, state: GameState): RegionId => {
  const n = world.regions.get(r)!.neighbours.find((x) => !world.regions.get(x)!.sea)!;
  state.regions[n]!.controller = iso;
  state.regionsVersion++;
  for (const u of Object.values(state.units)) if (u.region === n && u.owner !== iso) delete state.units[u.id];
  return n;
};

describe('supply network (D-059)', () => {
  it('capitals, major ports and industrial regions are depots; other home regions keep a floor', () => {
    const g = newGame('USA');
    expect(isDepot(world, 'USA', cap('USA'))).toBe(true);
    const home = world.regionsByNation.get('USA')!;
    const depots = home.filter((r) => isDepot(world, 'USA', r));
    expect(depots.length).toBeGreaterThan(3);
    expect(depots.length).toBeLessThan(home.length);
    runSupply(world, g);
    for (const r of home) {
      expect(g.regions[r]!.supply).toBeGreaterThanOrEqual(HOME_SUPPLY_FLOOR - 0.01);
    }
    expect(g.regions[cap('USA')]!.supply).toBeGreaterThan(HOME_SUPPLY_FLOOR + 0.2);
  });

  it('bombed infrastructure and enemy interdiction wings cut supply; cut-off units lose strength and morale', () => {
    const g = newGame('POL');
    rawWar(g, 'POL', 'BLR');
    runSupply(world, g);
    const minsk = cap('BLR');
    const before = g.regions[minsk]!.supply;
    g.regions[minsk]!.infraDamage = 0.6;
    runSupply(world, g);
    const damaged = g.regions[minsk]!.supply;
    expect(damaged).toBeLessThan(before);
    // Interdiction: Polish fighters next door on interdiction.
    // Fighters (range 1) forward-based next to Minsk, flying interdiction.
    const border = world.regions.get(minsk)!.neighbours.find((n) => !world.regions.get(n)!.sea)!;
    add(g, 'fighter', 'POL', border, 3, { mission: 'interdiction' });
    g.regions[minsk]!.infraDamage = 0;
    runSupply(world, g);
    expect(interdictionFactor(world, g, minsk, 'BLR')).toBeLessThan(0.7);
    expect(g.regions[minsk]!.supply).toBeLessThan(before);
    // Cut off: a Belarusian unit deep in Poland with no friendly neighbours.
    const deep = cap('POL');
    const [u] = add(g, 'infantry', 'BLR', deep, 1);
    const s0 = u!.strength;
    const m0 = u!.morale;
    runAttrition(world, g);
    expect(u!.strength).toBeLessThan(s0);
    expect(u!.morale).toBeLessThan(m0 - 3);
    expect(SUPPLY_THRESHOLD).toBe(0.25);
  });
});

describe('interception (D-059)', () => {
  it('missile defence tech and air-defence brigades raise the interception chance; strike tech lowers it', () => {
    const g = newGame('USA');
    rawWar(g, 'USA', 'IRN');
    const tehran = cap('IRN');
    clear(g, (u) => u.region === tehran);
    const bare = interceptionChance(world, g, tehran, 'USA');
    add(g, 'airDefense', 'IRN', tehran, 3);
    const withAd = interceptionChance(world, g, tehran, 'USA');
    expect(withAd).toBeGreaterThan(bare);
    g.nations['IRN']!.modifiers.missileDefence = 0.2;
    const withTech = interceptionChance(world, g, tehran, 'USA');
    expect(withTech).toBeGreaterThan(withAd);
    g.nations['USA']!.modifiers.strikePower = 0.4;
    expect(interceptionChance(world, g, tehran, 'USA')).toBeLessThan(withTech);
  });

  it('a missile strike spends a salvo, logs hits and interceptions, and damages infrastructure', () => {
    const g = newGame('USA');
    rawWar(g, 'USA', 'IRN');
    const tehran = cap('IRN');
    const missiles = g.nations['USA']!.missiles;
    const after = applyCommand(world, g, { type: 'missileStrike', region: tehran, kind: 'infrastructure' });
    expect(after.nations['USA']!.missiles).toBe(missiles - SALVO);
    expect(after.regions[tehran]!.infraDamage).toBeGreaterThan(0);
    const strike = after.strikes.find((s) => s.kind === 'missile')!;
    expect(strike.launched).toBe(SALVO);
    expect((strike.intercepted ?? 0) + (SALVO - (strike.intercepted ?? 0))).toBe(SALVO);
    expect(after.log.some((l) => l.kind === 'strike' && /cruise missiles/.test(l.text))).toBe(true);
    // Not at war: refused.
    expect(() => applyMissileStrike(world, g, 'USA', cap('GBR'), 'military')).toThrow(/not at war/);
  });

  it('air wings over defended enemy regions take interception losses scaled by air defence', () => {
    const g = newGame('USA');
    rawWar(g, 'USA', 'IRN');
    const tehran = cap('IRN');
    const kuwait = 687;
    clear(g, (u) => u.region === tehran);
    const [bomber] = add(g, 'bomber', 'USA', kuwait, 1, { mission: 'bombing' });
    const undefended = interceptionLoss(world, g, bomber!, tehran);
    add(g, 'airDefense', 'IRN', tehran, 4);
    add(g, 'fighter', 'IRN', tehran, 2);
    expect(airDefenceAt(world, g, tehran, 'USA')).toBeGreaterThan(0);
    const defended = interceptionLoss(world, g, bomber!, tehran);
    expect(defended).toBeGreaterThan(undefended);
    // Escorts help.
    add(g, 'fighter', 'USA', kuwait, 4, { mission: 'superiority' });
    expect(interceptionLoss(world, g, bomber!, tehran)).toBeLessThan(defended);
  });
});

describe('sea control (D-059)', () => {
  it('a lone fleet controls its zone; equal hostile fleets contest it; blockades need control off the ports', () => {
    const g = newGame('USA');
    const gulf = Z('Persian Gulf');
    clear(g, (u) => u.region === gulf);
    expect(zoneControl(world, g, gulf).controller).toBeNull();
    add(g, 'destroyerGroup', 'USA', gulf, 2);
    expect(zoneControl(world, g, gulf).controller).toBe('USA');
    expect(hasSeaControl(world, g, gulf, 'USA')).toBe(true);
    rawWar(g, 'USA', 'IRN');
    add(g, 'destroyerGroup', 'IRN', gulf, 2);
    g.nations['IRN']!.quality = g.nations['USA']!.quality;
    const zc = zoneControl(world, g, gulf);
    expect(zc.contested).toBe(true);
    expect(zc.controller).toBeNull();
    // Overwhelming force: four more groups give the US control again.
    add(g, 'carrierGroup', 'USA', gulf, 4);
    expect(zoneControl(world, g, gulf).controller).toBe('USA');
    // Kuwait's only ports face the Gulf → fully blockaded by the US fleet if at war.
    rawWar(g, 'USA', 'KWT');
    expect(blockadeShare(world, g, 'KWT')).toBeGreaterThanOrEqual(0.99);
    expect(blockadeShare(world, g, 'IRN')).toBeLessThan(1);
  });

  it('hostile fleets in one zone fight: both sides lose strength and a sea battle report is written', () => {
    const g = newGame('USA');
    const gulf = Z('Persian Gulf');
    clear(g, (u) => u.region === gulf);
    rawWar(g, 'USA', 'IRN');
    const us = add(g, 'destroyerGroup', 'USA', gulf, 2);
    const ir = add(g, 'attackSub', 'IRN', gulf, 2);
    for (const u of ir) u.prevRegion = Z('Gulf of Oman');
    const reports = runNavalCombat(world, g);
    expect(reports.length).toBe(1);
    expect(reports[0]!.domain).toBe('sea');
    expect(reports[0]!.attackers[0]!.nation).toBe('IRN');
    expect(us.reduce((s, u) => s + u.strength, 0)).toBeLessThan(200);
    expect(ir.reduce((s, u) => s + u.strength, 0)).toBeLessThan(200);
  });

  it('amphibious landings wait out the preparation timer before embarking', () => {
    const g = newGame('CHN', 5);
    rawWar(g, 'CHN', 'TWN');
    const strait = Z('Taiwan Strait');
    const fujian = 96;
    clear(g, (u) => u.region === strait || (u.owner === 'TWN' && world.unitTypes.get(u.type)?.domain === 'sea'));
    add(g, 'destroyerGroup', 'CHN', strait, 3);
    add(g, 'amphibiousGroup', 'CHN', strait, 2);
    const targets = amphibiousTargets(world, g, fujian, 'CHN', 'marines');
    expect(targets.length).toBeGreaterThan(0);
    const target = targets.find((t) => world.regions.get(t)!.iso3 === 'TWN') ?? targets[0]!;
    clear(g, (u) => u.region === target);
    const [m] = add(g, 'marines', 'CHN', fujian, 1);
    m!.path = [target];
    runMovement(world, g);
    expect(m!.region).toBe(fujian);
    expect(m!.prep).toBe(1);
    runMovement(world, g);
    expect(m!.region).toBe(target);
    expect(m!.prep).toBe(0);
  });
});

describe('combat modifiers (D-059)', () => {
  it('experience, commanders and air superiority appear in the breakdown and move the odds', () => {
    expect(experienceFactor(0)).toBeCloseTo(0.95);
    expect(experienceFactor(100)).toBeCloseTo(1.2);
    expect(airSuperiorityFactor(0.5)).toBeCloseTo(1.0);
    expect(airSuperiorityFactor(1)).toBeCloseTo(1.15);
    const g = newGame('POL');
    rawWar(g, 'POL', 'BLR');
    const minsk = cap('BLR');
    const from = landNeighbour(minsk, 'POL', g);
    const [vet] = add(g, 'armored', 'POL', from, 1, {
      experience: 80,
      commander: { name: 'Test Officer', trait: 'aggressive', fictional: true },
    });
    const f = attackerFactors(world, g, vet!, minsk, from, { amphibious: false, dominant: false });
    const labels = f.mods.map((m) => m.label);
    expect(labels).toContain('Experience');
    expect(labels).toContain('Commander');
    expect(f.mods.find((m) => m.label === 'Experience')!.factor).toBeGreaterThan(1.1);
    expect(commanderAttackModifier(vet!.commander)!.factor).toBeCloseTo(1.1);
    const [def] = add(g, 'infantry', 'BLR', minsk, 1);
    const d = defenderFactors(world, g, def!, minsk, { onlyFromSea: false });
    expect(d.mods.map((m) => m.label)).toContain('Experience');
    // Odds: the attacker's air superiority is a visible modifier and improves with fighters.
    const base = estimateOdds(world, g, [vet!.id], minsk);
    expect(base.attacker.map((m) => m.label)).toContain('Air superiority');
    expect(base.defender.map((m) => m.label)).toContain('Air superiority');
    add(g, 'fighter', 'POL', from, 6, { mission: 'superiority' });
    const air = estimateOdds(world, g, [vet!.id], minsk);
    expect(air.attacker.find((m) => m.label === 'Air superiority')!.factor).toBeGreaterThan(
      base.attacker.find((m) => m.label === 'Air superiority')!.factor,
    );
    expect(air.ratio).toBeGreaterThan(base.ratio);
  });

  it('battles write a report with sides, losses, modifiers and an outcome; survivors gain experience', () => {
    const g = newGame('POL');
    rawWar(g, 'POL', 'BLR');
    const minsk = cap('BLR');
    clear(g, (u) => u.region === minsk);
    add(g, 'infantry', 'BLR', minsk, 2);
    const att = add(g, 'armored', 'POL', minsk, 4);
    for (const u of att) u.prevRegion = landNeighbour(minsk, 'POL', g);
    const xp0 = att[0]!.experience;
    runCombat(world, g);
    expect(g.battleReports.length).toBe(1);
    const r = g.battleReports[0]!;
    expect(r.domain).toBe('land');
    expect(r.attackers[0]!.nation).toBe('POL');
    expect(r.defenders[0]!.nation).toBe('BLR');
    expect(r.attackerMods.map((m) => m.label)).toContain('Air superiority');
    expect(r.defenderMods.map((m) => m.label)).toContain('Terrain');
    expect(r.attackerLoss + r.defenderLoss).toBeGreaterThan(0);
    expect(['attackerWins', 'defenderHolds', 'stalemate']).toContain(r.outcome);
    const survivor = att.find((u) => g.units[u.id]);
    if (survivor) expect(survivor.experience).toBeGreaterThan(xp0);
  });

  it('generated commanders are fictional and deterministic per seed', () => {
    const a = newGame('FRA', 3);
    const b = newGame('FRA', 3);
    const ca = unitsOf(a, 'FRA').map((u) => u.commander?.name ?? '');
    const cb = unitsOf(b, 'FRA').map((u) => u.commander?.name ?? '');
    expect(ca).toEqual(cb);
    expect(ca.some((n) => n !== '')).toBe(true);
    for (const u of unitsOf(a, 'FRA')) if (u.commander) expect(u.commander.fictional).toBe(true);
    const c = maybeCommander(world, a, 'JPN');
    if (c) expect(c.name.split(' ').length).toBeGreaterThanOrEqual(2);
  });
});

describe('fog of war (D-059)', () => {
  it('own territory is fully seen; distant enemies need satellites, recon or spies', () => {
    const g = newGame('BRA');
    const brasilia = cap('BRA');
    expect(intelLevel(world, g, 'BRA', brasilia)).toBe(4);
    const beijing = cap('CHN');
    g.nations['BRA']!.satellites = 0;
    const blind = intelLevel(world, g, 'BRA', beijing);
    expect(blind).toBeLessThanOrEqual(1);
    g.nations['BRA']!.satellites = 8;
    g.turn += 1; // invalidate the cache
    expect(intelLevel(world, g, 'BRA', beijing)).toBeGreaterThan(blind);
    g.nations['BRA']!.intelOps['CHN'] = 6;
    g.turn += 1;
    const spied = intelLevel(world, g, 'BRA', beijing);
    expect(spied).toBeGreaterThan(blind + 1);
    // Recon over the target from a nearby base.
    const near = world.regions.get(beijing)!.neighbours.find((n) => !world.regions.get(n)!.sea)!;
    add(g, 'drone', 'BRA', near, 1, { mission: 'recon' });
    g.turn += 1;
    expect(intelLevel(world, g, 'BRA', beijing)).toBe(4);
    // Cyber blinding takes two levels off.
    g.nations['BRA']!.blinded = 2;
    clear(g, (u) => u.owner === 'BRA' && u.region === near);
    g.turn += 1;
    expect(intelLevel(world, g, 'BRA', beijing)).toBeLessThan(spied);
  });

  it('stack estimates widen as intelligence thins', () => {
    const g = newGame('BRA');
    g.nations['BRA']!.satellites = 0;
    const beijing = cap('CHN');
    const stack = unitsIn(g, beijing).filter((u) => u.owner === 'CHN');
    expect(stack.length).toBeGreaterThan(2);
    const est = estimateStack(world, g, 'BRA', stack);
    expect(est.level).toBeLessThanOrEqual(1);
    if (est.level === 1) {
      expect(est.min).toBeLessThanOrEqual(stack.length);
      expect(est.max).toBeGreaterThanOrEqual(stack.length);
      expect(est.types).toBeNull();
    }
    const full = estimateStack(world, g, 'CHN', stack);
    expect(full.level).toBe(4);
    expect(full.min).toBe(stack.length);
    expect(full.types).not.toBeNull();
  });
});

describe('cyber and space (D-059)', () => {
  it('cyber operations respect the cooldown and apply their effect on success', () => {
    const g = newGame('USA');
    g.nations['USA']!.modifiers.cyberAttack = 1; // guaranteed success
    const after = applyCommand(world, g, { type: 'cyberOp', target: 'RUS', kind: 'intel' });
    expect(after.nations['RUS']!.blinded).toBe(2);
    expect(after.nations['USA']!.cyberCooldown).toBe(3);
    expect(() => applyCyberOp(world, after, 'USA', 'RUS', 'economy')).toThrow(/rebuilding/);
    const prod = structuredClone(g);
    prod.nations['RUS']!.production.push({ id: 1, type: 'infantry', region: cap('RUS'), monthsLeft: 2 });
    const delayed = applyCommand(world, prod, { type: 'cyberOp', target: 'RUS', kind: 'production' });
    expect(delayed.nations['RUS']!.production[0]!.monthsLeft).toBe(3);
  });

  it('ASAT needs the tech and a war, destroys satellites and leaves debris that hurts everyone', () => {
    const g = newGame('USA');
    rawWar(g, 'USA', 'CHN');
    // The US has fielded counterspace weapons since its 2008 test (D-079); take them away first.
    g.nations['USA']!.techs = g.nations['USA']!.techs.filter((id) => id !== 'space-counterspace');
    expect(canAsat(world, g, 'USA', 'CHN')).toMatch(/Counterspace/);
    g.nations['USA']!.techs.push('space-counterspace');
    expect(canAsat(world, g, 'USA', 'CHN')).toBeNull();
    const sats = g.nations['CHN']!.satellites;
    applyAsat(world, g, 'USA', 'CHN');
    expect(g.nations['CHN']!.satellites).toBeLessThan(sats);
    expect(g.debris).toBeGreaterThan(0);
    // Debris eventually costs everyone satellites, the shooter included.
    g.debris = 100;
    let s = g;
    const before = Object.values(s.nations).reduce((a, n) => a + n.satellites, 0);
    for (let i = 0; i < 6; i++) s = applyCommand(world, s, { type: 'endTurn' });
    const lost = before - Object.values(s.nations).reduce((a, n) => a + n.satellites, 0);
    expect(lost).toBeGreaterThan(0);
  });

  it('launching a satellite costs treasury and widens the global picture', () => {
    const g = newGame('DEU');
    g.nations['DEU']!.satellites = 0;
    g.nations['DEU']!.treasury = 50;
    let s = g;
    for (let i = 0; i < 2; i++) s = applyCommand(world, s, { type: 'launchSatellite' });
    expect(s.nations['DEU']!.satellites).toBe(2);
    expect(s.nations['DEU']!.treasury).toBeLessThan(50);
  });
});

describe('air operations (D-059)', () => {
  it('strategic bombing devastates enemy industry and records an air strike', () => {
    const g = newGame('USA');
    rawWar(g, 'USA', 'IRN');
    const kuwait = 687; // Al Jahra: two steps from Khuzestan across the Gulf
    add(g, 'bomber', 'USA', kuwait, 3, { mission: 'bombing' });
    const iran = world.regionsByNation.get('IRN')!;
    const before = iran.reduce((s, r) => s + g.regions[r]!.devastation, 0);
    runAirOperations(world, g);
    const after = iran.reduce((s, r) => s + g.regions[r]!.devastation, 0);
    expect(after).toBeGreaterThan(before);
    expect(g.strikes.some((s) => s.kind === 'air' && s.attacker === 'USA')).toBe(true);
    expect(g.log.some((l) => l.kind === 'strike' && /bombs/.test(l.text))).toBe(true);
  });

  it('the setAirMission command only accepts missions the wing type can fly', () => {
    const g = newGame('USA');
    const wing = unitsOf(g, 'USA').find((u) => u.type === 'bomber')!;
    const a = applyCommand(world, g, { type: 'setAirMission', unitIds: [wing.id], mission: 'interdiction' });
    expect(a.units[wing.id]!.mission).toBe('interdiction');
    const b = applyCommand(world, a, { type: 'setAirMission', unitIds: [wing.id], mission: 'recon' });
    expect(b.units[wing.id]!.mission).toBe('interdiction');
  });
});
