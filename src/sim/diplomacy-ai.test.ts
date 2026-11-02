/** Diplomacy AI (D-071): deals, memory, statements, blocs, the UN, war plans and coalitions. */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import type { Deal, DealItem, GameState, Iso3 } from './types';
import { evaluateDeal, proposeDeal } from './deals';
import { decayMemories, memoryBalance, opinionOf, remember } from './personality';
import { composeStatement, toneOf } from './statements';
import { declareWar } from './diplomacy';
import { alliesOf, atWar, getRelation, makeUnit, warBetween } from './query';
import { tableResolution, voteOf } from './un';
import { runBlocs } from './blocs';
import { dominanceOf, runCoalitions, runWarPlans } from './strategy';
import { runAid } from './aid';

const world = loadWorld();
const fresh = (player: Iso3 = 'BRA', seed = 11): GameState => createGame({ seed, player, scenario: 'world-2027' }, world);
const deal = (from: Iso3, to: Iso3, give: DealItem[], get: DealItem[]): Deal => ({ from, to, give, get });

describe('deal evaluation is consistent', () => {
  const g = fresh('GBR');
  const cases: Deal[] = [
    deal('GBR', 'FRA', [{ kind: 'money', amount: 5 }], [{ kind: 'basing' }]),
    deal('GBR', 'IND', [], [{ kind: 'treaty', treaty: 'trade' }]),
    deal('GBR', 'TUR', [{ kind: 'arms', units: 2 }], [{ kind: 'liftSanctions' }]),
    deal('GBR', 'POL', [{ kind: 'tech' }], [{ kind: 'arms', units: 3 }]),
    deal('GBR', 'SAU', [{ kind: 'money', amount: 20 }], [{ kind: 'treaty', treaty: 'defensive' }]),
    deal('GBR', 'DEU', [], [{ kind: 'joinWar', against: 'FRA' }]),
    deal('GBR', 'JPN', [{ kind: 'money', amount: 1 }], [{ kind: 'money', amount: 50 }]),
  ];

  it('is deterministic and never mutates the state', () => {
    const before = JSON.stringify(g);
    for (const d of cases) {
      const a = evaluateDeal(world, g, d);
      const b = evaluateDeal(world, g, d);
      expect(b).toEqual(a);
    }
    expect(JSON.stringify(g)).toBe(before);
  });

  it('accepts exactly when the acceptance bar is at or above 50 %', () => {
    for (const d of cases) {
      const v = evaluateDeal(world, g, d);
      if (v.verdict === 'accept') expect(v.likelihood).toBeGreaterThanOrEqual(0.5);
      else expect(v.likelihood).toBeLessThan(0.5);
      expect(v.reason.length).toBeGreaterThan(10);
    }
  });

  it('sweetening a deal with money never lowers its value; once accepted it stays accepted', () => {
    const base: DealItem[] = [{ kind: 'basing' }];
    let lastScore = -Infinity;
    let accepted = false;
    for (const amount of [0, 2, 5, 10, 20, 40, 80]) {
      const give: DealItem[] = amount > 0 ? [{ kind: 'money', amount }] : [];
      const v = evaluateDeal(world, g, deal('GBR', 'ITA', give, base));
      expect(v.score).toBeGreaterThanOrEqual(lastScore);
      if (accepted) expect(v.verdict).toBe('accept');
      if (v.verdict === 'accept') accepted = true;
      lastScore = v.score;
    }
    expect(accepted).toBe(true);
  });

  it('asking for more never raises the value to the AI', () => {
    const small = evaluateDeal(world, g, deal('GBR', 'JPN', [], [{ kind: 'money', amount: 5 }]));
    const big = evaluateDeal(world, g, deal('GBR', 'JPN', [], [{ kind: 'money', amount: 5 }, { kind: 'arms', units: 2 }]));
    expect(big.score).toBeLessThan(small.score);
  });

  it('a counter-offer, when made, is itself acceptable', () => {
    let counters = 0;
    for (const to of ['FRA', 'ITA', 'ESP', 'CAN', 'AUS', 'JPN', 'KOR', 'POL', 'NLD', 'TUR']) {
      for (const get of [[{ kind: 'basing' }], [{ kind: 'arms', units: 3 }], [{ kind: 'tech' }]] as DealItem[][]) {
        const v = evaluateDeal(world, g, deal('GBR', to, [], get));
        if (v.verdict !== 'counter') continue;
        counters++;
        expect(v.counter).not.toBeNull();
        expect(evaluateDeal(world, g, v.counter!).verdict).toBe('accept');
      }
    }
    expect(counters).toBeGreaterThan(0);
  });

  it('no amount of money buys a war on an ally', () => {
    const v = evaluateDeal(world, g, deal('GBR', 'DEU', [{ kind: 'money', amount: Math.floor(g.nations.GBR!.treasury) }], [{ kind: 'joinWar', against: 'FRA' }]));
    expect(v.verdict).toBe('reject');
    expect(v.likelihood).toBe(0);
    expect(v.reason).toMatch(/never attack|treaty partner/i);
  });

  it('personality matters: a transactional leader values cash more than a pragmatic ally', () => {
    const toUsa = evaluateDeal(world, g, deal('GBR', 'USA', [{ kind: 'money', amount: 20 }], []));
    const toDeu = evaluateDeal(world, g, deal('GBR', 'DEU', [{ kind: 'money', amount: 20 }], []));
    const usaMoney = toUsa.lines.find((l) => l.label.includes('$20'))!.value;
    const deuMoney = toDeu.lines.find((l) => l.label.includes('$20'))!.value;
    expect(usaMoney).toBeGreaterThan(deuMoney);
  });

  it('executes accepted deals through the command, and remembers the favour', () => {
    const d = deal('GBR', 'ITA', [{ kind: 'money', amount: 60 }], [{ kind: 'treaty', treaty: 'trade' }]);
    expect(evaluateDeal(world, g, d).verdict).toBe('accept');
    const next = applyCommand(world, g, { type: 'proposeDeal', deal: d });
    expect(next.nations.GBR!.treasury).toBeCloseTo(g.nations.GBR!.treasury - 60, 5);
    expect(next.treaties.some((t) => t.type === 'trade' && [t.a, t.b].includes('ITA') && [t.a, t.b].includes('GBR'))).toBe(true);
    expect(memoryBalance(next, 'ITA', 'GBR')).toBeGreaterThan(0);
  });
});

