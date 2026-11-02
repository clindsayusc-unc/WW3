import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'docs/screenshots';

/** docs/screenshots/<branch>.png per CLAUDE.md (slashes become dashes). */
function branchSlug(): string {
  if (process.env.SCREENSHOT_NAME) return process.env.SCREENSHOT_NAME;
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim().replace(/[/\\]/g, '-');
  } catch {
    return 'unknown';
  }
}
test.setTimeout(900_000);

type Ww3Window = { ww3: { fly: (lat: number, lon: number, d: number) => void } };
type Ww3Hook = {
  capital: (iso3: string) => number | null;
  neighbours: (id: number) => number[];
  isLand: (id: number) => boolean;
  screenPos: (id: number) => { x: number; y: number; z: number } | null;
  regionLatLon: (id: number) => { lat: number; lon: number } | null;
  ui: { getState: () => { select: (id: number | null) => void } };
  game: {
    getState: () => { game: { regions: Record<number, { controller: string | null }> } | null };
  };
};
async function fly(page: Page, lat: number, lon: number, d: number) {
  await page.evaluate(
    ([a, b, c]) => (globalThis as unknown as Ww3Window).ww3.fly(a!, b!, c!),
    [lat, lon, d],
  );
}

/** Ends `n` turns, answering any decision modal that appears while waiting for the End Turn button. */
async function playTurns(page: Page, n: number, onEvent?: () => Promise<void>): Promise<void> {
  for (let i = 0; i < n; i++) {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (await page.getByTestId('end-screen').isVisible().catch(() => false)) return;
      if (await page.getByTestId('event-modal').isVisible().catch(() => false)) {
        if (onEvent) await onEvent();
        await page.getByTestId('choice-0').click();
        await page.waitForTimeout(150);
        continue;
      }
      if (await page.getByTestId('end-turn').isEnabled().catch(() => false)) {
        await page.getByTestId('end-turn').click();
        await page.waitForTimeout(250);
        break;
      }
      if (Date.now() > deadline) throw new Error(`turn ${i + 1}: End Turn never became available`);
      await page.waitForTimeout(200);
    }
  }
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('new game as USA: every screen, 10 turns, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  // Wait for the globe textures to load (the loading overlay disappears).
  await expect(page.getByTestId('loading')).toBeHidden({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'main-menu');

  await page.getByTestId('menu-new').click();
  await page.getByTestId('scenario-world').click();
  await page.getByTestId('scenario-next').click();
  await expect(page.getByTestId('leader-grid')).toBeVisible();
  // D-049: parliamentary majors show the head of government, not the ceremonial head of state.
  const grid = page.getByTestId('leader-grid');
  for (const [iso, monarchOrPresident] of [
    ['GBR', 'Charles III'],
    ['DEU', 'Steinmeier'],
    ['IND', 'Murmu'],
    ['JPN', 'Naruhito'],
    ['ISR', 'Herzog'],
    ['PAK', 'Zardari'],
  ] as const) {
    await expect(grid.getByTestId(`leader-name-${iso}`)).not.toContainText(monarchOrPresident);
  }
  await grid.getByTestId('leader-GBR').click();
  await expect(page.getByTestId('secondary-offices')).toContainText('Charles III');
  await shot(page, 'leader-select-gbr');
  await grid.getByTestId('leader-USA').click();
  await shot(page, 'leader-select');
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('hud')).toContainText('January 2027');
  await page.waitForTimeout(4000);
  await shot(page, 'globe-usa');

  // Full globe view.
  await fly(page, 20, 30, 3.4);
  await page.waitForTimeout(3500);
  await shot(page, 'globe-full');

  // Zoomed Taiwan Strait.
  await fly(page, 24.5, 120.5, 1.22);
  await page.waitForTimeout(4500);
  await shot(page, 'taiwan-strait');

  // Terrain map mode (key 7): land-cover tint shaded by elevation.
  await fly(page, 32, 55, 1.9);
  await page.getByTestId('mode-terrain').click();
  await page.waitForTimeout(3500);
  await shot(page, 'terrain-mode');
  // Chokepoint overlay: Hormuz with its status icon and label.
  await fly(page, 26.5, 56.3, 1.5);
  await page.waitForTimeout(3500);
  await shot(page, 'chokepoints');
  await page.getByTestId('mode-political').click();

  // Screens.
  await page.getByTestId('nav-budget').click();
  await expect(page.getByTestId('modal-budget')).toBeVisible();
  await page.getByTestId('budget-research').fill('14');
  await page.getByTestId('budget-apply').click();
  await shot(page, 'budget');
  await page.getByTestId('modal-close').click();

  await page.getByTestId('nav-production').click();
  await expect(page.getByTestId('modal-production')).toBeVisible();
  await page.getByTestId('build-drone').click();
  await shot(page, 'production');
  await page.getByTestId('modal-close').click();

  await page.getByTestId('nav-research').click();
  await expect(page.getByTestId('modal-research')).toBeVisible();
  await page.getByTestId('tech-ai-decision-support').click();
  await shot(page, 'research-tree');
  await page.getByTestId('modal-close').click();

  await page.getByTestId('nav-diplomacy').click();
  await expect(page.getByTestId('modal-diplomacy')).toBeVisible();
  await page.getByTestId('dip-GBR').click();
  await page.getByTestId('act-trade').click();
  await expect(page.getByTestId('diplomacy-reply')).toBeVisible();
  await shot(page, 'diplomacy');
  await page.getByTestId('modal-close').click();

  await page.getByTestId('nav-military').click();
  await expect(page.getByTestId('modal-military')).toBeVisible();
  await shot(page, 'military');
  await page.getByTestId('modal-close').click();

  // Battle odds in the Zagros: declare war on Iran, select the capital garrison and hover
  // Kermanshah (mountains) to see the full modifier breakdown.
  await page.getByTestId('nav-diplomacy').click();
  await page.getByTestId('diplomacy-search').fill('Iran');
  await page.getByTestId('dip-IRN').click();
  await page.getByTestId('act-declareWar').click();
  await page.getByTestId('modal-close').click();
  await expect(page.getByTestId('alerts')).toContainText('declares war on Iran');
  const kermanshah = await page.evaluate(() => {
    const w = (globalThis as unknown as { ww3: Ww3Hook }).ww3;
    w.ui.getState().select(w.capital('USA')!);
    return 584;
  });
  await page.getByTestId('own-stack').first().click();
  await expect(page.getByTestId('orders-hint')).toBeVisible();
  const kLatLon = await page.evaluate(
    (id) => (globalThis as unknown as { ww3: Ww3Hook }).ww3.regionLatLon(id),
    kermanshah,
  );
  await fly(page, kLatLon!.lat, kLatLon!.lon, 1.35);
  await page.waitForTimeout(3500);
  const kPos = await page.evaluate(
    (id) => (globalThis as unknown as { ww3: Ww3Hook }).ww3.screenPos(id),
    kermanshah,
  );
  expect(kPos).not.toBeNull();
  await page.mouse.move(kPos!.x, kPos!.y);
  await expect(page.getByTestId('odds-breakdown')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('odds-breakdown')).toContainText('Terrain');
  await page.getByTestId('odds-breakdown').scrollIntoViewIfNeeded();
  await shot(page, 'zagros-odds');
  await page.evaluate(() => (globalThis as unknown as { ww3: Ww3Hook }).ww3.ui.getState().select(null));
  // window.ww3 keeps the renderer's hooks after the app installs its own (perf must survive).
  expect(await page.evaluate(() => typeof (globalThis as unknown as { ww3: { perf?: unknown } }).ww3.perf)).toBe('function');

  // Fight a war: declare war on Cuba, then order the capital garrison to an adjacent region.
  await page.getByTestId('nav-diplomacy').click();
  await page.getByTestId('diplomacy-search').fill('Cuba');
  await page.getByTestId('dip-CUB').click();
  await page.getByTestId('act-declareWar').click();
  await page.getByTestId('modal-close').click();
  await expect(page.getByTestId('alerts')).toContainText('declares war on Cuba');
  const move = await page.evaluate(() => {
    const w = (globalThis as unknown as { ww3: Ww3Hook }).ww3;
    const cap = w.capital('USA')!;
    const game = w.game.getState().game!;
    const target = w
      .neighbours(cap)
      .find((n) => w.isLand(n) && game.regions[n]?.controller === 'USA')!;
    const meta = { cap, target };
    w.ui.getState().select(cap);
    return meta;
  });
  const capMeta = await page.evaluate(
    (id) => (globalThis as unknown as { ww3: Ww3Hook }).ww3.regionLatLon(id),
    move.cap,
  );
  await fly(page, capMeta!.lat, capMeta!.lon, 1.35);
  await page.waitForTimeout(3500);
  await page.getByTestId('own-stack').first().click();
  await expect(page.getByTestId('orders-hint')).toBeVisible();
  const pos = await page.evaluate(
    (id) => (globalThis as unknown as { ww3: Ww3Hook }).ww3.screenPos(id),
    move.target,
  );
  expect(pos).not.toBeNull();
  await page.mouse.move(pos!.x, pos!.y);
  await page.waitForTimeout(500);
  await page.mouse.click(pos!.x, pos!.y, { button: 'right' });
  await expect(page.getByTestId('context-panel')).toContainText('Moving to', { timeout: 10_000 });
  await shot(page, 'orders');

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();
  await page.getByTestId('modal-close').click();

  // Ten turns, resolving any event that pops up (screenshot the first one).
  let eventShot = false;
  await playTurns(page, 10, async () => {
    if (!eventShot) {
      await shot(page, 'event');
      eventShot = true;
    }
  });
  await expect(page.getByTestId('hud')).toContainText('November 2027', { timeout: 60_000 });
  // A decision may be waiting after the last turn; answer it before opening other screens.
  while (await page.getByTestId('event-modal').isVisible().catch(() => false)) {
    await page.getByTestId('choice-0').click();
    await page.waitForTimeout(200);
  }
  await page.getByTestId('nav-summary').click();
  await shot(page, 'summary');
  await page.getByTestId('modal-close').click();
  await fly(page, 49, 32, 1.5);
  await page.waitForTimeout(4000);
  await shot(page, 'ukraine-front');
  await shot(page, branchSlug());
  expect(errors).toEqual([]);
});

