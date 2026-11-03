import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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

type Ww3Window = {
  ww3: {
    fly: (lat: number, lon: number, d: number) => void;
    ui: { getState: () => { setSunOffset: (deg: number) => void } };
  };
};
type Ww3Hook = {
  capital: (iso3: string) => number | null;
  neighbours: (id: number) => number[];
  isLand: (id: number) => boolean;
  screenPos: (id: number) => { x: number; y: number; z: number } | null;
  regionLatLon: (id: number) => { lat: number; lon: number } | null;
  ui: { getState: () => { select: (id: number | null) => void } };
  game: {
    getState: () => {
      game: {
        regions: Record<number, { controller: string | null }>;
        units: Record<number, { owner: string; region: number }>;
      } | null;
    };
  };
};
async function fly(page: Page, lat: number, lon: number, d: number) {
  await page.evaluate(
    ([a, b, c]) => (globalThis as unknown as Ww3Window).ww3.fly(a!, b!, c!),
    [lat, lon, d],
  );
}
/** Sub-solar longitude offset from the camera (D-045: 38 = afternoon; 80 = dusk; 180 = midnight). */
async function sun(page: Page, offsetDeg: number) {
  await page.evaluate(
    (d) => (globalThis as unknown as Ww3Window).ww3.ui.getState().setSunOffset(d),
    offsetDeg,
  );
}

/**
 * Screen position of a region once the camera has settled (software GL renders a frame a second,
 * so a timed flight can still be moving when a fixed wait ends).
 */
async function settledPos(page: Page, id: number): Promise<{ x: number; y: number }> {
  let last: { x: number; y: number } | null = null;
  for (let i = 0; i < 40; i++) {
    const p = await page.evaluate(
      (r) => (globalThis as unknown as { ww3: Ww3Hook }).ww3.screenPos(r),
      id,
    );
    if (p && last && Math.hypot(p.x - last.x, p.y - last.y) < 1) return p;
    last = p ? { x: p.x, y: p.y } : null;
    await page.waitForTimeout(500);
  }
  if (!last) throw new Error(`region ${id} never came on screen`);
  return last;
}

/** Right-clicks a region to order the selected units there, retrying until the order registers. */
async function orderTo(page: Page, id: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const pos = await settledPos(page, id);
    await page.mouse.move(pos.x, pos.y);
    await page.waitForTimeout(600);
    await page.mouse.click(pos.x, pos.y, { button: 'right' });
    try {
      await expect(page.getByTestId('context-panel')).toContainText('Moving to', { timeout: 6_000 });
      return;
    } catch {
      await page.waitForTimeout(800);
    }
  }
  throw new Error(`order to region ${id} never registered`);
}

/** Ends `n` turns, answering any decision modal that appears while waiting for the End Turn button. */
async function playTurns(page: Page, n: number, onEvent?: () => Promise<void>): Promise<void> {
  for (let i = 0; i < n; i++) {
    const deadline = Date.now() + 90_000;
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
        if (onEvent) await onEvent();
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
        await page.getByTestId('end-turn').click();
        await page.waitForTimeout(250);
        break;
      }
      if (Date.now() > deadline) throw new Error(`turn ${i + 1}: End Turn never became available`);
      await page.waitForTimeout(200);
    }
  }
}

