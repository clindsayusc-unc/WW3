/**
 * scripts/build-geography.ts — real geography for the strategic map.
 *
 *   node --import tsx scripts/build-geography.ts [--cache DIR] [--skip-infra]
 *
 * Inputs (downloaded once into the cache directory; all public domain or CC-BY):
 *   - NOAA ETOPO 2022 (60 arc-second surface elevation) via the NCEI THREDDS OPeNDAP server,
 *     read at a 2-arc-minute stride in latitude bands (binary .dods responses)
 *   - NASA MODIS MCD12 IGBP land cover (annual, 2022) rendered by NASA GIBS as a 4096×2048
 *     equirectangular PNG; decoded back to IGBP classes with the GIBS colormap
 *   - NASA MERRA-2 monthly 2 m air temperature and bias-corrected precipitation (2023), also via
 *     GIBS imagery + colormaps (1440×720)
 *   - Natural Earth 1:10m rivers + lake centerlines, geography region polygons (mountain ranges),
 *     roads and railroads
 *   - NGA World Port Index (Pub. 150) CSV
 *   - The game's own region-ID raster (public/textures/regions-id.png) for aggregation
 *
 * Outputs:
 *   - data/terrain.json         per land region: elevation, ruggedness, land cover, terrain class
 *   - data/climate.json         per land region: monthly temperature, precipitation and derived
 *                               winter / monsoon / heat indices
 *   - data/crossings.json       per adjacent land-region pair: rivers, mountain ranges, passes
 *   - data/infrastructure.json  per land region: ports (from the WPI) and road/rail density
 *   - data/chokepoints.json     twelve maritime chokepoints resolved onto sea zones and shores
 *
 * Deterministic: no randomness; every output is a pure function of the cached inputs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import { geoContains } from 'd3-geo';
import { CHOKEPOINTS, PASSES } from './geo/handData';

const ROOT = process.cwd();
const DATA = join(ROOT, 'data');
const AS_OF = '2026-11-02';
const EARTH_RADIUS_KM = 6371;
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson';
const ETOPO =
  'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const GIBS_CM = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3';
const WPI_URL =
  'https://msi.nga.mil/api/publications/download?key=16920959/SFH00000/UpdatedPub150.csv&type=download';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const CACHE = arg('cache', join(ROOT, '.cache'));
const SKIP_INFRA = process.argv.includes('--skip-infra');

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

async function fetchCached(url: string, file: string): Promise<Buffer> {
  const path = join(CACHE, file);
  if (existsSync(path)) return readFileSync(path);
  mkdirSync(join(path, '..'), { recursive: true });
  console.log(`downloading ${url}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(path, buf);
      return buf;
    }
    console.warn(`  HTTP ${res.status}, retrying`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`${url}: download failed`);
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------------------------
// Region-ID raster
// ---------------------------------------------------------------------------------------------

interface IdRaster {
  w: number;
  h: number;
  ids: Uint16Array;
  land: Uint8Array;
}

async function loadIdRaster(): Promise<IdRaster> {
  const { data, info } = await sharp(join(ROOT, 'public/textures/regions-id.png'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const ids = new Uint16Array(n);
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    ids[i] = data[o]! | (data[o + 1]! << 8);
    land[i] = data[o + 2]! > 127 ? 1 : 0;
  }
  return { w: info.width, h: info.height, ids, land };
}

const px = (r: IdRaster, lon: number, lat: number): number => {
  const x = clamp(Math.floor(((lon + 180) / 360) * r.w), 0, r.w - 1);
  const y = clamp(Math.floor(((90 - lat) / 180) * r.h), 0, r.h - 1);
  return y * r.w + x;
};
const pxLat = (r: IdRaster, i: number): number => 90 - ((Math.floor(i / r.w) + 0.5) / r.h) * 180;
const pxLon = (r: IdRaster, i: number): number => ((i % r.w) + 0.5) / r.w * 360 - 180;

/** Nearest pixel satisfying `ok` within `radius` pixels (Chebyshev), or -1. */
function nearest(r: IdRaster, i: number, radius: number, ok: (j: number) => boolean): number {
  if (ok(i)) return i;
  const x0 = i % r.w;
  const y0 = Math.floor(i / r.w);
  for (let d = 1; d <= radius; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
        const x = (((x0 + dx) % r.w) + r.w) % r.w;
        const y = y0 + dy;
        if (y < 0 || y >= r.h) continue;
        const j = y * r.w + x;
        if (ok(j)) return j;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// ETOPO 2022 via OPeNDAP (.dods): Float32 grid, stride 2 → 10800 × 5400 cells of 2 arc-minutes
// ---------------------------------------------------------------------------------------------

const ETOPO_STRIDE = 2;
const ETOPO_W = 21600 / ETOPO_STRIDE;
const ETOPO_H = 10800 / ETOPO_STRIDE;
const BAND_ROWS = 200; // source rows per request → 100 reduced rows

async function loadEtopo(): Promise<Int16Array> {
  const grid = new Int16Array(ETOPO_W * ETOPO_H);
  for (let r0 = 0; r0 < 10800; r0 += BAND_ROWS) {
    const r1 = r0 + BAND_ROWS - 1;
    const file = `etopo/band_${String(r0).padStart(5, '0')}.dods`;
    const buf = await fetchCached(
      `${ETOPO}.dods?z[${r0}:${ETOPO_STRIDE}:${r1}][0:${ETOPO_STRIDE}:21599]`,
      file,
    );
    const marker = buf.indexOf('Data:\n');
    if (marker < 0) throw new Error(`${file}: no data section`);
    let off = marker + 6;
    const n = buf.readUInt32BE(off);
    off += 8; // two identical XDR lengths
    const rows = BAND_ROWS / ETOPO_STRIDE;
    if (n !== rows * ETOPO_W) throw new Error(`${file}: unexpected length ${n}`);
    const rowBase = r0 / ETOPO_STRIDE;
    for (let k = 0; k < n; k++) {
      const v = buf.readFloatBE(off + k * 4);
      grid[(rowBase + Math.floor(k / ETOPO_W)) * ETOPO_W + (k % ETOPO_W)] = Math.round(
        clamp(v, -12000, 9000),
      );
    }
  }
  return grid;
}
// ETOPO rows run south → north: lat(r) = -90 + (r·stride + 0.5)/60.
const etopoCell = (lon: number, lat: number): number => {
  const c = clamp(Math.floor(((lon + 180) / 360) * ETOPO_W), 0, ETOPO_W - 1);
  const r = clamp(Math.floor(((lat + 90) / 180) * ETOPO_H), 0, ETOPO_H - 1);
  return r * ETOPO_W + c;
};
/** Terrain ruggedness: mean absolute elevation difference to the four neighbouring cells (m). */
function tri(grid: Int16Array, cell: number): number {
  const r = Math.floor(cell / ETOPO_W);
  const c = cell % ETOPO_W;
  const z = grid[cell]!;
  let s = 0;
  let n = 0;
  const nb = [
    r > 0 ? cell - ETOPO_W : -1,
    r < ETOPO_H - 1 ? cell + ETOPO_W : -1,
    r * ETOPO_W + ((c + 1) % ETOPO_W),
    r * ETOPO_W + ((c - 1 + ETOPO_W) % ETOPO_W),
  ];
  for (const j of nb) {
    if (j < 0) continue;
    s += Math.abs(grid[j]! - z);
    n++;
  }
  return n ? s / n : 0;
}

// ---------------------------------------------------------------------------------------------
// GIBS imagery + colormaps
// ---------------------------------------------------------------------------------------------

interface Rgba {
  w: number;
  h: number;
  data: Buffer;
  ch: number;
}
async function gibsImage(layer: string, w: number, h: number, time: string): Promise<Rgba> {
  const url = `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/png&TIME=${time}`;
  const buf = await fetchCached(url, `gibs/${layer}_${time}_${w}x${h}.png`);
  if (buf.subarray(0, 8).toString('latin1').startsWith('<?xml'))
    throw new Error(`${layer} ${time}: WMS returned an exception, not an image`);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data, ch: info.channels };
}

interface ColorEntry {
  rgb: [number, number, number];
  value: number;
}
/** Parses a GIBS colormap; returns the entries with a numeric value (range midpoints) or classes. */
async function gibsColormap(id: string): Promise<ColorEntry[]> {
  const xml = (await fetchCached(`${GIBS_CM}/${id}.xml`, `gibs/${id}.xml`)).toString('utf8');
  const out: ColorEntry[] = [];
  const re = /<ColorMapEntry\s+([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1]!;
    const rgb = /rgb="(\d+),(\d+),(\d+)"/.exec(attrs);
    const sv = /sourceValue="([^"]*)"/.exec(attrs);
    if (!rgb || !sv || /nodata="true"/.test(attrs)) continue;
    const s = sv[1]!;
    let value: number;
    const range = /^\[(-?[\d.eE+-]+|-INF),(-?[\d.eE+-]+|INF|\+INF)[)\]]$/.exec(s);
    if (range) {
      const a = range[1] === '-INF' ? NaN : Number(range[1]);
      const b = /INF/.test(range[2]!) ? NaN : Number(range[2]);
      // Open-ended bins take the previous bin's width (temperature bins are 1 K, precipitation
      // bins are tiny), so the top class is not inflated by an infinite upper bound.
      const prev = out.length >= 2 ? Math.abs(out[out.length - 1]!.value - out[out.length - 2]!.value) : 0.5;
      value = Number.isNaN(a) ? b - prev / 2 : Number.isNaN(b) ? a + prev / 2 : (a + b) / 2;
    } else {
      // Discrete classes, possibly "0,17" (several source values share a colour): use the first.
      value = Number(s.split(',')[0]);
    }
    if (!Number.isFinite(value)) continue;
    out.push({ rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], value });
  }
  if (out.length === 0) throw new Error(`colormap ${id}: no entries`);
  return out;
}

