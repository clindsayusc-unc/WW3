/**
 * Economy depth (D-061): resource shortages, sanctions symmetry, secondary sanctions, domestic
 * politics and a 240-turn soak that must stay free of runaway values.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import { makeUnit, setRelation } from './query';
import { imposeSanction } from './diplomacy';
import {
  imposeEmbargo,
  imposeSecondary,
  productionThroughput,
  researchThroughput,
  runTrade,
  strategicAccess,
  tradePartners,
} from './trade';
import { defaultThreshold, growthBreakdown, unitCost } from './economy';
import { projectedVoteShare, reelectionChance, coupBreakdown } from './domestic';
import { RESOURCE_IDS, type GameState, type Iso3 } from './types';

const world = loadWorld();
const newGame = (player: Iso3 = 'USA', seed = 1): GameState =>
  createGame({ seed, player, scenario: 'world-2027' }, world);

function assertFinite(value: unknown, path = 'state'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
}

/** China goes to war with Taiwan and parks destroyer groups in every sea zone off Taiwan's coast. */
function blockadeTaiwan(g: GameState): void {
  g.wars.push({ id: 9999, attackers: ['CHN'], defenders: ['TWN'], since: g.turn, score: 0 });
  g.diplomacyVersion++;
  const zones = new Set<number>();
  for (const rid of world.regionsByNation.get('TWN') ?? [])
    for (const nb of world.regions.get(rid)!.neighbours) if (world.regions.get(nb)?.sea) zones.add(nb);
  for (const z of zones)
    for (let i = 0; i < 6; i++) {
      g.units[g.nextId] = makeUnit(g.nextId, 'destroyerGroup', 'CHN', z);
      g.nextId++;
    }
}

describe('data', () => {
  it('resources, trade pairs and politics load and reference real nations', () => {
    expect(world.resources.map((r) => r.id).sort()).toEqual([...RESOURCE_IDS].sort());
    for (const r of world.resources) {
      const listed = Object.values(r.producers).reduce((a, b) => a + b, 0);
      expect(listed).toBeLessThanOrEqual(1.0001);
      expect(r.diffuse).toBeGreaterThanOrEqual(0);
      for (const iso of Object.keys(r.producers)) expect(world.nations.has(iso)).toBe(true);
      for (const iso of r.estimatedProducers) expect(r.producers[iso]).toBeDefined();
    }
    // Taiwan dominates leading-edge chips; China dominates rare-earth refining.
    expect(world.resourceById.get('chips')!.producers['TWN']).toBeGreaterThan(0.6);
    expect(world.resourceById.get('rareEarths')!.producers['CHN']).toBeGreaterThan(0.85);
    expect(world.tradePairs.length).toBeGreaterThan(150);
    for (const u of world.unitTypeList) expect(world.unitInputs.has(u.id)).toBe(true);
    for (const b of world.branches) expect(world.branchInputs.has(b.id)).toBe(true);
    for (const major of world.majors) expect(world.politics.has(major)).toBe(true);
    for (const n of world.nationList) expect(world.startInflation.has(n.iso3)).toBe(true);
  });
});

describe('baseline', () => {
  it('the starting world is calibrated: no trade, resource or sanction penalties on turn 0', () => {
    const g = newGame();
    for (const n of Object.values(g.nations)) {
      expect(Math.abs(n.econ.tradeEffect)).toBeLessThan(1e-9);
      expect(Math.abs(n.econ.shortageEffect)).toBeLessThan(1e-9);
      expect(n.potentialGdp).toBe(n.gdp);
    }
    for (const r of RESOURCE_IDS) expect(g.economy.prices[r]).toBe(1);
    expect(g.economy.routes.length).toBe(world.tradePairs.length);
    // Most of the world is fully supplied at the start.
    const usa = g.nations['USA']!;
    expect(usa.resources.chips.satisfaction).toBeGreaterThan(0.95);
    expect(usa.resources.rareEarths.satisfaction).toBeGreaterThan(0.95);
    expect(tradePartners(g, 'USA')[0]!.partner).toBe('MEX');
  });
});

