/** Quality presets and dynamic resolution scaling (D-040). */
import type { Quality } from '../state/uiStore';

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

/** Frame-time governed DPR: scales down when frames exceed 18 ms, creeps back up when fast. */
export class DynamicResolution {
  private ema = 16;
  private dpr: number;
  private cooldown = 0;
  constructor(private settings: QualitySettings) {
    this.dpr = settings.maxDpr;
  }
  reset(settings: QualitySettings): void {
    this.settings = settings;
    this.dpr = settings.maxDpr;
  }
  /** Feed a frame time (ms); returns a new DPR when it should change, else null. */
  update(frameMs: number): number | null {
    this.ema = this.ema * 0.9 + Math.min(100, frameMs) * 0.1;
    this.cooldown -= frameMs;
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
