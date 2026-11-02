import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import { TERRAIN, weatherAt, unitTerrainFactor, movePoints } from './terrain';
import {
  chokepointGrowthEffect,
  crossingBetween,
  crossingModifier,
  depthFromHome,
  stepCost,
  updateChokepoints,
} from './geography';
import { estimateOdds, runSupply, supplyFor, SUPPLY_THRESHOLD } from './military';
import { growthBreakdown } from './economy';
import type { GameState } from './types';

const world = loadWorld();

describe('geography data', () => {
  it('every land region has real terrain, elevation, cover, climate and infrastructure', () => {
    for (const r of world.regionList) {
      if (r.sea) continue;
      expect(TERRAIN[r.terrain]).toBeDefined();
      expect(r.terrain).not.toBe('sea');
      expect(r.elevMean).toBeGreaterThanOrEqual(0);
      expect(r.ruggedness).toBeGreaterThanOrEqual(0);
      const total = Object.values(r.cover).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0.95);
      expect(r.climate).not.toBeNull();
      expect(r.climate!.tempC.length).toBe(12);
      expect(r.infrastructure).toBeGreaterThan(0);
      expect(r.infrastructure).toBeLessThanOrEqual(1);
      if (!r.coastal) expect(r.portCapacity).toBe(0);
    }
  });
  it('matches well-known geography', () => {
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    expect(byName('IRN', 'Tehran').terrain).toBe('mountains');
    expect(byName('IRN', 'Kermanshah').terrain).toBe('mountains');
    expect(byName('KOR', 'Seoul').terrain).toBe('urban');
    expect(byName('IND', 'Ladakh').elevMean).toBeGreaterThan(4000);
    expect(byName('SAU', 'Eastern').terrain).toBe('desert');
    expect(byName('BRA', 'Amazonas').terrain).toBe('jungle');
    expect(byName('ARG', 'Buenos Aires').terrain).toBe('plains');
    // Monsoon in Seoul in July, winter in Moscow in January, heat in Khuzestan in July.
    expect(weatherAt(world, byName('KOR', 'Seoul').id, 7).monsoon).toBeGreaterThan(0.5);
    expect(weatherAt(world, byName('RUS', 'Moscow').id, 1).winter).toBeGreaterThan(0.3);
    expect(weatherAt(world, byName('RUS', 'Moscow').id, 7).winter).toBe(0);
    expect(weatherAt(world, byName('IRN', 'Khuzestan').id, 7).heat).toBeGreaterThan(0.4);
  });
  it('knows the Rhine, the Rio Grande, the Himalaya and the Khyber Pass', () => {
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    expect(crossingBetween(world, byName('FRA', 'Moselle').id, byName('DEU', 'Baden-Württemberg').id)?.rivers).toContain('Rhein');
    expect(crossingBetween(world, byName('USA', 'Texas').id, byName('MEX', 'Coahuila').id)?.rivers).toContain('Rio Grande');
    const himalaya = crossingBetween(world, byName('IND', 'Uttarakhand').id, byName('CHN', 'Tibet').id);
    expect(himalaya?.mountain).toBe(true);
    const khyber = [...world.crossings.values()].find((c) => c.pass === 'Khyber Pass');
    expect(khyber).toBeDefined();
    for (const c of world.crossings.values()) expect(world.regions.get(c.a)!.neighbours).toContain(c.b);
  });
  it('every chokepoint sits on real sea zones and shores', () => {
    expect(world.chokepoints.length).toBe(12);
    for (const c of world.chokepoints) {
      expect(c.zones.length).toBeGreaterThan(0);
      for (const z of c.zones) expect(world.regions.get(z)?.sea).toBe(true);
      for (const s of c.shores) expect(world.regions.get(s)?.sea).toBe(false);
    }
    const hormuz = world.chokepoints.find((c) => c.id === 'hormuz')!;
    expect(hormuz.shores.map((s) => world.regions.get(s)!.iso3)).toContain('IRN');
  });
});

