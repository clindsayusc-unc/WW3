/** Procedural tileable wave normal map (256², generated at start-up, no asset needed) (D-054). */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import { noteTexture } from './perf';

const SIZE = 256;

/** Sum of a few directional sine waves plus a hash-based ripple term, made tileable by integer frequencies. */
export function makeWaveNormal(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const waves: [number, number, number, number][] = [
    // [kx, ky, amplitude, phase]
    [3, 1, 1.0, 0.3],
    [-2, 4, 0.8, 1.7],
    [5, -3, 0.5, 0.9],
    [7, 6, 0.35, 2.4],
    [-9, 2, 0.25, 0.1],
    [11, -8, 0.2, 1.1],
  ];
  // Tileable value noise on a grid of `cells` cells, hashed from the integer lattice.
  const hash = (ix: number, iy: number, cells: number): number => {
    let h = ((ix % cells) + cells) % cells;
    h = Math.imul(h ^ 0x27d4eb2d, 0x165667b1) + ((((iy % cells) + cells) % cells) + 1) * 0x9e3779b1;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number, cells: number): number => {
    const fx = x * cells;
    const fy = y * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const sx = fx - ix;
    const sy = fy - iy;
    const u = sx * sx * (3 - 2 * sx);
    const v = sy * sy * (3 - 2 * sy);
    const a = hash(ix, iy, cells);
    const b = hash(ix + 1, iy, cells);
    const c = hash(ix, iy + 1, cells);
    const d = hash(ix + 1, iy + 1, cells);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v - 0.5;
  };
  const height = (x: number, y: number): number => {
    let h = 0;
    for (const [kx, ky, a, p] of waves) h += a * Math.sin(2 * Math.PI * (kx * x + ky * y) + p);
    // choppy ripples: tileable because the frequencies are integers
    h +=
      0.3 * Math.sin(2 * Math.PI * (13 * x + 17 * y)) * Math.sin(2 * Math.PI * (-19 * x + 7 * y));
    // irregular swell so the tiling never reads as stripes
    h += 2.2 * noise(x, y, 6) + 1.1 * noise(x, y, 13) + 0.5 * noise(x, y, 29);
    return h;
  };
  const eps = 1 / SIZE;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const x = i / SIZE;
      const y = j / SIZE;
      const dx = (height(x + eps, y) - height(x - eps, y)) / (2 * eps);
      const dy = (height(x, y + eps) - height(x, y - eps)) / (2 * eps);
      // gradients are large (frequencies up to ~20); scale so the normal tilts a few degrees
      let nx = -dx * 0.004;
      let ny = -dy * 0.004;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (j * SIZE + i) * 4;
      data[k] = Math.round((nx * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  const t = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  noteTexture(SIZE, SIZE, true, 4, 'waves');
  return t;
}
