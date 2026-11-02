/// <reference lib="webworker" />
import { applyCommand, createGame, refreshLeaders } from './game';
import { estimateOdds } from './military';
import { loadWorld } from './world';
import type { GameState, WorkerRequest, WorkerResponse } from './types';

let state: GameState | null = null;
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
    } else if (req.kind === 'load') {
      state = refreshLeaders(world, req.state);
    } else if (req.kind === 'odds') {
      if (!state) throw new Error('Simulation not initialised');
      const odds = estimateOdds(world, state, req.unitIds, req.target);
      post({ kind: 'odds', target: req.target, ratio: odds.ratio, text: odds.text });
      return;
    } else {
      if (!state) throw new Error('Simulation not initialised');
      state = applyCommand(world, state, req.command);
    }
    post({ kind: 'state', state, ms: performance.now() - t0 });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