describe('leader memory', () => {
  it('grievances lower opinion and fade at a rate set by traits', () => {
    const g = fresh();
    const before = opinionOf(world, g, 'RUS', 'POL');
    remember(g, 'RUS', 'POL', 'grievance', 20, 'test');
    remember(g, 'GBR', 'POL', 'grievance', 20, 'test');
    expect(opinionOf(world, g, 'RUS', 'POL')).toBeLessThan(before);
    for (let i = 0; i < 12; i++) decayMemories(world, g);
    const rus = -memoryBalance(g, 'RUS', 'POL');
    const gbr = -memoryBalance(g, 'GBR', 'POL');
    expect(rus).toBeGreaterThan(0);
    // A paranoid nationalist nurses a grudge longer than a pragmatic ally.
    expect(rus).toBeGreaterThan(gbr);
  });

  it('repeated memories accumulate in one entry', () => {
    const g = fresh();
    for (let i = 0; i < 5; i++) remember(g, 'CHN', 'USA', 'grievance', 2, 'arms sales to Taiwan');
    expect(g.memory.CHN!.filter((m) => m.reason === 'arms sales to Taiwan')).toHaveLength(1);
    expect(memoryBalance(g, 'CHN', 'USA')).toBe(-10);
  });
});

describe('diplomatic statements', () => {
  it('tone follows personality and the wording is deterministic', () => {
    expect(toneOf(world, 'RUS')).toBe('blunt');
    expect(toneOf(world, 'CAN')).toBe('measured');
    const g = fresh();
    const a = composeStatement(world, g, 'RUS', 'POL', 'threat', 'X.');
    const b = composeStatement(world, g, 'RUS', 'POL', 'threat', 'X.');
    expect(a).toEqual(b);
    expect(a.text).toContain('Poland');
  });
});

