import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDataDir } from '../scripts/validate-data';

describe('data/', () => {
  it('every JSON file has top-level "source" and "asOf"', () => {
    expect(validateDataDir(join(process.cwd(), 'data'))).toEqual([]);
  });
});