class ColorLookup {
  private exact = new Map<number, number>();
  private cache = new Map<number, number>();
  constructor(private entries: ColorEntry[]) {
    for (const e of entries) this.exact.set((e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], e.value);
  }
  value(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    const hit = this.exact.get(key);
    if (hit !== undefined) return hit;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    let best = NaN;
    let bestD = Infinity;
    for (const e of this.entries) {
      const d = (e.rgb[0] - r) ** 2 + (e.rgb[1] - g) ** 2 + (e.rgb[2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e.value;
      }
    }
    this.cache.set(key, best);
    return best;
  }
}

// ---------------------------------------------------------------------------------------------
// Natural Earth helpers
// ---------------------------------------------------------------------------------------------

type Props = Record<string, unknown>;
type LineFeature = Feature<LineString | MultiLineString, Props>;
type PolyFeature = Feature<Polygon | MultiPolygon, Props>;

async function neGeojson<G extends LineString | MultiLineString | Polygon | MultiPolygon>(
  name: string,
): Promise<FeatureCollection<G, Props>> {
  const buf = await fetchCached(`${NE}/${name}.geojson`, `${name}.geojson`);
  return JSON.parse(buf.toString('utf8')) as FeatureCollection<G, Props>;
}
const linesOf = (g: LineString | MultiLineString): Position[][] =>
  g.type === 'LineString' ? [g.coordinates] : g.coordinates;

/** Calls `fn` for points every `stepKm` along a polyline (including vertices). */
function walkLine(coords: Position[], stepKm: number, fn: (lon: number, lat: number, segKm: number) => void): void {
  for (let i = 1; i < coords.length; i++) {
    const [aLon, aLat] = coords[i - 1] as [number, number];
    const [bLon, bLat] = coords[i] as [number, number];
    const len = haversineKm(aLat, aLon, bLat, bLon);
    const n = Math.max(1, Math.ceil(len / stepKm));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      fn(aLon + (bLon - aLon) * t, aLat + (bLat - aLat) * t, len / n);
    }
  }
}

