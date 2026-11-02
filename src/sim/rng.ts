/**
 * Seeded PRNG (mulberry32). The only source of randomness permitted in src/sim.
 * State is a plain uint32 so it can be serialised into the game state.
 */
export type RngState = number;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Returns [value in [0,1), nextState]. Pure: never mutates. */
export function nextFloat(state: RngState): [number, RngState] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Integer in [min, max] inclusive. */
export function nextInt(state: RngState, min: number, max: number): [number, RngState] {
  const [f, s] = nextFloat(state);
  return [min + Math.floor(f * (max - min + 1)), s];
}
