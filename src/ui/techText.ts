/** Human-readable technology effects (research screen, hover cards, deal texts). */
import type { TechMeta } from '../sim/world';

export const EFFECT_LABEL: Record<string, { label: string; explain: string; unit: 'pct' | 'pp' | 'points' | 'levels' }> = {
  landAttack: { label: 'land attack', explain: 'Firepower of land formations when attacking.', unit: 'pct' },
  landDefence: { label: 'land defence', explain: 'Firepower of land formations when defending.', unit: 'pct' },
  airPower: { label: 'air power', explain: 'Strength of air wings, escorts and interception survival.', unit: 'pct' },
  navalPower: { label: 'naval power', explain: 'Strength of every naval formation.', unit: 'pct' },
  researchSpeed: { label: 'research speed', explain: 'Research points per month.', unit: 'pct' },
  gdpGrowth: { label: 'GDP growth', explain: 'Trend growth, percentage points a year.', unit: 'pp' },
  productionCost: { label: 'production cost', explain: 'Cost of every new formation.', unit: 'pct' },
  upkeep: { label: 'upkeep', explain: 'Monthly cost of the forces you field.', unit: 'pct' },
  missileDefence: { label: 'missile defence', explain: 'Interception chance against missile strikes and enemy second strikes.', unit: 'pct' },
  hypersonicDefence: { label: 'hypersonic defence', explain: 'Recovers part of the interception chance lost against hypersonic glide vehicles.', unit: 'pct' },
  cyberAttack: { label: 'cyber attack', explain: 'Success of cyber operations and research theft.', unit: 'pct' },
  cyberDefence: { label: 'cyber defence', explain: 'Resistance to enemy cyber operations and research theft.', unit: 'pct' },
  intel: { label: 'intelligence', explain: 'Intelligence level everywhere (fog of war, 0–4).', unit: 'levels' },
  enemyIntel: { label: 'enemy intelligence', explain: 'Intelligence level of enemies over your territory.', unit: 'levels' },
  stability: { label: 'stability', explain: 'Long-run stability equilibrium.', unit: 'points' },
  droneStrength: { label: 'drone strength', explain: 'Strength of drones, loyal wingmen and swarms.', unit: 'pct' },
  droneResistance: { label: 'drone resistance', explain: 'Electronic warfare and counter-drone defences: enemy drones over your territory are shot down more often.', unit: 'pct' },
  strikePower: { label: 'strike power', explain: 'Missile penetration, damage and production.', unit: 'pct' },
  missileRate: { label: 'missile production', explain: 'Missiles added to the stock each month.', unit: 'pct' },
  deterrence: { label: 'deterrence', explain: 'Survivability and penetration of your nuclear second strike.', unit: 'pct' },
  antiAir: { label: 'anti-air', explain: 'Weight of your air-defence brigades.', unit: 'pct' },
  sanctionResistance: { label: 'sanction resistance', explain: 'Share of sanctions and export-control penalties shrugged off.', unit: 'pct' },
  buildSpeed: { label: 'build speed', explain: 'Production lines finish formations faster.', unit: 'pct' },
  supply: { label: 'supply', explain: 'Supply reaching your formations.', unit: 'pct' },
  crossing: { label: 'river & mountain crossing', explain: 'Share of the crossing penalty recovered.', unit: 'pct' },
  amphibiousLift: { label: 'amphibious lift', explain: 'Formations carried per amphibious group.', unit: 'pct' },
  espionage: { label: 'espionage', explain: 'Success of operations to steal research.', unit: 'pct' },
  counterIntel: { label: 'counter-intelligence', explain: 'Foreign research theft fails and is exposed more often.', unit: 'pct' },
  satelliteSurvival: { label: 'satellite survival', explain: 'Share of ASAT kills and debris losses avoided.', unit: 'pct' },
};

export function effectText(e: { key: string; value: number }): string {
  const meta = EFFECT_LABEL[e.key];
  const sign = e.value > 0 ? '+' : '';
  const label = meta?.label ?? e.key;
  switch (meta?.unit ?? 'pct') {
    case 'pct':
      return `${sign}${Math.round(e.value * 100)} % ${label}`;
    case 'pp':
      return `${sign}${e.value} pp ${label}`;
    case 'points':
      return `${sign}${e.value} ${label}`;
    default:
      return `${sign}${e.value} ${label}`;
  }
}

export const effectsText = (t: TechMeta): string => t.effects.map(effectText).join(', ');
