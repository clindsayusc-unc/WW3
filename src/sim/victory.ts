/** Victory and defeat conditions from docs/DESIGN.md (D-031). */
import { nationName, type World } from './world';
import type { GameState } from './types';
import { alliesOf, controlledRegions, effectiveGdp, worldGdp } from './query';
import { trendGrowth } from './economy';
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
  const v = victoryFor(world, state, p, true);
  if (v) state.victory = v;
}

export type VictoryKind = 'hegemony' | 'conquest' | 'diplomatic' | 'deterrence';

/**
 * The victory conditions evaluated for any nation (the player's check, and the all-AI balance
 * runs in scripts/selfplay.ts, which score every great power each month). `diplomatic` needs the
 * World Order Resolution, which only the player can table.
 */
export function victoryFor(
  world: World,
  state: GameState,
  p: string,
  includeDiplomatic = false,
): { kind: VictoryKind; text: string } | null {
  if (!state.nations[p]?.alive || state.turn < 12) return null;
  const total = worldGdp(world, state) || 1;
  const bloc = [p, ...alliesOf(world, state, p)];
  const blocGdp = bloc.reduce((s, iso) => s + effectiveGdp(world, state, iso), 0);
  const blocPop = bloc.reduce((s, iso) => s + (state.nations[iso]?.population ?? 0), 0);
  const worldPop =
    Object.values(state.nations)
      .filter((n) => n.alive)
      .reduce((s, n) => s + n.population, 0) || 1;
  if (blocGdp / total >= 0.55 && blocPop / worldPop >= 0.35)
    return {
      kind: 'hegemony',
      text: `Your bloc commands ${Math.round((blocGdp / total) * 100)}% of world output and a third of its people. A new order takes shape around ${nationName(world, p)}.`,
    };
  const rivalMajors = world.majors.filter((m) => m !== p);
  if (rivalMajors.every((m) => !state.nations[m]!.alive))
    return {
      kind: 'conquest',
      text: 'Every rival great power has capitulated. The world is yours, for whatever that is worth.',
    };
  if (includeDiplomatic && state.resolutionPassed && blocGdp / total >= 0.45)
    return {
      kind: 'diplomatic',
      text: 'Your World Order Resolution stands and your bloc dominates the global economy. You have won the peace.',
    };
  if (state.turn >= DETERRENCE_TURN && state.detonations === 0) {
    const ranking = standingRanking(world, state);
    if (ranking[0]?.iso === p)
      return {
        kind: 'deterrence',
        text: `January 2040. You have led ${nationName(world, p)} through the most dangerous decade in memory without a nuclear war, and no great power has gained more standing: output against its own trend, and territory held.`,
      };
  }
  return null;
}

// --- standing (D-081) ------------------------------------------------------------------------------

/**
 * Weights of a great power's standing. Self-play rejected a military term: the share of the great
 * powers' armed strength rises fastest for nations that start lightly armed and rearm (Germany won
 * 45 of 50 all-AI games on it), which is a cheap strategy, not an achievement; strength that matters
 * shows up as territory.
 */
export const STANDING_WEIGHTS = { economy: 0.5, territory: 0.5 } as const;
/**
 * Territory is damped by this many regions (ln((R + K) ÷ (R₀ + K))) so that one region more or less
 * does not swing a small state's standing: undamped, Israel's or Pakistan's few regions made
 * territory the whole contest.
 */
export const TERRITORY_DAMPING = 10;

export interface StandingStart {
  /** GDP when recorded (US$ bn). */
  readonly gdp: number;
  readonly regions: number;
  /** Turn the position was recorded (0, or the turn an older save was loaded). */
  readonly turn: number;
}

/** Each great power's starting position, recorded when the game is created. */
export function standingStart(world: World, state: GameState): Record<string, StandingStart> {
  return Object.fromEntries(world.majors.map((m) => [m, { gdp: state.nations[m]!.gdp, regions: controlledRegions(state, m).length, turn: state.turn }]));
}

/** GDP the nation would have reached on its trend growth alone (no wars, sanctions or technology). */
export function trendGdp(state: GameState, iso: string, gdp0: number, fromTurn = 0): number {
  const n = state.nations[iso]!;
  let g = gdp0;
  for (let t = fromTurn; t < state.turn; t++) g *= (1 + trendGrowth({ turn: t } as GameState, n) / 100) ** (1 / 12);
  return g;
}

export interface Standing {
  readonly iso: string;
  /** ln(effective output ÷ trend output): above or below the economy's own trend since 2027. */
  readonly economy: number;
  /** ln((regions controlled + K) ÷ (regions in 2027 + K)), K = TERRITORY_DAMPING. */
  readonly territory: number;
  readonly score: number;
}

/**
 * The Deterrence victory goes to the great power that gained most standing since January 2027:
 * output against its own trend (so a fast-growing economy is not handed the win) and territory held.
 * Every playable major can top it (D-081).
 */
export function standingRanking(world: World, state: GameState): Standing[] {
  const start = state.standingStart ?? standingStart(world, state);
  const ln = (x: number) => Math.log(Math.max(0.05, x));
  const out: Standing[] = [];
  for (const m of world.majors) {
    const s0 = start[m];
    if (!s0 || !state.nations[m]?.alive) continue;
    const economy = ln(effectiveGdp(world, state, m) / Math.max(1e-6, trendGdp(state, m, s0.gdp, s0.turn ?? 0)));
    const territory = ln((controlledRegions(state, m).length + TERRITORY_DAMPING) / (s0.regions + TERRITORY_DAMPING));
    const score = STANDING_WEIGHTS.economy * economy + STANDING_WEIGHTS.territory * territory;
    out.push({ iso: m, economy, territory, score });
  }
  return out.sort((a, b) => b.score - a.score || (a.iso < b.iso ? -1 : 1));
}
