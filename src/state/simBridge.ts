import type {
  Command,
  GameState,
  NewGameOptions,
  OddsReport,
  RegionId,
  WorkerRequest,
  WorkerResponse,
} from '../sim/types';
import { useGameStore } from './gameStore';

/** Owns the simulation Web Worker and pipes its state into the zustand store. */
let worker: Worker | null = null;
let oddsListener: ((report: OddsReport) => void) | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    if (msg.kind === 'state') useGameStore.getState().setGame(msg.state, msg.ms, msg.undo);
    else if (msg.kind === 'odds') oddsListener?.(msg.report);
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

/**
 * A gate that may hold a command back for confirmation (D-080): it returns true when it has taken
 * the command (the UI shows a dialog and re-dispatches with `confirmed`).
 */
let gate: ((command: Command) => boolean) | null = null;
export function setDispatchGate(g: ((command: Command) => boolean) | null): void {
  gate = g;
}

export function dispatch(command: Command, opts: { confirmed?: boolean } = {}): void {
  if (!opts.confirmed && gate?.(command)) return;
  if (command.type === 'endTurn') useGameStore.getState().setBusy(true);
  send({ kind: 'command', command });
}

/** Take back the last undoable order of this turn (D-080). */
export function undoLast(): void {
  if (useGameStore.getState().undo.length === 0) return;
  send({ kind: 'undo' });
}

export function requestOdds(
  unitIds: number[],
  target: RegionId,
  cb: (report: OddsReport) => void,
): void {
  oddsListener = cb;
  send({ kind: 'odds', unitIds, target });
}
