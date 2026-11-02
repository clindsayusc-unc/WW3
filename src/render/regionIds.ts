/**
 * Loads the region-ID map (public/textures/regions-id.png, RG8 ids + B land flag) into a
 * CPU-side Uint16Array for picking and a GPU DataTexture for the globe shader (D-034).
 */
import { DataTexture, LinearFilter, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';
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
      for (let i = 0; i < ids.length; i++) ids[i] = data[i * 4]! | (data[i * 4 + 1]! << 8);
      const texture = new DataTexture(
        new Uint8Array(data.buffer),
        img.width,
        img.height,
        RGBAFormat,
        UnsignedByteType,
      );
      texture.magFilter = NearestFilter;
      texture.minFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = true;
      texture.needsUpdate = true;
      noteTexture(img.width, img.height, false);
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

export { LinearFilter };
