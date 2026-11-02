import type {
  Command,
  GameState,
  NewGameOptions,
  RegionId,
  WorkerRequest,
  WorkerResponse,
} from '../sim/types';
import { useGameStore } from './gameStore';

/** Owns the simulation Web Worker and pipes its state into the zustand store. */
let worker: Worker | null = null;
let oddsListener: ((target: RegionId, ratio: number, text: string) => void) | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'state') useGameStore.getState().setGame(msg.state, msg.ms);
    else if (msg.kind === 'odds') oddsListener?.(msg.target, msg.ratio, msg.text);
    else useGameStore.getState().setError(msg.message);
  };
  worker.onerror = (e) => useGameStore.getState().setError(e.message);
  return worker;
}

function send(req: WorkerRequest): void {
  ensureWorker().postMessage(req);
}

export function newGame(options: NewGameOptions): void {
  useGameStore.getState().setBusy(true);
  send({ kind: 'new', options });
}

export function loadGame(state: GameState): void {
  useGameStore.getState().setBusy(true);
  send({ kind: 'load', state });
}

export function dispatch(command: Command): void {
  if (command.type === 'endTurn') useGameStore.getState().setBusy(true);
  send({ kind: 'command', command });
}

export function requestOdds(
  unitIds: number[],
  target: RegionId,
  cb: (target: RegionId, ratio: number, text: string) => void,
): void {
  oddsListener = cb;
  send({ kind: 'odds', unitIds, target });
}
