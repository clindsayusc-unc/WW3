/**
 * Builds data/economy.json: starting consumer-price inflation per nation (D-061).
 *
 * Source: IMF World Economic Outlook via the DataMapper API, indicator PCPIPCH (inflation,
 * average consumer prices, annual % change). The campaign opens in January 2027, so the value
 * is the WEO figure for 2026 (latest available year ≤ 2026). Nations the IMF does not cover get
 * a regional fallback and are listed in `estimated`.
 *
 * Usage:  node --import tsx scripts/build-economy.ts
 * Env:    NATIONS_CACHE_DIR overrides the cache location (shared with build-nations.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = process.env.NATIONS_CACHE_DIR ?? join(process.cwd(), '.cache', 'nations');
const OUT_PATH = join(ROOT, 'data', 'economy.json');
const NATIONS_PATH = join(ROOT, 'data', 'nations.json');
const AS_OF = '2026-11-02';
const YEAR = 2026;
const IMF_CODE: Record<string, string> = { XKX: 'UVK', PSE: 'WBG' };
/** Game cap: hyperinflation beyond this is clamped (the simulation caps inflation at 400 %). */
const CAP = 300;

interface ImfResponse {
  values: Record<string, Record<string, Record<string, number>>>;
}

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

async function main(): Promise<void> {
  const nations = (JSON.parse(readFileSync(NATIONS_PATH, 'utf8')) as {
    nations: { iso3: string; region: string }[];
  }).nations;
  const imf = await cachedJson<ImfResponse>(
    'imf-PCPIPCH.json',
    'https://www.imf.org/external/datamapper/api/v1/PCPIPCH',
  );
  const series = imf.values['PCPIPCH'] ?? {};
  const inflation: Record<string, number> = {};
  const estimated: string[] = [];
  const byRegion = new Map<string, number[]>();
  for (const n of nations) {
    const s = series[IMF_CODE[n.iso3] ?? n.iso3];
    let v: number | undefined;
    if (s) {
      for (let y = YEAR; y >= YEAR - 3 && v === undefined; y--) {
        const x = s[String(y)];
        if (Number.isFinite(x)) v = x;
      }
    }
    if (v !== undefined) {
      inflation[n.iso3] = Math.round(Math.min(CAP, v) * 10) / 10;
      byRegion.set(n.region, [...(byRegion.get(n.region) ?? []), Math.min(CAP, v)]);
    }
  }
  for (const n of nations) {
    if (inflation[n.iso3] !== undefined) continue;
    const vals = (byRegion.get(n.region) ?? [3]).slice().sort((a, b) => a - b);
    inflation[n.iso3] = Math.round((vals[Math.floor(vals.length / 2)] ?? 3) * 10) / 10;
    estimated.push(n.iso3);
  }
  const out = {
    source: `IMF World Economic Outlook (DataMapper API), indicator PCPIPCH — inflation, average consumer prices, annual % change, ${YEAR} (latest available year if ${YEAR} is missing). Values above ${CAP} % are capped for the game. Nations without IMF coverage take the median of their region and are listed in "estimated".`,
    asOf: AS_OF,
    estimate: false,
    generatedBy: 'scripts/build-economy.ts',
    year: YEAR,
    estimated,
    inflation,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${OUT_PATH}: ${Object.keys(inflation).length} nations, ${estimated.length} estimated`);
}

void main();