test('Taiwan Strait Crisis as China: 50 turns without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('loading')).toBeHidden({ timeout: 120_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('scenario-taiwan').click();
  await page.getByTestId('scenario-next').click();
  await page.getByTestId('leader-grid').getByTestId('leader-CHN').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  // Set a research project and a budget so the economy loop is exercised.
  await page.getByTestId('nav-research').click();
  await page.getByTestId('tech-semi-mature-nodes').click();
  await page.getByTestId('modal-close').click();
  await playTurns(page, 50);
  await page.waitForTimeout(1000);
  await shot(page, 'taiwan-crisis-50-turns');
  expect(errors).toEqual([]);
});

test('performance probe: 20 s camera sweep', async ({ page }) => {
  test.skip(!process.env.PERF, 'set PERF=1 to run the performance sweep');
  await page.goto('/');
  await expect(page.getByTestId('loading')).toBeHidden({ timeout: 120_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('scenario-next').click();
  await page.getByTestId('leader-grid').getByTestId('leader-USA').click();
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  const result = await page.evaluate(() =>
    (globalThis as unknown as { ww3: { perf: (s: number) => Promise<unknown> } }).ww3.perf(20),
  );
  console.log('PERF_RESULT ' + JSON.stringify(result));
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/perf-last-run.json',
    JSON.stringify(
      {
        ...(result as object),
        userAgent: await page.evaluate(() => navigator.userAgent),
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
});
