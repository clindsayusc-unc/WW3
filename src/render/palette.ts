/** Map-mode colouring: fills the palette DataTexture, one texel per region id (D-034). */
import { Color } from 'three';
import type { GameState } from '../sim/types';
import type { World } from '../sim/world';
import { getRelation, isAtWar } from '../sim/query';
import type { MapMode } from '../state/uiStore';
import type { TerrainClass } from '../sim/world';

/** Land-cover tints for the terrain map mode. */
export const TERRAIN_TINT: Record<TerrainClass, string> = {
  plains: '#9fbf5a',
  forest: '#2f7a3a',
  hills: '#a8a060',
  mountains: '#8c7b6b',
  desert: '#e3c27a',
  jungle: '#1f6b34',
  marsh: '#4f9a8a',
  urban: '#b8b4c4',
  arctic: '#cfdbe6',
  ice: '#eef4fa',
  sea: '#1e3a5f',
};

/** Hand-picked accents for the majors; everyone else gets a stable hashed hue. */
const MAJOR_ACCENTS: Record<string, string> = {
  USA: '#3b82f6',
  CHN: '#ef4444',
  RUS: '#b45309',
  IND: '#f97316',
  GBR: '#2563eb',
  FRA: '#6366f1',
  DEU: '#facc15',
  JPN: '#f472b6',
  KOR: '#22d3ee',
  IRN: '#16a34a',
  ISR: '#60a5fa',
  TUR: '#dc2626',
  PAK: '#15803d',
  BRA: '#84cc16',
};

const accentCache = new Map<string, Color>();
export function nationColor(iso3: string): Color {
  let c = accentCache.get(iso3);
  if (c) return c;
  if (MAJOR_ACCENTS[iso3]) c = new Color(MAJOR_ACCENTS[iso3]);
  else {
    let h = 2166136261;
    for (const ch of iso3) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    const hue = ((h >>> 0) % 360) / 360;
    const sat = 0.45 + (((h >>> 9) % 100) / 100) * 0.3;
    const light = 0.42 + (((h >>> 17) % 100) / 100) * 0.18;
    c = new Color().setHSL(hue, sat, light);
  }
  accentCache.set(iso3, c);
  return c;
}

export function nationHex(iso3: string): string {
  return `#${nationColor(iso3).getHexString()}`;
}

const BLOC_COLORS: [string, string][] = [
  ['NATO', '#3b82f6'],
  ['CSTO', '#dc2626'],
  ['SCO', '#f97316'],
  ['EU', '#facc15'],
  ['BRICS', '#22c55e'],
  ['GCC', '#14b8a6'],
  ['AUKUS', '#a855f7'],
  ['Quad', '#c084fc'],
];

const tmp = new Color();
function write(data: Uint8Array, id: number, color: Color, alpha: number): void {
  const i = id * 4;
  data[i] = Math.round(color.r * 255);
  data[i + 1] = Math.round(color.g * 255);
  data[i + 2] = Math.round(color.b * 255);
  data[i + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
}

function heat(t: number): Color {
  // dark blue → cyan → yellow → red
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.33) return tmp.setRGB(0.05, 0.2 + x * 1.5, 0.6 + x * 1.2);
  if (x < 0.66) return tmp.setRGB((x - 0.33) * 3, 0.85, 0.9 - (x - 0.33) * 2.7);
  return tmp.setRGB(1, 0.85 - (x - 0.66) * 2.4, 0.1);
}

