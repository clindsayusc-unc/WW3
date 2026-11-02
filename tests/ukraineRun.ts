/**
 * Shared runner for the Ukraine calibration (D-072): World of 2027 with a passive player far from the
 * war (Brazil), 24 months, recording whether Kyiv stays Ukrainian, average turn time and any AI war
 * declared on an ally.
 */
import { applyCommand, createGame } from '../src/sim/game';
import { loadWorld } from '../src/sim/world';
import { alliesOf } from '../src/sim/query';
import type { GameState } from '../src/sim/types';

export const world = loadWorld();
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const MONTHS = 24;

export interface UkraineRun {
  seed: number;
  /** First month Kyiv was not Ukrainian, or null if it held throughout. */
  kyivLost: number | null;
  /** AI war declarations or entries against a nation it was allied to the month before. */
  allyWars: string[];
  msPerTurn: number;
  aidPerMonth: number;
}

function allyWarViolations(prev: GameState, next: GameState): string[] {
  const out: string[] = [];
  for (const w of next.wars) {
    const before = prev.wars.find((p) => p.id === w.id);
    const newA = w.attackers.filter((x) => !before?.attackers.includes(x));
    const newD = w.defenders.filter((x) => !before?.defenders.includes(x));
    const check = (joiners: string[], other: string[]) => {
      for (const j of joiners) {
        if (j === next.player) continue;
        for (const o of other) if (o !== next.player && alliesOf(world, prev, j).includes(o)) out.push(`${prev.isoDate}: ${j} vs ally ${o}`);
      }
    };
    check(newA, w.defenders);
    check(newD, w.attackers);
  }
  return out;
}

export function runUkraine(seed: number, aid: boolean): UkraineRun {
  let g = createGame({ seed, player: 'BRA', scenario: 'world-2027' }, world);
  if (!aid) g = { ...g, aidSuspended: Object.keys(g.nations) };
  const kyiv = world.capitalRegion.get('UKR')!;
  let kyivLost: number | null = null;
  const allyWars: string[] = [];
  let ms = 0;
  let aidTotal = 0;
  for (let m = 1; m <= MONTHS; m++) {
    const t0 = performance.now();
    const next = applyCommand(world, g, { type: 'endTurn' });
    ms += performance.now() - t0;
    allyWars.push(...allyWarViolations(g, next));
    g = next;
    aidTotal += g.nations.UKR!.aidReceived;
    if (kyivLost === null && g.regions[kyiv]!.controller !== 'UKR') kyivLost = m;
  }
  return { seed, kyivLost, allyWars, msPerTurn: ms / MONTHS, aidPerMonth: aidTotal / MONTHS };
}
