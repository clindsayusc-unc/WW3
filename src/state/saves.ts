/**
 * Saves (D-041, D-083). In the native app (Tauri) every save is a JSON file in the app data
 * folder (`~/Library/Application Support/game.ww3.worldwar3/saves` on macOS); in a browser they
 * live in IndexedDB (idb-keyval, MIT). JSON export/import works in both.
 */
import { del, get, keys, set } from 'idb-keyval';
import type { GameState } from '../sim/types';
import { isNative, nativeInvoke } from './native';

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

/** File stem for a save key in the native saves folder ("autosave", "save.My game"). */
export function fileStem(key: string): string {
  return key.startsWith('ww3.') ? key.slice(4) : key;
}

function metaFor(key: string, state: GameState, savedAt: number): SaveMeta {
  return {
    key,
    name: key === AUTOSAVE ? 'Autosave' : key.slice(PREFIX.length),
    player: state.player,
    isoDate: state.isoDate,
    turn: state.turn,
    savedAt,
  };
}

async function write(key: string, state: GameState): Promise<void> {
  const savedAt = Date.now();
  if (isNative()) {
    await nativeInvoke('save_write', {
      name: fileStem(key),
      data: JSON.stringify({ state, savedAt }),
      meta: JSON.stringify(metaFor(key, state, savedAt)),
    });
  } else await set(key, { state, savedAt });
}

async function read(key: string): Promise<{ state: GameState; savedAt: number } | null> {
  if (isNative()) {
    const raw = await nativeInvoke<string | null>('save_read', { name: fileStem(key) });
    return raw ? (JSON.parse(raw) as { state: GameState; savedAt: number }) : null;
  }
  return ((await get(key)) as { state: GameState; savedAt: number } | undefined) ?? null;
}

/**
 * Autosave after a state change. Debounced: orders arrive in bursts and each write serialises
 * the whole state (≈ 1–2 MB), so only the last state of a burst is written.
 */
let pending: GameState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
export const AUTOSAVE_DELAY_MS = 1500;
export function autosave(state: GameState): Promise<void> {
  pending = state;
  if (timer) clearTimeout(timer);
  return new Promise((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      const s = pending;
      pending = null;
      if (!s) return resolve();
      write(AUTOSAVE, s)
        .catch(() => undefined /* storage unavailable */)
        .finally(resolve);
    }, AUTOSAVE_DELAY_MS);
  });
}

export async function loadAutosave(): Promise<{ state: GameState; savedAt: number } | null> {
  try {
    return await read(AUTOSAVE);
  } catch {
    return null;
  }
}

export async function saveSlot(name: string, state: GameState): Promise<void> {
  await write(`${PREFIX}${name}`, state);
}

export async function listSaves(): Promise<SaveMeta[]> {
  try {
    if (isNative()) {
      const metas = await nativeInvoke<string[]>('save_list');
      return metas
        .map((m) => {
          try {
            return JSON.parse(m) as SaveMeta;
          } catch {
            return null;
          }
        })
        .filter((m): m is SaveMeta => !!m && typeof m.key === 'string')
        .sort((a, b) => b.savedAt - a.savedAt);
    }
    const all = (await keys()) as string[];
    const out: SaveMeta[] = [];
    for (const k of all) {
      if (typeof k !== 'string' || (!k.startsWith(PREFIX) && k !== AUTOSAVE)) continue;
      const v = (await get(k)) as { state: GameState; savedAt: number } | undefined;
      if (!v) continue;
      out.push(metaFor(k, v.state, v.savedAt));
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadSlot(key: string): Promise<GameState | null> {
  return (await read(key))?.state ?? null;
}

export async function deleteSlot(key: string): Promise<void> {
  if (isNative()) await nativeInvoke('save_delete', { name: fileStem(key) });
  else await del(key);
}

/** Where saves are kept, for the Settings screen (null in a browser). */
export async function savesLocation(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    return await nativeInvoke<string>('saves_path');
  } catch {
    return null;
  }
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
