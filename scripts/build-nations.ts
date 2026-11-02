/**
 * Builds data/nations.json: the 193 UN members plus Taiwan, Kosovo and Palestine.
 *
 * Sources (downloaded once, then served from the cache directory):
 *   - IMF World Economic Outlook via the DataMapper API: NGDPD (GDP, US$ bn), NGDP_RPCH
 *     (real growth, %), GGXWDG_NGDP (gross debt, % of GDP), LP (population, millions).
 *   - World Bank WDI: SP.POP.TOTL (population, 2024; IMF LP is the fallback, used for Taiwan)
 *     and MS.MIL.XPND.CD (military expenditure in current US$, which the World Bank
 *     reproduces from SIPRI).
 *   - data/nations.manual.json: hand-curated fields (capital, region, blocs, resources,
 *     personnel, warheads) plus overrides for countries the IMF/World Bank do not cover.
 *
 * Usage:  node --experimental-strip-types scripts/build-nations.ts
 * Env:    NATIONS_CACHE_DIR overrides the cache location.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = process.env.NATIONS_CACHE_DIR ?? join(process.cwd(), '.cache', 'nations');
const MANUAL_PATH = join(ROOT, 'data', 'nations.manual.json');
const OUT_PATH = join(ROOT, 'data', 'nations.json');
const AS_OF = '2026-11-02';
const LATEST_YEAR = 2026;
const PREFERRED_YEAR = 2025;

const IMF_INDICATORS = ['NGDPD', 'NGDP_RPCH', 'GGXWDG_NGDP', 'LP'] as const;
type ImfIndicator = (typeof IMF_INDICATORS)[number];

/** IMF uses a few non-ISO codes. Keys are our ISO3 codes, values the IMF code. */
const IMF_CODE: Record<string, string> = { XKX: 'UVK', PSE: 'WBG' };

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
const BLOCS = new Set(['NATO', 'EU', 'CSTO', 'SCO', 'AUKUS', 'Quad', 'BRICS', 'GCC']);
const RESOURCES = new Set([
  'oil',
  'gas',
  'coal',
  'rareEarths',
  'semiconductors',
  'food',
  'uranium',
  'lithium',
  'copper',
  'ironOre',
  'shipping',
  'finance',
]);
const REGIONS = new Set([
  'North America',
  'South America',
  'Western Europe',
  'Eastern Europe',
  'Middle East',
  'North Africa',
  'Sub-Saharan Africa',
  'Central Asia',
  'South Asia',
  'East Asia',
  'Southeast Asia',
  'Oceania',
  'Caribbean',
  'Central America',
]);
const EXPECTED_COUNT = 196;

interface ManualNation {
  iso3: string;
  iso2: string;
  name: string;
  capital: string;
  region: string;
  activePersonnel: number;
  nuclearWarheads?: number;
  blocs: string[];
  resources: string[];
  defenceSpendUsdBn?: number;
  overrides?: {
    gdpUsdBn?: number;
    gdpYear?: number;
    gdpGrowthPct?: number;
    debtToGdpPct?: number;
    population?: number;
  };
  estimatedFields?: string[];
  notes?: string;
}

interface ManualFile {
  source: string;
  asOf: string;
  nations: ManualNation[];
}

interface Nation {
  iso3: string;
  iso2: string;
  name: string;
  capital: string;
  region: string;
  population: number;
  gdpUsdBn: number;
  gdpYear: number;
  gdpGrowthPct: number;
  debtToGdpPct: number;
  defenceSpendUsdBn: number;
  activePersonnel: number;
  nuclearWarheads: number;
  blocs: string[];
  resources: string[];
  major: boolean;
  estimate: boolean;
  estimatedFields: string[];
}

type YearSeries = Record<string, number>;
interface ImfResponse {
  values: Record<string, Record<string, YearSeries>>;
}
interface WbRow {
  countryiso3code: string;
  date: string;
  value: number | null;
}
type WbResponse = [unknown, WbRow[]];

