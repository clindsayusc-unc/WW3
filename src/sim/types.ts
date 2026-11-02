import type { YearMonth } from './calendar';
import type { RngState } from './rng';

/** Complete, serialisable simulation state. Must be structured-clone safe. */
export interface GameState {
  readonly seed: number;
  readonly rng: RngState;
  /** Turn index, starting at 0. */
  readonly turn: number;
  /** In-game month, derived from turn — never from the wall clock. */
  readonly date: YearMonth;
  /** Same month as ISO-8601 "yyyy-mm", for logs, saves and tests. */
  readonly isoDate: string;
}

export type Command = { readonly type: 'endTurn' };

export type WorkerRequest =
  | { readonly kind: 'init'; readonly seed: number }
  | { readonly kind: 'command'; readonly command: Command };

export type WorkerResponse =
  | { readonly kind: 'state'; readonly state: GameState }
  | { readonly kind: 'error'; readonly message: string };
