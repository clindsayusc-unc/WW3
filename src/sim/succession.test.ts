/** Successor personalities from party and faction profiles (D-078). */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld, traitsOf, type Traits } from './world';
import type { GameState, Iso3 } from './types';
import {
  MIN_SUCCESSOR_DISTANCE,
  TRAIT_KEYS,
  factionOf,
  nationalBaseline,
  successorBounds,
  successorFaction,
  successorTraits,
  traitDistance,
  type SuccessionCause,
} from './succession';
import { succeedLeader } from './domestic';

const world = loadWorld();
const fresh = (seed = 1, player: Iso3 = 'BRA'): GameState => createGame({ seed, player, scenario: 'world-2027' }, world);
const LED = [...world.leaders.keys()];
const CAUSES: SuccessionCause[] = ['election', 'termLimit', 'health', 'resignation', 'assassination', 'impeachment', 'coup', 'revolution'];

describe('party and faction data', () => {
  it('every nation with a researched leader has sourced factions with valid profiles', () => {
    for (const iso of LED) {
      const nf = world.factions.get(iso);
      expect(nf, iso).toBeDefined();
      expect(nf!.factions.length, iso).toBeGreaterThanOrEqual(2);
      expect(nf!.factions.map((f) => f.id), iso).toContain(nf!.incumbent);
      const total = nf!.factions.reduce((s, f) => s + f.weight, 0);
      expect(total, iso).toBeGreaterThan(0.95);
      expect(total, iso).toBeLessThan(1.05);
      for (const f of nf!.factions) {
        expect(f.url, `${iso}/${f.id}`).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/./);
        expect(f.position.length).toBeGreaterThan(10);
        for (const k of TRAIT_KEYS) {
          expect(f.traits[k], `${iso}/${f.id}/${k}`).toBeGreaterThanOrEqual(0);
          expect(f.traits[k], `${iso}/${f.id}/${k}`).toBeLessThanOrEqual(100);
        }
      }
      for (const k of TRAIT_KEYS) {
        const b = nationalBaseline(world, iso)[k];
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('successor traits', () => {
  it('differ from the predecessor but stay within plausible bounds for their party, for every nation and cause', () => {
    let seed = 100;
    for (const iso of LED)
      for (const cause of CAUSES) {
        const g = fresh(seed++);
        const before = traitsOf(world, iso, g);
        const faction = successorFaction(world, g, iso, cause)!;
        const t = successorTraits(world, g, iso, faction, cause, before);
        const bounds = successorBounds(faction, cause);
        expect(traitDistance(t, before), `${iso} ${cause}`).toBeGreaterThanOrEqual(MIN_SUCCESSOR_DISTANCE);
        for (const k of TRAIT_KEYS) {
          expect(t[k], `${iso} ${cause} ${k}`).toBeGreaterThanOrEqual(bounds[k][0]);
          expect(t[k], `${iso} ${cause} ${k}`).toBeLessThanOrEqual(bounds[k][1]);
          expect(Number.isInteger(t[k])).toBe(true);
        }
      }
  });

  it('a real successor in the game is fictional, takes their own traits and drives the AI', () => {
    const g = fresh(7);
    const before = traitsOf(world, 'RUS', g);
    const name = succeedLeader(world, g, 'RUS', 'health')!;
    const n = g.nations.RUS!;
    expect(n.leaderFictional).toBe(true);
    expect(n.leaderName).toBe(name);
    expect(n.leaderName).not.toBe('Vladimir Putin');
    expect(n.leaderTraits).not.toBeNull();
    expect(traitsOf(world, 'RUS', g)).toEqual(n.leaderTraits);
    expect(traitDistance(n.leaderTraits!, before)).toBeGreaterThanOrEqual(MIN_SUCCESSOR_DISTANCE);
    // The static data still holds the real leader; only this game's state changed.
    expect(traitsOf(world, 'RUS')).toEqual(world.leaders.get('RUS')!.traits);
    // A successor's successor is another new person.
    const second = structuredClone(n.leaderTraits!);
    succeedLeader(world, g, 'RUS', 'assassination');
    expect(traitDistance(g.nations.RUS!.leaderTraits!, second)).toBeGreaterThanOrEqual(MIN_SUCCESSOR_DISTANCE);
  });

  it('is deterministic for a given state', () => {
    const a = fresh(42);
    const b = fresh(42);
    succeedLeader(world, a, 'IND', 'resignation');
    succeedLeader(world, b, 'IND', 'resignation');
    expect(a.nations.IND!.leaderTraits).toEqual(b.nations.IND!.leaderTraits);
    expect(a.nations.IND!.leaderName).toBe(b.nations.IND!.leaderName);
  });

  it('elections bring the main opposition; coups bring the army; revolutions the opposition', () => {
    const g = fresh(3);
    expect(successorFaction(world, g, 'GBR', 'election')!.id).toBe('reform');
    expect(successorFaction(world, g, 'USA', 'election')!.id).toBe('dem');
    expect(successorFaction(world, g, 'USA', 'termLimit')!.id).toBe('gop');
    expect(successorFaction(world, g, 'PAK', 'coup')!.kind).toBe('military');
    expect(successorFaction(world, g, 'IRN', 'coup')!.id).toBe('irgc');
    const rev = successorFaction(world, g, 'BLR', 'revolution')!;
    expect(rev.id).not.toBe(world.factions.get('BLR')!.incumbent);
    expect(rev.kind).not.toBe('military');
    // The faction is recorded on the nation.
    succeedLeader(world, g, 'IRN', 'coup');
    expect(g.nations.IRN!.leaderFaction).toBe('irgc');
    expect(factionOf(world, 'IRN', g.nations.IRN!.leaderFaction)!.name).toMatch(/IRGC/);
  });

  it('coups and revolutions shift traits further than an orderly succession', () => {
    const hawk = (t: Traits) => t.aggression + t.paranoia - t.pragmatism - t.nuclearThreshold;
    let orderly = 0;
    let coup = 0;
    let revolution = 0;
    let shiftOrderly = 0;
    let shiftRegime = 0;
    let seed = 500;
    for (const iso of LED) {
      const g = fresh(seed++);
      const before = traitsOf(world, iso, g);
      const fOrderly = successorFaction(world, g, iso, 'health')!;
      const o = successorTraits(world, g, iso, fOrderly, 'health', before);
      const fCoup = successorFaction(world, g, iso, 'coup')!;
      const c = successorTraits(world, g, iso, fCoup, 'coup', before);
      const fRev = successorFaction(world, g, iso, 'revolution')!;
      const r = successorTraits(world, g, iso, fRev, 'revolution', before);
      orderly += hawk(o);
      coup += hawk(c);
      revolution += traitDistance(r, before);
      shiftOrderly += traitDistance(o, before);
      shiftRegime += traitDistance(c, before);
    }
    expect(coup / LED.length).toBeGreaterThan(orderly / LED.length + 20);
    expect(shiftRegime).toBeGreaterThan(shiftOrderly);
    expect(revolution).toBeGreaterThan(shiftOrderly);
  });

  it('a term-limited president is replaced in a full turn by a party successor with new traits', () => {
    let g = fresh(4);
    g.nations.USA!.nextElection = g.turn;
    g.nations.USA!.support = 80;
    const before = traitsOf(world, 'USA', g);
    g = applyCommand(world, g, { type: 'endTurn' });
    const n = g.nations.USA!;
    expect(n.leaderFictional).toBe(true);
    expect(n.leaderFaction).toBe('gop');
    const bounds = successorBounds(factionOf(world, 'USA', 'gop')!, 'termLimit');
    for (const k of TRAIT_KEYS) {
      expect(n.leaderTraits![k]).toBeGreaterThanOrEqual(bounds[k][0]);
      expect(n.leaderTraits![k]).toBeLessThanOrEqual(bounds[k][1]);
    }
    expect(traitDistance(n.leaderTraits!, before)).toBeGreaterThanOrEqual(MIN_SUCCESSOR_DISTANCE);
  });
});