describe('terrain rules', () => {
  it('penalise armour in mountains, jungle and cities but not infantry', () => {
    for (const t of ['mountains', 'jungle', 'urban'] as const) {
      expect(unitTerrainFactor(TERRAIN[t], 'armored')).toBeLessThan(0.7);
      expect(unitTerrainFactor(TERRAIN[t], 'infantry')).toBeGreaterThanOrEqual(1);
      expect(unitTerrainFactor(TERRAIN[t], 'specialForces')).toBeGreaterThan(1);
      expect(TERRAIN[t].air).toBeLessThan(0.8);
    }
    expect(TERRAIN.mountains.defence).toBe(2.5);
    expect(TERRAIN.jungle.defence).toBe(2);
    expect(TERRAIN.urban.defence).toBe(2);
    expect(TERRAIN.marsh.defence).toBe(1.5);
    expect(TERRAIN.forest.defence).toBe(1.3);
    expect(TERRAIN.plains.defence).toBe(1);
    expect(TERRAIN.desert.defence).toBe(1);
  });
  it('movement costs more in rough terrain, winter and across rivers', () => {
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    const plains = stepCost(world, byName('DEU', 'Saxony').id, byName('DEU', 'Bavaria').id, 7);
    const alps = stepCost(world, byName('DEU', 'Bavaria').id, byName('AUT', 'Tyrol').id, 7);
    expect(alps).toBeGreaterThan(plains * 1.5);
    const moscowJan = stepCost(world, byName('RUS', 'Tver').id, byName('RUS', 'Moscow').id, 1);
    const moscowJul = stepCost(world, byName('RUS', 'Tver').id, byName('RUS', 'Moscow').id, 7);
    expect(moscowJan).toBeGreaterThan(moscowJul);
    const rhine = stepCost(world, byName('FRA', 'Moselle').id, byName('DEU', 'Baden-Württemberg').id, 7);
    const noRiver = stepCost(world, byName('DEU', 'Bavaria').id, byName('DEU', 'Baden-Württemberg').id, 7);
    expect(rhine).toBeGreaterThan(noRiver);
    expect(movePoints(world, 'mechanized')).toBe(2);
  });
});

function game(player = 'USA', seed = 3): GameState {
  return createGame({ seed, player, scenario: 'world-2027' }, world);
}

describe('supply', () => {
  it('home regions are depots, occupied regions decay with distance and terrain, cut-off regions starve', () => {
    const g = game('RUS');
    runSupply(world, g);
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    expect(g.regions[byName('RUS', 'Moscow').id]!.supply).toBeGreaterThan(0.9);
    // Occupy a chain into Ukraine: supply falls with every region.
    const kyiv = byName('UKR', 'Kyiv').id;
    const kharkiv = byName('UKR', 'Kharkiv').id;
    g.wars.push({ id: 999, attackers: ['RUS'], defenders: ['UKR'], since: 0, score: 0 });
    g.regions[kharkiv]!.controller = 'RUS';
    g.regions[kyiv]!.controller = 'RUS';
    g.regionsVersion++;
    runSupply(world, g);
    const sKharkiv = g.regions[kharkiv]!.supply;
    const sKyiv = g.regions[kyiv]!.supply;
    expect(sKharkiv).toBeGreaterThan(0.5);
    expect(sKharkiv).toBeLessThan(0.95);
    expect(sKyiv).toBeLessThanOrEqual(sKharkiv);
    // An occupied region with no friendly land link and no port is cut off.
    const alborz = byName('IRN', 'Alborz').id;
    g.wars.push({ id: 998, attackers: ['RUS'], defenders: ['IRN'], since: 0, score: 0 });
    g.regions[alborz]!.controller = 'RUS';
    g.regionsVersion++;
    runSupply(world, g);
    expect(g.regions[alborz]!.supply).toBeLessThan(SUPPLY_THRESHOLD + 0.2);
    expect(supplyFor(world, g, 'RUS', alborz)).toBeLessThan(0.6);
  });
  it('strategic depth: partisans grow with distance from home', () => {
    const g = game('CHN');
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    g.wars.push({ id: 999, attackers: ['CHN'], defenders: ['RUS'], since: 0, score: 0 });
    for (const n of ['Zabaykalsky Krai', 'Novosibirsk']) g.regions[byName('RUS', n).id]!.controller = 'CHN';
    g.regionsVersion++;
    expect(depthFromHome(world, g, byName('RUS', 'Zabaykalsky Krai').id, 'CHN')).toBe(1);
    expect(depthFromHome(world, g, byName('RUS', 'Novosibirsk').id, 'CHN')).toBeGreaterThanOrEqual(1);
    expect(depthFromHome(world, g, byName('CHN', 'Beijing').id, 'CHN')).toBe(0);
  });
});

