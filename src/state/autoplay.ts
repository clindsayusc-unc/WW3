/**
 * Unattended verification run for the packaged app (D-083). When the native shell is launched
 * with `WW3_AUTOPLAY=<turns>`, the game starts a new campaign, ends that many turns (taking the
 * first choice of every event), sweeps the camera over a few theatres in between, and hands a
 * report to the shell, which writes it to `WW3_AUTOPLAY_REPORT` and quits.
 * `scripts/native-verify.sh` samples the process memory meanwhile.
 */
import { autoplayConfig, autoplayDone } from './native';
import { dispatch, newGame } from './simBridge';
import { useGameStore } from './gameStore';
import { useUiStore } from './uiStore';
import { gpuTextureBytes } from '../render/perf';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const t0 = performance.now();
  while (!pred()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await wait(50);
  }
}

const VIEWS: [number, number, number][] = [
  [50, 10, 1.8],
  [25, 121, 1.3],
  [48, 35, 1.5],
  [30, 52, 1.6],
  [38, -98, 2.6],
];

export async function runAutoplayIfRequested(): Promise<void> {
  const cfg = await autoplayConfig();
  if (!cfg) return;
  // Collect errors for the report: a packaged build has no console to look at.
  const errors: string[] = [];
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' ').slice(0, 300));
    origError(...args);
  };
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${String(e.reason)}`));
  const t0 = performance.now();
  const turns: { turn: number; workerMs: number; wallMs: number; events: number }[] = [];
  const fps: number[] = [];
  let error: string | null = null;
  try {
    const ui = useUiStore.getState();
    ui.setTutorial({ active: false, step: 0 });
    newGame({ seed: 20270101, player: cfg.nation, scenario: 'world-2027' });
    ui.setScreen('game');
    await until(() => !!useGameStore.getState().game, 120_000, 'the new game');
    await wait(3000);
    for (let i = 0; i < cfg.turns; i++) {
      const start = performance.now();
      let events = 0;
      // Resolve pending events first (the first choice), as a player would.
      for (;;) {
        const g = useGameStore.getState().game!;
        const ev = g.pendingEvents[0];
        if (!ev) break;
        events++;
        dispatch({ type: 'resolveEvent', pendingId: ev.id, choice: 0 }, { confirmed: true });
        await until(
          () => useGameStore.getState().game?.pendingEvents[0]?.id !== ev.id,
          60_000,
          'an event to resolve',
        );
      }
      const g = useGameStore.getState().game!;
      if (g.victory || g.defeat) break;
      const before = g.turn;
      dispatch({ type: 'endTurn' }, { confirmed: true });
      await until(() => (useGameStore.getState().game?.turn ?? 0) > before, 180_000, 'the turn');
      turns.push({
        turn: useGameStore.getState().game!.turn,
        workerMs: useGameStore.getState().lastTurnMs,
        wallMs: performance.now() - start,
        events,
      });
      // Look around for a moment so the renderer works as it would in play.
      const v = VIEWS[i % VIEWS.length]!;
      useUiStore.getState().fly(v[0], v[1], v[2]);
      await wait(1500);
      fps.push(useUiStore.getState().fps);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = turns.map((t) => t.workerMs).sort((a, b) => a - b);
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  await autoplayDone({
    ok: error === null && turns.length === cfg.turns,
    error,
    nation: cfg.nation,
    turnsRequested: cfg.turns,
    turnsPlayed: turns.length,
    finalDate: useGameStore.getState().game?.isoDate ?? null,
    seconds: (performance.now() - t0) / 1000,
    workerTurnMs: {
      mean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
      p95: ms[Math.floor(ms.length * 0.95)] ?? 0,
      max: ms[ms.length - 1] ?? 0,
    },
    fpsSamples: fps,
    gpuTextureMB: gpuTextureBytes() / 1048576,
    globeLoaded: !document.querySelector('[data-testid="loading"]'),
    assetError: useUiStore.getState().assetError,
    errors: errors.slice(0, 20),
    jsHeapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
    userAgent: navigator.userAgent,
    turns,
  });
}
