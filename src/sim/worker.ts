/// <reference lib="webworker" />
import { applyCommand, createGame } from './game';
import type { GameState, WorkerRequest, WorkerResponse } from './types';

let state: GameState | null = null;

function post(msg: WorkerResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.kind === 'init') {
      state = createGame(req.seed);
    } else {
      if (!state) throw new Error('Simulation not initialised');
      state = applyCommand(state, req.command);
    }
    post({ kind: 'state', state });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
