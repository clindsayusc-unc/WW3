/** Strength by domain for the military overview bar charts (D-059). */
import { loadWorld } from '../sim/world';
import { unitPower } from '../sim/query';
import type { GameState, Iso3 } from '../sim/types';

const world = loadWorld();

export type Domain = 'land' | 'air' | 'sea' | 'strategic';
export const DOMAIN_INFO: Record<Domain, { label: string; tip: string }> = {
  land: { label: 'Land', tip: 'Sum of land formations’ attack + defence values × strength, quality and tech.' },
  air: { label: 'Air', tip: 'Sum of air wings’ attack + anti-air values × strength, quality and tech.' },
  sea: { label: 'Sea', tip: 'Sum of naval groups’ attack + defence values × strength, quality and tech.' },
  strategic: { label: 'Strategic', tip: 'Warheads ÷ 10 + missiles ÷ 20 + satellites × 2: nuclear, conventional-strike and orbital weight.' },
};

/** Strength by domain for a nation (also used by tests). */
export function domainStrength(game: GameState, iso: Iso3): Record<Domain, number> {
  const out: Record<Domain, number> = { land: 0, air: 0, sea: 0, strategic: 0 };
  for (const u of Object.values(game.units)) {
    if (u.owner !== iso) continue;
    const t = world.unitTypes.get(u.type);
    if (!t) continue;
    const p = unitPower(world, game, u, 'attack') + unitPower(world, game, u, 'defence');
    out[t.domain] += p;
  }
  const n = game.nations[iso];
  if (n) out.strategic = n.warheads / 10 + n.missiles / 20 + n.satellites * 2;
  return out;
}

