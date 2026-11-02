/**
 * scripts/build-map.ts — builds the strategic map from Natural Earth (public domain).
 *
 *   node scripts/build-map.ts [--cache DIR] [--width 4096]
 *
 * Inputs (downloaded once into the cache directory):
 *   - Natural Earth 1:10m admin-1 states/provinces (GeoJSON)
 *   - Natural Earth 1:50m admin-0 countries (GeoJSON) — sovereignty + population
 *   - Natural Earth 1:10m populated places (GeoJSON) — capitals, cities, population weights
 *   - NASA Blue Marble topography (GEBCO elevation, 5400×2700 grayscale) — terrain guess
 *
 * Outputs:
 *   - data/regions.topo.json   simplified TopoJSON of ~1,000 land regions (+ Antarctica)
 *   - data/regions.meta.json   region + sea-zone metadata (ids, names, owners, centroids,
 *                              area, population estimate, neighbours, terrain, coastal)
 *   - data/cities.json         national capitals and major cities with region ids
 *   - public/textures/regions-id.png   4096×2048 equirectangular region-ID map
 *                              (R = id & 255, G = id >> 8, B = 255 on land, 0 on water)
 *   - public/textures/ocean-mask.png   2048×1024 grayscale land/ocean mask
 *
 * Deterministic: the only randomness is a seeded mulberry32 used for sea-zone seeding.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import { topology } from 'topojson-server';
import { feature, merge, neighbors } from 'topojson-client';
import { filterWeight, presimplify, quantile, simplify } from 'topojson-simplify';
import sharp from 'sharp';
import type {
  Feature,
  FeatureCollection,
  GeoJsonObject,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';
import type {
  GeometryCollection,
  MultiPolygon as TopoMultiPolygon,
  Polygon as TopoPolygon,
  Topology,
} from 'topojson-specification';

// ---------------------------------------------------------------------------------------------
// CLI + constants
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
}
const ROOT = process.cwd();
const CACHE = arg('cache', join(ROOT, '.cache', 'natural-earth'));
const W = Number(arg('width', '4096'));
const H = W / 2;
const TARGET_REGIONS = Number(arg('target', '1000'));
const SEA_ZONES = Number(arg('seaZones', '150'));
/** Fraction of vertices KEPT by Visvalingam simplification (topojson-simplify's quantile sorts descending). */
const SIMPLIFY_QUANTILE = Number(arg('simplify', '0.08'));
const EARTH_RADIUS_KM = 6371.0088;
const AS_OF = '2026-11-02';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const SOURCES = {
  admin1: `${NE}/ne_10m_admin_1_states_provinces.geojson`,
  admin0: `${NE}/ne_50m_admin_0_countries.geojson`,
  places: `${NE}/ne_10m_populated_places_simple.geojson`,
  elevation:
    'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_5400x2700.jpg',
};

/** Natural Earth adm0_a3 codes → ISO 3166-1 alpha-3 used by the game (D-020). */
const ISO_REMAP: Record<string, string> = {
  SDS: 'SSD', // South Sudan
  PSX: 'PSE', // Palestine
  KOS: 'XKX', // Kosovo
  SAH: 'MAR', // Western Sahara → administered by Morocco
  CYN: 'CYP', // Northern Cyprus → Cyprus
  SOL: 'SOM', // Somaliland → Somalia
  KAS: 'IND', // Siachen Glacier → India (de facto control)
  ESB: 'CYP', // Dhekelia SBA → folded into Cyprus
  USG: 'CUB', // Guantánamo Bay → folded into Cuba (territory, not control)
  GIB: 'GBR', // Gibraltar
  KAB: 'KAZ', // Baykonur
  WSB: 'MAR', // Western Sahara buffer
  UMI: 'USA', // US minor outlying islands
  CSI: 'AUS', // Coral Sea Islands
  CLP: 'FRA', // Clipperton
  IOA: 'AUS', // Indian Ocean Territories
  HMD: 'AUS', // Heard & McDonald
  ATC: 'AUS', // Ashmore & Cartier
  ATF: 'FRA', // French Southern Lands
};
/** adm0_a3 codes dropped entirely (disputed specks / uninhabited). */
const DROP_ADM0 = new Set(['PGA', 'SGS', 'IOT', 'BJN', 'SER', 'SCR']);
/** Antarctica is kept as a single neutral, non-ownable region. */
const ANTARCTICA = 'ATA';
const MAJORS = new Set([
  'USA',
  'CHN',
  'RUS',
  'IND',
  'GBR',
  'FRA',
  'DEU',
  'JPN',
  'KOR',
  'IRN',
  'ISR',
  'TUR',
  'PAK',
  'BRA',
]);