/** Start the game; existing tests play without the tutorial (it has its own test, D-080). */
async function startGame(page: Page, tutorial = false) {
  const toggle = page.getByTestId('tutorial-toggle');
  if ((await toggle.isChecked()) !== tutorial) await toggle.click();
  await page.getByTestId('start-game').click();
}
/** Irreversible actions ask first (D-080). */
async function confirm(page: Page) {
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
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
  await startGame(page);

  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('hud')).toContainText('January 2027');
  // First launch: the one-time hint that music is off (D-060).
  await expect(page.getByTestId('music-hint')).toBeVisible();
  await page.getByTestId('music-hint-dismiss').click();
  await expect(page.getByTestId('music-hint')).toBeHidden();
  await page.waitForTimeout(4000);
  await shot(page, 'globe-usa');

  // Full globe view (the cinematic orbit shot: limb scattering, clouds, ocean glint).
  await fly(page, 20, 30, 3.4);
  await page.waitForTimeout(3500);
  await shot(page, 'globe-full');
  await shot(page, 'orbit');

  // Terminator over Europe at dusk: the sun 80° east of the camera puts the twilight band on Germany.
  await sun(page, 80);
  await fly(page, 50, 10, 1.7);
  await page.waitForTimeout(4500);
  await shot(page, 'europe-dusk');
  await sun(page, 38);

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
  // Supply map mode (key 8, D-059): depots bright, sea zones in their controlling fleet's colour.
  await fly(page, 50, 30, 1.7);
  await page.getByTestId('mode-supply').click();
  await page.waitForTimeout(3500);
  await shot(page, 'supply-mode');
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

  // Research (D-079): the US starts with its January 2027 technology; clicking a distant tech
  // queues its whole path; the hover card explains it; espionage and sharing tabs.
  await page.getByTestId('nav-research').click();
  await expect(page.getByTestId('modal-research')).toBeVisible();
  await expect(page.getByTestId('tech-ai-decision-support')).toHaveClass(/done/);
  // The sixth-generation fighter sits off-screen in era IV: dispatch the click rather than let
  // Playwright scroll the clipped viewport.
  await page.getByTestId('tech-ai-sixth-gen').dispatchEvent('click');
  await expect(page.getByTestId('queue-item-ai-sixth-gen')).toBeVisible();
  await expect(page.getByTestId('research-queue')).toContainText('AI Battle Management');
  await page.getByTestId('tech-md-directed-energy').hover();
  await expect(page.getByTestId('tech-card')).toContainText('Iron Beam');
  await shot(page, 'research-hover');
  await page.getByTestId('tech-zoom-in').click();
  await page.getByTestId('tech-zoom-out').click();
  await page.getByTestId('tech-fit').click();
  await page.mouse.move(720, 120);
  await shot(page, 'research-tree');
  await page.getByTestId('research-tab-espionage').click();
  await expect(page.getByTestId('research-espionage')).toBeVisible();
  await shot(page, 'research-espionage');
  await page.getByTestId('research-tab-sharing').click();
  await expect(page.getByTestId('research-sharing')).toBeVisible();
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
  await expect(page.getByTestId('domain-bars')).toBeVisible();
  await shot(page, 'military');
  await page.getByTestId('mil-tab-air').click();
  await expect(page.getByTestId('air-list')).toBeVisible();
  await shot(page, 'military-air');
  await page.getByTestId('mil-tab-operations').click();
  await expect(page.getByTestId('ops-panel')).toBeVisible();
  await page.getByTestId('launch-satellite').click();
  await shot(page, 'military-operations');
  await page.getByTestId('mil-tab-intel').click();
  await page.getByTestId('modal-close').click();

  // Battle odds in the Zagros: the US starts at war with Iran (D-085), so select the capital
  // garrison and hover Kermanshah (mountains) to see the full modifier breakdown.
  expect(
    await page.evaluate(() => {
      const w = (globalThis as unknown as { ww3: Ww3Hook }).ww3;
      const g = w.game.getState().game as unknown as { wars: { attackers: string[]; defenders: string[] }[] };
      return g.wars.some((x) => x.attackers.includes('USA') && x.defenders.includes('IRN'));
    }),
  ).toBe(true);
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
  // Fog of war: Kermanshah's garrison is shown as an estimate (intel chip) and a missile strike
  // on it is available from the region panel (D-059).
  await page.evaluate(
    (id) => (globalThis as unknown as { ww3: Ww3Hook }).ww3.ui.getState().select(id),
    kermanshah,
  );
  await expect(page.getByTestId('strike-section')).toBeVisible();
  await page.getByTestId('strike-military').click();
  await confirm(page);
  await expect(page.getByTestId('alerts')).toContainText('cruise missiles', { timeout: 10_000 });
  await shot(page, 'missile-strike');
  await page.evaluate(() =>
    (globalThis as unknown as { ww3: Ww3Hook }).ww3.ui.getState().select(null),
  );
  // window.ww3 keeps the renderer's hooks after the app installs its own (perf must survive).
  expect(
    await page.evaluate(
      () => typeof (globalThis as unknown as { ww3: { perf?: unknown } }).ww3.perf,
    ),
  ).toBe('function');

  // Fight a war: declare war on Cuba, then order the capital garrison to an adjacent region.
  await page.getByTestId('nav-diplomacy').click();
  await page.getByTestId('diplomacy-search').fill('Cuba');
  await page.getByTestId('dip-CUB').click();
  await page.getByTestId('act-declareWar').click();
  await confirm(page);
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
  await orderTo(page, move.target);
  await shot(page, 'orders');

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();
  // Per-effect levels (D-055) and the strike cam toggle (D-056); a level change recompiles the globe.
  await expect(page.getByTestId('effects-grid')).toBeVisible();
  await expect(page.getByTestId('toggle-strike-cam')).toBeVisible();
  // Audio (D-060): three sliders, music off by default, switching it on starts the bed.
  await expect(page.getByTestId('audio-settings')).toBeVisible();
  await expect(page.getByTestId('toggle-music')).toContainText('off');
  await page.getByTestId('volume-music').fill('60');
  await page.getByTestId('toggle-music').click();
  await expect(page.getByTestId('toggle-music')).toContainText('on');
  await shot(page, 'settings-audio');
  await page.getByTestId('effect-clouds-low').click();
  await page.waitForTimeout(800);
  await page.getByTestId('quality-high').click();
  await page.waitForTimeout(800);
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
  while (
    await page
      .getByTestId('event-modal')
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByTestId('choice-0').click();
    await page.waitForTimeout(200);
  }
  await page.getByTestId('nav-summary').click();
  await shot(page, 'summary');
  // Battle report (D-059): open the first battle of last month if there was one.
  if (await page.getByTestId('summary-battle').first().isVisible().catch(() => false)) {
    await page.getByTestId('summary-battle').first().click();
    await expect(page.getByTestId('modal-battle')).toBeVisible();
    await expect(page.getByTestId('battle-summary')).toBeVisible();
    await shot(page, 'battle-report');
  }
  await page.getByTestId('modal-close').click();
  await fly(page, 49, 32, 1.5);
  await page.waitForTimeout(4000);
  await shot(page, 'ukraine-front');
  // The war with Cuba at midnight: city lights, dimmed where damaged, fires and smoke where the
  // fighting is, the Florida coast glowing across the strait.
  await sun(page, 180);
  await fly(page, 22.5, -80, 1.35);
  await page.waitForTimeout(4500);
  await shot(page, 'night-war-zone');
  await sun(page, 38);
  // Economy (D-061): trade routes as flowing arcs in the economy map mode, then every tab of the
  // economy screen after ten turns of history.
  await page.getByTestId('mode-economy').click();
  await fly(page, 32, 45, 2.5);
  await page.waitForTimeout(4500);
  await shot(page, 'trade-routes');
  await page.keyboard.press('e');
  await expect(page.getByTestId('modal-economy')).toBeVisible();
  await expect(page.getByTestId('chart-gdp')).toBeVisible();
  await expect(page.getByTestId('growth-breakdown')).toBeVisible();
  await shot(page, 'economy-overview');
  await page.getByTestId('econ-tab-budget').click();
  await expect(page.getByTestId('mobilization')).toBeVisible();
  await page.getByTestId('tax-slider').fill('30');
  await page.getByTestId('tax-apply').click();
  await shot(page, 'economy-budget');
  await page.getByTestId('econ-tab-trade').click();
  await expect(page.getByTestId('trade-partners')).toBeVisible();
  await shot(page, 'economy-trade');
  await page.getByTestId('econ-tab-resources').click();
  await expect(page.getByTestId('resource-balance')).toBeVisible();
  await shot(page, 'economy-resources');
  await page.getByTestId('econ-tab-sanctions').click();
  await expect(page.getByTestId('coalitions')).toBeVisible();
  await page.getByTestId('rally-target').selectOption('RUS');
  await shot(page, 'economy-sanctions');
  await page.getByTestId('econ-tab-domestic').click();
  await expect(page.getByTestId('support-breakdown')).toBeVisible();
  await shot(page, 'economy-domestic');
  await page.getByTestId('econ-tab-overview').click();
  await shot(page, 'economy-overview-late');
  await page.getByTestId('modal-close').click();
  // Diplomacy AI (D-071): the wire, blocs, the Security Council and a negotiated deal with Poland.
  await page.getByTestId('nav-dispatches').click();
  await expect(page.getByTestId('dispatch-feed')).toBeVisible();
  await shot(page, 'diplomacy-dispatches');
  await page.getByTestId('dip-tab-blocs').click();
  await expect(page.getByTestId('bloc-NATO')).toBeVisible();
  await shot(page, 'diplomacy-blocs');
  await page.getByTestId('dip-tab-un').click();
  await expect(page.getByTestId('un-panel')).toBeVisible();
  await page.getByTestId('un-kind').selectOption('condemnation');
  await page.getByTestId('un-target').selectOption('IRN');
  await shot(page, 'diplomacy-un');
  await page.getByTestId('dip-tab-nations').click();
  await page.getByTestId('diplomacy-search').fill('Poland');
  await page.getByTestId('dip-POL').click();
  await expect(page.getByTestId('leader-intel')).toBeVisible();
  await page.getByTestId('dip-tab-negotiate').click();
  await expect(page.getByTestId('negotiation')).toBeVisible();
  await page.getByTestId('deal-add-USA').click();
  await page.getByTestId('deal-kind-POL').selectOption('basing');
  await page.getByTestId('deal-add-POL').click();
  await expect(page.getByTestId('deal-verdict')).toBeVisible();
  await shot(page, 'diplomacy-negotiate');
  await page.getByTestId('deal-propose').click();
  await expect(page.getByTestId('deal-reply')).toBeVisible();
  await shot(page, 'diplomacy-negotiate-reply');
  await page.getByTestId('modal-close').click();
  // Escalation ladder and the news wire (D-076, D-077).
  await page.getByTestId('hud-tension').click();
  await expect(page.getByTestId('modal-escalation')).toBeVisible();
  await expect(page.getByTestId('escalation-ladder')).toBeVisible();
  await expect(page.getByTestId('defcon-table')).toBeVisible();
  await shot(page, 'escalation-ladder');
  await page.getByTestId('modal-close').click();
  await page.keyboard.press('n');
  await expect(page.getByTestId('modal-news')).toBeVisible();
  await expect(page.getByTestId('wire-story').first()).toBeVisible();
  await shot(page, 'news-wire');
  await page.getByTestId('news-cat-war').click();
  await page.getByTestId('news-scope-top').click();
  await shot(page, 'news-wire-war');
  await page.getByTestId('modal-close').click();
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
  await startGame(page);
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  // Set a research project and a budget so the economy loop is exercised.
  await page.getByTestId('nav-research').click();
  await page.getByTestId('tech-semi-angstrom-nodes').dispatchEvent('click');
  await expect(page.getByTestId('research-queue')).toContainText('Leading-Edge Logic');
  await page.getByTestId('modal-close').click();
  // Open the war: declare on Taiwan, send the Fujian stack across the strait, resolve a month and
  // catch the combat visuals (attack arrow before, strikes / flashes / smoke / front line after).
  await page.getByTestId('nav-diplomacy').click();
  await page.getByTestId('diplomacy-search').fill('Taiwan');
  await page.getByTestId('dip-TWN').click();
  await page.getByTestId('act-declareWar').click();
  await confirm(page);
  await page.getByTestId('modal-close').click();
  await expect(page.getByTestId('alerts')).toContainText('declares war on Taiwan');
  const taipei = await page.evaluate(() => {
    const w = (globalThis as unknown as { ww3: Ww3Hook }).ww3;
    const game = w.game.getState().game!;
    const twn = w.capital('TWN')!;
    const t = w.regionLatLon(twn)!;
    let best = -1;
    let bd = 1e9;
    for (const u of Object.values(game.units)) {
      if (u.owner !== 'CHN' || !w.isLand(u.region)) continue;
      const p = w.regionLatLon(u.region)!;
      const d = Math.hypot(p.lat - t.lat, p.lon - t.lon);
      if (d < bd) {
        bd = d;
        best = u.region;
      }
    }
    w.ui.getState().select(best);
    return twn;
  });
  await page.getByTestId('own-stack').first().click();
  await expect(page.getByTestId('orders-hint')).toBeVisible();
  await fly(page, 24.8, 119.5, 1.3);
  await page.waitForTimeout(3500);
  await orderTo(page, taipei);
  await page.waitForTimeout(1200);
  await shot(page, 'taiwan-strait-orders');
  await playTurns(page, 1);
  // A decision may pop up with the new month; answer it so the battle is unobstructed.
  for (let i = 0; i < 20; i++) {
    if (
      await page
        .getByTestId('event-modal')
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByTestId('choice-0').click();
      break;
    }
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/taiwan-strait-combat.png` });
  await page.waitForTimeout(3000);
  await shot(page, 'taiwan-strait-aftermath');
  // The landing takes a month of preparation (D-059) and the first fight follows: open the first
  // battle report of the month that has one.
  let reported = false;
  for (let i = 0; i < 4 && !reported; i++) {
    await playTurns(page, 1);
    // Wait for the month to resolve and answer any decision it raises before opening the summary.
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (
        await page
          .getByTestId('event-modal')
          .isVisible()
          .catch(() => false)
      ) {
        await page.getByTestId('choice-0').click();
        await page.waitForTimeout(200);
        continue;
      }
      if (
        await page
          .getByTestId('end-turn')
          .isEnabled()
          .catch(() => false)
      )
        break;
      if (Date.now() > deadline) throw new Error('month never resolved');
      await page.waitForTimeout(200);
    }
    await page.getByTestId('nav-summary').click();
    await expect(page.getByTestId('modal-summary')).toBeVisible();
    if (await page.getByTestId('summary-battle').first().isVisible().catch(() => false)) {
      await page.getByTestId('summary-battle').first().click();
      await expect(page.getByTestId('modal-battle')).toBeVisible();
      await expect(page.getByTestId('battle-summary')).toBeVisible();
      await shot(page, 'battle-report');
      reported = true;
    }
    await page.getByTestId('modal-close').click();
  }
  expect(reported).toBe(true);
  await playTurns(page, 45);
  await page.waitForTimeout(1000);
  await shot(page, 'taiwan-crisis-50-turns');
  expect(errors).toEqual([]);
});

test('nuclear aftermath: fallout on the map and the nobody-wins ending', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('loading')).toBeHidden({ timeout: 120_000 });
  await page.getByTestId('menu-new').click();
  await page.getByTestId('scenario-world').click();
  await page.getByTestId('scenario-next').click();
  await page.getByTestId('leader-grid').getByTestId('leader-USA').click();
  await startGame(page);
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 60_000 });
  // A fictional successor (D-078): Russia after a security-service coup, with traits the simulation
  // generated for seed 2027 from the siloviki profile.
  await page.evaluate(() => {
    const w = (globalThis as unknown as { ww3: Ww3Hook & { load: (s: unknown) => void } }).ww3;
    const g = JSON.parse(JSON.stringify(w.game.getState().game)) as { nations: Record<string, Record<string, unknown>> };
    Object.assign(g.nations.RUS!, {
      leaderFictional: true,
      leaderName: 'Andrei Sadovsky',
      leaderTitle: 'Chair of the Military Council',
      leaderFaction: 'siloviki',
      leaderTraits: { aggression: 93, riskTolerance: 73, pragmatism: 32, nationalism: 100, paranoia: 100, economicPriority: 33, allianceLoyalty: 47, nuclearThreshold: 24 },
    });
    w.load(g);
  });
  await page.getByTestId('nav-diplomacy').click();
  await page.getByTestId('dip-tab-nations').click();
  await page.getByTestId('diplomacy-search').fill('Russia');
  await page.getByTestId('dip-RUS').click();
  await expect(page.getByTestId('leader-traits')).toBeVisible();
  await expect(page.getByTestId('modal-diplomacy')).toContainText('Andrei Sadovsky');
  await expect(page.getByTestId('modal-diplomacy')).toContainText('Siloviki');
  await shot(page, 'diplomacy-successor');
  await page.getByTestId('modal-close').click();
  // A crafted aftermath (D-076): fallout over Moscow, St Petersburg's region and two US regions.
  const craft = (defeat: boolean) =>
    page.evaluate((defeat) => {
      const w = (globalThis as unknown as { ww3: Ww3Hook & { load: (s: unknown) => void } }).ww3;
      const g = JSON.parse(JSON.stringify(w.game.getState().game)) as Record<string, unknown> & {
        regions: Record<number, { fallout: number; devastation: number }>;
        nuclearLog: unknown[];
        turn: number;
      };
      const hits: [number, string][] = [
        [w.capital('RUS')!, 'RUS'],
        [w.capital('USA')!, 'USA'],
      ];
      for (const [id, target] of hits) {
        g.regions[id]!.fallout = 1;
        g.regions[id]!.devastation = 0.8;
        for (const nb of w.neighbours(id)) if (w.isLand(nb) && g.regions[nb]) g.regions[nb]!.fallout = 0.35;
        g.nuclearLog.push({ turn: g.turn, attacker: target === 'RUS' ? 'USA' : 'RUS', target, region: id, population: 12000000 });
      }
      g.detonations = defeat ? 8 : 2;
      g.nuclearWinter = defeat ? 4.8 : 1.2;
      if (defeat) g.defeat = { kind: 'nuclearWar', text: 'Eight nuclear detonations. The exchange has ended civilisation as it was.' };
      w.load(g);
    }, defeat);
  await craft(false);
  await fly(page, 52, 38, 1.9);
  await page.waitForTimeout(4000);
  await shot(page, 'fallout-map');
  await page.getByTestId('hud-tension').click();
  await expect(page.getByTestId('rung-tactical')).toHaveClass(/current/);
  await shot(page, 'escalation-nuclear');
  await page.getByTestId('modal-close').click();
  await craft(true);
  await expect(page.getByTestId('nobody-wins')).toBeVisible();
  await shot(page, 'nobody-wins');
  expect(errors).toEqual([]);
});

/** Every visible text node rendered below 12 px on screen (CSS size × any scale transform). */
const SMALL_TEXT = `(() => {
  const out = [];
  const root = document.querySelector('[data-testid="ui-root"]') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    let k = 1;
    for (let a = el; a; a = a.parentElement) {
      const m = getComputedStyle(a).transform.match(/matrix\\(([^,]+),/);
      if (m) k *= Number(m[1]);
    }
    const px = parseFloat(cs.fontSize) * k;
    if (px < 11.95) out.push(px.toFixed(1) + 'px "' + n.textContent.trim().slice(0, 30) + '"');
  }
  return out;
})()`;
async function smallText(page: Page): Promise<string[]> {
  return (await page.evaluate(SMALL_TEXT)) as string[];
}

test('tutorial: five guided months, every screen, readability (D-080)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const id = (t: string) => page.getByTestId(t);
  const small: string[] = [];
  const look = async (name: string) => {
    await shot(page, name);
    small.push(...(await smallText(page)).map((x) => `${name}: ${x}`));
  };
  /** Wait for a tutorial step, answering any decision event that arrives first. */
  const step = async (sid: string) => {
    for (let k = 0; k < 240; k++) {
      if (await id('event-modal').isVisible().catch(() => false)) {
        await expect(id('tutorial-paused')).toBeVisible();
        await id('choice-0').click();
      }
      if (await id(`tutorial-step-${sid}`).isVisible().catch(() => false)) return;
      await page.waitForTimeout(250);
    }
    throw new Error(`tutorial step ${sid} never appeared`);
  };
  const next = () => id('tutorial-next').click();
  await page.goto('/');
  await expect(id('loading')).toBeHidden({ timeout: 120_000 });
  await look('menu');
  await id('menu-new').click();
  await id('scenario-world').click();
  await id('scenario-next').click();
  await id('leader-grid').getByTestId('leader-USA').click();
  await expect(id('tutorial-toggle')).toBeChecked(); // on by default for a first game
  await startGame(page, true);
  await expect(id('hud')).toBeVisible({ timeout: 60_000 });
  // Month 1.
  await step('welcome');
  await look('tutorial-01-welcome');
  await next();
  await step('topbar');
  await look('tutorial-02-topbar');
  await next();
  await step('growth');
  await id('hud-growth').hover();
  await expect(id('tooltip')).toContainText('Trend');
  const rows = page.locator('[data-testid="tooltip"] .bd-nest');
  await rows.nth(Math.min((await rows.count()) - 1, 4)).hover();
  await expect(id('tooltip-1')).toBeVisible(); // the nested tooltip with the sources
  await look('tutorial-03-nested-tooltip');
  // Move off the tooltips before clicking on: with the Iran war and Hormuz lines (D-085) the
  // nested tooltip can overlap the tutorial card.
  await page.mouse.move(5, 5);
  await expect(id('tooltip')).toBeHidden();
  await next();
  await step('nation');
  await next();
  await step('mapmodes');
  await page.keyboard.press('3');
  await step('select');
  await page.evaluate(() => {
    const w = (globalThis as unknown as { ww3: Ww3Hook }).ww3;
    w.ui.getState().select(w.capital('USA')!);
  });
  await step('advisor');
  await expect(id('advice-0')).toBeVisible();
  await look(branchSlug());
  await next();
  await step('budget-open');
  await id('nav-budget').click();
  await step('budget-inside');
  await look('tutorial-04-budget');
  await page.keyboard.press('Escape');
  await step('end-1');
  await id('end-turn').click();
  // Month 2: the briefing and research.
  await step('briefing');
  await id('nav-summary').click();
  await step('research-open');
  await expect(id('briefing-bluf')).toBeVisible();
  await expect(id('briefing-relations')).toBeVisible();
  await look('briefing');
  await id('nav-research').click(); // the nav works with any screen open
  await step('research-queue');
  await id('tech-cyber-pqc').dispatchEvent('click');
  await step('end-2');
  await page.keyboard.press('Escape');
  await id('end-turn').click();
  // Month 3: production and undo.
  await step('production-open');
  await id('nav-production').click();
  await step('production-build');
  await id('build-infantry').click();
  await step('undo');
  await expect(id('undo')).toContainText('Undo (1)');
  await page.keyboard.press('Control+z');
  await expect(id('undo')).toContainText('Undo');
  await expect(id('undo')).toBeDisabled();
  await look('tutorial-05-undo');
  await next();
  await step('military-open');
  await id('nav-military').click();
  await step('end-3');
  await page.keyboard.press('Escape');
  await id('end-turn').click();
  // Month 4: diplomacy and the economy.
  await step('diplomacy-open');
  await id('nav-diplomacy').click();
  await step('diplomacy-inside');
  await look('tutorial-06-diplomacy');
  await next();
  await step('economy-open');
  await id('nav-economy').click();
  await step('end-4');
  await page.keyboard.press('Escape');
  await id('end-turn').click();
  // Month 5: escalation, shortcuts, settings.
  await step('tension');
  await id('hud-tension').click();
  await step('shortcuts');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await step('settings');
  await expect(id('modal-shortcuts')).toBeVisible();
  await look('shortcuts');
  await page.keyboard.press('Escape');
  await next();
  await step('farewell');
  await look('tutorial-07-farewell');
  await id('tutorial-finish').click();
  await expect(id('tutorial')).toBeHidden();
  // Every screen and tab.
  const screens: [string, string, string[]][] = [
    ['nav-economy', 'econ-tab', ['overview', 'budget', 'trade', 'resources', 'sanctions', 'domestic']],
    ['nav-military', 'mil-tab', ['overview', 'air', 'operations', 'intel']],
    ['nav-diplomacy', 'dip-tab', ['nations', 'negotiate', 'dispatches', 'blocs', 'un']],
    ['nav-research', 'research-tab', ['queue', 'espionage', 'sharing']],
  ];
  for (const [nav, prefix, tabs] of screens) {
    await id(nav).click();
    for (const t of tabs) {
      await id(`${prefix}-${t}`).click();
      await look(`screen-${nav.slice(4)}-${t}`);
    }
    await page.keyboard.press('Escape');
  }
  for (const nav of ['nav-budget', 'nav-production', 'nav-settings']) {
    await id(nav).click();
    await look(`screen-${nav.slice(4)}`);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('x');
  await look('screen-escalation');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await look('screen-news');
  await page.keyboard.press('Escape');
  // Irreversible actions ask first; cancelling changes nothing.
  await id('nav-diplomacy').click();
  await id('dip-tab-nations').click();
  await id('diplomacy-search').fill('Venezuela');
  await id('dip-VEN').click();
  await id('act-declareWar').click();
  await expect(id('confirm-dialog')).toContainText('Declare war on Venezuela?');
  await look('confirm-war');
  await id('confirm-cancel').click();
  await page.keyboard.press('Escape');
  await expect(id('alerts')).not.toContainText('declares war on Venezuela');
  // Readability: the colourblind palette and a 125 % UI scale.
  await id('nav-settings').click();
  await id('palette-colourblind').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('3');
  await look('colourblind-relations');
  await page.keyboard.press('8');
  await look('colourblind-supply');
  await page.keyboard.press('1');
  await page.evaluate(() => (globalThis as unknown as { ww3: { ui: { getState: () => { setPrefs: (p: object) => void } } } }).ww3.ui.getState().setPrefs({ uiScale: 1.25, palette: 'default' }));
  await look('ui-scale-125');
  await page.evaluate(() => (globalThis as unknown as { ww3: { ui: { getState: () => { setPrefs: (p: object) => void } } } }).ww3.ui.getState().setPrefs({ uiScale: 1 }));
  expect(small, small.slice(0, 10).join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});
