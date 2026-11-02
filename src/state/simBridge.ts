import type { Command, WorkerRequest, WorkerResponse } from '../sim/types';
import { useGameStore } from './gameStore';

/** Owns the simulation Web Worker and pipes its state into the zustand store. */
let worker: Worker | null = null;

function send(req: WorkerRequest): void {
  if (!worker) throw new Error('Simulation worker not started');
  worker.postMessage(req);
}

export function startSimulation(seed: number): void {
  if (worker) return;
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'state') useGameStore.getState().setGame(msg.state);
    else useGameStore.getState().setError(msg.message);
  };
  send({ kind: 'init', seed });
}

export function dispatch(command: Command): void {
  send({ kind: 'command', command });
}