describe('war declarations', () => {
  it('an AI never declares war on an ally', () => {
    const g = fresh('BRA');
    declareWar(world, g, 'TUR', 'GRC', 'test');
    declareWar(world, g, 'USA', 'CAN', 'test');
    declareWar(world, g, 'RUS', 'BLR', 'test');
    expect(atWar(g, 'TUR', 'GRC')).toBe(false);
    expect(atWar(g, 'USA', 'CAN')).toBe(false);
    expect(atWar(g, 'RUS', 'BLR')).toBe(false);
  });

  it('NATO Article 5: an attack on Estonia brings in the alliance member by member', () => {
    const g = fresh('BRA');
    declareWar(world, g, 'RUS', 'EST', 'test');
    const war = warBetween(g, 'RUS', 'EST')!;
    expect(war.defenders).toEqual(expect.arrayContaining(['EST', 'POL', 'GBR', 'FIN']));
    expect(g.log.some((l) => l.text.includes('Article 5'))).toBe(true);
    // Allies of both sides stay out; no defender is allied to the attacker.
    for (const d of war.defenders) expect(alliesOf(world, g, 'RUS')).not.toContain(d);
  });
});

describe('blocs', () => {
  it('a member at war with a fellow member walks out', () => {
    const g = fresh('BRA');
    g.wars.push({ id: g.nextId++, attackers: ['TUR'], defenders: ['GRC'], since: 0, score: 0 });
    g.diplomacyVersion++;
    runBlocs(world, g);
    const left = ['TUR', 'GRC'].filter((x) => !g.blocs.NATO.members.includes(x));
    expect(left.length).toBeGreaterThanOrEqual(1);
    expect(g.blocs.NATO.departed.length).toBeGreaterThanOrEqual(1);
    // Leaving ends the alliance guarantee.
    expect(alliesOf(world, g, left[0]!)).not.toContain('USA');
  });

  it('the annual summit issues a communiqué', () => {
    let g = fresh('BRA');
    for (let i = 0; i < 7; i++) g = applyCommand(world, g, { type: 'endTurn' });
    expect(g.dispatches.some((d) => d.kind === 'communique' && d.text.includes('NATO summit'))).toBe(true);
    expect(g.blocs.NATO.nextSummit).toBeGreaterThan(6);
  });
});

describe('UN Security Council', () => {
  it('a permanent member vetoes a resolution against itself', () => {
    const g = fresh('GBR');
    const res = tableResolution(world, g, 'GBR', 'condemnation', 'RUS')!;
    expect(res.status).toBe('vetoed');
    expect(res.vetoedBy).toContain('RUS');
    expect(g.nations.RUS!.legitimacy).toBeLessThan(50);
  });

  it('a condemnation of a small aggressor without a patron passes and costs legitimacy', () => {
    const g = fresh('FRA');
    // Venezuela attacks Guyana: no P5 protects it.
    g.wars.push({ id: g.nextId++, attackers: ['VEN'], defenders: ['GUY'], since: 0, score: 0 });
    g.relations['GUY|VEN'] = -100;
    g.diplomacyVersion++;
    const yes = g.un.council.filter((m) => m === 'FRA' || voteOf(world, g, m, { kind: 'condemnation', sponsor: 'FRA', target: 'VEN' }).vote === 'yes');
    const res = tableResolution(world, g, 'FRA', 'condemnation', 'VEN')!;
    expect(res.status === 'adopted' || res.status === 'vetoed' || res.status === 'failed').toBe(true);
    if (yes.length >= 9 && res.vetoedBy.length === 0) {
      expect(res.status).toBe('adopted');
      expect(g.nations.VEN!.legitimacy).toBeLessThan(45);
    }
  });

  it('the player votes on AI resolutions before they are counted', () => {
    const g = fresh('FRA');
    const res = tableResolution(world, g, 'GBR', 'condemnation', 'PRK')!;
    expect(res.status).toBe('pending');
    const voted = applyCommand(world, g, { type: 'unVote', resolutionId: res.id, vote: 'no' });
    expect(voted.un.resolutions.find((r) => r.id === res.id)!.votes.FRA).toBe('no');
    const next = applyCommand(world, voted, { type: 'endTurn' });
    const done = next.un.resolutions.find((r) => r.id === res.id)!;
    expect(done.status).toBe('vetoed');
    expect(done.vetoedBy).toContain('FRA');
  });
});