describe('resource shortages', () => {
  it('losing access to Taiwan’s chips throttles high-tech output worldwide', () => {
    const g = newGame('USA');
    const fighterCost = unitCost(world, g, 'USA', 'fighter');
    blockadeTaiwan(g);
    runTrade(world, g);
    const route = g.economy.routes.find((r) => (r.a === 'USA' && r.b === 'TWN') || (r.a === 'TWN' && r.b === 'USA'))!;
    expect(route.status).toBe('cut');
    expect(route.volume).toBe(0);
    expect(g.economy.shortage.chips).toBeGreaterThan(0.4);
    for (const iso of ['USA', 'JPN', 'DEU', 'GBR', 'IND']) {
      expect(g.nations[iso]!.resources.chips.satisfaction).toBeLessThan(0.75);
      expect(growthBreakdown(world, g, iso).resources).toBeLessThan(-0.5);
    }
    // Chip-heavy production and research slow far more than infantry.
    const fighter = productionThroughput(world, g, 'USA', 'fighter');
    const infantry = productionThroughput(world, g, 'USA', 'infantry');
    expect(fighter).toBeLessThan(0.85);
    expect(fighter).toBeLessThan(infantry);
    expect(researchThroughput(world, g, 'USA', 'ai')).toBeLessThan(0.85);
    expect(researchThroughput(world, g, 'USA', 'energy')).toBeGreaterThan(researchThroughput(world, g, 'USA', 'ai'));
    expect(unitCost(world, g, 'USA', 'fighter')).toBeGreaterThan(fighterCost);
    // Prices respond the following month.
    runTrade(world, g);
    expect(g.economy.prices.chips).toBeGreaterThan(1.3);
  });

  it('a production line starved of inputs takes longer to deliver', () => {
    const base = newGame('USA');
    const starved = newGame('USA');
    blockadeTaiwan(starved);
    for (const g of [base, starved]) {
      g.nations['USA']!.production.push({ id: g.nextId++, type: 'fighter', region: world.capitalRegion.get('USA')!, monthsLeft: 8 });
    }
    const a = applyCommand(world, base, { type: 'endTurn' });
    const b = applyCommand(world, starved, { type: 'endTurn' });
    const left = (g: GameState) => g.nations['USA']!.production.find((p) => p.type === 'fighter')!.monthsLeft;
    expect(left(a)).toBeCloseTo(7, 1);
    expect(left(b)).toBeGreaterThan(7.1);
  });

  it('a Chinese rare-earth embargo on the G7 starves missile and drone programmes', () => {
    const g = newGame('USA');
    imposeEmbargo(world, g, 'CHN', 'JPN');
    runTrade(world, g);
    // Alone, Japan buys up the non-Chinese supply (Malaysia, Australia, the US) and copes.
    expect(g.nations['JPN']!.resources.rareEarths.satisfaction).toBeGreaterThan(0.6);
    for (const x of ['USA', 'GBR', 'FRA', 'DEU', 'ITA', 'CAN', 'KOR']) imposeEmbargo(world, g, 'CHN', x);
    runTrade(world, g);
    const jpn = g.nations['JPN']!;
    expect(jpn.resources.rareEarths.satisfaction).toBeLessThan(0.4);
    expect(g.nations['USA']!.resources.rareEarths.satisfaction).toBeLessThan(0.4);
    expect(researchThroughput(world, g, 'JPN', 'missiles')).toBeLessThan(0.9);
    expect(productionThroughput(world, g, 'JPN', 'drone')).toBeLessThan(productionThroughput(world, g, 'JPN', 'infantry'));
    // Food is not embargo-exempt, but other suppliers fill most of Japan's grain gap.
    expect(jpn.resources.food.satisfaction).toBeGreaterThan(0.8);
  });
});