function bbox(f: PolyFeature): [number, number, number, number] {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
  for (const ring of rings)
    for (const [x, y] of ring as [number, number][]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

interface RegionRow {
  id: number;
  name: string;
  iso3: string;
  lat: number;
  lon: number;
  areaKm2: number;
  neighbours: number[];
  coastal: boolean;
}
interface SeaRow {
  id: number;
  name: string;
  neighbours: number[];
}

const IGBP_GROUP: Record<number, string> = {
  1: 'forest', 3: 'forest', 4: 'forest', 5: 'forest',
  2: 'jungle',
  6: 'shrub', 7: 'shrub',
  8: 'woodland',
  9: 'savanna',
  10: 'grassland',
  11: 'marsh',
  12: 'cropland', 14: 'cropland',
  13: 'urban',
  15: 'ice',
  16: 'barren',
  17: 'water',
};
const COVER_KEYS = ['forest', 'jungle', 'woodland', 'shrub', 'savanna', 'grassland', 'marsh', 'cropland', 'urban', 'ice', 'barren', 'water'] as const;
type CoverKey = (typeof COVER_KEYS)[number];

export function classifyTerrain(x: {
  iso3: string;
  lat: number;
  tri: number;
  elevStd: number;
  elevMean: number;
  cover: Record<CoverKey, number>;
  tempYear: number;
  precipYear: number;
}): string {
  const c = x.cover;
  // MODIS labels open boreal and subtropical forests "woody savanna"; count them as 70 % forest.
  const forest = c.forest + c.jungle + 0.7 * c.woodland;
  if (x.iso3 === 'ATA' || c.ice >= 0.5) return 'ice';
  if (c.urban >= 0.12) return 'urban';
  if (x.tri >= 130 || (x.tri >= 100 && x.elevStd >= 450) || x.elevMean >= 3500) return 'mountains';
  if (c.jungle >= 0.3 && Math.abs(x.lat) < 30) return 'jungle';
  if (c.marsh >= 0.12) return 'marsh';
  if (c.barren + c.shrub * 0.5 >= 0.45 && x.precipYear < 400) return 'desert';
  if (x.tempYear < -2 && forest < 0.35) return 'arctic';
  if (x.tri >= 70) return 'hills';
  if (forest >= 0.45) return 'forest';
  return 'plains';
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const meta = JSON.parse(readFileSync(join(DATA, 'regions.meta.json'), 'utf8')) as {
    regions: RegionRow[];
    seaZones: SeaRow[];
  };
  const regions = meta.regions;
  const regionById = new Map(regions.map((r) => [r.id, r]));
  const seaById = new Map(meta.seaZones.map((z) => [z.id, z]));
  const raster = await loadIdRaster();
  console.log(`raster ${raster.w}×${raster.h}, ${regions.length} land regions`);

  // ---- 1. Elevation and ruggedness per region, plus per-pixel TRI for border statistics -------
  const grid = await loadEtopo();
  console.log(`ETOPO grid loaded (${ETOPO_W}×${ETOPO_H}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const maxId = Math.max(...regions.map((r) => r.id), ...meta.seaZones.map((z) => z.id)) + 1;
  const elevSum = new Float64Array(maxId), elevSq = new Float64Array(maxId), elevMax = new Float64Array(maxId);
  const triSum = new Float64Array(maxId), cellCount = new Float64Array(maxId);
  // Walk every ETOPO cell; attribute it to the land region under it (ID raster lookup).
  for (let r = 0; r < ETOPO_H; r++) {
    const lat = -90 + ((r * ETOPO_STRIDE + 0.5) / 60) * 1;
    const weight = Math.cos((lat * Math.PI) / 180);
    const y = clamp(Math.floor(((90 - lat) / 180) * raster.h), 0, raster.h - 1);
    for (let c = 0; c < ETOPO_W; c++) {
      const x = Math.floor((c / ETOPO_W) * raster.w);
      const i = y * raster.w + x;
      if (!raster.land[i]) continue;
      const id = raster.ids[i]!;
      if (!regionById.has(id)) continue;
      const cell = r * ETOPO_W + c;
      const z = Math.max(0, grid[cell]!);
      elevSum[id]! += z * weight;
      elevSq[id]! += z * z * weight;
      if (z > elevMax[id]!) elevMax[id] = z;
      triSum[id]! += tri(grid, cell) * weight;
      cellCount[id]! += weight;
    }
  }

  // ---- 2. Land cover (MODIS IGBP via GIBS) ------------------------------------------------------
  const lcImg = await gibsImage('MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', raster.w, raster.h, '2022-01-01');
  const lcMap = new ColorLookup(await gibsColormap('MODIS_IGBP_Land_Cover_Type'));
  const coverCount = new Map<number, Record<CoverKey, number>>();
  const blankCover = (): Record<CoverKey, number> =>
    Object.fromEntries(COVER_KEYS.map((k) => [k, 0])) as Record<CoverKey, number>;
  const pixelCount = new Float64Array(maxId);
  for (let i = 0; i < raster.w * raster.h; i++) {
    if (!raster.land[i]) continue;
    const id = raster.ids[i]!;
    if (!regionById.has(id)) continue;
    const o = i * lcImg.ch;
    const cls = lcMap.value(lcImg.data[o]!, lcImg.data[o + 1]!, lcImg.data[o + 2]!);
    const group = IGBP_GROUP[cls];
    const w = Math.cos((pxLat(raster, i) * Math.PI) / 180);
    pixelCount[id]! += w;
    if (!group) continue;
    let rec = coverCount.get(id);
    if (!rec) coverCount.set(id, (rec = blankCover()));
    rec[group as CoverKey] += w;
  }

  // ---- 3. Climate (MERRA-2 monthly 2023 via GIBS) ------------------------------------------------
  const CW = 1440, CH = 720;
  const tempMap = new ColorLookup(await gibsColormap('MERRA2_2m_Air_Temperature_Monthly'));
  const precMap = new ColorLookup(await gibsColormap('MERRA2_Precipitation_Bias_Corrected_Monthly'));
  const tempSum = Array.from({ length: 12 }, () => new Float64Array(maxId));
  const precSum = Array.from({ length: 12 }, () => new Float64Array(maxId));
  const climCount = Array.from({ length: 12 }, () => new Float64Array(maxId));
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 0; m < 12; m++) {
    const time = `2023-${String(m + 1).padStart(2, '0')}-01`;
    const [tImg, pImg] = await Promise.all([
      gibsImage('MERRA2_2m_Air_Temperature_Monthly', CW, CH, time),
      gibsImage('MERRA2_Precipitation_Bias_Corrected_Monthly', CW, CH, time),
    ]);
    // Sample every other raster pixel (plenty for 0.25° source data).
    for (let y = 0; y < raster.h; y += 2) {
      const lat = 90 - ((y + 0.5) / raster.h) * 180;
      const cy = clamp(Math.floor(((90 - lat) / 180) * CH), 0, CH - 1);
      const w = Math.cos((lat * Math.PI) / 180);
      for (let x = 0; x < raster.w; x += 2) {
        const i = y * raster.w + x;
        if (!raster.land[i]) continue;
        const id = raster.ids[i]!;
        if (!regionById.has(id)) continue;
        const cx = Math.floor((x / raster.w) * CW);
        const o = (cy * CW + cx) * 4;
        const tK = tempMap.value(tImg.data[o]!, tImg.data[o + 1]!, tImg.data[o + 2]!);
        const pRate = precMap.value(pImg.data[o]!, pImg.data[o + 1]!, pImg.data[o + 2]!);
        if (!Number.isFinite(tK) || !Number.isFinite(pRate)) continue;
        tempSum[m]![id]! += (tK - 273.15) * w;
        precSum[m]![id]! += pRate * 86400 * DAYS[m]! * w; // kg/m²/s → mm/month
        climCount[m]![id]! += w;
      }
    }
  }

  // ---- 3b. Connected water bodies: which seas each coastal region actually touches ----------------
  // Sea zones are k-means cells and a cell can span two unconnected waters (the Caspian and the
  // Gulf share one), so label the water pixels by 4-connected component and record, per land
  // region, the components it borders. The simulation only allows landings between regions that
  // share a water body.
  const comp = new Int32Array(raster.w * raster.h).fill(-1);
  const compSize: number[] = [];
  {
    const stack: number[] = [];
    for (let i = 0; i < comp.length; i++) {
      if (raster.land[i] || comp[i] !== -1) continue;
      const id = compSize.length;
      compSize.push(0);
      comp[i] = id;
      stack.push(i);
      while (stack.length > 0) {
        const j = stack.pop()!;
        compSize[id]!++;
        const x = j % raster.w, y = Math.floor(j / raster.w);
        const nb = [y > 0 ? j - raster.w : -1, y < raster.h - 1 ? j + raster.w : -1, y * raster.w + ((x + 1) % raster.w), y * raster.w + ((x - 1 + raster.w) % raster.w)];
        for (const k of nb) {
          if (k < 0 || raster.land[k] || comp[k] !== -1) continue;
          comp[k] = id;
          stack.push(k);
        }
      }
    }
  }
  const waterTouch = new Map<number, Map<number, number>>();
  for (let y = 0; y < raster.h; y++)
    for (let x = 0; x < raster.w; x++) {
      const i = y * raster.w + x;
      if (!raster.land[i]) continue;
      const id = raster.ids[i]!;
      if (!regionById.has(id)) continue;
      const nb = [y > 0 ? i - raster.w : -1, y < raster.h - 1 ? i + raster.w : -1, y * raster.w + ((x + 1) % raster.w), y * raster.w + ((x - 1 + raster.w) % raster.w)];
      for (const k of nb) {
        if (k < 0 || raster.land[k]) continue;
        const c = comp[k]!;
        if (compSize[c]! < 40) continue; // lakes and reservoirs
        let m = waterTouch.get(id);
        if (!m) waterTouch.set(id, (m = new Map()));
        m.set(c, (m.get(c) ?? 0) + 1);
      }
    }
  const bigWater = compSize.map((n, i) => [i, n] as const).filter(([, n]) => n >= 40).sort((a, b) => b[1] - a[1]);
  console.log(`water bodies ≥ 40 px: ${bigWater.length}; largest ${bigWater.slice(0, 5).map(([i, n]) => `#${i}:${n}`).join(' ')}`);

  // ---- Assemble terrain + climate rows ----------------------------------------------------------
  const terrainRows: Record<string, unknown>[] = [];
  const climateRows: Record<string, unknown>[] = [];
  const terrainClassOf = new Map<number, string>();
  const classCount: Record<string, number> = {};
  for (const r of regions) {
    const n = cellCount[r.id] || 1;
    const mean = elevSum[r.id]! / n;
    const std = Math.sqrt(Math.max(0, elevSq[r.id]! / n - mean * mean));
    const rug = triSum[r.id]! / n;
    // Regions smaller than a raster pixel (micro-states) borrow a neighbour's land cover.
    const cov =
      coverCount.get(r.id) ??
      r.neighbours.map((n) => coverCount.get(n)).find((c) => c !== undefined) ??
      // Islands below raster resolution: assume jungle in the tropics, grassland elsewhere.
      { ...blankCover(), ...(Math.abs(r.lat) < 23.5 ? { jungle: 1 } : { grassland: 1 }) };
    const total = Object.values(cov).reduce((a, b) => a + b, 0) || 1;
    const cover = Object.fromEntries(COVER_KEYS.map((k) => [k, round(cov[k] / total, 3)])) as Record<CoverKey, number>;
    const tempC = Array.from({ length: 12 }, (_, m) => {
      const c = climCount[m]![r.id] || 0;
      return c > 0 ? tempSum[m]![r.id]! / c : NaN;
    });
    const precip = Array.from({ length: 12 }, (_, m) => {
      const c = climCount[m]![r.id] || 0;
      return c > 0 ? precSum[m]![r.id]! / c : NaN;
    });
    // Regions smaller than the climate sampling grid borrow the nearest neighbour's climate.
    if (tempC.some((v) => Number.isNaN(v))) {
      const donor = r.neighbours.map((id) => regionById.get(id)).find((d) => d && (climCount[0]![d.id] ?? 0) > 0);
      for (let m = 0; m < 12; m++) {
        const c = donor ? climCount[m]![donor.id]! : 0;
        tempC[m] = donor && c > 0 ? tempSum[m]![donor.id]! / c : 15 - Math.abs(r.lat) * 0.5;
        precip[m] = donor && c > 0 ? precSum[m]![donor.id]! / c : 60;
      }
    }
    const tempYear = tempC.reduce((a, b) => a + b, 0) / 12;
    const precipYear = precip.reduce((a, b) => a + b, 0);
    const terrainClass = classifyTerrain({
      iso3: r.iso3, lat: r.lat, tri: rug, elevStd: std, elevMean: mean, cover, tempYear, precipYear,
    });
    terrainClassOf.set(r.id, terrainClass);
    classCount[terrainClass] = (classCount[terrainClass] ?? 0) + 1;
    terrainRows.push({
      id: r.id,
      terrain: terrainClass,
      waterBodies: [...(waterTouch.get(r.id) ?? new Map<number, number>()).entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([c]) => c),
      elevMean: Math.round(mean),
      elevStd: Math.round(std),
      elevMax: Math.round(elevMax[r.id]!),
      ruggedness: Math.round(rug),
      cover,
      urbanShare: cover.urban,
    });
    // Derived monthly indices (documented in docs/BALANCE.md): winter from mean temperature below
    // 0 °C, monsoon from monthly rainfall above 150 mm, heat from mean temperature above 30 °C.
    const winter = tempC.map((t) => round(clamp(-t / 15, 0, 1), 2));
    const monsoon = precip.map((p) => round(clamp((p - 150) / 250, 0, 1), 2));
    const heat = tempC.map((t) => round(clamp((t - 30) / 10, 0, 1), 2));
    climateRows.push({
      id: r.id,
      tempC: tempC.map((v) => round(v, 1)),
      precipMm: precip.map((v) => Math.round(v)),
      winter,
      monsoon,
      heat,
    });
  }
  console.log('terrain classes:', classCount);

  // ---- 4. Border pixel pairs between adjacent land regions ----------------------------------------
  const pairKey = (a: number, b: number) => (a < b ? a * 65536 + b : b * 65536 + a);
  const borderPx = new Map<number, number>();
  const borderTri = new Map<number, number>();
  const borderElev = new Map<number, number>();
  const borderPixels = new Map<number, number[]>(); // sampled pixel indices for range tests
  for (let y = 0; y < raster.h - 1; y++) {
    for (let x = 0; x < raster.w; x++) {
      const i = y * raster.w + x;
      if (!raster.land[i]) continue;
      const a = raster.ids[i]!;
      if (!regionById.has(a)) continue;
      for (const j of [i + 1 - (x === raster.w - 1 ? raster.w : 0), i + raster.w]) {
        if (!raster.land[j]) continue;
        const b = raster.ids[j]!;
        if (b === a || !regionById.has(b)) continue;
        const k = pairKey(a, b);
        borderPx.set(k, (borderPx.get(k) ?? 0) + 1);
        const cell = etopoCell(pxLon(raster, i), pxLat(raster, i));
        borderTri.set(k, (borderTri.get(k) ?? 0) + tri(grid, cell));
        borderElev.set(k, (borderElev.get(k) ?? 0) + Math.max(0, grid[cell]!));
        const list = borderPixels.get(k) ?? [];
        if (list.length < 400) list.push(i);
        borderPixels.set(k, list);
      }
    }
  }

  // ---- 5. Rivers along borders ----------------------------------------------------------------------
  const rivers = await neGeojson<LineString | MultiLineString>('ne_10m_rivers_lake_centerlines');
  const riverHits = new Map<number, Map<string, number>>();
  for (const f of rivers.features as LineFeature[]) {
    if (f.properties.featurecla !== 'River' || Number(f.properties.scalerank) > 7) continue;
    const name = String(f.properties.name_en ?? f.properties.name ?? '').trim();
    if (!name) continue;
    for (const line of linesOf(f.geometry)) {
      walkLine(line, 3, (lon, lat) => {
        const i = px(raster, lon, lat);
        const x0 = i % raster.w;
        const y0 = Math.floor(i / raster.w);
        const seen = new Set<number>();
        for (let dy = -2; dy <= 2; dy++) {
          const y = y0 + dy;
          if (y < 0 || y >= raster.h) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const j = y * raster.w + ((((x0 + dx) % raster.w) + raster.w) % raster.w);
            if (raster.land[j]) seen.add(raster.ids[j]!);
          }
        }
        const ids = [...seen].filter((id) => regionById.has(id));
        for (let p = 0; p < ids.length; p++)
          for (let q = p + 1; q < ids.length; q++) {
            const k = pairKey(ids[p]!, ids[q]!);
            if (!borderPx.has(k)) continue;
            let m = riverHits.get(k);
            if (!m) riverHits.set(k, (m = new Map()));
            m.set(name, (m.get(name) ?? 0) + 1);
          }
      });
    }
  }

  // ---- 6. Mountain ranges along borders ---------------------------------------------------------------
  const geo = await neGeojson<Polygon | MultiPolygon>('ne_10m_geography_regions_polys');
  const ranges = (geo.features as PolyFeature[])
    .filter((f) => f.properties.FEATURECLA === 'Range/mtn')
    .map((f) => ({ f, name: String(f.properties.NAME_EN ?? f.properties.NAME ?? ''), box: bbox(f) }));
  const rangeHits = new Map<number, Map<string, number>>();
  for (const [k, pixels] of borderPixels) {
    const step = Math.max(1, Math.floor(pixels.length / 60));
    let tested = 0;
    for (let n = 0; n < pixels.length; n += step) {
      const i = pixels[n]!;
      const lon = pxLon(raster, i);
      const lat = pxLat(raster, i);
      tested++;
      for (const rg of ranges) {
        const [minX, minY, maxX, maxY] = rg.box;
        if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
        if (geoContains(rg.f, [lon, lat])) {
          let m = rangeHits.get(k);
          if (!m) rangeHits.set(k, (m = new Map()));
          m.set(rg.name, (m.get(rg.name) ?? 0) + 1);
        }
      }
    }
    const m = rangeHits.get(k);
    if (m) for (const [name, v] of m) m.set(name, v / tested);
  }

  // ---- 7. Passes (hand-listed) → edges --------------------------------------------------------------
  const passEdge = new Map<number, string>();
  for (const p of PASSES) {
    const i = px(raster, p.lon, p.lat);
    const x0 = i % raster.w, y0 = Math.floor(i / raster.w);
    const count = new Map<number, number>();
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const y = y0 + dy;
        if (y < 0 || y >= raster.h) continue;
        const j = y * raster.w + ((((x0 + dx) % raster.w) + raster.w) % raster.w);
        if (raster.land[j]) count.set(raster.ids[j]!, (count.get(raster.ids[j]!) ?? 0) + 1);
      }
    const ids = [...count.entries()].filter(([id]) => regionById.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    let placed = false;
    for (let a = 0; a < ids.length && !placed; a++)
      for (let b = a + 1; b < ids.length && !placed; b++) {
        const k = pairKey(ids[a]!, ids[b]!);
        if (borderPx.has(k)) {
          passEdge.set(k, p.name);
          placed = true;
        }
      }
    if (!placed) console.warn(`pass ${p.name}: no adjacent region pair found near ${p.lat},${p.lon}`);
  }

  const crossings: Record<string, unknown>[] = [];
  let riverEdges = 0, mountainEdges = 0;
  const neighbourSet = new Map(regions.map((r) => [r.id, new Set(r.neighbours)]));
  for (const [k, n] of borderPx) {
    const a = Math.floor(k / 65536), b = k % 65536;
    if (!neighbourSet.get(a)?.has(b)) continue; // one-pixel contacts are not map adjacencies
    const rv = riverHits.get(k);
    const riverNames: string[] = [];
    if (rv) {
      // A river that follows the border yields ≈ 3.3 samples per border pixel (3 km vs ~10 km).
      for (const [name, hits] of rv) if (hits / (3.3 * n) >= 0.3 && hits >= 4) riverNames.push(name);
    }
    const rg = rangeHits.get(k);
    const rangeNames: string[] = [];
    if (rg) for (const [name, share] of rg) if (share >= 0.3 && name) rangeNames.push(name);
    const bTri = borderTri.get(k)! / n;
    const bElev = borderElev.get(k)! / n;
    const mountain = bTri >= 120 || rangeNames.length > 0 || bElev >= 3000;
    const pass = passEdge.get(k) ?? null;
    if (riverNames.length > 0) riverEdges++;
    if (mountain) mountainEdges++;
    if (riverNames.length === 0 && !mountain && !pass) continue;
    crossings.push({
      a, b,
      borderKm: Math.round(n * 9.8),
      rivers: riverNames.slice(0, 3),
      mountain,
      ranges: rangeNames.slice(0, 3),
      borderRuggedness: Math.round(bTri),
      borderElev: Math.round(bElev),
      pass,
    });
  }
  console.log(`crossings: ${crossings.length} edges with features (${riverEdges} river, ${mountainEdges} mountain, ${passEdge.size} passes) of ${borderPx.size} borders`);

  // ---- 8. Ports (NGA World Port Index) -------------------------------------------------------------
  const wpiCsv = (await fetchCached(WPI_URL, 'wpi.csv')).toString('utf8').replace(/^\uFEFF/, '');
  const wpi = parseCsv(wpiCsv);
  const col = (name: string) => wpi.header.indexOf(name);
  const cName = col('Main Port Name'), cSize = col('Harbor Size'), cLat = col('Latitude'), cLon = col('Longitude'), cUse = col('Harbor Use');
  if ([cName, cSize, cLat, cLon].some((c) => c < 0)) throw new Error('WPI columns not found');
  const SIZE_CAP: Record<string, number> = { Large: 4, Medium: 2, Small: 0.8, 'Very Small': 0.3 };
  const SIZE_CODE: Record<string, string> = { Large: 'L', Medium: 'M', Small: 'S', 'Very Small': 'V' };
  const portsByRegion = new Map<number, { name: string; size: string; capacity: number }[]>();
  let portsPlaced = 0;
  for (const row of wpi.rows) {
    const size = row[cSize] ?? '';
    const cap = SIZE_CAP[size];
    if (!cap) continue;
    if (cUse >= 0 && /Mil/i.test(row[cUse] ?? '') && !/Com/i.test(row[cUse] ?? '')) continue; // purely military
    const lat = Number(row[cLat]), lon = Number(row[cLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const i = nearest(raster, px(raster, lon, lat), 3, (j) => raster.land[j] === 1 && regionById.has(raster.ids[j]!));
    if (i < 0) continue;
    const id = raster.ids[i]!;
    const list = portsByRegion.get(id) ?? [];
    list.push({ name: row[cName] ?? 'port', size: SIZE_CODE[size]!, capacity: cap });
    portsByRegion.set(id, list);
    portsPlaced++;
  }
  console.log(`ports placed: ${portsPlaced} in ${portsByRegion.size} regions`);

  // ---- 9. Roads and railways (Natural Earth 10m) ----------------------------------------------------
  const roadKm = new Float64Array(maxId), railKm = new Float64Array(maxId);
  if (!SKIP_INFRA) {
    const roads = await neGeojson<LineString | MultiLineString>('ne_10m_roads');
    for (const f of roads.features as LineFeature[]) {
      if (/Ferry/i.test(String(f.properties.type ?? ''))) continue;
      for (const line of linesOf(f.geometry))
        walkLine(line, 2, (lon, lat, seg) => {
          const i = px(raster, lon, lat);
          if (raster.land[i]) roadKm[raster.ids[i]!]! += seg;
        });
    }
    const rails = await neGeojson<LineString | MultiLineString>('ne_10m_railroads');
    for (const f of rails.features as LineFeature[]) {
      if (/ferry/i.test(String(f.properties.featurecla ?? ''))) continue;
      for (const line of linesOf(f.geometry))
        walkLine(line, 2, (lon, lat, seg) => {
          const i = px(raster, lon, lat);
          if (raster.land[i]) railKm[raster.ids[i]!]! += seg;
        });
    }
  }
  const infraRows: Record<string, unknown>[] = [];
  const densities: number[] = [];
  for (const r of regions) {
    const kkm2 = Math.max(1, r.areaKm2 / 1000);
    const road = roadKm[r.id]! / kkm2;
    const rail = railKm[r.id]! / kkm2;
    densities.push(road + 2 * rail);
  }
  const sortedD = [...densities].sort((a, b) => a - b);
  const q = (p: number) => sortedD[Math.min(sortedD.length - 1, Math.floor(p * sortedD.length))]!;
  console.log(`road+2·rail density km/1000km²: p10 ${q(0.1).toFixed(1)} p50 ${q(0.5).toFixed(1)} p90 ${q(0.9).toFixed(1)} max ${q(0.999).toFixed(1)}`);
  const scaleD = Math.max(1, q(0.92)); // regions at the 92nd percentile and above score 1.0
  regions.forEach((r, idx) => {
    const kkm2 = Math.max(1, r.areaKm2 / 1000);
    const ports = (portsByRegion.get(r.id) ?? []).sort((a, b) => b.capacity - a.capacity);
    const portCapacity = round(Math.min(16, ports.reduce((s, p) => s + p.capacity, 0)), 1);
    const infrastructure = SKIP_INFRA
      ? 0.5
      : round(clamp(0.08 + 0.92 * Math.sqrt(densities[idx]! / scaleD), 0.08, 1), 2);
    infraRows.push({
      id: r.id,
      roadKmPer1000Km2: round(roadKm[r.id]! / kkm2, 1),
      railKmPer1000Km2: round(railKm[r.id]! / kkm2, 1),
      infrastructure,
      portCapacity,
      majorPort: ports.some((p) => p.size === 'L' || p.size === 'M'),
      ports: ports.slice(0, 4).map((p) => ({ name: p.name, size: p.size })),
    });
  });

  // ---- 10. Chokepoints ------------------------------------------------------------------------------------
  const chokeRows: Record<string, unknown>[] = [];
  for (const c of CHOKEPOINTS) {
    const zones: number[] = [];
    for (const [lat, lon] of c.zoneProbes) {
      const i = nearest(raster, px(raster, lon, lat), 6, (j) => raster.land[j] === 0 && seaById.has(raster.ids[j]!));
      if (i < 0) throw new Error(`${c.id}: no sea zone near ${lat},${lon}`);
      const id = raster.ids[i]!;
      if (!zones.includes(id)) zones.push(id);
    }
    const shores: number[] = [];
    for (const [lat, lon] of c.shoreProbes) {
      const i = nearest(raster, px(raster, lon, lat), 6, (j) => raster.land[j] === 1 && regionById.has(raster.ids[j]!));
      if (i < 0) throw new Error(`${c.id}: no land region near ${lat},${lon}`);
      const id = raster.ids[i]!;
      if (!shores.includes(id)) shores.push(id);
    }
    chokeRows.push({
      id: c.id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      zones,
      zoneNames: zones.map((z) => seaById.get(z)!.name),
      shores,
      shoreNames: shores.map((s) => `${regionById.get(s)!.name} (${regionById.get(s)!.iso3})`),
      oilMbd: c.oilMbd,
      tradeShare: c.tradeShare,
      oilShock: c.oilShock,
      semiconductors: c.semiconductors,
      dependents: c.dependents,
      note: c.note,
    });
  }

  // ---- Write ----------------------------------------------------------------------------------------------
  const write = (file: string, obj: Record<string, unknown>) => {
    writeFileSync(join(DATA, file), JSON.stringify(obj) + '\n');
    console.log(`wrote data/${file} (${(JSON.stringify(obj).length / 1024).toFixed(0)} KB)`);
  };
  write('terrain.json', {
    source:
      'NOAA NCEI ETOPO 2022 Global Relief Model, 60 arc-second surface elevation (public domain), read at a 2 arc-minute stride via the NCEI THREDDS OPeNDAP service; land cover from NASA MODIS MCD12 IGBP annual land cover (2022) as rendered by NASA Global Imagery Browse Services (GIBS), decoded with the GIBS MODIS_IGBP_Land_Cover_Type colormap (public domain). Aggregated per region by scripts/build-geography.ts over the game’s region-ID raster.',
    asOf: AS_OF,
    estimate: true,
    licence: 'NOAA ETOPO 2022: public domain (US Government). NASA MODIS/GIBS imagery: public domain (NASA).',
    notes:
      'elevMean/elevStd/elevMax in metres over land cells (sea below 0 clamped to 0); ruggedness = mean absolute elevation difference to the four neighbouring 2-arc-minute cells (≈3.7 km), i.e. a terrain ruggedness index in metres. cover = area shares of IGBP class groups (forest = evergreen/deciduous needleleaf, deciduous broadleaf and mixed forest; jungle = evergreen broadleaf; woodland = woody savanna (open boreal/subtropical forest); shrub = closed+open shrublands; savanna; cropland = croplands + cropland/natural mosaic; marsh = permanent wetlands; barren; ice = permanent snow and ice; water). terrain = classifyTerrain() in scripts/build-geography.ts (see classifier). waterBodies = ids of the 4-connected water bodies (≥ 40 raster pixels) the region borders, largest first; landings are only possible between regions sharing one.',
    classifier: 'ice: Antarctica or ice ≥ 0.5; urban: urban ≥ 0.12; mountains: ruggedness ≥ 130 m or (≥ 100 m and elevStd ≥ 450 m) or elevMean ≥ 3500 m; jungle: evergreen broadleaf ≥ 0.30 within 30° of the equator; marsh: wetlands ≥ 0.12; desert: barren + ½·shrub ≥ 0.45 and annual precipitation < 400 mm; arctic: annual mean temperature < −2 °C and forest < 0.35; hills: ruggedness ≥ 70 m; forest: forest + jungle + 0.7·woodland ≥ 0.45; else plains.',
    counts: classCount,
    regions: terrainRows,
  });
  write('climate.json', {
    source:
      'NASA MERRA-2 (GMAO) monthly mean 2 m air temperature (M2TMNXSLV T2M) and bias-corrected total precipitation (M2TMNXFLX PRECTOTCORR) for January–December 2023, as rendered by NASA GIBS (MERRA2_2m_Air_Temperature_Monthly, MERRA2_Precipitation_Bias_Corrected_Monthly) and decoded with the GIBS colormaps (1 K / fine precipitation bins). Averaged per region by scripts/build-geography.ts.',
    asOf: AS_OF,
    estimate: true,
    licence: 'NASA MERRA-2 and GIBS imagery: public domain (NASA).',
    notes:
      'tempC = monthly mean 2 m temperature (°C), precipMm = monthly precipitation (mm). Derived indices in 0..1 per month: winter = clamp(−tempC / 15) (1 at −15 °C), monsoon = clamp((precipMm − 150) / 250) (1 at 400 mm/month), heat = clamp((tempC − 30) / 10) (1 at 40 °C). A single year (2023) stands in for the climatology; month-to-month patterns (monsoon timing, continental winters) are what the game uses.',
    regions: climateRows,
  });
  write('crossings.json', {
    source:
      'Natural Earth v5.1.1 (public domain): 1:10m Rivers + Lake Centerlines (rivers of scalerank ≤ 7 that run along ≥ 30 % of a border) and 1:10m Geography Regions polygons (featurecla Range/mtn covering ≥ 30 % of a border); border ruggedness and elevation from NOAA ETOPO 2022 sampled along the shared pixels of the region-ID raster; named passes hand-listed in scripts/geo/handData.ts from Wikipedia/Britannica coordinates.',
    asOf: AS_OF,
    estimate: true,
    licence: 'Natural Earth: public domain. ETOPO 2022: public domain. Pass list: original compilation of public facts.',
    notes:
      'One row per adjacent land-region pair that has a crossing feature. mountain = border ruggedness ≥ 120 m, or a named range along the border, or mean border elevation ≥ 3000 m. borderKm ≈ shared border length (raster pixels × 9.8 km). pass = a named pass on that border (the crossing is narrow but passable).',
    edges: crossings,
  });
  write('infrastructure.json', {
    source:
      'Ports: NGA World Port Index (Pub. 150, msi.nga.mil, CSV export; Harbor Size L/M/S/V), assigned to regions via the region-ID raster. Road and rail density: Natural Earth v5.1.1 1:10m Roads and 1:10m Railroads (public domain), line length sampled every 2 km per region ÷ region area.',
    asOf: AS_OF,
    estimate: true,
    licence: 'NGA World Port Index: public domain (US Government). Natural Earth: public domain.',
    notes:
      'portCapacity = Σ harbour-size weights (L 4, M 2, S 0.8, V 0.3; purely military harbours excluded), capped at 16 — an abstract supply-throughput capacity. infrastructure = clamp(0.08 + 0.92·√((road + 2·rail density) / D)) with D the 92nd-percentile density, so the best-connected tenth of regions score 1.0; Natural Earth roads are generalised, so this is a relative index, not an absolute network length.',
    densityScale: round(scaleD, 1),
    regions: infraRows,
  });
  write('chokepoints.json', {
    source:
      'Chokepoint list, positions and shores: original compilation of public geography (Wikipedia). Oil flows (million barrels per day, 2023) from the US Energy Information Administration, “World Oil Transit Chokepoints” (2024 update) and “Strait of Hormuz” fact sheet (2025). Trade shares are rounded public estimates (UNCTAD Review of Maritime Transport, Suez Canal Authority, Bloomberg/CSIS reporting for the Taiwan Strait); oilShock, semiconductors and dependents are game-design values. Sea zones and shore regions resolved by scripts/build-geography.ts from the region-ID raster.',
    asOf: AS_OF,
    estimate: true,
    licence: 'EIA: public domain (US Government). Natural Earth-derived zones: public domain.',
    notes:
      'zones = sea zones on either side of the chokepoint (closing it blocks movement between them and trade through them); shores = land regions whose controller can close or mine it. oilShock = oil-price index increase while closed; dependents = GDP-growth exposure (share) of nations whose trade routes run through it.',
    chokepoints: chokeRows,
  });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return { header, rows };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