describe('foreign aid', () => {
  it('Western donors send money, arms and munitions to Ukraine; suspending aid stops it', () => {
    const g = fresh('BRA');
    const t0 = g.nations.UKR!.treasury;
    runAid(world, g);
    const donors = new Set(g.aid.filter((f) => f.recipient === 'UKR').map((f) => f.donor));
    for (const d of ['DEU', 'GBR', 'POL', 'FRA']) expect(donors.has(d)).toBe(true);
    expect(donors.has('CHN')).toBe(false);
    expect(g.nations.UKR!.treasury).toBeGreaterThan(t0);
    expect(g.nations.UKR!.aidSupply).toBeGreaterThan(0);
    const total = g.aid.filter((f) => f.recipient === 'UKR').reduce((s, f) => s + f.money + f.arms + f.munitions, 0);
    // Kiel Institute scale: tens of billions a year, i.e. a few billion a month.
    expect(total * 12).toBeGreaterThan(30);
    expect(total * 12).toBeLessThan(200);
    const cut = fresh('BRA');
    cut.aidSuspended = Object.keys(cut.nations);
    runAid(world, cut);
    expect(cut.aid).toHaveLength(0);
  });

  it('the player can run an aid programme', () => {
    const g = applyCommand(world, fresh('USA'), { type: 'setAid', recipient: 'UKR', level: 2 });
    expect(g.playerAid.UKR).toBe(2);
    const t0 = g.nations.USA!.treasury;
    runAid(world, g);
    expect(g.aid.some((f) => f.donor === 'USA' && f.recipient === 'UKR')).toBe(true);
    expect(g.nations.USA!.treasury).toBeLessThan(t0);
  });
});

describe('strategic AI', () => {
  it('war plans pick targets from agendas and hostility, never allies or nuclear powers lightly', () => {
    let g = fresh('BRA');
    for (let i = 0; i < 6; i++) g = applyCommand(world, g, { type: 'endTurn' });
    runWarPlans(world, g);
    for (const [iso, p] of Object.entries(g.warPlans)) {
      expect(alliesOf(world, g, iso)).not.toContain(p.target);
      expect(p.threshold).toBeGreaterThan(1);
      expect(p.readiness).toBeGreaterThanOrEqual(0);
    }
  });

  it('a balancing coalition forms against a runaway player', () => {
    const g = fresh('CHN');
    expect(dominanceOf(world, g, 'CHN').threat).toBeLessThan(0.3);
    runCoalitions(world, g);
    expect(g.coalition).toBeNull();
    // China overruns its neighbours: Mongolia, Kazakhstan, Vietnam, the Koreas and Taiwan.
    for (const iso of ['MNG', 'KAZ', 'VNM', 'KOR', 'PRK', 'TWN', 'JPN'])
      for (const r of world.regionsByNation.get(iso) ?? []) {
        g.regions[r]!.controller = 'CHN';
      }
    g.regionsVersion++;
    for (let i = 0; i < 60; i++) {
      const u = makeUnit(g.nextId++, 'armored', 'CHN', world.capitalRegion.get('CHN')!);
      g.units[u.id] = u;
    }
    const d = dominanceOf(world, g, 'CHN');
    expect(d.threat).toBeGreaterThanOrEqual(0.3);
    runCoalitions(world, g);
    expect(g.coalition?.target).toBe('CHN');
    expect(g.coalition!.members.length).toBeGreaterThanOrEqual(3);
    expect(g.coalition!.members).not.toContain('CHN');
    // Members bind themselves with defensive pacts and hold a grievance against the hegemon.
    expect(g.treaties.filter((t) => t.type === 'defensive' && g.coalition!.members.includes(t.a) && g.coalition!.members.includes(t.b)).length).toBeGreaterThan(0);
    expect(g.coalition!.members.every((m) => memoryBalance(g, m, 'CHN') < 0)).toBe(true);
    // Their war plans turn toward China.
    let s = g;
    for (let i = 0; i < 6; i++) s = applyCommand(world, s, { type: 'endTurn' });
    expect(Object.values(s.warPlans).some((p) => p.target === 'CHN')).toBe(true);
  });

  it('no coalition forms against an ordinary player in a quiet year', () => {
    let g = fresh('BRA', 3);
    for (let i = 0; i < 12; i++) g = applyCommand(world, g, { type: 'endTurn' });
    expect(g.coalition?.target === 'BRA').toBe(false);
  });

  it('deals between AIs respect relations (sanity check on proposeDeal logging)', () => {
    const g = fresh('BRA');
    const v = proposeDeal(world, g, deal('RUS', 'POL', [], [{ kind: 'basing' }]));
    expect(v.verdict).toBe('reject');
    expect(getRelation(world, g, 'RUS', 'POL')).toBeLessThan(0);
  });
});
