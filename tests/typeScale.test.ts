/** Text never below 12 px (D-080): every font size in the style sheet is a token of at least 12 px. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('type scale', () => {
  it('no font size in the style sheet is below 12 px', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
    for (const m of css.matchAll(/font-size:\s*([0-9.]+)px/g)) expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(12);
    for (const m of css.matchAll(/--text-[a-z0-9]+:\s*([0-9.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    // Every other font size uses a token.
    for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) expect(m[1]!.trim(), m[0]).toMatch(/^(var\(--text-[a-z0-9]+\)|inherit|1em)$/);
  });
});

