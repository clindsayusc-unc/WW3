import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, dateForTurn } from './game';

describe('game', () => {
  it('starts at turn 0 on the campaign start date', () => {
    const g = createGame(123);
    expect(g.turn).toBe(0);
    expect(g.date).toBe('2027-01-01');
  });

  it('advances one week per turn', () => {
    const g = applyCommand(createGame(1), { type: 'endTurn' });
    expect(g.turn).toBe(1);
    expect(g.date).toBe('2027-01-08');
    expect(dateForTurn(52)).toBe('2027-12-31');
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
