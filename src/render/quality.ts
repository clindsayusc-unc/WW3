/** Quality presets, per-effect levels, dynamic resolution and the effect auto-scaler (D-040, D-055). */
import type { Quality } from '../state/uiStore';

export type Level = 'low' | 'medium' | 'high';
export const LEVELS: readonly Level[] = ['low', 'medium', 'high'];
export const LEVEL_INDEX: Record<Level, number> = { low: 0, medium: 1, high: 2 };

export type EffectKey = 'atmosphere' | 'ocean' | 'clouds' | 'terrain' | 'war';
export type EffectLevels = Record<EffectKey, Level>;

export interface EffectInfo {
  key: EffectKey;
  label: string;
  /** What each level does, for the settings tooltips. */
  levels: Record<Level, string>;
}

export const EFFECTS: readonly EffectInfo[] = [
  {
    key: 'atmosphere',
    label: 'Atmosphere',
    levels: {
      low: 'Scattering limb from the precomputed table; surface haze replaced by a cheap rim glow.',
      medium: 'Limb plus aerial perspective on the surface and clouds (2 table taps per pixel).',
      high: 'As medium, with sun-tinted ocean reflections and full cloud haze.',
    },
  },
  {
    key: 'ocean',
    label: 'Ocean',
    levels: {
      low: 'Flat water with depth tint and a single sun glint; no wave animation.',
      medium: 'One octave of animated wave normals, Fresnel sky reflection, soft glint.',
      high: 'Two wave octaves, sharper glint and sea-ice edge noise.',
    },
  },
  {
    key: 'clouds',
    label: 'Clouds',
    levels: {
      low: 'One cloud layer, no cloud shadows, no storm systems.',
      medium: 'Two cloud layers with parallax and shadows from the lower layer.',
      high: 'Two layers, both casting shadows, with procedural storm systems.',
    },
  },
  {
    key: 'terrain',
    label: 'Terrain',
    levels: {
      low: 'No height displacement; seasonal snow and sea ice tint only.',
      medium: 'Half-strength height exaggeration when zoomed in.',
      high: 'Full height exaggeration and stronger relief shading.',
    },
  },
  {
    key: 'war',
    label: 'War effects',
    levels: {
      low: 'Front lines, attack arrows and a few fire points; no smoke, no wakes.',
      medium: 'Smoke plumes and carrier wakes at half density; missile trails.',
      high: 'Full particle density, glowing front lines and interception bursts.',
    },
  },
];

export interface QualitySettings {
  maxDpr: number;
  minDpr: number;
  segments: number;
  anisotropy: number;
  postprocessing: boolean;
  stars: number;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: { maxDpr: 1, minDpr: 0.6, segments: 96, anisotropy: 2, postprocessing: false, stars: 1500 },
  medium: {
    maxDpr: 1.5,
    minDpr: 0.75,
    segments: 160,
    anisotropy: 4,
    postprocessing: true,
    stars: 3000,
  },
  high: { maxDpr: 2, minDpr: 0.9, segments: 256, anisotropy: 8, postprocessing: true, stars: 5000 },
};

export function levelsForPreset(q: Quality): EffectLevels {
  return { atmosphere: q, ocean: q, clouds: q, terrain: q, war: q };
}

/** Effective level index (0–2) after the auto-scaler cap. */
export function effectiveLevel(levels: EffectLevels, key: EffectKey, cap: number): number {
  return Math.min(LEVEL_INDEX[levels[key]], cap);
}

/** Returns the stored preset or `high` (the M3 default). */
export function loadQuality(): Quality {
  try {
    const q = localStorage.getItem('ww3.quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch {
    /* ignore */
  }
  return 'high';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem('ww3.quality', q);
  } catch {
    /* ignore */
  }
}