describe('crossings', () => {
  it('a river or mountain border penalises the attacker, eased by engineering tech', () => {
    const g = game('FRA');
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    const m = crossingModifier(world, g, 'FRA', byName('FRA', 'Moselle').id, byName('DEU', 'Baden-Württemberg').id)!;
    expect(m.factor).toBeLessThan(0.8);
    g.nations['FRA']!.modifiers.crossing = 0.5;
    const eased = crossingModifier(world, g, 'FRA', byName('FRA', 'Moselle').id, byName('DEU', 'Baden-Württemberg').id)!;
    expect(eased.factor).toBeGreaterThan(m.factor);
    expect(crossingModifier(world, g, 'DEU', byName('DEU', 'Saxony').id, byName('DEU', 'Bavaria').id)).toBeNull();
  });
});

describe('odds report', () => {
  it('explains every factor and previews the route', () => {
    let g = game('USA');
    g = applyCommand(world, g, { type: 'propose', proposal: 'declareWar', target: 'IRN' });
    const byName = (iso: string, name: string) => world.regionList.find((r) => r.iso3 === iso && r.name === name)!;
    const ids = Object.values(g.units)
      .filter((u) => u.owner === 'USA' && u.type === 'mechanized')
      .slice(0, 3)
      .map((u) => u.id);
    const report = estimateOdds(world, g, ids, byName('IRN', 'Kermanshah').id);
    expect(report.attacker.map((m) => m.label)).toContain('Terrain');
    expect(report.attacker.map((m) => m.label)).toContain('Supply');
    expect(report.defender.map((m) => m.label)).toContain('Terrain');
    expect(report.defender.find((m) => m.label === 'Terrain')!.factor).toBe(2.5);
    for (const m of [...report.attacker, ...report.defender]) expect(m.detail.length).toBeGreaterThan(10);
  });
});

describe('chokepoints', () => {
  it('closing Hormuz spikes oil and hits importers; a closed strait blocks hostile shipping', () => {
    let g = game('IRN');
    g = applyCommand(world, g, { type: 'propose', proposal: 'declareWar', target: 'ARE' });
    expect(() => applyCommand(world, g, { type: 'chokepoint', id: 'suez', action: 'close' })).toThrow(/shore/);
    g = applyCommand(world, g, { type: 'chokepoint', id: 'hormuz', action: 'close' });
    expect(g.chokepoints['hormuz']!.status).toBe('closed');
    expect(g.oilPrice).toBeGreaterThan(1.4);
    const japan = growthBreakdown(world, g, 'JPN');
    expect(japan.chokepoints).toBeLessThan(-1);
    expect(chokepointGrowthEffect(world, g, 'KWT').value).toBeLessThan(-4);
    expect(chokepointGrowthEffect(world, g, 'DEU').value).toBeLessThan(0); // importer paying the oil bill
    expect(chokepointGrowthEffect(world, g, 'BRA').value).toBeGreaterThan(0); // exporter windfall
    const h = structuredClone(g);
    h.wars = [];
    h.diplomacyVersion++;
    updateChokepoints(world, h);
    expect(h.chokepoints['hormuz']!.status).toBe('open');
    expect(h.oilPrice).toBe(1);
  });
  it('closing the Taiwan Strait or Malacca disrupts East Asian trade and semiconductors', () => {
    const g = game('CHN');
    g.wars.push({ id: 999, attackers: ['CHN'], defenders: ['TWN'], since: 0, score: 0 });
    g.chokepoints['taiwan-strait'] = { status: 'closed', by: 'CHN', mined: false, minedBy: null, since: 0 };
    g.chokepoints['malacca'] = { status: 'closed', by: 'IDN', mined: false, minedBy: null, since: 0 };
    expect(chokepointGrowthEffect(world, g, 'JPN').value).toBeLessThan(-3);
    expect(chokepointGrowthEffect(world, g, 'KOR').value).toBeLessThan(-3);
    expect(chokepointGrowthEffect(world, g, 'CHN').value).toBeLessThan(-1); // Malacca, closed by someone else, hurts China too
  });
});
