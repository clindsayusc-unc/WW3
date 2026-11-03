/**
 * Performance profile (D-082): a camera sweep at Low, Medium and High, then 20 turns with the
 * worker turn time and the browser's process memory sampled after each. Run with `npm run perf`;
 * writes docs/perf-last-run.json. Skipped unless PERF=1.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(1_800_000);

type Ww3 = {
  ww3: {
    perf: (s: number) => Promise<Record<string, unknown>>;
    ui: {
      getState: () => {
        setQuality: (q: string) => void;
        setEffects: (e: Record<string, string>) => void;
        setPrefs: (p: object) => void;
      };
    };
    game: { getState: () => { lastTurnMs: number; game: { turn: number } | null } };
  };
};

/**
 * Proportional set size of every browser process (MB), summed: shared pages are split between
 * the processes that map them, so the sum is what the browser costs the machine — the closest
 * Linux equivalent of Activity Monitor's "Memory" column. Linux only (null elsewhere).
 */
function browserMemoryMB(): number | null {
  if (platform() !== 'linux') return null;
  let kb = 0;
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!/chrom|headless_shell/.test(cmd) || !/playwright/.test(cmd)) continue;
      const roll = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const m = /^Pss:\s+(\d+) kB/m.exec(roll);
      if (m) kb += Number(m[1]);
    } catch {
      /* process exited */
    }
  }
  return kb / 1024;
}

async function playTurn(page: Page): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (
      await page
        .getByTestId('end-screen')
        .isVisible()
        .catch(() => false)
    )
      return;
    if (
      await page
        .getByTestId('event-modal')
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByTestId('choice-0').click();
      await page.waitForTimeout(150);
      continue;
    }
    if (
      await page
        .getByTestId('end-turn')
        .isEnabled()
        .catch(() => false)
    ) {
      const before = await page.evaluate(
        () => (globalThis as unknown as Ww3).ww3.game.getState().game?.turn ?? 0,
      );
      await page.getByTestId('end-turn').click();
      await page.waitForFunction(
        (t) => ((globalThis as unknown as Ww3).ww3.game.getState().game?.turn ?? 0) > t,
        before,
        { timeout: 180_000 },
      );
      return;
    }
    if (Date.now() > deadline) throw new Error('End Turn never became available');
    await page.waitForTimeout(200);
  }
}

test('performance profile: Low/Medium/High sweep and 20 turns', async ({ page }) => {
  test.skip(!process.env.PERF, 'set PERF=1 to run the performance profile');
  const sweep = Number(process.env.PERF_SECONDS ?? 15);
  await page.goto('/');
  await expect(page.getByTestId('loading')).toBeHidden({ timeout: 180_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('mode-full').click(); // Full mode (Simple is the first-game default, D-086)
  await page.getByTestId('mode-next').click();
  await page.getByTestId('scenario-next').click();
  await page.getByTestId('leader-grid').getByTestId('leader-USA').click();
  const toggle = page.getByTestId('tutorial-toggle');
  if (await toggle.isChecked()) await toggle.click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 120_000 });
  const memAtStart = browserMemoryMB();
  const levels: Record<string, unknown>[] = [];
  for (const q of ['low', 'medium', 'high']) {
    await page.evaluate((quality) => {
      const s = (globalThis as unknown as Ww3).ww3.ui.getState();
      s.setQuality(quality);
      s.setEffects({
        atmosphere: quality,
        ocean: quality,
        clouds: quality,
        terrain: quality,
        war: quality,
      });
    }, q);
    // Switching to or from Low swaps the texture set (D-082): let it load and settle.
    await page.waitForTimeout(8000);
    const r = await page.evaluate((s) => (globalThis as unknown as Ww3).ww3.perf(s), sweep);
    levels.push({ ...r, processMB: browserMemoryMB() });
    console.log(`PERF ${q} ${JSON.stringify(r)}`);
  }
  const turns: { turn: number; ms: number; processMB: number | null; heapMB: number | null }[] = [];
  for (let i = 0; i < 20; i++) {
    await playTurn(page);
    const s = await page.evaluate(() => ({
      ms: (globalThis as unknown as Ww3).ww3.game.getState().lastTurnMs,
      turn: (globalThis as unknown as Ww3).ww3.game.getState().game?.turn ?? 0,
      heap:
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null,
    }));
    turns.push({
      turn: s.turn,
      ms: s.ms,
      processMB: browserMemoryMB(),
      heapMB: s.heap === null ? null : s.heap / 1048576,
    });
  }
  const ms = turns.map((t) => t.ms).sort((a, b) => a - b);
  const peak = Math.max(0, ...turns.map((t) => t.processMB ?? 0));
  const out = {
    at: new Date().toISOString(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    renderer: await page.evaluate(`(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const ext = c && c.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(c.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    })()`),
    sweepSeconds: sweep,
    levels,
    turns: {
      count: turns.length,
      meanMs: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
      p95Ms: ms[Math.floor(ms.length * 0.95)] ?? 0,
      maxMs: ms[ms.length - 1] ?? 0,
      samples: turns,
    },
    processMB: { atStart: memAtStart, peak },
  };
  writeFileSync('docs/perf-last-run.json', JSON.stringify(out, null, 2) + '\n');
  console.log(
    'PERF_RESULT ' + JSON.stringify({ ...out, turns: { ...out.turns, samples: undefined } }),
  );
  if (peak) expect(peak).toBeLessThan(1536);
});
