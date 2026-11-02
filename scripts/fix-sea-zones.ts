/**
 * scripts/fix-sea-zones.ts — gives enclosed and marginal seas their own correctly named sea zones
 * (D-058, fixes the naming problem noted in D-052).
 *
 *   node --import tsx scripts/fix-sea-zones.ts
 *
 * The k-means zones of build-map.ts ignore coastlines, so the Persian Gulf, Red Sea, Black Sea,
 * Baltic and the like were absorbed by the nearest open-ocean cell and named after it. This
 * post-process reads the region-ID raster, flood-fills each listed sea from seed points inside a
 * bounding polygon (so a fill can never leak past a strait the raster does not resolve), gives it a
 * new zone id, folds leftovers smaller than MIN_PIXELS into the neighbouring open-ocean zone with the
 * longest shared edge, renumbers the sea zones compactly, recomputes centroids, areas and
 * adjacency (raster + hand-listed straits), renames the remaining open-ocean zones by basin, and
 * re-resolves the chokepoints' sea zones. Deterministic; safe to re-run (seas already carved keep
 * their shape).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CHOKEPOINTS } from './geo/handData';

const ROOT = process.cwd();
const ID_PNG = join(ROOT, 'public', 'textures', 'regions-id.png');
const META = join(ROOT, 'data', 'regions.meta.json');
const CHOKE = join(ROOT, 'data', 'chokepoints.json');
const MIN_PIXELS = 400;

type LatLon = [number, number];
interface SeaDef {
  name: string;
  seeds: LatLon[];
  polygon: LatLon[];
  /** Longitudes given in 0..360 (polygon crosses the antimeridian). */
  wrap?: boolean;
}

