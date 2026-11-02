/**
 * Terrain, weather and movement rules (D-050). Values are game design, tuned by the calibration
 * scenarios in scenarios.test.ts and documented in docs/BALANCE.md. Real-world inputs (elevation,
 * land cover, climate) come from data/terrain.json and data/climate.json via the world loader.
 */
import type { TerrainClass, World } from './world';
import type { RegionId, UnitTypeId } from './types';

export interface TerrainRule {
  readonly name: string;
  /** Defender firepower multiplier. */
  readonly defence: number;
  /** Multiplier for armoured formations (mechanised get 60 % of the penalty). */
  readonly armour: number;
  /** Multiplier for infantry-type formations. */
  readonly infantry: number;
  /** Multiplier for special forces and marines. */
  readonly special: number;
  /** Effectiveness of air support (strike and air superiority). */
  readonly air: number;
  /** Movement cost of entering the region (1 = one month for a speed-1 unit on plains). */
  readonly moveCost: number;
  /** Share of supply lost per region of this terrain on a supply chain (before infrastructure). */
  readonly supplyLoss: number;
  readonly description: string;
}

export const TERRAIN: Readonly<Record<TerrainClass, TerrainRule>> = {
  plains: {
    name: 'Plains',
    defence: 1,
    armour: 1.15,
    infantry: 1,
    special: 1,
    air: 1,
    moveCost: 1,
    supplyLoss: 0.08,
    description: 'Open country: tank country, nowhere to hide, easy to supply.',
  },
  forest: {
    name: 'Forest',
    defence: 1.3,
    armour: 0.85,
    infantry: 1.05,
    special: 1.1,
    air: 0.85,
    moveCost: 1.3,
    supplyLoss: 0.1,
    description: 'Woodland limits lines of sight and canalises armour onto roads.',
  },
  hills: {
    name: 'Hills',
    defence: 1.4,
    armour: 0.8,
    infantry: 1.05,
    special: 1.1,
    air: 0.9,
    moveCost: 1.4,
    supplyLoss: 0.1,
    description: 'Broken ground favours the defender and slows everything.',
  },
  mountains: {
    name: 'Mountains',
    defence: 2.5,
    armour: 0.5,
    infantry: 1,
    special: 1.15,
    air: 0.6,
    moveCost: 2.2,
    supplyLoss: 0.22,
    description:
      'A few passes, no room to manoeuvre, every ridge a fortress. Armour is nearly useless and air support struggles with weather and masking.',
  },
  jungle: {
    name: 'Jungle',
    defence: 2,
    armour: 0.5,
    infantry: 1,
    special: 1.15,
    air: 0.6,
    moveCost: 2,
    supplyLoss: 0.2,
    description: 'Dense canopy hides defenders from the air, swallows armour and rots supplies.',
  },
  urban: {
    name: 'Urban',
    defence: 2,
    armour: 0.6,
    infantry: 1.1,
    special: 1.15,
    air: 0.75,
    moveCost: 1.1,
    supplyLoss: 0.06,
    description: 'Street fighting: block by block, basement by basement. Armour is vulnerable, infantry decisive.',
  },
  marsh: {
    name: 'Marsh',
    defence: 1.5,
    armour: 0.6,
    infantry: 1,
    special: 1.1,
    air: 0.9,
    moveCost: 1.8,
    supplyLoss: 0.15,
    description: 'Wetlands bog down vehicles and funnel attacks onto causeways.',
  },
  desert: {
    name: 'Desert',
    defence: 1,
    armour: 1.1,
    infantry: 1,
    special: 1,
    air: 1.1,
    moveCost: 1.2,
    supplyLoss: 0.14,
    description: 'Open and visible from the air, but water, fuel and distance strain supply.',
  },
  arctic: {
    name: 'Arctic',
    defence: 1.3,
    armour: 0.7,
    infantry: 0.95,
    special: 1.05,
    air: 0.85,
    moveCost: 1.8,
    supplyLoss: 0.18,
    description: 'Tundra and taiga: few roads, long nights, brutal cold for most of the year.',
  },
  ice: {
    name: 'Ice sheet',
    defence: 1.5,
    armour: 0.5,
    infantry: 0.9,
    special: 1,
    air: 0.8,
    moveCost: 3,
    supplyLoss: 0.3,
    description: 'Permanent ice. Operations here are expeditions, not campaigns.',
  },
  sea: {
    name: 'Sea',
    defence: 1,
    armour: 1,
    infantry: 1,
    special: 1,
    air: 1,
    moveCost: 1,
    supplyLoss: 0.05,
    description: 'Open water.',
  },
};