export function loadEffects(preset: Quality): EffectLevels {
  const base = levelsForPreset(preset);
  try {
    const raw = localStorage.getItem('ww3.effects');
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<string, string>>;
    for (const e of EFFECTS) {
      const v = parsed[e.key];
      if (v === 'low' || v === 'medium' || v === 'high') base[e.key] = v;
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function saveEffects(levels: EffectLevels): void {
  try {
    localStorage.setItem('ww3.effects', JSON.stringify(levels));
  } catch {
    /* ignore */
  }
}

export function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}
export function saveFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Frame-time governed DPR: scales down when frames exceed 18 ms, creeps back up when fast.
 * When the DPR floor is reached and frames are still slow, the effect cap steps down a level
 * (high → medium → low) and recovers only after a long quiet stretch.
 */
export class DynamicResolution {
  private ema = 16;
  private dpr: number;
  private cooldown = 0;
  private slowMs = 0;
  private fastMs = 0;
  private capCooldown = 0;
  /** 2 = no cap, 1 = medium at most, 0 = low. */
  cap = 2;
  /** `maxDpr` overrides the preset's maximum (the window's pixel-budget cap); `start` resumes
   * from the DPR settled on last session. */
  constructor(
    private settings: QualitySettings,
    start?: number,
  ) {
    this.dpr = Math.min(settings.maxDpr, start ?? settings.maxDpr);
  }
  get current(): number {
    return this.dpr;
  }
  /** Lowers or raises the ceiling (window resized); returns the new DPR if it had to change. */
  setMax(maxDpr: number): number | null {
    this.settings = { ...this.settings, maxDpr: Math.max(this.settings.minDpr, maxDpr) };
    if (this.dpr > this.settings.maxDpr + 1e-6) {
      this.dpr = this.settings.maxDpr;
      return this.dpr;
    }
    return null;
  }
  reset(settings: QualitySettings): void {
    this.settings = settings;
    this.dpr = settings.maxDpr;
    this.cap = 2;
    this.slowMs = this.fastMs = 0;
  }
  /** Feed a frame time (ms); returns a new DPR when it should change, else null. */
  update(frameMs: number): number | null {
    const ms = Math.min(100, frameMs);
    this.ema = this.ema * 0.9 + ms * 0.1;
    this.cooldown -= ms;
    this.capCooldown -= ms;
    const atFloor = this.dpr <= this.settings.minDpr + 1e-6;
    if (this.ema > 20 && atFloor) this.slowMs += ms;
    else this.slowMs = 0;
    if (this.ema < 11 && this.dpr >= this.settings.maxDpr - 1e-6) this.fastMs += ms;
    else this.fastMs = 0;
    if (this.capCooldown <= 0) {
      if (this.slowMs > 2500 && this.cap > 0) {
        this.cap--;
        this.slowMs = 0;
        this.capCooldown = 6000;
      } else if (this.fastMs > 15000 && this.cap < 2) {
        this.cap++;
        this.fastMs = 0;
        this.capCooldown = 10000;
      }
    }
    if (this.cooldown > 0) return null;
    if (this.ema > 18 && this.dpr > this.settings.minDpr) {
      this.dpr = Math.max(this.settings.minDpr, this.dpr - 0.1);
      this.cooldown = 800;
      return this.dpr;
    }
    if (this.ema < 12 && this.dpr < this.settings.maxDpr) {
      this.dpr = Math.min(this.settings.maxDpr, this.dpr + 0.05);
      this.cooldown = 1500;
      return this.dpr;
    }
    return null;
  }
  get frameMs(): number {
    return this.ema;
  }
}

/**
 * Pixel budget per preset (device pixels drawn per frame, D-082). The M3 baseline settled at
 * DPR 1.3 in a 1440 × 900 window (≈ 2.2 MP) on High; a Retina display at DPR 2 would be 5.2 MP,
 * most of it wasted on a globe that is soft by nature. The cap keeps the auto-scaler from
 * starting far above what it will settle on.
 */
export const PIXEL_BUDGET: Record<Quality, number> = { low: 1.2e6, medium: 2.2e6, high: 3.6e6 };

/**
 * Highest DPR worth rendering at for this window: the preset's maximum, the display's own DPR
 * and the pixel budget, whichever is lowest; never below the preset's floor (pure, tested).
 */
export function dprCap(
  quality: Quality,
  cssWidth: number,
  cssHeight: number,
  deviceDpr: number,
): number {
  const q = QUALITY[quality];
  const area = Math.max(1, cssWidth * cssHeight);
  const budget = Math.sqrt(PIXEL_BUDGET[quality] / area);
  const cap = Math.min(q.maxDpr, Math.max(1, deviceDpr), budget);
  return Math.round(Math.max(q.minDpr, cap) * 20) / 20;
}

/** The DPR the auto-scaler settled on last time, per preset, so a new session starts there. */
export function loadSettledDpr(quality: Quality): number | null {
  try {
    const v = Number(localStorage.getItem(`ww3.dpr.${quality}`));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
export function saveSettledDpr(quality: Quality, dpr: number): void {
  try {
    localStorage.setItem(`ww3.dpr.${quality}`, dpr.toFixed(2));
  } catch {
    /* ignore */
  }
}

/** Render cadence (D-082): full speed while the player interacts, slower when nothing happens. */
export type Cadence = 'full' | 'idle' | 'deepIdle' | 'covered' | 'hidden';

/** Target frame interval (ms) per cadence; 0 = every display frame, Infinity = no frames. */
export const CADENCE_MS: Record<Cadence, number> = {
  full: 0,
  idle: 1000 / 30,
  deepIdle: 1000 / 15,
  covered: 1000 / 20,
  hidden: Infinity,
};

/** Seconds without input before the globe drops to the idle and deep-idle cadences. */
export const IDLE_AFTER_S = 8;
export const DEEP_IDLE_AFTER_S = 60;

/** Which cadence applies (pure, tested). `busy` = camera moving or a strike animating. */
export function cadenceFor(o: {
  hidden: boolean;
  covered: boolean;
  busy: boolean;
  idleSeconds: number;
}): Cadence {
  if (o.hidden) return 'hidden';
  if (o.busy) return 'full';
  if (o.covered) return 'covered';
  if (o.idleSeconds >= DEEP_IDLE_AFTER_S) return 'deepIdle';
  if (o.idleSeconds >= IDLE_AFTER_S) return 'idle';
  return 'full';
}
