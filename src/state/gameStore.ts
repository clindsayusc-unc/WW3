import { create } from 'zustand';
import type { GameState } from '../sim/types';

interface GameStore {
  game: GameState | null;
  error: string | null;
  setGame: (game: GameState) => void;
  setError: (message: string) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  game: null,
  error: null,
  setGame: (game) => set({ game, error: null }),
  setError: (error) => set({ error }),
}));