/** Enclosed and marginal seas, with a polygon that stops at the connecting strait. */
const SEAS: SeaDef[] = [
  {
    name: 'Persian Gulf',
    seeds: [[26.5, 52]],
    polygon: [
      [30.6, 47.5],
      [30.6, 50.5],
      [27.5, 56.4],
      [26.6, 56.6],
      [25.8, 56.3],
      [24, 54.5],
      [23.8, 51.2],
      [25.5, 49.5],
      [27.8, 48],
    ],
  },
  {
    name: 'Gulf of Oman',
    seeds: [[24.5, 59]],
    polygon: [
      [25.8, 56.3],
      [26.6, 56.6],
      [27.5, 56.4],
      [27.8, 57.3],
      [26, 62],
      [25.2, 61.6],
      [22.4, 59.9],
      [22.6, 58.5],
      [24.5, 56.6],
    ],
  },
  {
    name: 'Red Sea',
    seeds: [
      [20, 38],
      [29, 32.8],
      [28.5, 34.6],
    ],
    polygon: [
      [30.2, 32.2],
      [30.2, 33],
      [28.2, 34.3],
      [29.6, 34.7],
      [29.6, 35.2],
      [27.5, 35.5],
      [20, 41.5],
      [15, 43.5],
      [12.4, 43.6],
      [12.4, 43.0],
      [13.5, 41.5],
      [16, 39],
      [20, 36.5],
      [24, 34],
      [27, 33],
      [29, 32.2],
    ],
  },
  {
    name: 'Gulf of Aden',
    seeds: [[12.5, 47]],
    polygon: [
      [12.4, 43.0],
      [12.4, 43.6],
      [13, 45],
      [14.5, 51],
      [11.8, 51.5],
      [11, 50.5],
      [10.5, 45],
      [11.5, 43.3],
    ],
  },
  {
    name: 'Black Sea',
    seeds: [
      [43, 34],
      [46, 36.5],
    ],
    polygon: [
      [41, 27.8],
      [41.3, 29.3],
      [42.5, 41.8],
      [47.5, 40],
      [47.5, 33],
      [45, 28],
    ],
  },
  {
    name: 'Caspian Sea',
    seeds: [
      [41, 51],
      [45.5, 48],
    ],
    polygon: [
      [47.5, 45],
      [47.5, 54],
      [44, 55],
      [36.5, 54.5],
      [36.5, 48.5],
      [40, 47],
      [44, 46],
    ],
  },
  {
    name: 'Baltic Sea',
    seeds: [
      [58, 20],
      [57, 11.5],
      [64, 22],
      [60, 26],
    ],
    polygon: [
      [53.5, 10],
      [53.5, 21],
      [59, 32],
      [61, 30],
      [66, 25],
      [66, 19],
      [61, 17],
      [59, 11],
      [57, 10.5],
      [55.5, 9.5],
    ],
  },
  {
    name: 'North Sea',
    seeds: [
      [56, 3],
      [58, 9.5],
    ],
    polygon: [
      [51, 1.5],
      [51, 2.5],
      [53.5, 4.5],
      [57.2, 8.2],
      [57.3, 10.9],
      [59.2, 11.3],
      [61, 5],
      [61, -1],
      [58.7, -3.5],
      [57.5, -4],
      [56, -3.2],
      [54.5, -1.5],
      [53, 0],
      [51.5, 1.3],
    ],
  },
  {
    name: 'Western Mediterranean',
    seeds: [
      [38, 4],
      [36, -3],
      [43, 4.5],
    ],
    polygon: [
      [36.1, -5.6],
      [35.6, -5.6],
      [35.3, -1],
      [36.9, 10.3],
      [37.1, 11.05],
      [37.8, 12.45],
      [38.4, 12.0],
      [39, 9.7],
      [41, 9.8],
      [43, 9.5],
      [43.5, 10.2],
      [44.6, 9.5],
      [44.6, 7],
      [43.5, 4],
      [43.5, 3],
      [42, 2.5],
      [40.5, -0.5],
      [38.5, -1.5],
      [36.8, -4],
    ],
  },
  {
    name: 'Tyrrhenian Sea',
    seeds: [[40, 12.5]],
    polygon: [
      [38, 12.4],
      [38.3, 15.6],
      [39.5, 16.2],
      [41.5, 13],
      [43.5, 10.2],
      [43, 9.5],
      [41, 9.8],
      [39, 9.7],
      [38.4, 12],
    ],
  },
  {
    name: 'Adriatic Sea',
    seeds: [[43, 15]],
    polygon: [
      [40, 18.5],
      [39.8, 19.3],
      [40.5, 20.2],
      [41.5, 19.9],
      [45.8, 13.8],
      [45.7, 12],
      [43.5, 12.5],
      [41.5, 15.8],
      [40.6, 18.0],
    ],
  },
  {
    name: 'Ionian Sea',
    seeds: [
      [37.5, 18.5],
      [33, 16],
    ],
    polygon: [
      [37.1, 11.05],
      [36.9, 10.3],
      [33.5, 10.3],
      [30.2, 15],
      [30.2, 19.0],
      [34.6, 19.0],
      [34.6, 23.8],
      [35.0, 22.9],
      [36, 23.5],
      [38, 22.5],
      [39, 20.5],
      [39.8, 19.3],
      [40, 18.5],
      [40.6, 18.0],
      [40.6, 16.8],
      [39.5, 17],
      [38.3, 15.6],
      [37.5, 15.2],
      [36.5, 15],
      [37.8, 12.45],
    ],
  },
  {
    name: 'Aegean Sea',
    seeds: [
      [38.5, 25],
      [40.7, 28.0],
      [40.3, 23.5],
    ],
    polygon: [
      [34.5, 23.0],
      [34.5, 27.0],
      [36.0, 28.6],
      [36.9, 28.6],
      [37.6, 27.8],
      [38.6, 27.5],
      [39.4, 27.2],
      [40.1, 26.6],
      [40.3, 27.0],
      [40.4, 29.5],
      [41.3, 29.5],
      [41.2, 27.8],
      [40.8, 26.2],
      [41.2, 25.0],
      [41.2, 23.0],
      [40.3, 22.5],
      [38.5, 22.5],
      [37.0, 22.6],
      [36.0, 22.8],
    ],
  },
  {
    name: 'Levantine Sea',
    seeds: [[33.5, 30]],
    polygon: [
      [30.2, 19.0],
      [30.2, 34.5],
      [33.5, 36.2],
      [36.9, 36.2],
      [36.9, 28.6],
      [36.0, 28.6],
      [35.0, 27.0],
      [34.6, 23.8],
      [34.6, 19.0],
    ],
  },
  {
    name: 'Yellow Sea',
    seeds: [
      [36, 123],
      [38.5, 120],
    ],
    polygon: [
      [31.4, 121.5],
      [31.4, 122.3],
      [33.4, 126.4],
      [35.5, 126.8],
      [38, 125.8],
      [39.8, 125.0],
      [41, 122.5],
      [41, 119],
      [37.2, 117.5],
      [34, 119.5],
      [32.2, 120.5],
    ],
  },
  {
    name: 'Taiwan Strait',
    seeds: [[24.5, 119.3]],
    polygon: [
      [26.3, 119.2],
      [26.0, 121.2],
      [25.2, 121.8],
      [22, 121.0],
      [21.6, 120.6],
      [22.5, 118.5],
      [24.2, 117.8],
    ],
  },
  {
    name: 'East China Sea',
    seeds: [[28.5, 125]],
    polygon: [
      [25.2, 121.8],
      [26.0, 121.2],
      [26.3, 119.2],
      [28.0, 120.5],
      [30.0, 121.5],
      [31.4, 121.5],
      [31.4, 122.3],
      [33.4, 126.4],
      [33.0, 128.8],
      [31, 130],
      [28.5, 129.5],
      [26.5, 127.5],
      [24.5, 123.5],
      [24.8, 122.2],
    ],
  },
  {
    name: 'Sea of Japan',
    seeds: [[40, 135]],
    polygon: [
      [34.9, 126.5],
      [34.0, 128.9],
      [33.9, 131.0],
      [35.4, 133.0],
      [37.5, 137.5],
      [40.5, 140.3],
      [43, 140.5],
      [45.4, 141.6],
      [46.1, 141.4],
      [47, 140.6],
      [52.3, 141.0],
      [51.5, 139.0],
      [47, 138.5],
      [44, 135.5],
      [42.5, 131.5],
      [39.5, 127.8],
      [36.5, 128.5],
    ],
  },
  {
    name: 'Sea of Okhotsk',
    seeds: [
      [54, 148],
      [60, 158],
    ],
    polygon: [
      [45.3, 142.2],
      [46.1, 141.4],
      [47, 140.6],
      [52.3, 141.0],
      [54, 137.5],
      [59.2, 142.5],
      [59.8, 153.5],
      [61.5, 157],
      [62.6, 160.5],
      [62.8, 164.5],
      [60, 162],
      [57.5, 156.8],
      [53, 155.6],
      [51, 156.7],
      [47, 153],
      [43.4, 145.6],
    ],
  },
  {
    name: 'Bering Sea',
    seeds: [[58, 185]],
    wrap: true,
    polygon: [
      [51, 157],
      [52.5, 172],
      [52.9, 180],
      [52, 190],
      [54.5, 197],
      [58, 202],
      [63, 195],
      [66, 191],
      [66, 189],
      [66.3, 185],
      [64, 180],
      [62, 172],
      [59, 165],
      [56, 162],
    ],
  },
  {
    name: 'Gulf of Mexico',
    seeds: [[25, -90]],
    polygon: [
      [30.8, -98],
      [30.8, -82],
      [24.6, -81.8],
      [23.0, -82.5],
      [22.5, -85],
      [21.5, -87.2],
      [18, -91],
      [18.5, -95],
      [20, -98],
    ],
  },
  {
    name: 'Hudson Bay',
    seeds: [
      [59, -86],
      [66, -78],
    ],
    polygon: [
      [51, -96],
      [51, -78.5],
      [56, -76.5],
      [60, -77.5],
      [62.0, -74],
      [58.0, -69],
      [58.5, -65],
      [60.8, -64.5],
      [62.5, -64],
      [64.5, -72],
      [67, -74],
      [70, -80],
      [69, -86],
      [65, -92],
      [60, -95],
    ],
  },
  {
    name: 'Gulf of California',
    seeds: [[27, -111]],
    polygon: [
      [22.8, -109.8],
      [31.6, -114.9],
      [31.6, -114.3],
      [29, -111],
      [26, -109],
      [23.2, -106.8],
    ],
  },
  {
    name: 'Gulf of Thailand',
    seeds: [[10, 101]],
    polygon: [
      [13.8, 99.5],
      [13.8, 101.5],
      [12, 103],
      [10.5, 104.3],
      [8.6, 104.8],
      [6.1, 102.4],
      [7, 100.4],
      [10, 99],
      [12.5, 99.5],
    ],
  },
  {
    name: 'Java Sea',
    seeds: [[-5, 111]],
    polygon: [
      [-2.5, 105.5],
      [-1.5, 109],
      [-3.0, 116],
      [-5.5, 118.5],
      [-7.2, 115.5],
      [-6.9, 113],
      [-6.3, 108.5],
      [-5.9, 106.0],
      [-4.5, 105.8],
    ],
  },
  {
    name: 'Andaman Sea',
    seeds: [[11, 96]],
    polygon: [
      [16.5, 94.0],
      [16.5, 98.0],
      [10, 98.5],
      [6.5, 100],
      [5.5, 98.5],
      [5.5, 95.3],
      [10, 92.5],
      [14, 92.5],
    ],
  },
];

