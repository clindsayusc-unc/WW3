/**
 * Readability and onboarding preferences (D-080), persisted in localStorage (`ww3.prefs`).
 * Pure parsing lives here so it can be unit-tested; the store holds the live values.
 */
export type PaletteMode = 'default' | 'colourblind';

export interface UiPrefs {
  /** Multiplies every UI size (text, spacing, panels): 0.85–1.5. */
  uiScale: number;
  /** Map and UI state colours: default, or Okabe–Ito colourblind-safe ramps. */
  palette: PaletteMode;
  /** Ask before irreversible actions (war, strikes, operations, leaving a bloc …). */
  confirmIrreversible: boolean;
  /** Show the advisor's recommendations each turn. */
  advisor: boolean;
  /** Tutorial finished or dismissed (it is offered again from the main menu). */
  tutorialDone: boolean;
}

export const PREFS_KEY = 'ww3.prefs';
export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.5;
export const DEFAULT_PREFS: UiPrefs = {
  uiScale: 1,
  palette: 'default',
  confirmIrreversible: true,
  advisor: true,
  tutorialDone: false,
};

export function clampScale(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n)) * 100) / 100;
}

export function parsePrefs(raw: string | null): UiPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const o = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      uiScale: clampScale(o.uiScale),
      palette: o.palette === 'colourblind' ? 'colourblind' : 'default',
      confirmIrreversible: o.confirmIrreversible !== false,
      advisor: o.advisor !== false,
      tutorialDone: o.tutorialDone === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function loadPrefs(): UiPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: UiPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Private mode or blocked storage: preferences last for this session only.
  }
}
