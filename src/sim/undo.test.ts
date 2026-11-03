/** Undo for orders within a turn (D-080). */
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { loadWorld } from './world';
import { emptyUndo, isUndoable, recordCommand, UNDO_LIMIT, undoLabel } from './undo';
import type { Command } from './types';

const world = loadWorld();

describe('undo', () => {
  it('orders are undoable; dice rolls, diplomacy and the end of the turn are final', () => {
    for (const c of [
      { type: 'moveUnits', unitIds: [1], target: 1 },
      { type: 'queueProduction', unitType: 'infantry', region: 1 },
      { type: 'queueResearch', tech: 'cyber-pqc' },
      { type: 'setTaxRate', rate: 30 },
    ] as Command[])
      expect(isUndoable(c)).toBe(true);
    for (const c of [
      { type: 'endTurn' },
      { type: 'propose', proposal: 'declareWar', target: 'IRN' },
      { type: 'missileStrike', region: 1, kind: 'industry' },
      { type: 'stealTech', target: 'USA', tech: 'x' },
      { type: 'cyberOp', target: 'CHN', kind: 'economy' },
    ] as Command[])
      expect(isUndoable(c)).toBe(false);
  });

  it('restoring the recorded state takes back exactly that order', () => {
    const g = createGame({ seed: 4, player: 'USA', scenario: 'world-2027' }, world);
    const stack = emptyUndo();
    const cmd: Command = { type: 'queueProduction', unitType: 'infantry', region: world.capitalRegion.get('USA')! };
    const after = applyCommand(world, g, cmd);
    recordCommand(stack, world, g, cmd);
    expect(after.nations['USA']!.production.length).toBe(g.nations['USA']!.production.length + 1);
    expect(stack.labels).toEqual(['build Infantry Division']);
    const restored = stack.states.pop()!;
    expect(restored).toBe(g);
    expect(restored.nations['USA']!.treasury).toBe(g.nations['USA']!.treasury);
  });

  it('a final command clears the history, and the stack is bounded', () => {
    const g = createGame({ seed: 4, player: 'USA', scenario: 'world-2027' }, world);
    const stack = emptyUndo();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) recordCommand(stack, world, g, { type: 'setTaxRate', rate: 28 + (i % 3) });
    expect(stack.states.length).toBe(UNDO_LIMIT);
    recordCommand(stack, world, g, { type: 'endTurn' });
    expect(stack.states.length).toBe(0);
    expect(stack.labels.length).toBe(0);
    expect(undoLabel(world, { type: 'queueResearch', tech: 'cyber-pqc' })).toMatch(/Post-Quantum/);
  });
});
