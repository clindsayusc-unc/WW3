import { describe, expect, it } from 'vitest';
import { advanceTurn, applyCommand, createGame, dateForTurn } from './game';
import { loadWorld } from './world';
import { stepKind, runCombat } from './military';
import { runAi } from './ai';
import type { GameState } from './types';

const world = loadWorld();

function play(seed: number, player: string, turns: number): GameState {
  let g = createGame({ seed, player, scenario: 'world-2027' }, world);
  for (let i = 0; i < turns; i++) g = applyCommand(world, g, { type: 'endTurn' });
  return g;
}

function assertNoNaN(value: unknown, path = 'state'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertNoNaN(v, `${path}[${i}]`));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) assertNoNaN(v, `${path}.${k}`);
}

describe('world', () => {
  it('loads ~1,000 land regions, 150 sea zones and 196 nations', () => {
    expect(world.landCount).toBeGreaterThan(900);
    expect(world.regionList.filter((r) => r.sea).length).toBe(150);
    expect(world.nationList.length).toBe(196);
    expect(world.majors.length).toBe(14);
    for (const iso of world.majors) expect(world.capitalRegion.has(iso)).toBe(true);
  });
  it('every region has at least one neighbour and every tech prerequisite exists', () => {
    for (const r of world.regionList) expect(r.neighbours.length).toBeGreaterThan(0);
    for (const t of world.techList)
      for (const req of t.requires) expect(world.techs.has(req)).toBe(true);
  });
});

describe('game', () => {
  it('starts in January 2027 and reaches 2040 after 156 turns', () => {
    const g = createGame({ seed: 1, player: 'USA', scenario: 'world-2027' }, world);
    expect(g.turn).toBe(0);
    expect(g.isoDate).toBe('2027-01');
    expect(dateForTurn(156)).toEqual({ year: 2040, month: 1 });
    expect(Object.keys(g.units).length).toBeGreaterThan(500);
  });

  it('does not mutate the input state', () => {
    const g = createGame({ seed: 5, player: 'FRA', scenario: 'world-2027' }, world);
    const snapshot = structuredClone(g);
    applyCommand(world, g, { type: 'endTurn' });
    expect(g).toEqual(snapshot);
  });

  it('is deterministic: same seed → same state after 24 turns', () => {
    const a = play(42, 'CHN', 24);
    const b = play(42, 'CHN', 24);
    expect(a).toEqual(b);
    const c = play(43, 'CHN', 24);
    expect(c.rng).not.toBe(a.rng);
  });

  it('supports every major as the player and the Taiwan scenario', () => {
    for (const iso of world.majors) {
      const g = createGame({ seed: 7, player: iso, scenario: 'world-2027' }, world);
      expect(g.nations[iso]!.alive).toBe(true);
    }
    const t = createGame({ seed: 7, player: 'USA', scenario: 'taiwan-crisis' }, world);
    expect(t.flashpoints['taiwan-strait']).toBe(90);
  });
});

describe('economy', () => {
  it('stays within sane bounds over 60 turns', () => {
    const g = play(11, 'DEU', 60);
    const start = createGame({ seed: 11, player: 'DEU', scenario: 'world-2027' }, world);
    for (const n of Object.values(g.nations)) {
      if (!n.alive) continue;
      const s = start.nations[n.iso3]!;
      expect(n.gdp).toBeGreaterThan(s.gdp * 0.3);
      expect(n.gdp).toBeLessThan(s.gdp * 3);
      expect(n.stability).toBeGreaterThanOrEqual(0);
      expect(n.stability).toBeLessThanOrEqual(100);
      expect(n.treasury).toBeGreaterThanOrEqual(0);
      expect(n.debt).toBeLessThan(n.gdp * 5);
      const b = n.budget;
      expect(b.military + b.research + b.infrastructure + b.social + b.debt).toBe(100);
    }
    const usa = g.nations['USA']!;
    expect(usa.gdp).toBeGreaterThan(start.nations['USA']!.gdp * 0.9);
  });

  it('player budget is normalised to 100%', () => {
    let g = createGame({ seed: 1, player: 'GBR', scenario: 'world-2027' }, world);
    g = applyCommand(world, g, {
      type: 'setBudget',
      budget: { military: 50, research: 50, infrastructure: 50, social: 50, debt: 50 },
    });
    const b = g.nations['GBR']!.budget;
    expect(b.military + b.research + b.infrastructure + b.social + b.debt).toBe(100);
  });
});

