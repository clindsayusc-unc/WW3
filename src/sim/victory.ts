/** Victory and defeat conditions from docs/DESIGN.md (D-031). */
import { nationName, type World } from './world';
import type { GameState } from './types';
import { alliesOf, effectiveGdp, worldGdp } from './query';
import { isFullExchange } from './escalation';

export const DETERRENCE_TURN = 156; // January 2040

export function checkVictory(world: World, state: GameState): void {
  if (state.victory || state.defeat) return;
  const p = state.player;
  const me = state.nations[p]!;
  if (isFullExchange(state)) {
    state.defeat = {
      kind: 'nuclearWar',
      text: 'A full nuclear exchange has devastated the northern hemisphere. There are no winners.',
    };
    return;
  }
  if (!me.alive) {
    state.defeat = {
      kind: 'capitulation',
      text: `${nationName(world, p)} has capitulated to ${nationName(world, me.capitulatedTo)}.`,
    };
    return;
  }
  if (me.monthsUnstable >= 3) {
    state.defeat = {
      kind: 'collapse',
      text: 'Your government has collapsed after months of unrest. The regime has fallen.',
    };
    return;
  }
  if (state.turn < 12) return;
  const total = worldGdp(world, state) || 1;
  const blocGdp = [p, ...alliesOf(world, state, p)].reduce(
    (s, iso) => s + effectiveGdp(world, state, iso),
    0,
  );
  const blocPop = [p, ...alliesOf(world, state, p)].reduce(
    (s, iso) => s + (state.nations[iso]?.population ?? 0),
    0,
  );
  const worldPop =
    Object.values(state.nations)
      .filter((n) => n.alive)
      .reduce((s, n) => s + n.population, 0) || 1;
  const myGdp = effectiveGdp(world, state, p);
  const topGdp = Math.max(
    ...Object.values(state.nations)
      .filter((n) => n.alive)
      .map((n) => effectiveGdp(world, state, n.iso3)),
  );
  if (blocGdp / total >= 0.55 && blocPop / worldPop >= 0.35) {
    state.victory = {
      kind: 'hegemony',
      text: `Your bloc commands ${Math.round((blocGdp / total) * 100)}% of world output and a third of its people. A new order takes shape around ${nationName(world, p)}.`,
    };
    return;
  }
  const rivalMajors = world.majors.filter((m) => m !== p);
  if (rivalMajors.every((m) => !state.nations[m]!.alive)) {
    state.victory = {
      kind: 'conquest',
      text: 'Every rival great power has capitulated. The world is yours, for whatever that is worth.',
    };
    return;
  }
  if (state.resolutionPassed && blocGdp / total >= 0.45) {
    state.victory = {
      kind: 'diplomatic',
      text: 'Your World Order Resolution stands and your bloc dominates the global economy. You have won the peace.',
    };
    return;
  }
  if (state.turn >= DETERRENCE_TURN && myGdp >= topGdp * 0.999 && state.detonations === 0) {
    state.victory = {
      kind: 'deterrence',
      text: 'January 2040. You have led the world through its most dangerous decade without a nuclear war, and emerged as its leading power.',
    };
  }
}
