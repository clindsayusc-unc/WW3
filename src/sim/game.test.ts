import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, dateForTurn } from './game';

describe('game', () => {
  it('starts at turn 0 in January 2027', () => {
    const g = createGame(123);
    expect(g.turn).toBe(0);
    expect(g.date).toEqual({ year: 2027, month: 1 });
    expect(g.isoDate).toBe('2027-01');
  });

  it('advances one calendar month per turn', () => {
    const g = applyCommand(createGame(1), { type: 'endTurn' });
    expect(g.turn).toBe(1);
    expect(g.isoDate).toBe('2027-02');
    expect(dateForTurn(11)).toEqual({ year: 2027, month: 12 });
    expect(dateForTurn(12)).toEqual({ year: 2028, month: 1 });
  });

  it('reaches the 2040 Deterrence horizon after 156 turns', () => {
    expect(dateForTurn(156)).toEqual({ year: 2040, month: 1 });
  });

  it('does not mutate the input state', () => {
    const g = createGame(5);
    const snapshot = structuredClone(g);
    applyCommand(g, { type: 'endTurn' });
    expect(g).toEqual(snapshot);
  });

  it('replays identically from the same seed', () => {
    const play = (seed: number) => {
      let g = createGame(seed);
      for (let i = 0; i < 50; i++) g = applyCommand(g, { type: 'endTurn' });
      return g;
    };
    expect(play(99)).toEqual(play(99));
    expect(play(99).rng).not.toBe(play(100).rng);
  });
});