/** Hand-listed straits the raster cannot resolve (same list as build-map.ts). */
const STRAITS: Array<{ name: string; a: LatLon; b: LatLon }> = [
  { name: 'Bosporus & Dardanelles', a: [42.5, 31.0], b: [39.5, 25.5] },
  { name: 'Suez Canal', a: [32.0, 32.0], b: [27.5, 34.2] },
  { name: 'Panama Canal', a: [10.0, -79.5], b: [7.5, -79.8] },
  { name: 'Strait of Gibraltar', a: [36.0, -6.5], b: [36.2, -3.5] },
  { name: 'Danish straits', a: [57.0, 10.5], b: [55.2, 14.5] },
  { name: 'Skagerrak', a: [58.0, 8.5], b: [57.2, 11.2] },
  { name: 'Strait of Hormuz', a: [26.5, 55.0], b: [25.0, 58.0] },
  { name: 'Bab-el-Mandeb', a: [14.5, 42.0], b: [12.0, 45.0] },
  { name: 'Kerch Strait', a: [46.0, 37.0], b: [44.5, 36.0] },
  { name: 'Strait of Messina', a: [38.4, 15.4], b: [37.9, 15.8] },
];

// --- basin names for the open-ocean zones -------------------------------------------------------
interface Box {
  name: string;
  lat: [number, number];
  lon: [number, number];
}
const BASINS: Box[] = [
  { name: 'Barents Sea', lat: [67, 81], lon: [18, 62] },
  { name: 'Kara Sea', lat: [68, 81], lon: [62, 100] },
  { name: 'Laptev Sea', lat: [70, 81], lon: [100, 140] },
  { name: 'East Siberian Sea', lat: [68, 78], lon: [140, 180] },
  { name: 'Chukchi Sea', lat: [66, 76], lon: [-180, -156] },
  { name: 'Beaufort Sea', lat: [69, 78], lon: [-156, -122] },
  { name: 'Baffin Bay', lat: [66, 79], lon: [-82, -52] },
  { name: 'Greenland Sea', lat: [70, 82], lon: [-22, 12] },
  { name: 'Norwegian Sea', lat: [61, 72], lon: [-12, 18] },
  { name: 'Labrador Sea', lat: [53, 66], lon: [-66, -42] },
  { name: 'Caribbean Sea', lat: [8, 23], lon: [-90, -60] },
  { name: 'Gulf of Alaska', lat: [50, 61], lon: [-160, -130] },
  { name: 'Bay of Bengal', lat: [5, 23], lon: [79, 95] },
  { name: 'Arabian Sea', lat: [5, 26], lon: [52, 78] },
  { name: 'Mozambique Channel', lat: [-27, -10], lon: [33, 46] },
  { name: 'Gulf of Guinea', lat: [-6, 7], lon: [-12, 12] },
  { name: 'South China Sea', lat: [0, 25], lon: [99, 122] },
  { name: 'Philippine Sea', lat: [5, 30], lon: [122, 145] },
  { name: 'Celebes Sea', lat: [-1, 8], lon: [117, 126] },
  { name: 'Banda Sea', lat: [-9, -1], lon: [122, 135] },
  { name: 'Coral Sea', lat: [-28, -8], lon: [143, 165] },
  { name: 'Tasman Sea', lat: [-48, -28], lon: [148, 175] },
  { name: 'Weddell Sea', lat: [-80, -60], lon: [-62, -18] },
  { name: 'Ross Sea', lat: [-80, -68], lon: [158, 200] },
  { name: 'Drake Passage', lat: [-64, -54], lon: [-72, -54] },
  { name: 'Scotia Sea', lat: [-62, -52], lon: [-54, -30] },
];
function basinName(lat: number, lon: number): string {
  for (const b of BASINS) {
    const lo = b.lon[1] > 180 && lon < 0 ? lon + 360 : lon;
    if (lat >= b.lat[0] && lat <= b.lat[1] && lo >= b.lon[0] && lo <= b.lon[1]) return b.name;
  }
  if (lat > 66) return 'Arctic Ocean';
  if (lat < -55) return 'Southern Ocean';
  if (lon > (lat > 15 ? -100 : -70) && lon < 20)
    return lat > 0 ? 'North Atlantic' : 'South Atlantic';
  if (lon >= 20 && lon < 110 && lat < 30) return 'Indian Ocean';
  if (lon >= 110 && lon < 147 && lat < -8) return 'Indian Ocean';
  return lat > 0 ? 'North Pacific' : 'South Pacific';
}

