import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'docs/screenshots';
test.setTimeout(900_000);

type Ww3Window = { ww3: { fly: (lat: number, lon: number, d: number) => void } };
async function fly(page: Page, lat: number, lon: number, d: number) {
  await page.evaluate(
    ([a, b, c]) => (globalThis as unknown as Ww3Window).ww3.fly(a!, b!, c!),
    [lat, lon, d],
  );
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
  await page.getByTestId('leader-grid').getByTestId('leader-USA').click();
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

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();
  await page.getByTestId('modal-close').click();

  // Ten turns, resolving any event that pops up.
  for (let i = 0; i < 10; i++) {
    const event = page.getByTestId('event-modal');
    if (await event.isVisible().catch(() => false)) await page.getByTestId('choice-0').click();
    await expect(page.getByTestId('end-turn')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('end-turn').click();
    await page.waitForTimeout(400);
  }
  const event = page.getByTestId('event-modal');
  if (await event.isVisible().catch(() => false)) {
    await shot(page, 'event');
    await page.getByTestId('choice-0').click();
  }
  await expect(page.getByTestId('hud')).toContainText('November 2027', { timeout: 60_000 });
  await page.getByTestId('nav-summary').click();
  await shot(page, 'summary');
  await page.getByTestId('modal-close').click();
  await fly(page, 49, 32, 1.5);
  await page.waitForTimeout(4000);
  await shot(page, 'ukraine-front');
  await shot(page, 'feat-playable-v1');
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
