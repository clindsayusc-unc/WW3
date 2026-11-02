/** CPU copy of the height map so lines and sprites can follow the displaced terrain (D-054). */
import { terrainDisplacement } from './displacement';

export interface HeightMap {
  width: number;
  height: number;
  data: Uint8Array;
}

let promise: Promise<HeightMap> | null = null;

export function loadHeightMap(url = '/textures/earth-height.jpg'): Promise<HeightMap> {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('2D context unavailable'));
      ctx.drawImage(img, 0, 0);
      const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
      const data = new Uint8Array(img.width * img.height);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]!;
      resolve({ width: img.width, height: img.height, data });
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
  return promise;
}

/** Normalised height 0..1 (≈ 0..9 km) at a lat/lon, bilinear. */
export function heightAt(map: HeightMap, lat: number, lon: number): number {
  const fx = (((lon + 180) / 360) * map.width + map.width) % map.width;
  const fy = Math.min(map.height - 1, Math.max(0, ((90 - lat) / 180) * map.height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % map.width;
  const y1 = Math.min(map.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = map.data[y0 * map.width + x0]! * (1 - tx) + map.data[y0 * map.width + x1]! * tx;
  const b = map.data[y1 * map.width + x0]! * (1 - tx) + map.data[y1 * map.width + x1]! * tx;
  return (a * (1 - ty) + b * ty) / 255;
}

/** Radius for a surface point lifted `lift` above the (possibly displaced) terrain. */
export function surfaceRadius(
  map: HeightMap | null,
  lat: number,
  lon: number,
  lift: number,
  cameraDistance: number,
  terrainLevel: number,
): number {
  const d = terrainDisplacement(cameraDistance, terrainLevel);
  if (!map || d <= 0) return 1 + lift;
  return 1 + heightAt(map, lat, lon) * d + lift;
}

let current: HeightMap | null = null;
/** The height map once loaded by the scene; null until then (lines then sit on the sphere). */
export function getHeightMap(): HeightMap | null {
  return current;
}
export function setHeightMap(map: HeightMap): void {
  current = map;
}
