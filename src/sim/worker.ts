/// <reference lib="webworker" />
import { applyCommand, createGame, refreshLeaders } from './game';
import { estimateOdds } from './military';
import { loadWorld } from './world';
import type { GameState, WorkerRequest, WorkerResponse } from './types';
import { emptyUndo, recordCommand } from './undo';

let state: GameState | null = null;
const undo = emptyUndo();
const world = loadWorld();

function post(msg: WorkerResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const t0 = performance.now();
  try {
    if (req.kind === 'new') {
      state = createGame(req.options, world);
      recordCommand(undo, world, state, { type: 'endTurn' });
    } else if (req.kind === 'load') {
      state = refreshLeaders(world, req.state);
      recordCommand(undo, world, state, { type: 'endTurn' });
    } else if (req.kind === 'undo') {
      const prev = undo.states.pop();
      undo.labels.pop();
      if (!prev) throw new Error('Nothing to undo this turn.');
      state = prev;
    } else if (req.kind === 'odds') {
      if (!state) throw new Error('Simulation not initialised');
      post({ kind: 'odds', report: estimateOdds(world, state, req.unitIds, req.target) });
      return;
    } else {
      if (!state) throw new Error('Simulation not initialised');
      const before = state;
      state = applyCommand(world, state, req.command);
      // States are immutable (applyCommand clones), so the previous one can be kept as is.
      recordCommand(undo, world, before, req.command);
    }
    post({ kind: 'state', state, ms: performance.now() - t0, undo: [...undo.labels] });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