export function fillPalette(data: Uint8Array, world: World, state: GameState, mode: MapMode): void {
  data.fill(0);
  const player = state.player;
  const unitCount = new Map<number, number>();
  for (const u of Object.values(state.units))
    unitCount.set(u.region, (unitCount.get(u.region) ?? 0) + 1);
  const gdpByRegion = new Map<number, number>();
  if (mode === 'economy') {
    for (const r of world.regionList) {
      if (r.sea) continue;
      const owner = state.regions[r.id]?.owner;
      if (!owner) continue;
      gdpByRegion.set(r.id, (state.nations[owner]?.gdp ?? 0) * r.populationShare);
    }
  }
  const maxUnits = Math.max(1, ...unitCount.values());
  for (const r of world.regionList) {
    const rs = state.regions[r.id];
    if (!rs) continue;
    const controller = rs.controller;
    switch (mode) {
      case 'political': {
        if (r.sea || !controller) break;
        const c = nationColor(controller);
        const occupied = rs.owner !== controller;
        write(
          data,
          r.id,
          occupied ? tmp.copy(c).lerp(new Color('#000000'), 0.25) : c,
          occupied ? 0.72 : 0.55,
        );
        break;
      }
      case 'blocs': {
        if (r.sea || !controller) break;
        const blocs = world.nations.get(controller)?.blocs ?? [];
        const hit = BLOC_COLORS.find(([b]) => blocs.includes(b));
        if (hit) write(data, r.id, tmp.set(hit[1]), 0.6);
        else write(data, r.id, tmp.set('#64748b'), 0.25);
        break;
      }
      case 'relations': {
        if (r.sea || !controller) break;
        if (controller === player) {
          write(data, r.id, tmp.set('#ffffff'), 0.45);
          break;
        }
        const rel = getRelation(world, state, player, controller);
        const t = (rel + 100) / 200;
        tmp.setRGB(1 - t, t, 0.15);
        if (
          isAtWar(state, player) &&
          state.wars.some(
            (w) =>
              (w.attackers.includes(player) && w.defenders.includes(controller)) ||
              (w.defenders.includes(player) && w.attackers.includes(controller)),
          )
        )
          tmp.set('#ff2d2d');
        write(data, r.id, tmp, 0.6);
        break;
      }
      case 'economy': {
        if (r.sea) break;
        const g = gdpByRegion.get(r.id) ?? 0;
        const t = g <= 0 ? 0 : Math.min(1, Math.log10(g + 1) / 3.8);
        write(data, r.id, heat(t), 0.65);
        break;
      }
      case 'military': {
        const n = unitCount.get(r.id) ?? 0;
        if (n === 0) {
          if (!r.sea) write(data, r.id, tmp.set('#1e293b'), 0.3);
          break;
        }
        const t = Math.log(n + 1) / Math.log(maxUnits + 1);
        write(data, r.id, heat(0.3 + t * 0.7), r.sea ? 0.55 : 0.7);
        break;
      }
      case 'terrain': {
        if (r.sea) break;
        // Land-cover tint, shaded by elevation: dark lowlands to bright plateaus and peaks.
        const tint = tmp.set(TERRAIN_TINT[r.terrain] ?? TERRAIN_TINT.plains);
        const elevT = Math.min(1, Math.log2(1 + r.elevMean / 200) / Math.log2(1 + 5000 / 200));
        const shade = 0.55 + 0.7 * elevT;
        tint.multiplyScalar(shade);
        // Ruggedness adds a touch of grey (relief), urban share a touch of light.
        const rug = Math.min(1, r.ruggedness / 300);
        tint.lerp(new Color('#6b6560'), rug * 0.35);
        if (r.cover.urban > 0.1) tint.lerp(new Color('#e8e4f0'), Math.min(0.6, r.cover.urban));
        write(data, r.id, tint, 0.78);
        break;
      }
      case 'tension': {
        if (r.sea || !controller) break;
        let t = 0;
        for (const f of world.flashpoints)
          if (f.nations.includes(controller)) t = Math.max(t, (state.flashpoints[f.id] ?? 0) / 100);
        const atWarNow = isAtWar(state, controller);
        if (atWarNow) t = Math.max(t, 0.9);
        if (t <= 0.05) write(data, r.id, tmp.set('#1e3a5f'), 0.25);
        else write(data, r.id, heat(t), 0.4 + t * 0.4);
        break;
      }
    }
  }
}

/**
 * Region attributes for the globe shader (D-057): R = devastation (dims night lights, scorches the
 * ground), G = burning (battle this turn, or lingering fires scaled by devastation), B = controller
 * at war.
 */
export function fillRegionAttr(data: Uint8Array, world: World, state: GameState): void {
  data.fill(0);
  const battles = new Set<number>();
  for (const l of state.log)
    if (l.kind === 'battle' && l.turn === state.turn - 1 && l.region !== undefined)
      battles.add(l.region);
  for (const s of state.strikes) if (s.turn >= state.turn - 1) battles.add(s.to);
  for (const r of world.regionList) {
    const rs = state.regions[r.id];
    if (!rs) continue;
    const burning = Math.max(
      battles.has(r.id) ? 1 : 0,
      Math.min(0.7, Math.max(0, (rs.devastation - 0.04) * 1.6)),
    );
    data[r.id * 4] = Math.round(Math.min(1, rs.devastation) * 255);
    data[r.id * 4 + 1] = Math.round(burning * 255);
    data[r.id * 4 + 2] = rs.controller && isAtWar(state, rs.controller) ? 255 : 0;
    data[r.id * 4 + 3] = 255;
  }
}

/** Regions with fires this turn and their intensity (0..1), for the fire/smoke particle layers. */
export function burningRegions(world: World, state: GameState): Map<number, number> {
  const data = new Uint8Array(2048 * 4);
  fillRegionAttr(data, world, state);
  const out = new Map<number, number>();
  for (const r of world.regionList) {
    const b = data[r.id * 4 + 1]! / 255;
    if (b > 0.05 && !r.sea) out.set(r.id, b);
  }
  return out;
}

/** 16-bit nation index per region (for country borders in the shader). */
export function fillCountryIndex(data: Uint8Array, world: World, state: GameState): void {
  data.fill(0);
  const index = new Map<string, number>();
  world.nationList.forEach((n, i) => index.set(n.iso3, i + 1));
  for (const r of world.regionList) {
    const c = state.regions[r.id]?.controller;
    const v = r.sea ? 0 : c ? (index.get(c) ?? 0) : 65000 + (r.id % 500);
    data[r.id * 4] = v & 255;
    data[r.id * 4 + 1] = v >> 8;
    data[r.id * 4 + 2] = r.sea ? 0 : 255;
    data[r.id * 4 + 3] = 255;
  }
}
