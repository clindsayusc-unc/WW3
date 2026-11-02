import { daysFromCivil, isoDate } from './calendar';
import { nextFloat, seedRng } from './rng';
import type { Command, GameState } from './types';

/** Campaign start date (placeholder until the scenario data lands). */
export const START_DATE = { year: 2027, month: 1 } as const;
/** One turn = one week (see docs/DECISIONS.md). */
export const DAYS_PER_TURN = 7;

export function dateForTurn(turn: number): string {
  return isoDate(daysFromCivil(START_DATE.year, START_DATE.month, 1) + turn * DAYS_PER_TURN);
}

export function createGame(seed: number): GameState {
  return { seed, rng: seedRng(seed), turn: 0, date: dateForTurn(0) };
}

export function applyCommand(state: GameState, command: Command): GameState {
  switch (command.type) {
    case 'endTurn': {
      // Advance the RNG once per turn so later systems inherit a stable stream.
      const [, rng] = nextFloat(state.rng);
      const turn = state.turn + 1;
      return { ...state, rng, turn, date: dateForTurn(turn) };
    }
  }
}
