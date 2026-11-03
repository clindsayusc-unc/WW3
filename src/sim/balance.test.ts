/**
 * The self-play balance pass (D-081): observer mode, the standing-based Deterrence victory, landless
 * states, nuclear restraint, the AI's order of battle and research pacing.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import { DETERRENCE_TURN, standingRanking, trendGdp, victoryFor } from './victory';
import { checkCapitulations } from './military';
import { AI_LAUNCH_CHANCE } from './escalation';
import { warPrudence } from './events';
import { attackThreshold } from './strategy';
import { PREMATURE_PREMIUM, eraGateMet, pathTo, researchPointsPerMonth, techCost, techCostBreakdown } from './research';
import type { GameState, Iso3 } from './types';

const world = loadWorld();
const newGame = (player: Iso3 = 'USA', observer = false): GameState =>
  createGame({ seed: 5, player, scenario: 'world-2027', observer }, world);

describe('observer mode (all-AI self-play)', () => {
  it('lets the AI run the nominal player nation and draws no player events', () => {
    const g = newGame('JPN', true);
    expect(g.observer).toBe(true);
    const before = g.nations['JPN']!.budget;
    const next = applyCommand(world, g, { type: 'endTurn' });
    // The AI sets a budget and picks research for Japan as for any other nation.
    expect(next.nations['JPN']!.researchCurrent).not.toBeNull();
    expect(next.nations['JPN']!.budget).not.toEqual(before);
    expect(next.pendingEvents).toHaveLength(0);
  });

  it('is off in a normal game: the player nation is left alone', () => {
    const g = newGame('JPN');
    const next = applyCommand(world, g, { type: 'endTurn' });
    expect(next.nations['JPN']!.budget).toEqual(g.nations['JPN']!.budget);
  });
});

describe('Deterrence victory by standing', () => {
  it('records every great power’s starting position, and everyone starts level', () => {
    const g = newGame();
    expect(Object.keys(g.standingStart ?? {}).sort()).toEqual([...world.majors].sort());
    for (const s of standingRanking(world, g)) expect(Math.abs(s.score)).toBeLessThan(1e-9);
  });

  it('measures output against each nation’s own trend, so a fast grower is not handed the win', () => {
    const g = newGame();
    g.turn = 120;
    // India on exactly its trend scores 0 for the economy; the US 10 % above its trend scores more.
    g.nations['IND']!.gdp = trendGdp(g, 'IND', g.standingStart!['IND']!.gdp);
    g.nations['USA']!.gdp = trendGdp(g, 'USA', g.standingStart!['USA']!.gdp) * 1.1;
    expect(g.nations['IND']!.gdp / g.standingStart!['IND']!.gdp).toBeGreaterThan(1.6);
    const r = standingRanking(world, g);
    const ind = r.find((x) => x.iso === 'IND')!;
    const usa = r.find((x) => x.iso === 'USA')!;
    expect(Math.abs(ind.economy)).toBeLessThan(0.02);
    expect(usa.economy).toBeCloseTo(Math.log(1.1), 2);
  });

  it('goes to the top of the standing table in January 2040, and to nobody after a nuclear detonation', () => {
    const g = newGame();
    g.turn = DETERRENCE_TURN;
    // Pakistan takes territory: its standing rises above everyone else's.
    const target = Object.values(g.regions).filter((r) => r.controller === 'IND').slice(0, 25);
    for (const r of target) r.controller = 'PAK';
    const top = standingRanking(world, g)[0]!;
    expect(top.iso).toBe('PAK');
    expect(victoryFor(world, g, 'PAK')?.kind).toBe('deterrence');
    expect(victoryFor(world, g, 'USA')).toBeNull();
    g.detonations = 1;
    expect(victoryFor(world, g, 'PAK')).toBeNull();
  });
});

describe('event choices that start a hopeless war', () => {
  it('are all but ruled out for the weaker side, and untouched for the stronger', () => {
    const g = newGame();
    // A choice in which the chooser declares war on the event's target (as in the Gulf incident chain).
    const choice = { label: 'x', tooltip: 'x', stance: 'escalate' as const, effects: [{ type: 'war' as const, a: 'PLAYER', b: 'TARGET' }] };
    expect(warPrudence(world, g, 'IRN', { player: 'IRN', target: 'USA' }, choice as never)).toBeLessThan(0.05);
    expect(warPrudence(world, g, 'USA', { player: 'USA', target: 'IRN' }, choice as never)).toBe(1);
  });
});

describe('landless states', () => {
  it('capitulate to whoever holds the capital, even at peace', () => {
    const g = newGame();
    for (const r of Object.values(g.regions)) if (r.controller === 'LBN') r.controller = 'ISR';
    expect(g.wars.some((w) => [...w.attackers, ...w.defenders].includes('LBN') && [...w.attackers, ...w.defenders].includes('ISR'))).toBe(false);
    checkCapitulations(world, g);
    expect(g.nations['LBN']!.alive).toBe(false);
    expect(g.nations['LBN']!.capitulatedTo).toBe('ISR');
  });
});

describe('nuclear restraint', () => {
  it('launches rarely even when desperate, and a limited deterrent deters a nuclear-armed attacker', () => {
    expect(AI_LAUNCH_CHANCE).toBeLessThanOrEqual(0.15);
    const g = newGame();
    // India facing Pakistan's limited deterrent needs a clearly larger edge than against Bangladesh.
    expect(attackThreshold(world, g, 'IND', 'PAK')).toBeGreaterThan(1.5 * attackThreshold(world, g, 'IND', 'BGD'));
  });
});

describe('research pacing (D-081)', () => {
  /** RP a month with a 30 % research budget, and the cheapest queued path (gate included) to era V. */
  function focused(g: GameState, iso: Iso3): { rp: number; path: string[]; cost: number } {
    const n = g.nations[iso]!;
    const sum = n.budget.military + n.budget.infrastructure + n.budget.social + n.budget.debt;
    n.budget = {
      military: (n.budget.military / sum) * 70,
      infrastructure: (n.budget.infrastructure / sum) * 70,
      social: (n.budget.social / sum) * 70,
      debt: (n.budget.debt / sum) * 70,
      research: 30,
    };
    n.finances.research = 0; // use the budget, not last month's spending
    const rp = researchPointsPerMonth(world, g, iso);
    let best = { path: [] as string[], cost: Infinity };
    for (const t of world.techList) {
      if (t.era !== 5) continue;
      const path = pathTo(world, n, t.id);
      const cost = path.reduce((s, id) => s + techCost(world, g, iso, id), 0);
      if (cost < best.cost) best = { path, cost };
    }
    return { rp, ...best };
  }

  it('closes the beeline: the frontier needs a broad base in every era', () => {
    const g = newGame();
    const { path } = focused(g, 'USA');
    // Before D-081 the US reached era V with four technologies (about two years of focused research).
    expect(path.length).toBeGreaterThanOrEqual(15);
    for (const era of [3, 4, 5]) {
      const gate = world.eras.find((e) => e.id === era)!.gate!;
      expect(gate).toBeGreaterThan(0);
    }
    // An era-V project cannot start without the gate.
    const n = g.nations['USA']!;
    const frontier = world.techList.find((t) => t.era === 5)!;
    for (const r of frontier.requires) if (!n.techs.includes(r)) n.techs.push(r);
    expect(eraGateMet(world, frontier, n)).toBe(false);
  });

  it('even with every technology on time, a focused great power needs seven years of 2027-level research to reach era V', () => {
    for (const iso of ['USA', 'CHN'] as const) {
      const g = newGame();
      g.turn = DETERRENCE_TURN; // no prematurity premium
      const { rp, cost } = focused(g, iso);
      expect(cost / rp / 12, iso).toBeGreaterThan(7);
      expect(cost / rp / 12, iso).toBeLessThan(12);
    }
  });

  it('charges a premium for researching ahead of the plausible fielding year', () => {
    const g = newGame();
    const t = world.techList.find((x) => x.era === 5)!;
    const early = techCostBreakdown(world, g, 'USA', t.id);
    expect(early.premature).toBeCloseTo(1 + PREMATURE_PREMIUM * (t.year - 2027), 5);
    g.turn = (t.year - 2027) * 12;
    expect(techCostBreakdown(world, g, 'USA', t.id).premature).toBe(1);
    expect(early.total).toBeGreaterThan(4 * techCostBreakdown(world, g, 'USA', t.id).total);
  });
});