/** Canal / strait links the raster cannot resolve at ~10 km per pixel: [lat, lon] pairs. */
const STRAITS: Array<{ name: string; a: [number, number]; b: [number, number] }> = [
  { name: 'Bosporus & Dardanelles', a: [42.5, 31.0], b: [39.5, 25.5] },
  { name: 'Suez Canal', a: [32.0, 32.0], b: [27.5, 34.2] },
  { name: 'Panama Canal', a: [10.0, -79.5], b: [7.5, -79.8] },
  { name: 'Strait of Gibraltar', a: [36.0, -6.5], b: [36.2, -3.5] },
  { name: 'Danish straits', a: [57.0, 10.5], b: [55.2, 14.5] },
  { name: 'Strait of Hormuz', a: [26.5, 55.0], b: [25.0, 58.0] },
  { name: 'Bab-el-Mandeb', a: [14.5, 42.0], b: [12.0, 45.0] },
  { name: 'Kerch Strait', a: [46.0, 37.0], b: [44.5, 36.0] },
];

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function fetchCached(url: string, file: string): Promise<Buffer> {
  const path = join(CACHE, file);
  if (existsSync(path)) return readFileSync(path);
  mkdirSync(CACHE, { recursive: true });
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function toUnit(lat: number, lon: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
function greatCircleKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const [ax, ay, az] = toUnit(aLat, aLon);
  const [bx, by, bz] = toUnit(bLat, bLon);
  const d = clamp(ax * bx + ay * by + az * bz, -1, 1);
  return Math.acos(d) * EARTH_RADIUS_KM;
}

type Props = Record<string, unknown>;
type PolyFeature = Feature<Polygon | MultiPolygon, Props>;

function ringsOf(geom: Polygon | MultiPolygon): Position[][] {
  return geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
}

// ---------------------------------------------------------------------------------------------
// 1. Load Natural Earth
// ---------------------------------------------------------------------------------------------

interface Adm0Row {
  adm0: string;
  sov: string;
  type: string;
  name: string;
  pop: number;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const [a1Buf, a0Buf, ppBuf] = await Promise.all([
    fetchCached(SOURCES.admin1, 'ne_10m_admin_1_states_provinces.geojson'),
    fetchCached(SOURCES.admin0, 'ne_50m_admin_0_countries.geojson'),
    fetchCached(SOURCES.places, 'ne_10m_populated_places_simple.geojson'),
  ]);
  const admin1 = JSON.parse(a1Buf.toString('utf8')) as FeatureCollection<
    Polygon | MultiPolygon,
    Props
  >;
  const admin0 = JSON.parse(a0Buf.toString('utf8')) as FeatureCollection<
    Polygon | MultiPolygon,
    Props
  >;
  const places = JSON.parse(ppBuf.toString('utf8')) as FeatureCollection<
    { type: 'Point'; coordinates: Position },
    Props
  >;
  console.log(
    `loaded admin1=${admin1.features.length} admin0=${admin0.features.length} places=${places.features.length}`,
  );

  // --- sovereignty resolution -----------------------------------------------------------------
  const adm0Rows: Adm0Row[] = admin0.features.map((f) => ({
    adm0: String(f.properties.ADM0_A3),
    sov: String(f.properties.SOV_A3),
    type: String(f.properties.TYPE),
    name: String(f.properties.NAME_EN ?? f.properties.NAME),
    pop: Number(f.properties.POP_EST ?? 0),
  }));
  const bySov = new Map<string, Adm0Row[]>();
  for (const r of adm0Rows) bySov.set(r.sov, [...(bySov.get(r.sov) ?? []), r]);
  const sovereignOf = new Map<string, string>(); // sov code → adm0 of the sovereign state
  for (const [sov, rows] of bySov) {
    const s =
      rows.find((r) => r.type === 'Sovereign country' || r.type === 'Sovereignty') ??
      rows.reduce((a, b) => (b.pop > a.pop ? b : a));
    sovereignOf.set(sov, s.adm0);
  }
  const rowByAdm0 = new Map(adm0Rows.map((r) => [r.adm0, r]));
  const countryName = new Map<string, string>();
  for (const r of adm0Rows) countryName.set(ISO_REMAP[r.adm0] ?? r.adm0, r.name);
  countryName.set('XKX', 'Kosovo');
  countryName.set('PSE', 'Palestine');
  countryName.set('SSD', 'South Sudan');

  /** Owner ISO3 for an admin-1 feature's adm0_a3, or null to drop. */
  function ownerOf(adm0: string): string | null {
    if (DROP_ADM0.has(adm0)) return null;
    if (adm0 === ANTARCTICA) return ANTARCTICA;
    const remapped = ISO_REMAP[adm0];
    if (remapped) return remapped;
    const row = rowByAdm0.get(adm0);
    if (!row) return adm0; // unknown code: keep as-is
    const sov = sovereignOf.get(row.sov) ?? adm0;
    return ISO_REMAP[sov] ?? sov;
  }

  // --- per-unit metrics -----------------------------------------------------------------------
  interface Unit {
    idx: number; // index into topology geometries
    owner: string;
    name: string;
    areaKm2: number;
    cityPop: number;
    lat: number;
    lon: number;
    feature: PolyFeature;
  }
  const units: Unit[] = [];
  const kept: PolyFeature[] = [];
  for (const f of admin1.features) {
    if (!f.geometry) continue;
    const owner = ownerOf(String(f.properties.adm0_a3));
    if (!owner) continue;
    const areaKm2 = geoArea(f) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
    if (!(areaKm2 > 0)) continue;
    const [lon, lat] = geoCentroid(f);
    units.push({
      idx: kept.length,
      owner,
      name: String(f.properties.name_en ?? f.properties.name ?? f.properties.gn_name ?? 'Region'),
      areaKm2,
      cityPop: 0,
      lat: lat ?? 0,
      lon: lon ?? 0,
      feature: f,
    });
    kept.push(f);
  }

  // City populations → unit weights (bbox prefilter + spherical point-in-polygon).
  const bboxes = kept.map((f) => {
    let x0 = 180,
      x1 = -180,
      y0 = 90,
      y1 = -90;
    for (const ring of ringsOf(f.geometry))
      for (const [x, y] of ring as [number, number][]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    return [x0, y0, x1, y1] as const;
  });
  function unitAt(lon: number, lat: number): Unit | null {
    for (let i = 0; i < kept.length; i++) {
      const b = bboxes[i]!;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (geoContains(kept[i]!, [lon, lat])) return units[i]!;
    }
    return null;
  }
  for (const p of places.features) {
    const [lon, lat] = p.geometry.coordinates as [number, number];
    const u = unitAt(lon, lat);
    if (u) u.cityPop += Math.max(0, Number(p.properties.pop_max ?? 0));
  }

  // --- drop far-flung specks (D-020) ----------------------------------------------------------
  const byOwner = new Map<string, Unit[]>();
  for (const u of units) byOwner.set(u.owner, [...(byOwner.get(u.owner) ?? []), u]);
  const dropped = new Set<number>();
  for (const [, list] of byOwner) {
    for (const u of list) {
      if (u.areaKm2 >= 50 || u.cityPop > 100_000) continue;
      const near = list.some((o) => o !== u && greatCircleKm(u.lat, u.lon, o.lat, o.lon) < 300);
      if (!near && list.length > 1) dropped.add(u.idx);
    }
  }
  console.log(`units=${units.length} dropped specks=${dropped.size}`);

  // --- topology of admin-1 → neighbours -------------------------------------------------------
  const a1Topo = topology(
    { a1: { type: 'FeatureCollection', features: kept } as unknown as GeoJsonObject },
    1e5,
  ) as Topology<{
    a1: GeometryCollection<Props>;
  }>;
  const a1Geoms = a1Topo.objects.a1.geometries;
  const adjacency = neighbors(a1Geoms);

  // --- target region counts per country ---------------------------------------------------------
  const popOf = (iso: string) =>
    adm0Rows
      .filter(
        (r) =>
          (ISO_REMAP[r.adm0] ?? sovereignOf.get(r.sov) ?? r.adm0) === iso &&
          (ISO_REMAP[r.adm0] ?? r.adm0) === iso,
      )
      .reduce((s, r) => s + r.pop, 0);
  const countries = [...byOwner.keys()].filter((c) => c !== ANTARCTICA);
  const countryArea = new Map(
    countries.map((c) => [c, byOwner.get(c)!.reduce((s, u) => s + u.areaKm2, 0)]),
  );
  const countryPop = new Map(countries.map((c) => [c, popOf(c)]));
  const liveUnits = (c: string) => byOwner.get(c)!.filter((u) => !dropped.has(u.idx)).length;
  function targets(scale: number): Map<string, number> {
    const m = new Map<string, number>();
    for (const c of countries) {
      const raw =
        scale *
        (1.3 * Math.sqrt((countryArea.get(c) ?? 0) / 1e5) +
          1.3 * Math.sqrt((countryPop.get(c) ?? 0) / 1e7));
      let t = clamp(Math.round(raw), 1, 80);
      if (MAJORS.has(c)) t = Math.max(t, 20);
      m.set(c, Math.max(1, Math.min(t, liveUnits(c))));
    }
    return m;
  }
  let scale = 1;
  for (let it = 0; it < 30; it++) {
    const total = [...targets(scale).values()].reduce((a, b) => a + b, 0);
    if (Math.abs(total - TARGET_REGIONS) < 8) break;
    scale *= total > TARGET_REGIONS ? 0.97 : 1.03;
  }
  const target = targets(scale);
  console.log(
    `region target scale=${round(scale, 3)} total=${[...target.values()].reduce((a, b) => a + b, 0)}`,
  );

  // --- greedy merge within each country -------------------------------------------------------
  interface Group {
    members: number[]; // unit idx
    weight: number;
    areaKm2: number;
    cityPop: number;
    lat: number;
    lon: number;
    locked: boolean;
  }
  const regionsOut: Array<{
    iso3: string;
    members: number[];
    name: string;
    areaKm2: number;
    cityPop: number;
  }> = [];
  for (const iso of [...byOwner.keys()]) {
    const list = byOwner.get(iso)!.filter((u) => !dropped.has(u.idx));
    if (list.length === 0) continue;
    const totalArea = list.reduce((s, u) => s + u.areaKm2, 0);
    const totalCity = list.reduce((s, u) => s + u.cityPop, 0);
    const weightOf = (a: number, c: number) =>
      0.5 * (a / totalArea) + (totalCity > 0 ? 0.5 * (c / totalCity) : 0.5 * (a / totalArea));
    const groups: Group[] = list.map((u) => ({
      members: [u.idx],
      weight: weightOf(u.areaKm2, u.cityPop),
      areaKm2: u.areaKm2,
      cityPop: u.cityPop,
      lat: u.lat,
      lon: u.lon,
      locked: false,
    }));
    const groupOfUnit = new Map<number, Group>();
    for (const g of groups) groupOfUnit.set(g.members[0]!, g);
    const sameCountry = new Set(list.map((u) => u.idx));
    const neighbourGroups = (g: Group): Set<Group> => {
      const out = new Set<Group>();
      for (const m of g.members)
        for (const n of adjacency[m] ?? []) {
          if (!sameCountry.has(n) || dropped.has(n)) continue;
          const ng = groupOfUnit.get(n);
          if (ng && ng !== g) out.add(ng);
        }
      return out;
    };
    const want = iso === ANTARCTICA ? 1 : (target.get(iso) ?? 1);
    while (groups.length > want) {
      const live = groups.filter((g) => !g.locked);
      if (live.length === 0) break;
      live.sort((a, b) => a.weight - b.weight);
      const g = live[0]!;
      const ns = [...neighbourGroups(g)];
      let partner: Group | undefined;
      if (ns.length > 0) {
        ns.sort((a, b) => a.weight - b.weight);
        partner = ns[0];
      } else if (iso === ANTARCTICA || g.areaKm2 < 5000) {
        // Disconnected speck: merge with the nearest group of the same country.
        let best = Infinity;
        for (const o of groups) {
          if (o === g) continue;
          const d = greatCircleKm(g.lat, g.lon, o.lat, o.lon);
          if (d < best) {
            best = d;
            partner = o;
          }
        }
      }
      if (!partner) {
        g.locked = true;
        continue;
      }
      // merge g into partner
      const a = partner.areaKm2 + g.areaKm2;
      partner.lat = (partner.lat * partner.areaKm2 + g.lat * g.areaKm2) / a;
      partner.lon = (partner.lon * partner.areaKm2 + g.lon * g.areaKm2) / a;
      partner.areaKm2 = a;
      partner.cityPop += g.cityPop;
      partner.weight = weightOf(partner.areaKm2, partner.cityPop);
      partner.members.push(...g.members);
      for (const m of g.members) groupOfUnit.set(m, partner);
      groups.splice(groups.indexOf(g), 1);
    }
    for (const g of groups) {
      const biggest = g.members
        .map((m) => units[m]!)
        .reduce((a, b) =>
          weightOf(b.areaKm2, b.cityPop) > weightOf(a.areaKm2, a.cityPop) ? b : a,
        );
      regionsOut.push({
        iso3: iso,
        members: g.members,
        name: biggest.name,
        areaKm2: g.areaKm2,
        cityPop: g.cityPop,
      });
    }
  }
  console.log(
    `regions=${regionsOut.length} countries=${new Set(regionsOut.map((r) => r.iso3)).size}`,
  );

  // --- merged geometry → final topology → simplify --------------------------------------------
  const mergedFeatures: PolyFeature[] = regionsOut.map((r, i) => ({
    type: 'Feature',
    properties: { id: i + 1, iso3: r.iso3, name: r.name },
    geometry: merge(
      a1Topo,
      r.members.map((m) => a1Geoms[m]! as TopoPolygon | TopoMultiPolygon),
    ),
  }));
  let topo = topology(
    {
      regions: { type: 'FeatureCollection', features: mergedFeatures } as unknown as GeoJsonObject,
    },
    1e5,
  ) as Topology<{
    regions: GeometryCollection<Props>;
  }>;
  topo = presimplify(topo);
  topo = simplify(topo, quantile(topo, SIMPLIFY_QUANTILE));
  // Drop rings smaller than ~4 km², but never a region's last exterior ring (topojson-simplify's
  // own filter() removes empty geometries from the collection, which would shift region ids).
  {
    // topojson-simplify's predicate actually receives rings of arc indexes (its typings say positions).
    const keepRing = filterWeight(topo, 1e-7) as unknown as (
      ring: number[],
      interior: boolean,
    ) => boolean;
    const ringWeight = (ring: number[]): number => {
      // approximate: count of points as a proxy when weights are unavailable
      return ring.length;
    };
    for (const g of topo.objects.regions.geometries) {
      if (g.type === 'Polygon') {
        const rings = g.arcs;
        const ext = rings[0]!;
        if (!keepRing(ext, false)) continue; // keep as-is: it is the only exterior ring
        g.arcs = [ext, ...rings.slice(1).filter((r) => keepRing(r, true))];
      } else if (g.type === 'MultiPolygon') {
        const polys = g.arcs
          .filter((rings) => keepRing(rings[0]!, false))
          .map((rings) => [rings[0]!, ...rings.slice(1).filter((r) => keepRing(r, true))]);
        if (polys.length === 0) {
          const biggest = g.arcs.reduce((a, b) => (ringWeight(b[0]!) > ringWeight(a[0]!) ? b : a));
          g.arcs = [[biggest[0]!]];
        } else g.arcs = polys;
      }
    }
    // Prune unused arcs and renumber.
    const used = new Set<number>();
    const visit = (arcs: number[][] | number[][][]) => {
      for (const x of arcs as unknown[]) {
        if (Array.isArray(x)) visit(x as number[][]);
        else used.add((x as number) < 0 ? ~(x as number) : (x as number));
      }
    };
    for (const g of topo.objects.regions.geometries)
      if (g.type === 'Polygon' || g.type === 'MultiPolygon') visit(g.arcs);
    const remap = new Map<number, number>();
    const newArcs: typeof topo.arcs = [];
    topo.arcs.forEach((arc, i) => {
      if (used.has(i)) {
        remap.set(i, newArcs.length);
        newArcs.push(arc.map((p) => [p[0]!, p[1]!]));
      }
    });
    const renumber = (arcs: unknown[]): unknown[] =>
      arcs.map((x) =>
        Array.isArray(x)
          ? renumber(x)
          : (x as number) < 0
            ? ~remap.get(~(x as number))!
            : remap.get(x as number)!,
      );
    for (const g of topo.objects.regions.geometries) {
      if (g.type === 'Polygon') g.arcs = renumber(g.arcs) as number[][];
      else if (g.type === 'MultiPolygon') g.arcs = renumber(g.arcs) as number[][][];
    }
    topo.arcs = newArcs;
  }
  const regionFeatures = feature(topo, topo.objects.regions) as FeatureCollection<
    Polygon | MultiPolygon,
    Props
  >;

  // --- rasterize region IDs -------------------------------------------------------------------
  const ids = new Uint16Array(W * H);
  function rasterize(rings: Position[][], id: number): void {
    let yMin = Infinity,
      yMax = -Infinity;
    for (const ring of rings)
      for (const p of ring) {
        const y = p[1]!;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    const py0 = clamp(Math.floor(((90 - yMax) / 180) * H), 0, H - 1);
    const py1 = clamp(Math.ceil(((90 - yMin) / 180) * H), 0, H - 1);
    const xs: number[] = [];
    for (let py = py0; py <= py1; py++) {
      const lat = 90 - ((py + 0.5) / H) * 180;
      xs.length = 0;
      for (const ring of rings) {
        for (let i = 0, n = ring.length - 1; i < n; i++) {
          const a = ring[i]!,
            b = ring[i + 1]!;
          const ay = a[1]!,
            by = b[1]!;
          if (ay > lat !== by > lat) {
            xs.push(a[0]! + ((lat - ay) * (b[0]! - a[0]!)) / (by - ay));
          }
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = Math.ceil(((xs[i]! + 180) / 360) * W - 0.5);
        const x1 = Math.floor(((xs[i + 1]! + 180) / 360) * W - 0.5);
        for (let px = Math.max(0, x0); px <= Math.min(W - 1, x1); px++) ids[py * W + px] = id;
      }
    }
  }
  regionFeatures.features.forEach((f, i) => {
    if (f.geometry) rasterize(ringsOf(f.geometry), i + 1);
  });
  const landCount = regionFeatures.features.length;
  const pixelCount = new Uint32Array(landCount + SEA_ZONES + 1);
  for (let i = 0; i < ids.length; i++) pixelCount[ids[i]!]!++;
  const emptyRegions = regionsOut.map((_, i) => i + 1).filter((id) => pixelCount[id] === 0);
  for (const id of emptyRegions) {
    // Micro-states and specks smaller than a pixel: paint their centroid pixel so they exist on the map.
    const [lon, lat] = geoCentroid(regionFeatures.features[id - 1]!);
    const px = clamp(Math.floor(((lon! + 180) / 360) * W), 0, W - 1);
    const py = clamp(Math.floor(((90 - lat!) / 180) * H), 0, H - 1);
    ids[py * W + px] = id;
  }
  pixelCount.fill(0);
  for (let i = 0; i < ids.length; i++) pixelCount[ids[i]!]!++;
  console.log(`rasterized ${W}x${H}; sub-pixel regions painted: ${emptyRegions.length}`);

  // --- sea zones: k-means over ocean pixels -----------------------------------------------------
  const rnd = mulberry32(20270101);
  const stride = 4;
  const sx: number[] = [],
    sy: number[] = [],
    sz: number[] = [],
    sw: number[] = [];
  for (let py = 0; py < H; py += stride) {
    const lat = 90 - ((py + 0.5) / H) * 180;
    if (lat < -62) continue; // Southern Ocean margin is one implicit zone, keep seeds northward
    const w = Math.cos((lat * Math.PI) / 180);
    for (let px = 0; px < W; px += stride) {
      if (ids[py * W + px] !== 0) continue;
      const lon = ((px + 0.5) / W) * 360 - 180;
      const [x, y, z] = toUnit(lat, lon);
      sx.push(x);
      sy.push(y);
      sz.push(z);
      sw.push(w);
    }
  }
  const N = sx.length;
  const cx = new Float64Array(SEA_ZONES),
    cy = new Float64Array(SEA_ZONES),
    cz = new Float64Array(SEA_ZONES);
  // k-means++ seeding
  {
    const d2 = new Float64Array(N).fill(4);
    const first = Math.floor(rnd() * N);
    cx[0] = sx[first]!;
    cy[0] = sy[first]!;
    cz[0] = sz[first]!;
    for (let k = 1; k < SEA_ZONES; k++) {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const dx = sx[i]! - cx[k - 1]!,
          dy = sy[i]! - cy[k - 1]!,
          dz = sz[i]! - cz[k - 1]!;
        const d = (dx * dx + dy * dy + dz * dz) * sw[i]!;
        if (d < d2[i]!) d2[i] = d;
        sum += d2[i]!;
      }
      let r = rnd() * sum;
      let pick = N - 1;
      for (let i = 0; i < N; i++) {
        r -= d2[i]!;
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      cx[k] = sx[pick]!;
      cy[k] = sy[pick]!;
      cz[k] = sz[pick]!;
    }
  }
  const assign = new Int32Array(N);
  for (let iter = 0; iter < 15; iter++) {
    for (let i = 0; i < N; i++) {
      let best = -1,
        bd = Infinity;
      for (let k = 0; k < SEA_ZONES; k++) {
        const dx = sx[i]! - cx[k]!,
          dy = sy[i]! - cy[k]!,
          dz = sz[i]! - cz[k]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      assign[i] = best;
    }
    const ax = new Float64Array(SEA_ZONES),
      ay = new Float64Array(SEA_ZONES),
      az = new Float64Array(SEA_ZONES),
      aw = new Float64Array(SEA_ZONES);
    for (let i = 0; i < N; i++) {
      const k = assign[i]!;
      const w = sw[i]!;
      ax[k]! += sx[i]! * w;
      ay[k]! += sy[i]! * w;
      az[k]! += sz[i]! * w;
      aw[k]! += w;
    }
    for (let k = 0; k < SEA_ZONES; k++) {
      if (aw[k]! === 0) continue;
      const len = Math.hypot(ax[k]!, ay[k]!, az[k]!) || 1;
      cx[k] = ax[k]! / len;
      cy[k] = ay[k]! / len;
      cz[k] = az[k]! / len;
    }
  }
  // assign every water pixel
  const seaBase = landCount; // sea zone k has id seaBase + 1 + k
  const rowUnit = new Float64Array(W * 3);
  for (let py = 0; py < H; py++) {
    const lat = 90 - ((py + 0.5) / H) * 180;
    for (let px = 0; px < W; px++) {
      const lon = ((px + 0.5) / W) * 360 - 180;
      const [x, y, z] = toUnit(lat, lon);
      rowUnit[px * 3] = x;
      rowUnit[px * 3 + 1] = y;
      rowUnit[px * 3 + 2] = z;
    }
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (ids[i] !== 0) continue;
      const x = rowUnit[px * 3]!,
        y = rowUnit[px * 3 + 1]!,
        z = rowUnit[px * 3 + 2]!;
      let best = 0,
        bd = Infinity;
      for (let k = 0; k < SEA_ZONES; k++) {
        const dx = x - cx[k]!,
          dy = y - cy[k]!,
          dz = z - cz[k]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      ids[i] = seaBase + 1 + best;
    }
  }
  const totalIds = landCount + SEA_ZONES;
  pixelCount.fill(0);
  for (let i = 0; i < ids.length; i++) pixelCount[ids[i]!]!++;

  // --- adjacency from the raster ----------------------------------------------------------------
  const adjCount = new Map<number, number>(); // key a*65536+b (a<b)
  const bump = (a: number, b: number) => {
    if (a === b || a === 0 || b === 0) return;
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    adjCount.set(key, (adjCount.get(key) ?? 0) + 1);
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const a = ids[i]!;
      bump(a, ids[py * W + ((px + 1) % W)]!);
      if (py + 1 < H) bump(a, ids[i + W]!);
    }
  }
  const neighboursOf = new Map<number, Set<number>>();
  const addAdj = (a: number, b: number) => {
    if (!neighboursOf.has(a)) neighboursOf.set(a, new Set());
    if (!neighboursOf.has(b)) neighboursOf.set(b, new Set());
    neighboursOf.get(a)!.add(b);
    neighboursOf.get(b)!.add(a);
  };
  for (const [key, n] of adjCount) {
    if (n < 2) continue;
    addAdj(Math.floor(key / 65536), key % 65536);
  }
  const idAt = (lat: number, lon: number): number => {
    const px = clamp(Math.floor(((lon + 180) / 360) * W), 0, W - 1);
    const py = clamp(Math.floor(((90 - lat) / 180) * H), 0, H - 1);
    return ids[py * W + px]!;
  };
  for (const s of STRAITS) {
    const a = idAt(s.a[0], s.a[1]),
      b = idAt(s.b[0], s.b[1]);
    if (a > seaBase && b > seaBase) {
      if (a !== b) addAdj(a, b);
    } else console.warn(`strait ${s.name}: endpoints not both sea (${a}, ${b})`);
  }

  // --- terrain guess from NASA elevation ---------------------------------------------------------
  const elevMean = new Float64Array(totalIds + 1),
    elevStd = new Float64Array(totalIds + 1);
  try {
    const elevBuf = await fetchCached(SOURCES.elevation, 'gebco_08_rev_elev_5400x2700.jpg');
    const img = sharp(elevBuf).greyscale();
    const meta = await img.metadata();
    const ew = meta.width ?? 5400,
      eh = meta.height ?? 2700;
    const raw = await img.raw().toBuffer();
    const sum = new Float64Array(totalIds + 1),
      sq = new Float64Array(totalIds + 1),
      cnt = new Float64Array(totalIds + 1);
    for (let py = 0; py < H; py += 2) {
      const ey = Math.min(eh - 1, Math.floor((py / H) * eh));
      for (let px = 0; px < W; px += 2) {
        const id = ids[py * W + px]!;
        if (id === 0 || id > landCount) continue;
        const ex = Math.min(ew - 1, Math.floor((px / W) * ew));
        const v = raw[ey * ew + ex]! * 25; // ≈ metres (255 ≈ 6,400 m)
        sum[id]! += v;
        sq[id]! += v * v;
        cnt[id]! += 1;
      }
    }
    for (let id = 1; id <= landCount; id++) {
      if (cnt[id]! === 0) continue;
      const m = sum[id]! / cnt[id]!;
      elevMean[id] = m;
      elevStd[id] = Math.sqrt(Math.max(0, sq[id]! / cnt[id]! - m * m));
    }
  } catch (e) {
    console.warn('elevation unavailable, terrain from latitude only:', (e as Error).message);
  }
  const DESERT_BOXES: Array<[number, number, number, number]> = [
    [15, -17, 32, 36], // Sahara
    [14, 36, 32, 60], // Arabia
    [36, 85, 46, 112], // Gobi / Taklamakan
    [-32, 122, -22, 142], // Australian interior
    [-28, -71, -18, -68], // Atacama
    [-28, 17, -20, 25], // Kalahari / Namib
    [25, 55, 34, 64], // Iranian plateau deserts
    [28, 62, 32, 72], // Baluchistan / Thar
  ];
  const JUNGLE_BOXES: Array<[number, number, number, number]> = [
    [-15, -75, 5, -48], // Amazon
    [-6, 10, 6, 30], // Congo
    [-8, 95, 12, 130], // Maritime SE Asia
    [8, -85, 18, -77], // Central America
  ];
  const inBox = (lat: number, lon: number, b: [number, number, number, number]) =>
    lat >= b[0] && lon >= b[1] && lat <= b[2] && lon <= b[3];

  // --- centroids & per-region metadata ------------------------------------------------------------
  const sumLat = new Float64Array(totalIds + 1),
    sumLon = new Float64Array(totalIds + 1),
    sumW = new Float64Array(totalIds + 1);
  const sumX = new Float64Array(totalIds + 1),
    sumY = new Float64Array(totalIds + 1),
    sumZ = new Float64Array(totalIds + 1);
  for (let py = 0; py < H; py++) {
    const lat = 90 - ((py + 0.5) / H) * 180;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let px = 0; px < W; px++) {
      const id = ids[py * W + px]!;
      if (id === 0) continue;
      const lon = ((px + 0.5) / W) * 360 - 180;
      const [x, y, z] = toUnit(lat, lon);
      sumX[id]! += x * w;
      sumY[id]! += y * w;
      sumZ[id]! += z * w;
      sumW[id]! += w;
      sumLat[id]! += lat * w;
      sumLon[id]! += lon * w;
    }
  }
  const centroidOf = (id: number): [number, number] => {
    if (sumW[id]! === 0) return [0, 0];
    const x = sumX[id]!,
      y = sumY[id]!,
      z = sumZ[id]!;
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;
    return [lat, lon];
  };
  const pixelAreaKm2 = (id: number) => {
    // area ≈ Σ cos(lat) · (R·Δlon)·(R·Δlat)
    const dLon = (2 * Math.PI) / W,
      dLat = Math.PI / H;
    return sumW[id]! * EARTH_RADIUS_KM * EARTH_RADIUS_KM * dLon * dLat;
  };

  // Capitals and cities.
  interface City {
    name: string;
    iso3: string;
    lat: number;
    lon: number;
    population: number;
    capital: boolean;
    regionId: number;
  }
  const cities: City[] = [];
  const capitalRegion = new Map<string, number>();
  for (const p of places.features) {
    const pr = p.properties;
    const [lon, lat] = p.geometry.coordinates as [number, number];
    const adm0 = String(pr.adm0_a3);
    const owner = ownerOf(adm0);
    if (!owner) continue;
    const isCapital = String(pr.featurecla) === 'Admin-0 capital' && Number(pr.adm0cap) === 1;
    const ownIso = ISO_REMAP[adm0] ?? adm0;
    const nationalCapital = isCapital && ownIso === owner && !DROP_ADM0.has(adm0);
    const pop = Number(pr.pop_max ?? 0);
    if (!nationalCapital && pop < 1_500_000) continue;
    let regionId = idAt(lat, lon);
    const ownsIt = (id: number) => id > 0 && id <= landCount && regionsOut[id - 1]!.iso3 === owner;
    if (!ownsIt(regionId)) {
      // Border/coastal capital: snap to the nearest pixel owned by this nation (window ≈ ±60 km),
      // else the nearest land pixel.
      const px0 = Math.floor(((lon + 180) / 360) * W),
        py0 = Math.floor(((90 - lat) / 180) * H);
      let bestD = Infinity,
        bestLand = Infinity,
        landId = regionId;
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const id = ids[clamp(py0 + dy, 0, H - 1) * W + ((((px0 + dx) % W) + W) % W)]!;
          const d = dx * dx + dy * dy;
          if (ownsIt(id) && d < bestD) {
            bestD = d;
            regionId = id;
          }
          if (id > 0 && id <= landCount && d < bestLand) {
            bestLand = d;
            landId = id;
          }
        }
      if (!ownsIt(regionId)) regionId = landId;
    }
    if (regionId === 0 || regionId > landCount) continue;
    cities.push({
      name: String(pr.name),
      iso3: owner,
      lat: round(lat, 3),
      lon: round(lon, 3),
      population: pop,
      capital: nationalCapital,
      regionId,
    });
    if (nationalCapital && !capitalRegion.has(owner)) capitalRegion.set(owner, regionId);
  }
  // Capitals whose own raster region is owned by someone else (e.g. folded territories) keep the owner.
  for (const [iso, rid] of capitalRegion) {
    const r = regionsOut[rid - 1]!;
    if (r.iso3 !== iso) console.warn(`capital of ${iso} falls in region ${rid} owned by ${r.iso3}`);
  }

  const totalCityPop = new Map<string, number>();
  for (const r of regionsOut) totalCityPop.set(r.iso3, (totalCityPop.get(r.iso3) ?? 0) + r.cityPop);

  const regionsMeta = regionsOut.map((r, i) => {
    const id = i + 1;
    const [lat, lon] = centroidOf(id);
    const nbrs = [...(neighboursOf.get(id) ?? [])].sort((a, b) => a - b);
    const coastal = nbrs.some((n) => n > seaBase);
    const cPop = countryPop.get(r.iso3) ?? 0;
    const cArea = countryArea.get(r.iso3) ?? 1;
    const cCity = totalCityPop.get(r.iso3) ?? 0;
    const popShare =
      0.5 * (r.areaKm2 / cArea) +
      (cCity > 0 ? 0.5 * (r.cityPop / cCity) : 0.5 * (r.areaKm2 / cArea));
    const std = elevStd[id] ?? 0,
      mean = elevMean[id] ?? 0;
    let terrain = 'plains';
    if (r.iso3 === ANTARCTICA) terrain = 'ice';
    else if (Math.abs(lat) > 64) terrain = 'arctic';
    else if (std > 600 || mean > 2500) terrain = 'mountains';
    else if (DESERT_BOXES.some((b) => inBox(lat, lon, b)) && std < 400) terrain = 'desert';
    else if (JUNGLE_BOXES.some((b) => inBox(lat, lon, b)) && mean < 800) terrain = 'jungle';
    else if (std > 250) terrain = 'hills';
    return {
      id,
      name: r.name,
      iso3: r.iso3,
      lat: round(lat, 2),
      lon: round(lon, 2),
      areaKm2: Math.round(r.areaKm2),
      populationShare: round(popShare, 4),
      population: Math.round(cPop * popShare),
      cityPopulation: Math.round(r.cityPop),
      neighbours: nbrs,
      terrain,
      coastal,
      capital: capitalRegion.get(r.iso3) === id,
      pixels: pixelCount[id] ?? 0,
    };
  });

  // Sea zone names from basin boxes + nearest coastal country.
  const basinName = (lat: number, lon: number): string => {
    if (lat > 66) return 'Arctic Ocean';
    if (lat < -55) return 'Southern Ocean';
    if (lat > 30 && lat < 47 && lon > -6 && lon < 37) return 'Mediterranean Sea';
    if (lat > 53 && lat < 66 && lon > 9 && lon < 31) return 'Baltic Sea';
    if (lat > 40 && lat < 48 && lon > 27 && lon < 42) return 'Black Sea';
    if (lat > 12 && lat < 30 && lon > 32 && lon < 44) return 'Red Sea';
    if (lat > 23 && lat < 31 && lon > 47 && lon < 57) return 'Persian Gulf';
    if (lat > 8 && lat < 28 && lon > -90 && lon < -60) return 'Caribbean Sea';
    if (lat > 18 && lat < 31 && lon > -98 && lon < -81) return 'Gulf of Mexico';
    if (lat > 0 && lat < 25 && lon > 99 && lon < 122) return 'South China Sea';
    if (lat > 24 && lat < 41 && lon > 117 && lon < 131) return 'East China Sea';
    if (lat > 34 && lat < 52 && lon > 127 && lon < 142) return 'Sea of Japan';
    if (lat > 50 && lat < 65 && lon > 135 && lon < 165) return 'Sea of Okhotsk';
    if (lat > 51 && lat < 66 && lon > 160 && lon < 200) return 'Bering Sea';
    if (lat > 5 && lat < 22 && lon > 80 && lon < 100) return 'Bay of Bengal';
    if (lat > 5 && lat < 25 && lon > 55 && lon < 78) return 'Arabian Sea';
    if (lon > -70 && lon < 20) return lat > 0 ? 'North Atlantic' : 'South Atlantic';
    if (lon >= 20 && lon < 100 && lat < 25) return 'Indian Ocean';
    if (lat > 0) return 'North Pacific';
    return 'South Pacific';
  };
  const coastalRegions = regionsMeta.filter((r) => r.coastal && r.iso3 !== ANTARCTICA);
  const seaZones = Array.from({ length: SEA_ZONES }, (_, k) => {
    const id = seaBase + 1 + k;
    const [lat, lon] = centroidOf(id);
    let nearest = coastalRegions[0]!,
      best = Infinity;
    for (const r of coastalRegions) {
      const d = greatCircleKm(lat, lon, r.lat, r.lon);
      if (d < best) {
        best = d;
        nearest = r;
      }
    }
    const nbrs = [...(neighboursOf.get(id) ?? [])].sort((a, b) => a - b);
    return {
      id,
      name: `${basinName(lat, lon)} — ${countryName.get(nearest.iso3) ?? nearest.iso3}`,
      basin: basinName(lat, lon),
      lat: round(lat, 2),
      lon: round(lon, 2),
      areaKm2: Math.round(pixelAreaKm2(id)),
      neighbours: nbrs,
      coastalRegions: nbrs.filter((n) => n <= landCount),
      pixels: pixelCount[id] ?? 0,
    };
  });
  // Disambiguate duplicate sea names.
  const seen = new Map<string, number>();
  for (const z of seaZones) {
    const n = (seen.get(z.name) ?? 0) + 1;
    seen.set(z.name, n);
    if (n > 1)
      z.name = `${z.name} ${['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n] ?? n}`;
  }

  // --- write outputs ------------------------------------------------------------------------------
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  mkdirSync(join(ROOT, 'public', 'textures'), { recursive: true });

  // Region-ID texture: RGB PNG, R = id & 255, G = id >> 8, B = land flag.
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const id = ids[i]!;
    rgb[i * 3] = id & 255;
    rgb[i * 3 + 1] = id >> 8;
    rgb[i * 3 + 2] = id > 0 && id <= landCount ? 255 : 0;
  }
  await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 9, palette: false })
    .toFile(join(ROOT, 'public', 'textures', 'regions-id.png'));
  // Ocean mask (land = white) at half resolution with a soft edge.
  const mask = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = ids[i]! > 0 && ids[i]! <= landCount ? 255 : 0;
  await sharp(mask, { raw: { width: W, height: H, channels: 1 } })
    .resize(W / 2, H / 2, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(join(ROOT, 'public', 'textures', 'ocean-mask.png'));

  const source =
    'Natural Earth 1:10m Admin 1 – States, Provinces and 1:50m Admin 0 – Countries and 1:10m Populated Places (public domain, naturalearthdata.com, v5.1.1 via github.com/nvkelso/natural-earth-vector); terrain guess from NASA Blue Marble GEBCO topography (public domain). Regions merged by scripts/build-map.ts.';
  const topoOut = { ...topo, source, asOf: AS_OF, estimate: false };
  writeFileSync(join(ROOT, 'data', 'regions.topo.json'), JSON.stringify(topoOut));
  const metaOut = {
    source,
    asOf: AS_OF,
    estimate: true,
    notes:
      'Region population = country population (Natural Earth POP_EST) × populationShare, where share = ½·area share + ½·city-population share. Terrain is a heuristic from elevation statistics and latitude. Sea zones are k-means cells over ocean pixels; names are basin + nearest coastal country.',
    idTexture: {
      path: '/textures/regions-id.png',
      width: W,
      height: H,
      encoding: 'RG8 id, B land flag',
    },
    landCount,
    seaZoneCount: SEA_ZONES,
    straits: STRAITS.map((s) => s.name),
    regions: regionsMeta,
    seaZones,
  };
  writeFileSync(join(ROOT, 'data', 'regions.meta.json'), JSON.stringify(metaOut));
  writeFileSync(
    join(ROOT, 'data', 'cities.json'),
    JSON.stringify({
      source:
        'Natural Earth 1:10m Populated Places (public domain, naturalearthdata.com v5.1.1), filtered to national capitals and cities ≥ 1.5 million (pop_max)',
      asOf: AS_OF,
      estimate: false,
      cities: cities.sort((a, b) => b.population - a.population),
    }),
  );

  const topoBytes = Buffer.byteLength(JSON.stringify(topoOut));
  const metaBytes = Buffer.byteLength(JSON.stringify(metaOut));
  const perCountry = new Map<string, number>();
  for (const r of regionsMeta) perCountry.set(r.iso3, (perCountry.get(r.iso3) ?? 0) + 1);
  const top = [...perCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  console.log(
    `regions.topo.json ${(topoBytes / 1e6).toFixed(2)} MB, regions.meta.json ${(metaBytes / 1e6).toFixed(2)} MB`,
  );
  console.log(
    `land regions=${landCount} sea zones=${SEA_ZONES} cities=${cities.length} capitals=${capitalRegion.size}`,
  );
  console.log(`top counts: ${top}`);
  console.log(
    `terrain: ${JSON.stringify(Object.fromEntries(['plains', 'hills', 'mountains', 'desert', 'jungle', 'arctic', 'ice'].map((t) => [t, regionsMeta.filter((r) => r.terrain === t).length])))}`,
  );
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