export function terrainRule(world: World, region: RegionId): TerrainRule {
  const t = world.regions.get(region)?.terrain ?? 'plains';
  return TERRAIN[t] ?? TERRAIN.plains;
}

/** Terrain multiplier for a unit type in a region (armour penalised, light troops less so). */
export function unitTerrainFactor(rule: TerrainRule, type: UnitTypeId): number {
  switch (type) {
    case 'armored':
      return rule.armour;
    case 'mechanized':
      return 1 - (1 - rule.armour) * 0.6;
    case 'specialForces':
    case 'marines':
      return rule.special;
    case 'infantry':
      return rule.infantry;
    case 'artillery':
      return 1 - (1 - rule.armour) * 0.3;
    default:
      return 1;
  }
}

export interface Weather {
  /** 0..1 — mean temperature below 0 °C, 1 at −15 °C. */
  readonly winter: number;
  /** 0..1 — monthly rainfall above 150 mm, 1 at 400 mm. */
  readonly monsoon: number;
  /** 0..1 — mean temperature above 30 °C, 1 at 40 °C. */
  readonly heat: number;
  readonly tempC: number;
  readonly precipMm: number;
}

const CALM: Weather = { winter: 0, monsoon: 0, heat: 0, tempC: 15, precipMm: 0 };

/** Weather in a region for a calendar month (1–12), from the MERRA-2 climatology. */
export function weatherAt(world: World, region: RegionId, month: number): Weather {
  const c = world.regions.get(region)?.climate;
  if (!c) return CALM;
  const m = ((month - 1) % 12 + 12) % 12;
  return {
    winter: c.winter[m] ?? 0,
    monsoon: c.monsoon[m] ?? 0,
    heat: c.heat[m] ?? 0,
    tempC: c.tempC[m] ?? 15,
    precipMm: c.precipMm[m] ?? 0,
  };
}

/** Attacker firepower multiplier from the weather in the battle region. */
export function weatherAttackFactor(w: Weather): number {
  return (1 - 0.35 * w.winter) * (1 - 0.3 * w.monsoon) * (1 - 0.15 * w.heat);
}
/** Air-support multiplier from the weather. */
export function weatherAirFactor(w: Weather): number {
  return (1 - 0.25 * w.winter) * (1 - 0.45 * w.monsoon);
}
/** Movement-cost multiplier from the weather. */
export function weatherMoveFactor(w: Weather): number {
  return (1 + 0.8 * w.winter) * (1 + 0.6 * w.monsoon) * (1 + 0.25 * w.heat);
}
/** Monthly strength loss (points) for a unit exposed to the weather; `foreign` = not on its own soil. */
export function weatherAttrition(w: Weather, foreign: boolean): number {
  const base = 8 * w.winter + 3 * w.monsoon + 4 * w.heat;
  return foreign ? base : base * 0.25;
}

export function describeWeather(w: Weather): string {
  const parts: string[] = [];
  if (w.winter >= 0.15) parts.push(w.winter >= 0.6 ? 'deep winter' : 'winter');
  if (w.monsoon >= 0.15) parts.push(w.monsoon >= 0.6 ? 'monsoon' : 'heavy rains');
  if (w.heat >= 0.15) parts.push(w.heat >= 0.6 ? 'extreme heat' : 'summer heat');
  return parts.length > 0 ? parts.join(', ') : 'clear';
}

/** Land unit movement points per month. */
export function movePoints(world: World, type: UnitTypeId): number {
  const t = world.unitTypes.get(type);
  if (!t) return 1;
  if (t.domain === 'air') return 2;
  return Math.max(1, t.speed);
}