async function cachedJson<T>(name: string, url: string): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, name);
  if (!existsSync(file)) {
    console.log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Latest year <= LATEST_YEAR with a finite value, preferring PREFERRED_YEAR. */
function pickYear(series: YearSeries | undefined, preferred = PREFERRED_YEAR): number | undefined {
  if (!series) return undefined;
  const years = Object.keys(series)
    .map(Number)
    .filter((y) => y <= LATEST_YEAR && Number.isFinite(series[String(y)]));
  if (years.includes(preferred)) return preferred;
  if (years.includes(preferred + 1)) return preferred + 1;
  return years.length ? Math.max(...years) : undefined;
}

function at(series: YearSeries | undefined, year: number | undefined): number | undefined {
  if (!series || year === undefined) return undefined;
  const v = series[String(year)];
  return Number.isFinite(v) ? v : undefined;
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function fail(msg: string): never {
  throw new Error(msg);
}

async function main(): Promise<void> {
  const manual = JSON.parse(readFileSync(MANUAL_PATH, 'utf8')) as ManualFile;

  const imf: Record<ImfIndicator, Record<string, YearSeries>> = {
    NGDPD: {},
    NGDP_RPCH: {},
    GGXWDG_NGDP: {},
    LP: {},
  };
  for (const ind of IMF_INDICATORS) {
    const data = await cachedJson<ImfResponse>(
      `imf-${ind}.json`,
      `https://www.imf.org/external/datamapper/api/v1/${ind}`,
    );
    imf[ind] = data.values[ind] ?? fail(`IMF ${ind}: no values`);
  }
  const wbPop = await cachedJson<WbResponse>(
    'wb-pop-2024.json',
    'https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&date=2024&per_page=400',
  );
  const wbMilex = await cachedJson<WbResponse>(
    'wb-milex-2024.json',
    'https://api.worldbank.org/v2/country/all/indicator/MS.MIL.XPND.CD?format=json&date=2024&per_page=400',
  );
  const wbPopBy = new Map(wbPop[1].map((r) => [r.countryiso3code, r.value]));
  const wbMilexBy = new Map(wbMilex[1].map((r) => [r.countryiso3code, r.value]));

  const problems: string[] = [];
  const nations: Nation[] = [];

  for (const m of manual.nations) {
    const code = IMF_CODE[m.iso3] ?? m.iso3;
    const o = m.overrides ?? {};
    const estimated = new Set(m.estimatedFields ?? []);

    const gdpSeries = imf.NGDPD[code];
    const gdpYear = o.gdpYear ?? pickYear(gdpSeries);
    const gdpUsdBn = o.gdpUsdBn ?? at(gdpSeries, gdpYear);
    if (gdpYear === undefined || gdpUsdBn === undefined) {
      problems.push(`${m.iso3}: no GDP (IMF has none; add overrides.gdpUsdBn/gdpYear)`);
      continue;
    }

    const growthSeries = imf.NGDP_RPCH[code];
    const growthYear = pickYear(growthSeries, gdpYear);
    const gdpGrowthPct = o.gdpGrowthPct ?? at(growthSeries, growthYear);

    const debtSeries = imf.GGXWDG_NGDP[code];
    const debtYear = pickYear(debtSeries, gdpYear);
    const debtToGdpPct = o.debtToGdpPct ?? at(debtSeries, debtYear);
    if (o.debtToGdpPct === undefined && debtYear !== undefined && debtYear < gdpYear - 2) {
      estimated.add('debtToGdpPct'); // stale IMF figure
    }

    // World Bank (UN World Population Prospects based) first: the IMF LP series undercounts
    // several countries badly (Yemen by half, Ethiopia by a sixth). IMF LP covers Taiwan,
    // which the World Bank omits.
    const wbPopValue = wbPopBy.get(m.iso3);
    const popSeries = imf.LP[code];
    const popMillions = at(popSeries, pickYear(popSeries, gdpYear));
    const population =
      o.population ??
      (typeof wbPopValue === 'number'
        ? wbPopValue
        : popMillions !== undefined
          ? Math.round(popMillions * 1_000_000)
          : undefined);

    const wbMilexValue = wbMilexBy.get(m.iso3);
    const defenceSpendUsdBn =
      m.defenceSpendUsdBn ?? (typeof wbMilexValue === 'number' ? wbMilexValue / 1e9 : undefined);

    const missing: string[] = [];
    if (gdpGrowthPct === undefined) missing.push('gdpGrowthPct');
    if (debtToGdpPct === undefined) missing.push('debtToGdpPct');
    if (population === undefined) missing.push('population');
    if (defenceSpendUsdBn === undefined) missing.push('defenceSpendUsdBn');
    if (missing.length) {
      problems.push(`${m.iso3}: missing ${missing.join(', ')} (add to nations.manual.json)`);
      continue;
    }

    if (!REGIONS.has(m.region)) problems.push(`${m.iso3}: unknown region "${m.region}"`);
    for (const b of m.blocs) if (!BLOCS.has(b)) problems.push(`${m.iso3}: unknown bloc "${b}"`);
    for (const r of m.resources)
      if (!RESOURCES.has(r)) problems.push(`${m.iso3}: unknown resource "${r}"`);
    if (m.resources.length > 5) problems.push(`${m.iso3}: more than 5 resources`);
    if (!/^[A-Z]{3}$/.test(m.iso3) || !/^[A-Z]{2}$/.test(m.iso2))
      problems.push(`${m.iso3}: bad ISO code`);

    const estimatedFields = [...estimated].sort();
    nations.push({
      iso3: m.iso3,
      iso2: m.iso2,
      name: m.name,
      capital: m.capital,
      region: m.region,
      population: population as number,
      gdpUsdBn: round(gdpUsdBn, 3),
      gdpYear,
      gdpGrowthPct: round(gdpGrowthPct as number, 1),
      debtToGdpPct: round(debtToGdpPct as number, 1),
      defenceSpendUsdBn: round(defenceSpendUsdBn as number, 3),
      activePersonnel: m.activePersonnel,
      nuclearWarheads: m.nuclearWarheads ?? 0,
      blocs: [...m.blocs],
      resources: [...m.resources],
      major: MAJORS.has(m.iso3),
      estimate: estimatedFields.length > 0,
      estimatedFields,
    });
  }

  nations.sort((a, b) => a.iso3.localeCompare(b.iso3));

  // Sanity checks.
  const codes = new Set(nations.map((n) => n.iso3));
  if (codes.size !== nations.length) problems.push('duplicate iso3 codes');
  if (nations.length !== EXPECTED_COUNT)
    problems.push(`expected ${EXPECTED_COUNT} nations, got ${nations.length}`);
  for (const code of MAJORS) if (!codes.has(code)) problems.push(`major ${code} missing`);
  const majors = nations.filter((n) => n.major).length;
  if (majors !== MAJORS.size) problems.push(`expected ${MAJORS.size} majors, got ${majors}`);
  for (const n of nations) {
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'number' && !Number.isFinite(v))
        problems.push(`${n.iso3}.${k} is not finite`);
    }
  }
  const count = (bloc: string): number => nations.filter((n) => n.blocs.includes(bloc)).length;
  const checks: [string, number, number][] = [
    ['NATO', count('NATO'), 32],
    ['EU', count('EU'), 27],
    ['GCC', count('GCC'), 6],
    ['AUKUS', count('AUKUS'), 3],
    ['Quad', count('Quad'), 4],
    ['nuclear states', nations.filter((n) => n.nuclearWarheads > 0).length, 9],
  ];
  for (const [label, got, want] of checks)
    if (got !== want) problems.push(`${label}: expected ${want}, got ${got}`);

  const worldGdp = nations.reduce((s, n) => s + n.gdpUsdBn, 0);
  const worldPop = nations.reduce((s, n) => s + n.population, 0);
  if (worldGdp < 105_000 || worldGdp > 130_000)
    problems.push(`world GDP ${worldGdp.toFixed(0)} bn outside the plausible range`);
  if (worldPop < 8.1e9 || worldPop > 8.3e9)
    problems.push(`world population ${worldPop} outside the plausible range`);

  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`);
    fail(`${problems.length} problem(s) building nations.json`);
  }

  const out = {
    source:
      'IMF World Economic Outlook (DataMapper API, Oct 2026 edition) for GDP/growth/debt; ' +
      'World Bank WDI SP.POP.TOTL (2024) for population, IMF WEO LP as fallback (Taiwan); ' +
      'SIPRI Military Expenditure Database (2024 data, as ' +
      'reproduced in World Bank WDI MS.MIL.XPND.CD and the SIPRI fact sheet of Apr 2025) for defence ' +
      'spending; IISS Military Balance 2024-2026 via Wikipedia for personnel; FAS Status of World ' +
      'Nuclear Forces 2026 for warheads; bloc membership from official bloc websites. Per-country ' +
      'gaps filled from the sources named in data/nations.manual.json and flagged in estimatedFields.',
    asOf: AS_OF,
    estimate: false,
    generatedBy: 'scripts/build-nations.ts',
    nations,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');

  const estimates = nations.filter((n) => n.estimate);
  console.log(`wrote ${OUT_PATH}`);
  console.log(`  nations: ${nations.length}, majors: ${majors}`);
  console.log(
    `  world GDP: ${(worldGdp / 1000).toFixed(1)} trn US$ (${nations.filter((n) => n.gdpYear === PREFERRED_YEAR).length} at ${PREFERRED_YEAR})`,
  );
  console.log(`  world population: ${(worldPop / 1e9).toFixed(2)} bn`);
  console.log(
    `  defence spending: ${nations.reduce((s, n) => s + n.defenceSpendUsdBn, 0).toFixed(0)} bn US$`,
  );
  console.log(`  warheads: ${nations.reduce((s, n) => s + n.nuclearWarheads, 0)}`);
  console.log(`  blocs: ${[...BLOCS].map((b) => `${b}=${count(b)}`).join(' ')}`);
  console.log(`  estimates: ${estimates.length} (${estimates.map((n) => n.iso3).join(' ')})`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