// --- helpers ----------------------------------------------------------------------------------------
const D2R = Math.PI / 180;
function pointInPolygon(lat: number, lon: number, poly: LatLon[], wrap: boolean): boolean {
  const x = wrap && lon < 0 ? lon + 360 : lon;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i]!;
    const [yj, xj] = poly[j]!;
    if (yi > lat !== yj > lat && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function greatCircleKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const a = aLat * D2R,
    b = bLat * D2R;
  const d = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((aLon - bLon) * D2R);
  return 6371 * Math.acos(Math.max(-1, Math.min(1, d)));
}

interface SeaZoneMeta {
  id: number;
  name: string;
  basin: string;
  lat: number;
  lon: number;
  areaKm2: number;
  neighbours: number[];
  coastalRegions: number[];
  pixels: number;
  /** Set for the seas carved by this script. */
  enclosed?: boolean;
}
interface RegionMeta {
  id: number;
  name: string;
  iso3: string;
  lat: number;
  lon: number;
  neighbours: number[];
  coastal: boolean;
  [k: string]: unknown;
}
interface Meta {
  source: string;
  asOf: string;
  estimate: boolean;
  notes: string;
  idTexture: { path: string; width: number; height: number; encoding: string };
  landCount: number;
  seaZoneCount: number;
  straits: string[];
  regions: RegionMeta[];
  seaZones: SeaZoneMeta[];
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta;
  const { data, info } = await sharp(ID_PNG).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const ch = info.channels;
  const ids = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) ids[i] = data[i * ch]! | (data[i * ch + 1]! << 8);
  const landCount = meta.landCount;
  const isSea = (id: number) => id > landCount;
  const latOf = (py: number) => 90 - ((py + 0.5) / H) * 180;
  const lonOf = (px: number) => ((px + 0.5) / W) * 360 - 180;
  const pxOf = (lon: number) => Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
  const pyOf = (lat: number) => Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));

  // Working ids: old sea zones keep their ids; carved seas get temporary ids above everything.
  const oldSeaIds = meta.seaZones.map((z) => z.id);
  let nextTemp = Math.max(landCount, ...oldSeaIds) + 1;
  const carved = new Map<number, SeaDef>();
  // Re-running: a sea already carved is simply re-flooded (its pixels are sea pixels like any other).
  const work = new Uint16Array(ids);
  for (const sea of SEAS) {
    const id = nextTemp++;
    carved.set(id, sea);
    // precompute polygon membership lazily per pixel in the BFS
    const stack: number[] = [];
    const seen = new Uint8Array(W * H);
    for (const [lat, lon] of sea.seeds) {
      const i = pyOf(lat) * W + pxOf(lon);
      if (!isSea(work[i]!)) {
        // find the nearest sea pixel within 6 px
        let found = -1;
        outer: for (let r = 1; r <= 6; r++)
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              const j = (pyOf(lat) + dy) * W + ((pxOf(lon) + dx + W) % W);
              if (j >= 0 && j < W * H && isSea(work[j]!)) {
                found = j;
                break outer;
              }
            }
        if (found < 0) throw new Error(`${sea.name}: seed ${lat},${lon} is not at sea`);
        stack.push(found);
      } else stack.push(i);
    }
    let count = 0;
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i]) continue;
      seen[i] = 1;
      if (!isSea(work[i]!)) continue;
      const py = Math.floor(i / W);
      const px = i - py * W;
      if (!pointInPolygon(latOf(py), lonOf(px), sea.polygon, !!sea.wrap)) continue;
      work[i] = id;
      count++;
      stack.push(py * W + ((px + 1) % W), py * W + ((px - 1 + W) % W));
      if (py > 0) stack.push(i - W);
      if (py < H - 1) stack.push(i + W);
    }
    if (count < 20) throw new Error(`${sea.name}: flood fill found only ${count} pixels`);
    console.log(`${sea.name.padEnd(24)} ${count} px`);
  }

  // Inland water (lakes, dry seas) that no ocean can reach is not a sea zone at all: those pixels
  // join the nearest land region (the Caspian stays, being carved above).
  {
    const reached = new Uint8Array(W * H);
    const stack = [pyOf(0) * W + pxOf(-150)];
    while (stack.length) {
      const i = stack.pop()!;
      if (reached[i] || !isSea(work[i]!)) continue;
      reached[i] = 1;
      const py = Math.floor(i / W);
      const px = i - py * W;
      stack.push(py * W + ((px + 1) % W), py * W + ((px - 1 + W) % W));
      if (py > 0) stack.push(i - W);
      if (py < H - 1) stack.push(i + W);
    }
    // Multi-source dilation of land ids into the unreached water.
    let frontier: number[] = [];
    const inland = new Uint8Array(W * H);
    let inlandCount = 0;
    for (let i = 0; i < W * H; i++)
      if (isSea(work[i]!) && !reached[i] && !carved.has(work[i]!)) {
        inland[i] = 1;
        inlandCount++;
      }
    for (let i = 0; i < W * H; i++) {
      if (!inland[i]) continue;
      const py = Math.floor(i / W);
      const px = i - py * W;
      const nb = [
        py * W + ((px + 1) % W),
        py * W + ((px - 1 + W) % W),
        py > 0 ? i - W : -1,
        py < H - 1 ? i + W : -1,
      ];
      if (nb.some((j) => j >= 0 && work[j]! > 0 && work[j]! <= landCount)) frontier.push(i);
    }
    let assigned = 0;
    while (frontier.length) {
      const next: number[] = [];
      const values = new Map<number, number>();
      for (const i of frontier) {
        if (!inland[i]) continue;
        const py = Math.floor(i / W);
        const px = i - py * W;
        const nb = [
          py * W + ((px + 1) % W),
          py * W + ((px - 1 + W) % W),
          py > 0 ? i - W : -1,
          py < H - 1 ? i + W : -1,
        ];
        const land = nb.find((j) => j >= 0 && work[j]! > 0 && work[j]! <= landCount);
        if (land !== undefined) values.set(i, work[land]!);
      }
      for (const [i, v] of values) {
        work[i] = v;
        inland[i] = 0;
        assigned++;
        const py = Math.floor(i / W);
        const px = i - py * W;
        for (const j of [
          py * W + ((px + 1) % W),
          py * W + ((px - 1 + W) % W),
          py > 0 ? i - W : -1,
          py < H - 1 ? i + W : -1,
        ])
          if (j >= 0 && inland[j]) next.push(j);
      }
      frontier = next;
    }
    console.log(`inland water: ${inlandCount} px → land (${assigned} assigned)`);
  }

  // Pixel counts, then fold small leftovers into the neighbouring non-carved zone with the longest edge.
  const count = new Map<number, number>();
  for (let i = 0; i < W * H; i++)
    if (isSea(work[i]!)) count.set(work[i]!, (count.get(work[i]!) ?? 0) + 1);
  const edgeCount = () => {
    const m = new Map<number, Map<number, number>>();
    const bump = (a: number, b: number) => {
      if (a === b || !isSea(a) || !isSea(b)) return;
      if (!m.has(a)) m.set(a, new Map());
      m.get(a)!.set(b, (m.get(a)!.get(b) ?? 0) + 1);
    };
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        const a = work[i]!;
        const r = work[py * W + ((px + 1) % W)]!;
        bump(a, r);
        bump(r, a);
        if (py + 1 < H) {
          const d = work[i + W]!;
          bump(a, d);
          bump(d, a);
        }
      }
    return m;
  };
  const edges = edgeCount();
  const remap = new Map<number, number>();
  for (const [id, n] of [...count.entries()].sort((a, b) => a[1] - b[1])) {
    if (carved.has(id) || n >= MIN_PIXELS) continue;
    const candidates = [...(edges.get(id) ?? new Map<number, number>()).entries()]
      .filter(([b]) => !remap.has(b) && (count.get(b) ?? 0) >= MIN_PIXELS)
      .sort((a, b) => b[1] - a[1]);
    // prefer open-ocean neighbours; a sliver wedged between carved seas joins the carved one
    const nb = candidates.find(([b]) => !carved.has(b)) ?? candidates[0];
    if (!nb) continue;
    remap.set(id, nb[0]);
    console.log(`fold zone ${id} (${n} px) into ${nb[0]}`);
  }
  if (remap.size) {
    for (let i = 0; i < W * H; i++) {
      const r = remap.get(work[i]!);
      if (r !== undefined) work[i] = r;
    }
  }

  // Renumber sea zones compactly: surviving old zones in their old order, then the carved seas.
  const survivors = oldSeaIds.filter((id) => !remap.has(id) && (count.get(id) ?? 0) > 0);
  const order = [...survivors, ...carved.keys()];
  const newId = new Map<number, number>();
  order.forEach((id, i) => newId.set(id, landCount + 1 + i));
  const final = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = work[i]!;
    final[i] = isSea(v) ? newId.get(v)! : v;
  }
  const seaCount = order.length;
  const totalIds = landCount + seaCount;

  // Centroids, pixel areas and adjacency from the final raster.
  const sx = new Float64Array(totalIds + 1),
    sy = new Float64Array(totalIds + 1),
    sz = new Float64Array(totalIds + 1),
    area = new Float64Array(totalIds + 1),
    px = new Uint32Array(totalIds + 1);
  const adj = new Map<number, Set<number>>();
  const adjCount = new Map<string, number>();
  const bump = (a: number, b: number) => {
    if (a === b || a === 0 || b === 0) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    adjCount.set(k, (adjCount.get(k) ?? 0) + 1);
  };
  for (let py = 0; py < H; py++) {
    const lat = latOf(py);
    const cl = Math.cos(lat * D2R);
    const pixKm2 = ((2 * Math.PI * 6371) / W) * ((Math.PI * 6371) / H) * cl;
    for (let x = 0; x < W; x++) {
      const i = py * W + x;
      const id = final[i]!;
      if (id > landCount) {
        const lon = lonOf(x);
        sx[id]! += cl * Math.cos(lon * D2R) * cl;
        sy[id]! += Math.sin(lat * D2R) * cl;
        sz[id]! += -cl * Math.sin(lon * D2R) * cl;
        area[id]! += pixKm2;
        px[id]!++;
      }
      bump(id, final[py * W + ((x + 1) % W)]!);
      if (py + 1 < H) bump(id, final[i + W]!);
    }
  }
  const addAdj = (a: number, b: number) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const [k, n] of adjCount) {
    if (n < 2) continue;
    const [a, b] = k.split('|').map(Number) as [number, number];
    addAdj(a, b);
  }
  const idAt = (lat: number, lon: number) => final[pyOf(lat) * W + pxOf(lon)]!;
  const straitNames: string[] = [];
  for (const s of STRAITS) {
    const a = idAt(s.a[0], s.a[1]);
    const b = idAt(s.b[0], s.b[1]);
    if (a > landCount && b > landCount) {
      if (a !== b) {
        addAdj(a, b);
        straitNames.push(s.name);
      }
    } else console.warn(`strait ${s.name}: endpoints not both sea (${a}, ${b})`);
  }

  // Names.
  const countryName = new Map<string, string>();
  const nations = JSON.parse(readFileSync(join(ROOT, 'data', 'nations.json'), 'utf8')) as {
    nations: { iso3: string; name: string }[];
  };
  for (const n of nations.nations) countryName.set(n.iso3, n.name);
  const coastal = meta.regions.filter((r) => r.coastal && r.iso3 !== 'ATA');
  const seaZones: SeaZoneMeta[] = order.map((old) => {
    const id = newId.get(old)!;
    const len = Math.hypot(sx[id]!, sy[id]!, sz[id]!) || 1;
    const lat = (Math.asin(Math.max(-1, Math.min(1, sy[id]! / len))) * 180) / Math.PI;
    const lon = (Math.atan2(-sz[id]! / len, sx[id]! / len) * 180) / Math.PI;
    const nbrs = [...(adj.get(id) ?? [])].sort((a, b) => a - b);
    const def = carved.get(old);
    let name: string;
    let basin: string;
    if (def) {
      name = def.name;
      basin = def.name;
    } else {
      basin = basinName(lat, lon);
      let nearest = coastal[0]!;
      let best = Infinity;
      for (const r of coastal) {
        const d = greatCircleKm(lat, lon, r.lat, r.lon);
        if (d < best) {
          best = d;
          nearest = r;
        }
      }
      name = `${basin} — ${countryName.get(nearest.iso3) ?? nearest.iso3}`;
    }
    return {
      id,
      name,
      basin,
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
      areaKm2: Math.round(area[id]!),
      neighbours: nbrs,
      coastalRegions: nbrs.filter((n) => n <= landCount),
      pixels: px[id]!,
      ...(def ? { enclosed: true } : {}),
    };
  });
  const seen = new Map<string, number>();
  for (const z of seaZones) {
    const n = (seen.get(z.name) ?? 0) + 1;
    seen.set(z.name, n);
    if (n > 1)
      z.name = `${z.name} ${['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? n}`;
  }

  // Land regions: refresh neighbours (sea ids changed), the coastal flag and pixel counts.
  const landPx = new Uint32Array(landCount + 1);
  for (let i = 0; i < W * H; i++) if (final[i]! > 0 && final[i]! <= landCount) landPx[final[i]!]!++;
  for (const r of meta.regions) {
    const nbrs = [...(adj.get(r.id) ?? [])].sort((a, b) => a - b);
    r.neighbours = nbrs;
    r.coastal = nbrs.some((n) => n > landCount);
    r.pixels = landPx[r.id]!;
  }

  // Chokepoints: re-resolve zones from the probes, like build-geography.ts.
  const choke = JSON.parse(readFileSync(CHOKE, 'utf8')) as {
    chokepoints: { id: string; zones: number[]; zoneNames: string[]; [k: string]: unknown }[];
    [k: string]: unknown;
  };
  const seaById = new Map(seaZones.map((z) => [z.id, z]));
  for (const c of choke.chokepoints) {
    const def = CHOKEPOINTS.find((d) => d.id === c.id);
    if (!def) continue;
    const zones: number[] = [];
    for (const [lat, lon] of def.zoneProbes) {
      let found = -1;
      const cx = pxOf(lon),
        cy = pyOf(lat);
      outer: for (let r = 0; r <= 6; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const y = cy + dy;
            if (y < 0 || y >= H) continue;
            const j = y * W + ((cx + dx + W) % W);
            if (final[j]! > landCount) {
              found = final[j]!;
              break outer;
            }
          }
      if (found < 0) throw new Error(`${c.id}: no sea zone near ${lat},${lon}`);
      if (!zones.includes(found)) zones.push(found);
    }
    c.zones = zones;
    c.zoneNames = zones.map((z) => seaById.get(z)!.name);
    console.log(`${c.id.padEnd(16)} → ${c.zoneNames.join(' | ')}`);
  }

  // Write the raster (RGB: id low byte, id high byte, land flag).
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const id = final[i]!;
    rgb[i * 3] = id & 255;
    rgb[i * 3 + 1] = id >> 8;
    rgb[i * 3 + 2] = id > 0 && id <= landCount ? 255 : 0;
  }
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(ID_PNG);
  const mask = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = final[i]! > 0 && final[i]! <= landCount ? 255 : 0;
  await sharp(mask, { raw: { width: W, height: H, channels: 1 } })
    .resize(W / 2, H / 2, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(join(ROOT, 'public', 'textures', 'ocean-mask.png'));

  meta.seaZoneCount = seaCount;
  meta.seaZones = seaZones;
  meta.straits = straitNames;
  meta.notes =
    meta.notes.replace(/ Sea zones are k-means cells.*$/, '') +
    ' Sea zones are k-means cells over ocean pixels (names: basin + nearest coastal country), except the enclosed and marginal seas carved out by scripts/fix-sea-zones.ts (`enclosed: true`), which follow their real coastlines and straits and carry their own names.';
  writeFileSync(META, JSON.stringify(meta));
  writeFileSync(CHOKE, JSON.stringify(choke, null, 2) + '\n');
  console.log(
    `sea zones: ${oldSeaIds.length} → ${seaCount} (${carved.size} carved, ${remap.size} folded); straits ${straitNames.length}; ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
