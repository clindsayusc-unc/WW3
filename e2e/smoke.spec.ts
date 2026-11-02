import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

function branchSlug(): string {
  const fromEnv = process.env.SCREENSHOT_NAME;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim().replace(/[/\\]/g, '-');
  } catch {
    return 'unknown';
  }
}

test('game boots, renders the globe and advances a turn', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('end-turn')).toBeVisible();
  await expect(page.getByTestId('hud')).toContainText('2027-01-01');

  await page.getByTestId('end-turn').click();
  await expect(page.getByTestId('hud')).toContainText('2027-01-08');

  await page.waitForTimeout(1000);
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: `docs/screenshots/${branchSlug()}.png` });
  expect(errors).toEqual([]);
});
