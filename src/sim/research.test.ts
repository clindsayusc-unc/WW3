/**
 * The research tree (D-079): data integrity, starting capability, costs (alliances, theft,
 * export controls), the auto-queue, unlocks and abilities, espionage, sharing and migration.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, refreshLeaders } from './game';
import { loadWorld } from './world';
import {
  ALLY_DISCOUNT_MAX,
  CALIBRATED_KEYS,
  pathTo,
  queueResearch,
  recomputeModifiers,
  runResearch,
  startingTechList,
  techCostBreakdown,
  unitLockReason,
} from './research';
import { applyShareTech, applyStealTech, canShareTech, canStealTech, runTechWar, stealOdds, STEAL_CREDIT } from './techwar';
import { cyberSuccessChance, interceptionChance } from './strikes';
import { attackerFactors } from './military';
import { airDefenceAt } from './air';
import { growthBreakdown } from './economy';
import { secondStrike } from './escalation';
import { alliesOf, getRelation, makeUnit } from './query';
import techStart from '../../data/tech-start.json';
import type { GameState, Iso3 } from './types';

const world = loadWorld();
const newGame = (player: Iso3 = 'USA', seed = 11): GameState => createGame({ seed, player, scenario: 'world-2027' }, world);
const cap = (iso: Iso3) => world.capitalRegion.get(iso)!;

describe('technology data', () => {
  it('has about 80 technologies across the 8 branches, each with framing, cost and effects', () => {
    expect(world.techList.length).toBeGreaterThanOrEqual(78);
    expect(world.techList.length).toBeLessThanOrEqual(90);
    expect(world.branches).toHaveLength(8);
    for (const b of world.branches) expect(world.techList.filter((t) => t.branch === b.id).length).toBeGreaterThanOrEqual(9);
    for (const t of world.techList) {
      expect(t.framing.length, t.id).toBeGreaterThan(80);
      expect(t.cost).toBeGreaterThan(0);
      expect(t.effects.length).toBeGreaterThan(0);
      expect(t.era).toBeGreaterThanOrEqual(1);
      expect(t.era).toBeLessThanOrEqual(5);
      expect(t.tier).toBe(t.era);
      expect(t.year).toBeGreaterThanOrEqual(2027);
      expect(t.year).toBeLessThanOrEqual(2040);
    }
  });

  it('spans 2027–2040 in five eras whose years and costs rise', () => {
    const avg = (era: number) => {
      const list = world.techList.filter((t) => t.era === era);
      return list.reduce((s, t) => s + t.cost, 0) / list.length;
    };
    for (let e = 2; e <= 5; e++) expect(avg(e)).toBeGreaterThan(avg(e - 1));
    const ranges: Record<number, [number, number]> = { 1: [2027, 2027], 2: [2028, 2030], 3: [2031, 2033], 4: [2034, 2036], 5: [2037, 2040] };
    for (const t of world.techList) {
      expect(t.year, t.id).toBeGreaterThanOrEqual(ranges[t.era]![0]);
      expect(t.year, t.id).toBeLessThanOrEqual(ranges[t.era]![1]);
    }
  });

  it('prerequisites exist, come from the same or an earlier era, and form no cycle', () => {
    for (const t of world.techList)
      for (const r of t.requires) {
        const p = world.techs.get(r);
        expect(p, `${t.id} requires ${r}`).toBeDefined();
        expect(p!.era).toBeLessThanOrEqual(t.era);
      }
    // A full path exists to every technology (no cycles: pathTo terminates and ends at the tech).
    const blank = newGame();
    const n = { ...blank.nations['USA']!, techs: [] };
    for (const t of world.techList) {
      const p = pathTo(world, n, t.id);
      expect(p[p.length - 1]).toBe(t.id);
      const seen = new Set<string>();
      for (const id of p) {
        for (const r of world.techs.get(id)!.requires) expect(seen.has(r), `${id} after ${r}`).toBe(true);
        seen.add(id);
      }
    }
  });

  it('unlocks the promised units and abilities, and each locked unit names its technology', () => {
    const units = world.techList.flatMap((t) => t.unlocks.units);
    const abilities = world.techList.flatMap((t) => t.unlocks.abilities);
    for (const u of ['fighter6', 'loyalWingman', 'droneSwarm', 'laserAD']) expect(units).toContain(u);
    for (const a of ['hypersonicStrike', 'directedEnergy', 'quantumComms', 'aiCommand', 'spaceSensors']) expect(abilities).toContain(a);
    for (const u of world.unitTypeList) {
      if (!u.requiresTech) continue;
      expect(world.techs.get(u.requiresTech)?.unlocks.units, u.id).toContain(u.id);
      expect(world.unitInputs.get(u.id), `inputs for ${u.id}`).toBeDefined();
    }
    for (const a of world.abilities.values()) expect(world.techs.has(a.tech)).toBe(true);
    expect(world.abilities.size).toBe(abilities.length);
  });
});

describe('starting capability (data/tech-start.json)', () => {
  it('lists real nations with existing, prerequisite-closed technologies and a stated basis', () => {
    expect(techStart.estimate).toBe(true);
    for (const [iso, row] of Object.entries(techStart.nations)) {
      expect(world.nations.has(iso), iso).toBe(true);
      expect(row.basis.length).toBeGreaterThan(20);
      for (const id of row.techs) {
        const t = world.techs.get(id);
        expect(t, `${iso}: ${id}`).toBeDefined();
        for (const r of t!.requires) expect(row.techs, `${iso}: ${id} needs ${r}`).toContain(r);
      }
    }
  });

  it('reflects current capability: leaders ahead, signature programmes present', () => {
    const g = newGame();
    const count = (iso: Iso3) => g.nations[iso]!.techs.length;
    expect(count('USA')).toBeGreaterThan(count('GBR'));
    expect(count('CHN')).toBeGreaterThan(count('IND'));
    expect(count('RUS')).toBeGreaterThan(count('PAK'));
    expect(g.nations['ISR']!.techs).toContain('md-directed-energy'); // Iron Beam, December 2025
    expect(g.nations['CHN']!.techs).toContain('cyber-quantum-secure-comms'); // Micius, QKD backbone
    expect(g.nations['CHN']!.techs).toContain('missiles-anti-ship-ballistic'); // DF-21D / DF-26
    expect(g.nations['RUS']!.techs).toContain('missiles-scramjet'); // Zircon
    expect(g.nations['UKR']!.techs).toContain('drones-naval-usv'); // Magura
    expect(g.nations['AUS']!.techs).toContain('drones-collaborative-combat'); // Ghost Bat
    expect(g.nations['TWN']!.techs).toContain('semi-angstrom-nodes'); // TSMC
    expect(g.nations['USA']!.techs).not.toContain('ai-sixth-gen'); // F-47 not yet flying
    for (const n of Object.values(g.nations)) expect(n.techs).toEqual(startingTechList(world, n.iso3));
  });

  it('calibrated economies start with zero technology growth bonus', () => {
    const g = newGame();
    for (const iso of ['USA', 'CHN', 'DEU', 'BRA'] as Iso3[]) {
      const n = g.nations[iso]!;
      for (const k of CALIBRATED_KEYS) expect(n.techBaseline[k]).toBeCloseTo(n.modifiers[k] ?? 0, 9);
      // The technology term of the growth breakdown is measured against January 2027.
      expect(growthBreakdown(world, g, iso).tech).toBeCloseTo(0, 9);
    }
  });
});

describe('costs: alliances, theft and export controls', () => {
  it('allies that field a technology make it cheaper, capped', () => {
    const g = newGame();
    const t = 'missiles-hypersonic-glide';
    expect(g.nations['USA']!.techs).toContain(t);
    expect(alliesOf(world, g, 'GBR')).toContain('USA');
    const gbr = techCostBreakdown(world, g, 'GBR', t);
    expect(gbr.sharingAllies).toContain('USA');
    expect(gbr.total).toBeLessThan(gbr.base);
    expect(gbr.allyDiscount).toBeLessThanOrEqual(ALLY_DISCOUNT_MAX);
    // A nation with no allies fielding it pays more.
    const bra = techCostBreakdown(world, g, 'BRA', t);
    expect(bra.allyDiscount).toBe(0);
    expect(bra.total).toBeGreaterThan(gbr.total);
  });

  it('export controls raise China’s chip and AI costs; lifting them lowers the cost', () => {
    const g = newGame('USA');
    const chip = techCostBreakdown(world, g, 'CHN', 'semi-angstrom-nodes');
    expect(chip.exportControl).toBeGreaterThan(1.1);
    expect(techCostBreakdown(world, g, 'CHN', 'energy-solid-state').exportControl).toBe(1);
    const lifted = applyCommand(world, g, { type: 'techControls', target: 'CHN', on: false });
    expect(techCostBreakdown(world, lifted, 'CHN', 'semi-angstrom-nodes').total).toBeLessThan(chip.total);
    expect(getRelation(world, lifted, 'USA', 'CHN')).toBeGreaterThan(getRelation(world, g, 'USA', 'CHN'));
  });

  it('sanctions slow research and block allied spillover from the sanctioners', () => {
    const g = newGame('USA');
    const before = techCostBreakdown(world, g, 'TUR', 'missiles-hypersonic-glide');
    expect(before.sharingAllies).toContain('USA');
    g.sanctions.push('USA>TUR');
    const after = techCostBreakdown(world, g, 'TUR', 'missiles-hypersonic-glide');
    expect(after.sharingAllies).not.toContain('USA');
    expect(after.total).toBeGreaterThan(before.total);
  });
});

describe('the research queue', () => {
  it('clicking a distant tech queues its whole path, prerequisites first, and research advances it', () => {
    let g = newGame('USA');
    g = applyCommand(world, g, { type: 'queueResearch', tech: 'ai-sixth-gen' });
    const me = g.nations['USA']!;
    const all = [me.researchCurrent!, ...me.researchQueue];
    expect(all[all.length - 1]).toBe('ai-sixth-gen');
    for (const id of ['ai-command-systems', 'ai-pilot', 'energy-adaptive-engines', 'drones-collaborative-combat']) expect(all).toContain(id);
    expect(all.indexOf('ai-command-systems')).toBeLessThan(all.indexOf('ai-pilot'));
    // Every project in the queue is started in an order whose prerequisites are met.
    me.researchPoints = 1e6;
    const done: string[] = [];
    for (let k = 0; k < 10 && (me.researchCurrent || me.researchQueue.length); k++) {
      runResearch(world, g);
      done.push(...me.techs.filter((id) => all.includes(id) && !done.includes(id)));
    }
    expect(me.techs).toContain('ai-sixth-gen');
    expect(me.researchQueue).toHaveLength(0);
  });

  it('shift-click appends; setResearchQueue reorders and drops known techs', () => {
    let g = newGame('USA');
    g = applyCommand(world, g, { type: 'queueResearch', tech: 'cyber-pqc' });
    g = applyCommand(world, g, { type: 'queueResearch', tech: 'energy-smr', append: true });
    const me = g.nations['USA']!;
    expect(me.researchCurrent).toBe('cyber-pqc');
    expect(me.researchQueue).toEqual(['energy-smr']);
    g = applyCommand(world, g, { type: 'setResearchQueue', queue: ['md-glide-phase', 'ai-decision-support', 'energy-smr'] });
    expect(g.nations['USA']!.researchQueue).toEqual(['md-glide-phase', 'energy-smr']);
  });

  it('queueResearch is a no-op for a fielded tech', () => {
    const g = newGame('USA');
    queueResearch(world, g, 'USA', 'ai-decision-support');
    expect(g.nations['USA']!.researchQueue).toHaveLength(0);
  });
});

describe('unlocks and abilities', () => {
  it('locked units cannot be built until their technology is fielded', () => {
    let g = newGame('USA');
    g.nations['USA']!.treasury = 1000;
    expect(unitLockReason(world, g, 'USA', 'fighter6')).toMatch(/Sixth-Generation/);
    expect(() => applyCommand(world, g, { type: 'queueProduction', unitType: 'fighter6', region: cap('USA') })).toThrow(/Requires/);
    g.nations['USA']!.techs.push('ai-pilot', 'energy-adaptive-engines', 'drones-collaborative-combat', 'ai-command-systems', 'ai-sixth-gen');
    g = applyCommand(world, g, { type: 'queueProduction', unitType: 'fighter6', region: cap('USA') });
    expect(g.nations['USA']!.production.some((p) => p.type === 'fighter6')).toBe(true);
    // Israel fields Iron Beam and may build laser air defence from the start.
    expect(unitLockReason(world, g, 'ISR', 'laserAD')).toBeNull();
  });

  it('hypersonic salvos are intercepted far less, unless the defender has glide-phase defences', () => {
    const g = newGame('USA');
    const tehran = cap('IRN');
    g.nations['IRN']!.modifiers.missileDefence = 0.25;
    const cruise = interceptionChance(world, g, tehran, 'USA');
    const hyper = interceptionChance(world, g, tehran, 'USA', true);
    expect(hyper).toBeLessThan(cruise * 0.5);
    g.nations['IRN']!.modifiers.hypersonicDefence = 0.45;
    expect(interceptionChance(world, g, tehran, 'USA', true)).toBeGreaterThan(hyper);
  });

  it('a hypersonic strike needs the ability', () => {
    const g = newGame('GBR');
    g.wars.push({ id: g.nextId++, attackers: ['GBR'], defenders: ['IRN'], since: 0, score: 0 });
    g.diplomacyVersion++;
    g.nations['GBR']!.missiles = 50;
    expect(() => applyCommand(world, g, { type: 'missileStrike', region: cap('IRN'), kind: 'industry', hypersonic: true })).toThrow(/Hypersonic/);
    expect(() => applyCommand(world, g, { type: 'missileStrike', region: cap('IRN'), kind: 'industry' })).not.toThrow();
  });

  it('quantum-secure communications halve blinding and sabotage, not economic attacks', () => {
    const g = newGame('USA');
    const plain = cyberSuccessChance(g, 'USA', 'CHN', 'intel', world);
    expect(g.nations['CHN']!.techs).toContain('cyber-quantum-secure-comms');
    expect(cyberSuccessChance(g, 'USA', 'CHN', 'economy', world)).toBeCloseTo(plain * 2, 9);
  });

  it('AI battle management adds a visible battle modifier', () => {
    const g = newGame('USA');
    const u = makeUnit(g.nextId++, 'mechanized', 'USA', cap('USA'), {});
    g.units[u.id] = u;
    const target = world.regions.get(cap('USA'))!.neighbours[0]!;
    const without = attackerFactors(world, g, u, target, cap('USA'), { amphibious: false, dominant: false });
    expect(without.mods.some((m) => m.label === 'AI battle management')).toBe(false);
    g.nations['USA']!.techs.push('ai-command-systems');
    const withAi = attackerFactors(world, g, u, target, cap('USA'), { amphibious: false, dominant: false });
    expect(withAi.mods.some((m) => m.label === 'AI battle management')).toBe(true);
    expect(withAi.factor).toBeGreaterThan(without.factor);
  });

  it('laser brigades and electronic warfare hunt drones harder than crewed jets', () => {
    const g = newGame('USA');
    g.wars.push({ id: g.nextId++, attackers: ['USA'], defenders: ['ISR'], since: 0, score: 0 });
    g.diplomacyVersion++;
    const r = cap('ISR');
    for (const u of Object.values(g.units)) if (u.region === r) delete g.units[u.id];
    const l = makeUnit(g.nextId++, 'laserAD', 'ISR', r, {});
    g.units[l.id] = l;
    g.nextId++;
    expect(airDefenceAt(world, g, r, 'USA', true)).toBeGreaterThan(airDefenceAt(world, g, r, 'USA') * 2);
  });

  it('deterrence technology makes a second strike survive missile defence better', () => {
    const g = newGame('USA');
    g.nations['USA']!.modifiers.missileDefence = 0.4;
    const base = secondStrike(world, g, 'CHN', 'USA');
    g.nations['CHN']!.modifiers.deterrence = 0.3;
    expect(secondStrike(world, g, 'CHN', 'USA').penetrating).toBeGreaterThan(base.penetrating);
  });
});

describe('espionage and sharing', () => {
  it('a successful theft covers half the cost; exposure costs relations and legitimacy', () => {
    const g = newGame('CHN');
    const tech = 'semi-advanced-nodes';
    expect(canStealTech(world, g, 'CHN', 'USA', tech)).toBeNull();
    const base = techCostBreakdown(world, g, 'CHN', tech).total;
    const rel = getRelation(world, g, 'CHN', 'USA');
    const legit = g.nations['CHN']!.legitimacy;
    const out = applyStealTech(world, g, 'CHN', 'USA', tech, [0, 0]);
    expect(out).toEqual({ success: true, exposed: true });
    expect(g.nations['CHN']!.techCredit[tech]).toBe(STEAL_CREDIT);
    expect(techCostBreakdown(world, g, 'CHN', tech).total).toBeLessThan(base * 0.75);
    expect(getRelation(world, g, 'CHN', 'USA')).toBeLessThan(rel);
    expect(g.nations['CHN']!.legitimacy).toBeLessThan(legit);
    expect(g.memory['USA']!.some((m) => m.about === 'CHN' && m.reason === 'stole our technology')).toBe(true);
    // Cooldown, then no second theft of the same design.
    expect(canStealTech(world, g, 'CHN', 'USA', tech)).toMatch(/lying low/);
  });

  it('a clean failure changes nothing but the treasury and cooldown', () => {
    const g = newGame('CHN');
    const rel = getRelation(world, g, 'CHN', 'USA');
    const out = applyStealTech(world, g, 'CHN', 'USA', 'semi-advanced-nodes', [0.99, 0.99]);
    expect(out).toEqual({ success: false, exposed: false });
    expect(getRelation(world, g, 'CHN', 'USA')).toBe(rel);
    expect(g.nations['CHN']!.techCredit['semi-advanced-nodes']).toBeUndefined();
  });

  it('designs are useless without prerequisites, and odds respond to counter-intelligence', () => {
    const g = newGame('IRN');
    expect(canStealTech(world, g, 'IRN', 'USA', 'semi-ai-accelerators')).toMatch(/prerequisites/);
    const before = stealOdds(world, g, 'IRN', 'USA');
    g.nations['USA']!.modifiers.counterIntel = 0.3;
    const after = stealOdds(world, g, 'IRN', 'USA');
    expect(after.success).toBeLessThan(before.success);
    expect(after.detection).toBeGreaterThan(before.detection);
  });

  it('player theft goes through the command and the seeded RNG', () => {
    const g = newGame('CHN');
    const a = applyCommand(world, g, { type: 'stealTech', target: 'USA', tech: 'semi-advanced-nodes' });
    const b = applyCommand(world, g, { type: 'stealTech', target: 'USA', tech: 'semi-advanced-nodes' });
    expect(a.rng).toBe(b.rng);
    expect(a.rng).not.toBe(g.rng);
    expect(a.nations['CHN']!.espionageCooldown).toBe(4);
  });

  it('allies receive shared technology at once; distant non-allies cannot', () => {
    const g = newGame('USA');
    expect(canShareTech(world, g, 'USA', 'GBR', 'missiles-hypersonic-glide')).toBeNull();
    applyShareTech(world, g, 'USA', 'GBR', 'missiles-hypersonic-glide');
    expect(g.nations['GBR']!.techs).toContain('missiles-hypersonic-glide');
    expect(g.nations['GBR']!.modifiers.strikePower ?? 0).toBeGreaterThan(0.1);
    expect(canShareTech(world, g, 'USA', 'PAK', 'md-counter-uas')).toMatch(/allies/);
    // The US and Iran are at war when the campaign opens (D-085).
    expect(canShareTech(world, g, 'USA', 'IRN', 'md-counter-uas')).toBe('You are at war.');
  });

  it('AI powers steal and share over time without touching the simulation RNG', () => {
    const g = newGame('BRA');
    const rng = g.rng;
    const before = Object.values(g.nations).reduce((s, n) => s + n.techs.length, 0);
    let thefts = 0;
    for (let t = 0; t < 60; t++) {
      g.turn = t;
      for (const iso of world.majors) g.nations[iso]!.espionageCooldown = 0;
      const credits = Object.values(g.nations).reduce((s, n) => s + Object.keys(n.techCredit).length, 0);
      runTechWar(world, g);
      thefts += Object.values(g.nations).reduce((s, n) => s + Object.keys(n.techCredit).length, 0) - credits;
    }
    const after = Object.values(g.nations).reduce((s, n) => s + n.techs.length, 0);
    expect(g.rng).toBe(rng);
    expect(thefts).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before);
  });
});

describe('saves and determinism', () => {
  it('a save from before D-079 gains the starting technologies and an empty queue', () => {
    const g = newGame('USA');
    const old = structuredClone(g) as unknown as { nations: Record<string, Record<string, unknown>>; techControls?: unknown };
    for (const n of Object.values(old.nations)) {
      delete n.researchQueue;
      delete n.techCredit;
      delete n.techBaseline;
      delete n.espionageCooldown;
      n.techs = ['ai-decision-support', 'some-removed-tech', 'ai-pilot'];
    }
    delete old.techControls;
    const m = refreshLeaders(world, old as unknown as GameState);
    const usa = m.nations['USA']!;
    expect(usa.researchQueue).toEqual([]);
    expect(usa.techs).not.toContain('some-removed-tech');
    expect(usa.techs).not.toContain('ai-pilot'); // its prerequisites are missing
    for (const id of startingTechList(world, 'USA')) expect(usa.techs).toContain(id);
    expect(m.techControls).toContain('USA>CHN');
    recomputeModifiers(world, m, 'USA');
    expect(m.nations['USA']!.modifiers).toEqual(usa.modifiers);
  });

  it('two games with the same seed research identically', () => {
    let a = newGame('JPN', 5);
    let b = newGame('JPN', 5);
    for (let i = 0; i < 3; i++) {
      a = applyCommand(world, a, { type: 'endTurn' });
      b = applyCommand(world, b, { type: 'endTurn' });
    }
    for (const iso of world.majors) {
      expect(a.nations[iso]!.techs).toEqual(b.nations[iso]!.techs);
      expect(a.nations[iso]!.researchCurrent).toBe(b.nations[iso]!.researchCurrent);
    }
  });
});
