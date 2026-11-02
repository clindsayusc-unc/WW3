import { create } from 'zustand';
import type { GameState } from '../sim/types';

interface GameStore {
  game: GameState | null;
  /** Previous state, kept one step for movement/strike animations. */
  previous: GameState | null;
  error: string | null;
  busy: boolean;
  lastTurnMs: number;
  setGame: (game: GameState, ms: number) => void;
  setError: (message: string) => void;
  setBusy: (busy: boolean) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  previous: null,
  error: null,
  busy: false,
  lastTurnMs: 0,
  setGame: (game, ms) =>
    set({ game, previous: get().game, error: null, busy: false, lastTurnMs: ms }),
  setError: (error) => set({ error, busy: false }),
  setBusy: (busy) => set({ busy }),
  reset: () => set({ game: null, previous: null, error: null, busy: false }),
}));