describe('combat', () => {
  function duel(attackerCount: number): { defLoss: number; attLoss: number } {
    const g = createGame({ seed: 3, player: 'POL', scenario: 'world-2027' }, world);
    // Isolate: remove all units, create a war between POL and BLR, place units.
    g.units = {};
    g.wars = [{ id: 9000, attackers: ['POL'], defenders: ['BLR'], since: 0, score: 0 }];
    g.relations['BLR|POL'] = -100;
    const target = world.capitalRegion.get('BLR')!;
    const defender = {
      id: 1,
      type: 'infantry',
      owner: 'BLR',
      region: target,
      strength: 100,
      morale: 80,
      path: [],
      prevRegion: target,
    };
    g.units[1] = defender;
    for (let i = 0; i < attackerCount; i++) {
      g.units[10 + i] = {
        id: 10 + i,
        type: 'armored',
        owner: 'POL',
        region: target,
        strength: 100,
        morale: 80,
        path: [],
        prevRegion: target,
      };
    }
    const results = runCombat(world, g);
    const r = results[0]!;
    return { defLoss: r.defenderLoss, attLoss: r.attackerLoss };
  }
  it('more attackers → defender loses at least as much and attackers lose less each', () => {
    const one = duel(1);
    const three = duel(3);
    expect(three.defLoss).toBeGreaterThanOrEqual(one.defLoss);
    expect(three.attLoss / 3).toBeLessThanOrEqual(one.attLoss);
  });
});

describe('ai', () => {
  it('never issues invalid orders', () => {
    let g = createGame({ seed: 21, player: 'BRA', scenario: 'world-2027' }, world);
    for (let turn = 0; turn < 12; turn++) {
      const s = structuredClone(g);
      runAi(world, s);
      for (const u of Object.values(s.units)) {
        if (u.path.length === 0) continue;
        expect(stepKind(world, s, u, u.region, u.path[0]!)).not.toBeNull();
      }
      for (const n of Object.values(s.nations)) {
        const b = n.budget;
        expect(b.military + b.research + b.infrastructure + b.social + b.debt).toBe(100);
        for (const p of n.production) expect(world.unitTypes.has(p.type)).toBe(true);
        if (n.researchCurrent) expect(world.techs.has(n.researchCurrent)).toBe(true);
      }
      g = applyCommand(world, g, { type: 'endTurn' });
    }
  });
});

describe('escalation', () => {
  it('nuclear strike devastates the target, costs warheads, and a full exchange ends the game', () => {
    let g = createGame({ seed: 9, player: 'USA', scenario: 'world-2027' }, world);
    g = applyCommand(world, g, { type: 'propose', proposal: 'declareWar', target: 'RUS' });
    expect(g.wars.some((w) => w.attackers.includes('USA') && w.defenders.includes('RUS'))).toBe(
      true,
    );
    // Not at DEFCON 1 yet: the command must be refused.
    expect(() =>
      applyCommand(world, g, {
        type: 'nuclearStrike',
        target: 'RUS',
        region: world.capitalRegion.get('RUS')!,
      }),
    ).toThrow(/DEFCON 1/);
    // Force the conditions and strike.
    const forced = structuredClone(g);
    forced.nations['USA']!.defcon = 1;
    const target = world.capitalRegion.get('RUS')!;
    const before = forced.nations['RUS']!.gdp;
    const after = applyCommand(world, forced, {
      type: 'nuclearStrike',
      target: 'RUS',
      region: target,
    });
    expect(after.detonations).toBeGreaterThanOrEqual(1);
    expect(after.nations['USA']!.warheads).toBeLessThanOrEqual(forced.nations['USA']!.warheads - 10);
    expect(after.nations['RUS']!.gdp).toBeLessThan(before);
    expect(after.regions[target]!.devastation).toBeGreaterThan(0.1);
    expect(after.globalTension).toBe(100);
    // Eight detonations → nobody wins.
    const doom = structuredClone(after);
    doom.detonations = 8;
    const ended = applyCommand(world, doom, { type: 'endTurn' });
    expect(ended.defeat?.kind).toBe('nuclearWar');
  });
});

describe('soak', () => {
  it('runs 120 turns without exceptions or NaN', () => {
    const t0 = performance.now();
    let g = createGame({ seed: 2027, player: 'IND', scenario: 'world-2027' }, world);
    for (let i = 0; i < 120; i++) {
      g = advanceTurn(world, g, []);
      assertNoNaN(g);
    }
    const ms = performance.now() - t0;
    expect(g.turn).toBe(120);
    expect(g.isoDate).toBe('2037-01');
    console.log(
      `soak: 120 turns in ${ms.toFixed(0)} ms; wars=${g.wars.length} units=${Object.keys(g.units).length} tension=${g.globalTension.toFixed(0)} detonations=${g.detonations} alive=${Object.values(g.nations).filter((n) => n.alive).length}`,
    );
  }, 120_000);
});
