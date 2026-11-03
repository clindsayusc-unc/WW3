/** Onboarding and readability (D-080): prefs, confirmations, breakdowns, type floor, tutorial. */
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { loadWorld } from '../sim/world';
import { clampScale, DEFAULT_PREFS, parsePrefs, UI_SCALE_MAX, UI_SCALE_MIN } from './prefs';
import { confirmText } from './confirmText';
import { approvalRows, growthRows } from './breakdowns';
import { growthBreakdown } from '../sim/economy';
import { SHORTCUTS } from './shortcuts';
import { ADVISOR, TUTORIAL_STEPS } from './tutorial/steps';
import { isUndoable } from '../sim/undo';
import type { Command } from '../sim/types';

const world = loadWorld();
const game = createGame({ seed: 2, player: 'USA', scenario: 'world-2027' }, world);

describe('preferences', () => {
  it('parse defensively and clamp the UI scale', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    const p = parsePrefs(JSON.stringify({ uiScale: 9, palette: 'colourblind', confirmIrreversible: false, tutorialDone: true }));
    expect(p.uiScale).toBe(UI_SCALE_MAX);
    expect(p.palette).toBe('colourblind');
    expect(p.confirmIrreversible).toBe(false);
    expect(p.advisor).toBe(true);
    expect(p.tutorialDone).toBe(true);
    expect(clampScale(0.1)).toBe(UI_SCALE_MIN);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe('confirmations', () => {
  it('every irreversible command asks first; undoable orders never do', () => {
    const asks: Command[] = [
      { type: 'propose', proposal: 'declareWar', target: 'IRN' },
      { type: 'propose', proposal: 'embargo', target: 'IRN' },
      { type: 'missileStrike', region: world.capitalRegion.get('IRN')!, kind: 'industry' },
      { type: 'cyberOp', target: 'IRN', kind: 'economy' },
      { type: 'asat', target: 'CHN' },
      { type: 'stealTech', target: 'CHN', tech: 'cyber-pqc' },
      { type: 'leaveBloc', bloc: 'NATO' },
      { type: 'techControls', target: 'CHN', on: true },
    ];
    for (const c of asks) {
      const t = confirmText(world, game, c);
      expect(t, c.type).not.toBeNull();
      expect(t!.title.length).toBeGreaterThan(5);
      expect(t!.body.length).toBeGreaterThan(30);
      expect(isUndoable(c)).toBe(false);
    }
    expect(confirmText(world, game, asks[0]!)!.danger).toBe(true);
    // War warns about the target's allies.
    expect(confirmText(world, game, { type: 'propose', proposal: 'declareWar', target: 'GBR' })!.body).toMatch(/treaties/);
    for (const c of [
      { type: 'queueProduction', unitType: 'infantry', region: 1 },
      { type: 'propose', proposal: 'trade', target: 'GBR' },
      { type: 'endTurn' },
      { type: 'techControls', target: 'CHN', on: false },
    ] as Command[])
      expect(confirmText(world, game, c)).toBeNull();
  });
});

describe('nested breakdowns', () => {
  it('growth rows add up to the growth breakdown and carry their sources', () => {
    const rows = growthRows(world, game, 'USA');
    expect(rows[0]!.label).toBe('Trend');
    const g = growthBreakdown(world, game, 'USA');
    const sum = rows.reduce((s, r) => s + Number(r.value.replace('−', '-').replace(' pp', '')), 0);
    const expected = g.base + g.infrastructure + g.tech + g.tax + g.trade + g.resources + g.sanctions + g.war + g.mobilization + g.debt + g.inflation + g.recovery + g.events + g.chokepoints;
    expect(sum).toBeCloseTo(expected, 1);
    expect(rows.every((r) => typeof r.tip === 'string' && r.tip.length > 10)).toBe(true);
    const ru = growthRows(world, createGame({ seed: 2, player: 'RUS', scenario: 'world-2027' }, world), 'RUS');
    expect(ru.find((r) => r.label === 'War')?.tip).toMatch(/Ukraine/);
  });
  it('approval rows start from the baseline', () => {
    const rows = approvalRows(world, game, 'USA');
    expect(rows[0]!.label).toBe('Baseline');
    expect(rows.length).toBeGreaterThan(2);
  });
});

describe('tutorial and shortcuts', () => {
  it('five months of steps, each with a body, tasks that can complete, a fictional advisor', () => {
    expect(ADVISOR.fictional).toBe(true);
    expect(new Set(TUTORIAL_STEPS.map((s) => s.turn))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(TUTORIAL_STEPS.map((s) => s.id)).size).toBe(TUTORIAL_STEPS.length);
    for (let i = 1; i < TUTORIAL_STEPS.length; i++) expect(TUTORIAL_STEPS[i]!.turn).toBeGreaterThanOrEqual(TUTORIAL_STEPS[i - 1]!.turn);
    for (const s of TUTORIAL_STEPS) {
      expect(s.body.length).toBeGreaterThan(30);
      if (s.task) expect(s.done).toBeDefined();
    }
    // Each month but the last ends with an end-turn step.
    for (let t = 0; t < 4; t++) {
      const last = TUTORIAL_STEPS.filter((s) => s.turn === t).at(-1)!;
      expect(last.target).toBe('end-turn');
    }
  });
  it('the shortcut list has no duplicate keys', () => {
    const keys = SHORTCUTS.map((s) => s.keys.join('+'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
