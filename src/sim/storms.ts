/**
 * Procedural storm systems (D-054). Deterministic per (seed, turn): the renderer draws them as
 * spiralling cloud masses and the simulation can read `stormAt()` to penalise air operations.
 * Cosmetic for now — nothing in combat reads it yet; `weatherAirFactor` is the natural hook.
 */
import { nextFloat, seedRng, type RngState } from './rng';

export interface Storm {
  /** Centre, degrees. */
  readonly lat: number;
  readonly lon: number;
  /** Radius of the cloud mass, degrees of arc. */
  readonly radiusDeg: number;
  /** 0..1 — peak cloud density / wind strength. */
  readonly intensity: number;
  /** Drift over the month, degrees. */
  readonly driftLat: number;
  readonly driftLon: number;
  /** +1 counter-clockwise (northern hemisphere), −1 clockwise. */
  readonly spin: 1 | -1;
  /** 'cyclone' = tropical system, 'low' = mid-latitude depression. */
  readonly kind: 'cyclone' | 'low';
}

interface Basin {
  readonly name: string;
  readonly lat: [number, number];
  readonly lon: [number, number];
  /** Activity weight per month (January first). */
  readonly season: readonly number[];
  readonly kind: Storm['kind'];
  readonly driftLon: number;
}

const TROPICAL = (peak: number[]): number[] => {
  const s = new Array<number>(12).fill(0.05);
  for (const m of peak) s[m] = 1;
  return s;
};

/** Cyclone basins (NOAA/JTWC climatology, simplified to peak months) and year-round mid-latitude lows. */
const BASINS: readonly Basin[] = [
  {
    name: 'West Pacific',
    lat: [8, 28],
    lon: [120, 160],
    season: TROPICAL([6, 7, 8, 9, 10]),
    kind: 'cyclone',
    driftLon: -4,
  },
  {
    name: 'East Pacific',
    lat: [8, 22],
    lon: [-130, -95],
    season: TROPICAL([5, 6, 7, 8, 9]),
    kind: 'cyclone',
    driftLon: -5,
  },
  {
    name: 'North Atlantic',
    lat: [10, 32],
    lon: [-80, -30],
    season: TROPICAL([7, 8, 9]),
    kind: 'cyclone',
    driftLon: -5,
  },
  {
    name: 'North Indian',
    lat: [8, 20],
    lon: [60, 95],
    season: TROPICAL([4, 9, 10]),
    kind: 'cyclone',
    driftLon: -2,
  },
  {
    name: 'South Indian',
    lat: [-25, -10],
    lon: [40, 100],
    season: TROPICAL([0, 1, 2]),
    kind: 'cyclone',
    driftLon: -3,
  },
  {
    name: 'South Pacific',
    lat: [-25, -10],
    lon: [150, -170],
    season: TROPICAL([0, 1, 2]),
    kind: 'cyclone',
    driftLon: 3,
  },
  {
    name: 'North Atlantic lows',
    lat: [45, 62],
    lon: [-50, -5],
    season: new Array<number>(12).fill(0.6),
    kind: 'low',
    driftLon: 8,
  },
  {
    name: 'North Pacific lows',
    lat: [40, 58],
    lon: [150, -150],
    season: new Array<number>(12).fill(0.6),
    kind: 'low',
    driftLon: 8,
  },
  {
    name: 'Southern Ocean lows',
    lat: [-62, -45],
    lon: [-180, 180],
    season: new Array<number>(12).fill(0.8),
    kind: 'low',
    driftLon: 9,
  },
];

export const MAX_STORMS = 8;

function hashSeed(seed: number, turn: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ ((turn + 1) * 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Storm systems for a given month. Pure and deterministic. */
export function generateStorms(seed: number, turn: number, month: number): Storm[] {
  let rng: RngState = seedRng(hashSeed(seed, turn));
  const roll = (): number => {
    const [v, s] = nextFloat(rng);
    rng = s;
    return v;
  };
  const m = (((month - 1) % 12) + 12) % 12;
  const storms: Storm[] = [];
  for (const b of BASINS) {
    if (storms.length >= MAX_STORMS) break;
    const w = b.season[m] ?? 0;
    if (roll() > w) continue;
    const lat = b.lat[0] + roll() * (b.lat[1] - b.lat[0]);
    const lonSpan = (b.lon[1] - b.lon[0] + 360) % 360 || 360;
    let lon = b.lon[0] + roll() * lonSpan;
    lon = ((lon + 540) % 360) - 180;
    const cyclone = b.kind === 'cyclone';
    const spin: 1 | -1 = lat >= 0 ? 1 : -1;
    storms.push({
      lat: Math.round(lat * 10) / 10,
      lon: Math.round(lon * 10) / 10,
      radiusDeg: cyclone ? 4 + roll() * 5 : 8 + roll() * 7,
      intensity: cyclone ? 0.6 + roll() * 0.4 : 0.35 + roll() * 0.4,
      driftLat: (cyclone ? 1.5 + roll() * 3 : roll() * 2 - 1) * (lat >= 0 ? 1 : -1),
      driftLon: b.driftLon + (roll() - 0.5) * 3,
      spin,
      kind: b.kind,
    });
  }
  return storms;
}

const D2R = Math.PI / 180;
function angularDistanceDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const a1 = aLat * D2R,
    b1 = bLat * D2R;
  const d =
    Math.sin(a1) * Math.sin(b1) + Math.cos(a1) * Math.cos(b1) * Math.cos((aLon - bLon) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, d))) / D2R;
}

/**
 * Storm intensity (0..1) at a point for a month fraction `t` (0 = start of month, 1 = end).
 * The hook for air operations: multiply `weatherAirFactor` by `1 - 0.5 * stormAt(...)`.
 */
export function stormAt(storms: readonly Storm[], lat: number, lon: number, t = 0): number {
  let best = 0;
  for (const s of storms) {
    const d = angularDistanceDeg(lat, lon, s.lat + s.driftLat * t, s.lon + s.driftLon * t);
    const x = d / s.radiusDeg;
    if (x >= 1) continue;
    best = Math.max(best, s.intensity * (1 - x * x));
  }
  return best;
}
