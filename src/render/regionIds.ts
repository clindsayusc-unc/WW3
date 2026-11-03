/**
 * Loads the region-ID map (public/textures/regions-id.png, RG8 ids + B land flag) into a
 * CPU-side Uint16Array for picking and a GPU DataTexture for the globe shader (D-034).
 */
import {
  DataTexture,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
} from 'three';
import { noteTexture } from './perf';

export interface RegionIdMap {
  width: number;
  height: number;
  ids: Uint16Array;
  texture: DataTexture;
}

let promise: Promise<RegionIdMap> | null = null;

export function loadRegionIdMap(url = '/textures/regions-id.png'): Promise<RegionIdMap> {
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
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const ids = new Uint16Array(img.width * img.height);
      // GPU copy packed into two bytes per texel (D-082): R = id low byte, G = id high byte with
      // the land flag in bit 7 (ids stay below 2,048). Half the memory of the RGBA upload.
      const packed = new Uint8Array(img.width * img.height * 2);
      for (let i = 0; i < ids.length; i++) {
        const lo = data[i * 4]!;
        const hi = data[i * 4 + 1]!;
        ids[i] = lo | (hi << 8);
        packed[i * 2] = lo;
        packed[i * 2 + 1] = hi | (data[i * 4 + 2]! > 127 ? 128 : 0);
      }
      const texture = new DataTexture(packed, img.width, img.height, RGFormat, UnsignedByteType);
      texture.unpackAlignment = 2;
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = true;
      texture.needsUpdate = true;
      noteTexture(img.width, img.height, false, 2, 'regions-id');
      resolve({ width: img.width, height: img.height, ids, texture });
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
  return promise;
}

export function regionAt(map: RegionIdMap, lat: number, lon: number): number {
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * map.width)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * map.height)));
  return map.ids[y * map.width + x] ?? 0;
}

export const PALETTE_SIZE = 2048;

/** Palette texture: one RGBA texel per region id (fill colour + alpha). */
export function createPalette(): { texture: DataTexture; data: Uint8Array } {
  const data = new Uint8Array(PALETTE_SIZE * 4);
  const texture = new DataTexture(data, PALETTE_SIZE, 1, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, data };
}

/** Country-index texture: RG = 16-bit nation index per region id, used for thick country borders. */
export function createCountryIndex(): { texture: DataTexture; data: Uint8Array } {
  const data = new Uint8Array(PALETTE_SIZE * 4);
  const texture = new DataTexture(data, PALETTE_SIZE, 1, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, data };
}

/** Region attribute texture: R = devastation, G = burning, B = at war, per region id (D-057). */
export function createRegionAttr(): { texture: DataTexture; data: Uint8Array } {
  return createCountryIndex();
}

export { LinearFilter };
