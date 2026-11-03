/**
 * Undo for orders within a turn (D-080). Only orders whose outcome is known in advance can be
 * taken back: moves, air missions, production, research, budget, taxes, mobilisation, disbanding.
 * Anything that rolls dice or tells another government something (war, strikes, cyber, theft,
 * proposals, votes) is final, and clears the undo history so an earlier order cannot be undone
 * past it. Ending the turn clears it too.
 */
import type { Command, GameState } from './types';
import type { World } from './world';

export const UNDO_LIMIT = 20;

const UNDOABLE: ReadonlySet<Command['type']> = new Set([
  'moveUnits',
  'setAirMission',
  'queueProduction',
  'cancelProduction',
  'setResearch',
  'queueResearch',
  'setResearchQueue',
  'setBudget',
  'setTaxRate',
  'setMobilization',
  'disband',
  'setAid',
]);

export const isUndoable = (c: Command): boolean => UNDOABLE.has(c.type);

/** A short label for the undo button ("Undo: move 3 units"). */
export function undoLabel(world: World, c: Command): string {
  switch (c.type) {
    case 'moveUnits':
      return `move ${c.unitIds.length} unit${c.unitIds.length === 1 ? '' : 's'}`;
    case 'setAirMission':
      return 'air mission';
    case 'queueProduction':
      return `build ${world.unitTypes.get(c.unitType)?.name ?? c.unitType}`;
    case 'cancelProduction':
      return 'cancel production';
    case 'setResearch':
    case 'queueResearch':
      return `research ${world.techs.get(c.tech)?.name ?? c.tech}`;
    case 'setResearchQueue':
      return 'research queue';
    case 'setBudget':
      return 'budget';
    case 'setTaxRate':
      return 'tax rate';
    case 'setMobilization':
      return 'mobilisation';
    case 'disband':
      return 'disband';
    case 'setAid':
      return 'aid programme';
    default:
      return c.type;
  }
}

export interface UndoStack {
  states: GameState[];
  labels: string[];
}

export const emptyUndo = (): UndoStack => ({ states: [], labels: [] });

/** Record `before` for an undoable command, or clear the history for a final one. */
export function recordCommand(stack: UndoStack, world: World, before: GameState, c: Command): void {
  if (!isUndoable(c)) {
    stack.states.length = 0;
    stack.labels.length = 0;
    return;
  }
  stack.states.push(before);
  stack.labels.push(undoLabel(world, c));
  if (stack.states.length > UNDO_LIMIT) {
    stack.states.shift();
    stack.labels.shift();
  }
}
