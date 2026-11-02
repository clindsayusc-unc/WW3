import { addMonths, isoYearMonth, type YearMonth } from './calendar';
import { nextFloat, seedRng } from './rng';
import type { Command, GameState } from './types';

/** Campaign starts January 2027 (docs/DESIGN.md "Fantasy"; D-013). */
export const START_DATE: YearMonth = { year: 2027, month: 1 };
/** One turn = one calendar month (docs/DESIGN.md "Core loop"; D-013). */
export const MONTHS_PER_TURN = 1;

export function dateForTurn(turn: number): YearMonth {
  return addMonths(START_DATE, turn * MONTHS_PER_TURN);
}

function withDate(turn: number): Pick<GameState, 'turn' | 'date' | 'isoDate'> {
  const date = dateForTurn(turn);
  return { turn, date, isoDate: isoYearMonth(date) };
}

export function createGame(seed: number): GameState {
  return { seed, rng: seedRng(seed), ...withDate(0) };
}

export function applyCommand(state: GameState, command: Command): GameState {
  switch (command.type) {
    case 'endTurn': {
      // Advance the RNG once per turn so later systems inherit a stable stream.
      const [, rng] = nextFloat(state.rng);
      return { ...state, rng, ...withDate(state.turn + 1) };
    }
  }
}
