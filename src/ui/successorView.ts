/** The fictional successor in office for a nation, if any, as the leader card shows it (D-078). */
import type { World } from '../sim/world';
import { traitsOf } from '../sim/world';
import type { GameState, Iso3 } from '../sim/types';
import { factionOf } from '../sim/succession';
import type { SuccessorView } from './LeaderCard';

export function successorView(world: World, game: GameState, iso: Iso3): SuccessorView | null {
  const n = game.nations[iso];
  if (!n?.leaderFictional) return null;
  return {
    name: n.leaderName,
    title: n.leaderTitle,
    traits: traitsOf(world, iso, game),
    faction: factionOf(world, iso, n.leaderFaction)?.name ?? null,
  };
}
