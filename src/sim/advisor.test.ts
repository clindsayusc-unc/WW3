/** The chief of staff's advice (D-080). */
import { describe, expect, it } from 'vitest';
import { createGame } from './game';
import { loadWorld } from './world';
import { allAdvice, topAdvice } from './advisor';
import { makeUnit } from './query';
import type { GameState, Iso3 } from './types';

const world = loadWorld();
const newGame = (player: Iso3 = 'USA', seed = 3): GameState => createGame({ seed, player, scenario: 'world-2027' }, world);

describe('advisor', () => {
  it('gives at most three pieces of advice, sorted by urgency, each with a reason and a screen', () => {
    for (const iso of ['USA', 'CHN', 'RUS', 'IND', 'BRA', 'UKR'] as Iso3[]) {
      const g = newGame(iso);
      const top = topAdvice(world, g);
      expect(top.length).toBeGreaterThan(0);
      expect(top.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < top.length; i++) expect(top[i - 1]!.priority).toBeGreaterThanOrEqual(top[i]!.priority);
      for (const a of top) {
        expect(a.title.length).toBeGreaterThan(5);
        expect(a.reason.length).toBeGreaterThan(30);
        expect(['budget', 'economy', 'production', 'research', 'diplomacy', 'military', 'escalation']).toContain(a.target);
      }
    }
  });

  it('covers economy, military and diplomacy when each has something to say', () => {
    const g = newGame('UKR');
    const all = allAdvice(world, g);
    const cats = new Set(all.map((a) => a.category));
    const top = topAdvice(world, g);
    for (const c of cats) if (top.length === 3 && cats.size === 3) expect(top.some((a) => a.category === c)).toBe(true);
  });

  it('notices idle research, a looming election, threatened capitals and proposals', () => {
    const g = newGame('USA');
    const me = g.nations['USA']!;
    me.researchCurrent = null;
    me.researchQueue = [];
    expect(allAdvice(world, g).some((a) => a.id === 'research-idle')).toBe(true);
    me.nextElection = g.turn + 4;
    me.support = 30;
    const election = allAdvice(world, g).find((a) => a.id === 'election')!;
    expect(election.priority).toBeGreaterThan(80);
    expect(election.target).toBe('budget');
    // An enemy stack next to Washington.
    const cap = world.capitalRegion.get('USA')!;
    const nb = world.regions.get(cap)!.neighbours.find((r) => !world.regions.get(r)!.sea)!;
    g.wars.push({ id: g.nextId++, attackers: ['CAN'], defenders: ['USA'], since: 0, score: 0 });
    g.diplomacyVersion++;
    const u = makeUnit(g.nextId++, 'armored', 'CAN', nb, {});
    g.units[u.id] = u;
    const top = topAdvice(world, g);
    expect(top[0]!.id).toBe('capital');
    expect(top[0]!.region).toBe(cap);
    g.proposals.push({ id: 77, from: 'GBR', to: 'USA', type: 'trade', turn: g.turn, text: 'The United Kingdom proposes a trade agreement.' });
    expect(allAdvice(world, g).some((a) => a.id === 'proposal-77' && a.nation === 'GBR')).toBe(true);
  });

  it('is deterministic and never touches the state', () => {
    const g = newGame('JPN');
    const before = JSON.stringify(g);
    expect(topAdvice(world, g)).toEqual(topAdvice(world, g));
    expect(JSON.stringify(g)).toBe(before);
  });
});