describe('sanctions', () => {
  it('are symmetric: both sides lose the same trade, and the smaller economy feels it more', () => {
    const g = newGame('USA');
    const before = { CHN: g.nations['CHN']!.econ.tradeLost, JPN: g.nations['JPN']!.econ.tradeLost };
    imposeSanction(world, g, 'CHN', 'JPN');
    runTrade(world, g);
    const route = g.economy.routes.find((r) => (r.a === 'CHN' && r.b === 'JPN') || (r.a === 'JPN' && r.b === 'CHN'))!;
    expect(route.status).toBe('sanctioned');
    const lost = route.reference - route.volume;
    expect(lost).toBeGreaterThan(150);
    const lostChn = g.nations['CHN']!.econ.tradeLost - before.CHN;
    const lostJpn = g.nations['JPN']!.econ.tradeLost - before.JPN;
    expect(lostChn).toBeCloseTo(lostJpn, 0);
    expect(lostChn).toBeCloseTo(lost, 0);
    const eChn = g.nations['CHN']!.econ.tradeEffect;
    const eJpn = g.nations['JPN']!.econ.tradeEffect;
    expect(eChn).toBeLessThan(0);
    expect(eJpn).toBeLessThan(0);
    // Same lost trade divided by each GDP: the effect ratio is the inverse GDP ratio.
    expect(eJpn / eChn).toBeCloseTo(g.nations['CHN']!.gdp / g.nations['JPN']!.gdp, 1);
    // Strategic goods stop flowing both ways; food is exempt.
    for (const r of ['chips', 'rareEarths', 'oil', 'steel'] as const) {
      expect(strategicAccess(world, g, 'CHN', 'JPN', r)).toBe(0);
      expect(strategicAccess(world, g, 'JPN', 'CHN', r)).toBe(0);
    }
    expect(strategicAccess(world, g, 'CHN', 'JPN', 'food')).toBe(1);
    expect(strategicAccess(world, g, 'JPN', 'CHN', 'food')).toBe(1);
  });

  it('embargoes stop everything, both ways', () => {
    const g = newGame('USA');
    imposeEmbargo(world, g, 'USA', 'MEX');
    runTrade(world, g);
    const route = g.economy.routes.find((r) => r.a === 'USA' && r.b === 'MEX')!;
    expect(route.status).toBe('embargoed');
    expect(route.volume).toBe(0);
    expect(strategicAccess(world, g, 'MEX', 'USA', 'food')).toBe(0);
    expect(strategicAccess(world, g, 'USA', 'MEX', 'food')).toBe(0);
    expect(g.nations['MEX']!.econ.tradeEffect).toBeLessThan(g.nations['USA']!.econ.tradeEffect);
  });

  it('secondary sanctions: partners of the sanctioner comply, defiers pay with their own trade', () => {
    const g = newGame('USA');
    // The United States already runs secondary sanctions on Iran and Russia (2026 baseline).
    expect(g.secondarySanctions).toContain('USA>RUS');
    // A defier pays once per sanctioner: start from a world without the existing US measures.
    g.secondarySanctions = [];
    imposeSanction(world, g, 'USA', 'SAU');
    setRelation(g, 'CHN', 'SAU', 60); // a friend of the target defies
    runTrade(world, g);
    const route = (a: Iso3, b: Iso3) => g.economy.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))!;
    const jpnSauBefore = route('JPN', 'SAU').volume;
    const chnUsaBefore = route('USA', 'CHN').volume;
    imposeSecondary(world, g, 'USA', 'SAU');
    runTrade(world, g);
    // Japan (a US ally) complies and scales back its Saudi trade.
    expect(route('JPN', 'SAU').volume).toBeLessThan(jpnSauBefore * 0.5);
    expect(route('JPN', 'SAU').status).toBe('sanctioned');
    // China defies and loses part of its trade with the United States.
    expect(route('USA', 'CHN').volume).toBeLessThan(chnUsaBefore * 0.8);
    expect(g.nations['CHN']!.econ.secondaryLost).toBeGreaterThan(0);
  });

  it('a sanctions coalition rallies friends with a quarrel, not everyone', () => {
    let g = newGame('USA');
    g = applyCommand(world, g, { type: 'propose', proposal: 'rallySanctions', target: 'RUS' });
    // Most of the EU already sanctions Russia; a few more may join, but China and India do not.
    expect(g.sanctions).toContain('USA>RUS');
    expect(g.sanctions).not.toContain('CHN>RUS');
    expect(g.sanctions).not.toContain('IND>RUS');
  });
});

