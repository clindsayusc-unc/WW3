/** Autosave to IndexedDB (idb-keyval, MIT) plus JSON export/import (D-041). */
import { del, get, keys, set } from 'idb-keyval';
import type { GameState } from '../sim/types';

const AUTOSAVE = 'ww3.autosave';
const PREFIX = 'ww3.save.';

export interface SaveMeta {
  key: string;
  name: string;
  player: string;
  isoDate: string;
  turn: number;
  savedAt: number;
}

export async function autosave(state: GameState): Promise<void> {
  try {
    await set(AUTOSAVE, { state, savedAt: Date.now() });
  } catch {
    /* storage unavailable */
  }
}

export async function loadAutosave(): Promise<{ state: GameState; savedAt: number } | null> {
  try {
    return ((await get(AUTOSAVE)) as { state: GameState; savedAt: number } | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveSlot(name: string, state: GameState): Promise<void> {
  await set(`${PREFIX}${name}`, { state, savedAt: Date.now() });
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const all = (await keys()) as string[];
    const out: SaveMeta[] = [];
    for (const k of all) {
      if (typeof k !== 'string' || (!k.startsWith(PREFIX) && k !== AUTOSAVE)) continue;
      const v = (await get(k)) as { state: GameState; savedAt: number } | undefined;
      if (!v) continue;
      out.push({
        key: k,
        name: k === AUTOSAVE ? 'Autosave' : k.slice(PREFIX.length),
        player: v.state.player,
        isoDate: v.state.isoDate,
        turn: v.state.turn,
        savedAt: v.savedAt,
      });
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadSlot(key: string): Promise<GameState | null> {
  const v = (await get(key)) as { state: GameState } | undefined;
  return v?.state ?? null;
}

export async function deleteSlot(key: string): Promise<void> {
  await del(key);
}

export function exportSave(state: GameState): void {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ww3-${state.player}-${state.isoDate}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSave(file: File): Promise<GameState> {
  return file.text().then((text) => {
    const parsed = JSON.parse(text) as GameState;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.nations ||
      !parsed.regions ||
      typeof parsed.turn !== 'number'
    )
      throw new Error('Not a World War 3 save file');
    return parsed;
  });
}
