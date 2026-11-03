import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDataDir } from '../scripts/validate-data';

describe('data/', () => {
  it('every JSON file has top-level "source" and "asOf"', () => {
    expect(validateDataDir(join(process.cwd(), 'data'))).toEqual([]);
  });
});

describe('runtime textures (rule 3, D-082)', () => {
  it('ship as KTX2 (or small lossless PNG/JPG maps read on the CPU), none above 4096 px', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = 'public/textures';
    const files = readdirSync(dir);
    for (const f of ['earth-day', 'earth-night', 'earth-normal', 'earth-clouds', 'earth-bathy'])
      expect(files).toContain(`${f}.ktx2`);
    for (const f of files) {
      const buf = readFileSync(`${dir}/${f}`);
      let w: number;
      let h: number;
      if (f.endsWith('.ktx2')) {
        // KTX2 header: 12-byte identifier, vkFormat, typeSize, then pixelWidth, pixelHeight.
        expect(buf.subarray(1, 7).toString('latin1')).toBe('KTX 20');
        w = buf.readUInt32LE(20);
        h = buf.readUInt32LE(24);
      } else if (f.endsWith('.png')) {
        w = buf.readUInt32BE(16);
        h = buf.readUInt32BE(20);
      } else if (f.endsWith('.jpg')) {
        // Only the 2048-px height map stays a JPEG (decoded on the CPU for terrain following).
        expect(f).toBe('earth-height.jpg');
        expect(buf.length).toBeLessThan(200_000);
        continue;
      } else throw new Error(`unexpected texture ${f}`);
      expect(Math.max(w, h), f).toBeLessThanOrEqual(4096);
    }
  });
});

describe('score tracks (D-084)', () => {
  it('every track exists on disk and is credited in DATA_SOURCES', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    // Read the playlist from source text: the module itself needs the DOM.
    const src = readFileSync('src/ui/music.ts', 'utf8');
    const tracks = [
      ...src.matchAll(/file: '([^']+)', title: '([^']+)', author: '([^']+)'/g),
    ].map((m) => ({ file: m[1]!, title: m[2]!, author: m[3]! }));
    expect(tracks.length).toBeGreaterThanOrEqual(3);
    const credits = readFileSync('docs/DATA_SOURCES.md', 'utf8');
    for (const t of tracks) {
      expect(existsSync(`public/audio/music/${t.file}`), t.file).toBe(true);
      expect(credits, t.title).toContain(t.title);
      expect(credits, t.author).toContain(t.author);
    }
  });
});