describe('fiscal and domestic', () => {
  it('war bonds raise cash and debt and need a war or mobilisation', () => {
    let g = newGame('USA');
    expect(() => applyCommand(world, g, { type: 'issueWarBonds' })).toThrow(/war|mobil/i);
    g = applyCommand(world, g, { type: 'setMobilization', level: 1 });
    const before = g.nations['USA']!;
    const after = applyCommand(world, g, { type: 'issueWarBonds' }).nations['USA']!;
    expect(after.treasury - before.treasury).toBeCloseTo(before.gdp * 0.015, 3);
    expect(after.debt - before.debt).toBeCloseTo(before.gdp * 0.015, 3);
    expect(after.warBondCooldown).toBe(6);
  });

  it('taxes raise revenue and cost growth and approval', () => {
    let g = newGame('GBR');
    const g0 = growthBreakdown(world, g, 'GBR');
    g = applyCommand(world, g, { type: 'setTaxRate', rate: 40 });
    expect(g.nations['GBR']!.taxRate).toBe(40);
    expect(growthBreakdown(world, g, 'GBR').tax).toBeLessThan(g0.tax);
    const next = applyCommand(world, g, { type: 'endTurn' });
    expect(next.nations['GBR']!.finances.revenue).toBeGreaterThan(g.nations['GBR']!.gdp * 0.39 / 12);
    expect(applyCommand(world, g, { type: 'setTaxRate', rate: 99 }).nations['GBR']!.taxRate).toBe(45);
  });

  it('democracies schedule elections from the data; losing one ends the game', () => {
    const g = newGame('USA');
    const usa = g.nations['USA']!;
    expect(usa.nextElection).toBe((2028 - 2027) * 12 + 10); // November 2028
    expect(g.nations['CHN']!.nextElection).toBeNull();
    expect(projectedVoteShare(world, usa)).toBeGreaterThan(50);
    // An unpopular government loses.
    usa.support = 5;
    usa.nextElection = g.turn;
    expect(reelectionChance(world, usa)).toBeLessThan(0.01);
    const next = applyCommand(world, g, { type: 'endTurn' });
    expect(next.defeat?.kind).toBe('election');
  });

  it('autocracies carry coup risk when support, stability and the war go badly; democracies none', () => {
    const g = newGame('RUS');
    const rus = g.nations['RUS']!;
    rus.support = 10;
    rus.stability = 8;
    expect(coupBreakdown(world, g, 'RUS').total).toBeGreaterThan(0.02);
    const usa = g.nations['USA']!;
    usa.support = 5;
    usa.stability = 5;
    expect(coupBreakdown(world, g, 'USA').total).toBe(0);
  });
});

describe('soak', () => {
  it('240 turns: no runaway values anywhere', { timeout: 600_000 }, () => {
    let g = newGame('USA', 3);
    const start = structuredClone(g);
    const peakInflation = new Map<Iso3, number>();
    // The world keeps turning even if the (passive) player loses office or wins.
    for (let i = 0; i < 240; i++) {
      g = applyCommand(world, g, { type: 'endTurn' });
      for (const n of Object.values(g.nations)) {
        if (!n.alive) continue;
        peakInflation.set(n.iso3, Math.max(peakInflation.get(n.iso3) ?? 0, n.inflation));
        expect(n.debt / n.gdp).toBeLessThan(defaultThreshold(world, n.iso3) + 0.2);
      }
    }
    expect(g.turn).toBe(240);
    assertFinite(g.nations);
    assertFinite(g.economy);
    for (const n of Object.values(g.nations)) {
      if (!n.alive) continue;
      const s = start.nations[n.iso3]!;
      const years = g.turn / 12;
      // At most ~11 %/yr compound growth or ~6 %/yr compound decline over the run.
      expect(n.gdp).toBeGreaterThan(s.gdp * 0.94 ** years);
      expect(n.gdp).toBeLessThan(s.gdp * 1.11 ** years);
      expect(n.gdp / n.potentialGdp).toBeGreaterThan(0.4);
      expect(n.gdp / n.potentialGdp).toBeLessThan(1.3);
      expect(n.inflation).toBeGreaterThanOrEqual(-3);
      expect(n.inflation).toBeLessThan(150);
      expect(n.interestRate).toBeLessThanOrEqual(60);
      expect(n.treasury).toBeGreaterThanOrEqual(0);
      expect(n.treasury).toBeLessThan(n.gdp * 3);
      for (const v of [n.support, n.stability, n.warWeariness]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    // Majors never sit in hyperinflation for long.
    for (const m of world.majors) if (g.nations[m]!.alive) expect(g.nations[m]!.inflation).toBeLessThan(60);
    for (const r of RESOURCE_IDS) {
      expect(g.economy.prices[r]).toBeGreaterThanOrEqual(0.6);
      expect(g.economy.prices[r]).toBeLessThanOrEqual(5);
    }
    for (const h of Object.values(g.history)) expect(h.length).toBeLessThanOrEqual(240);
    expect(g.history['USA']!.length).toBeGreaterThan(100);
    // Peak inflation for majors stays out of hyperinflation territory (Iran starts near 80 %).
    for (const m of world.majors) expect(peakInflation.get(m) ?? 0).toBeLessThan(m === 'IRN' ? 120 : 60);
  });
});
