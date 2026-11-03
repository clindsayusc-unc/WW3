import { describe, expect, it } from 'vitest';
import {
  CADENCE_MS,
  DynamicResolution,
  PIXEL_BUDGET,
  QUALITY,
  cadenceFor,
  dprCap,
} from './quality';

describe('adaptive DPR cap (D-082)', () => {
  it('never exceeds the display, the preset or the pixel budget', () => {
    // 1440 × 900 Retina window on High: budget 3.6 MP → √(3.6e6 / 1.296e6) ≈ 1.67.
    const cap = dprCap('high', 1440, 900, 2);
    expect(cap).toBeLessThanOrEqual(QUALITY.high.maxDpr);
    expect(cap * cap * 1440 * 900).toBeLessThanOrEqual(PIXEL_BUDGET.high * 1.06);
    expect(cap).toBeCloseTo(1.65, 2);
    // A non-Retina display never renders above its own DPR.
    expect(dprCap('high', 1280, 800, 1)).toBe(1);
  });
  it('stays at or above the preset floor on huge windows', () => {
    expect(dprCap('low', 5120, 2880, 2)).toBe(QUALITY.low.minDpr);
    expect(dprCap('medium', 3840, 2160, 2)).toBeGreaterThanOrEqual(QUALITY.medium.minDpr);
  });
  it('the governor starts from the settled DPR and honours a lowered ceiling', () => {
    const d = new DynamicResolution(QUALITY.high, 1.3);
    expect(d.current).toBe(1.3);
    expect(d.setMax(1.1)).toBe(1.1);
    expect(d.setMax(1.5)).toBeNull();
    // Fast frames creep back up, but not above the new ceiling.
    for (let i = 0; i < 2000; i++) d.update(6);
    expect(d.current).toBeLessThanOrEqual(1.5 + 1e-9);
  });
});

describe('render cadence (D-082)', () => {
  const base = { hidden: false, covered: false, busy: false, idleSeconds: 0 };
  it('renders nothing while hidden, even if something animates', () => {
    expect(cadenceFor({ ...base, hidden: true, busy: true })).toBe('hidden');
    expect(CADENCE_MS.hidden).toBe(Infinity);
  });
  it('keeps full rate while the camera or a strike moves', () => {
    expect(cadenceFor({ ...base, busy: true, covered: true, idleSeconds: 999 })).toBe('full');
  });
  it('slows under a modal and after idling', () => {
    expect(cadenceFor({ ...base, covered: true })).toBe('covered');
    expect(cadenceFor({ ...base, idleSeconds: 3 })).toBe('full');
    expect(cadenceFor({ ...base, idleSeconds: 9 })).toBe('idle');
    expect(cadenceFor({ ...base, idleSeconds: 61 })).toBe('deepIdle');
    expect(CADENCE_MS.idle).toBeLessThan(CADENCE_MS.deepIdle);
  });
});
