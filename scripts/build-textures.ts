/**
 * scripts/build-textures.ts — downloads NASA public-domain imagery and builds the runtime
 * globe textures (≤ 4096 px, see docs/PERF.md).
 *
 *   node scripts/build-textures.ts [--cache DIR]
 *
 * Outputs: the colour sources in assets/textures/ (encoded to KTX2 in public/textures/ by
 * scripts/build-ktx2.ts, D-082) and the height map in public/textures/ (read on the CPU too):
 *   earth-day.jpg     4096×2048  NASA Blue Marble Next Generation (August 2004)
 *   earth-night.jpg   4096×2048  NASA Black Marble 2016 (city lights)
 *   earth-normal.jpg  4096×2048  tangent-space normal map derived from GEBCO_08 elevation
 *   earth-clouds.jpg  4096×2048  NASA Blue Marble cloud cover (greyscale, used as alpha)
 *   earth-bathy.jpg   2048×1024  GEBCO bathymetry shading (ocean depth tint)
 *   earth-height.jpg  2048×1024  GEBCO_08 elevation (greyscale height map; 0 = sea level, ≈ 36 m per level)
 *
 *   --only height     build just the listed outputs (comma-separated: day,night,clouds,bathy,normal,height)
 *
 * Run `node --import tsx scripts/build-ktx2.ts` afterwards to refresh the KTX2 files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const cacheArg = args.indexOf('--cache');
const ROOT = process.cwd();
const CACHE =
  cacheArg >= 0 && args[cacheArg + 1]
    ? (args[cacheArg + 1] as string)
    : join(ROOT, '.cache', 'nasa');
const OUT = join(ROOT, 'public', 'textures');
const SRC_OUT = join(ROOT, 'assets', 'textures');

const A = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images';
const E = 'https://eoimages.gsfc.nasa.gov/images/imagerecords';
const SOURCES = {
  day: {
    url: `${A}/bmng/bmng-base/august/world.200408.3x5400x2700.jpg`,
    file: 'world.200408.3x5400x2700.jpg',
  },
  night: { url: `${E}/144000/144898/BlackMarble_2016_3km.jpg`, file: 'BlackMarble_2016_3km.jpg' },
  clouds: { url: `${E}/57000/57747/cloud_combined_8192.tif`, file: 'cloud_combined_8192.tif' },
  elevation: {
    url: `${A}/bmng/topography/gebco_08_rev_elev_5400x2700.jpg`,
    file: 'gebco_08_rev_elev_5400x2700.jpg',
  },
  bathymetry: {
    url: `${A}/bmng/bathymetry/gebco_08_rev_bath_5400x2700.jpg`,
    file: 'gebco_08_rev_bath_5400x2700.jpg',
  },
};

async function fetchCached(url: string, file: string): Promise<Buffer> {
  const path = join(CACHE, file);
  if (existsSync(path)) return readFileSync(path);
  mkdirSync(CACHE, { recursive: true });
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

async function normalMap(
  elevJpg: Buffer,
  width: number,
  height: number,
  strength: number,
): Promise<Buffer> {
  const { data } = await sharp(elevJpg)
    .greyscale()
    .resize(width, height, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height * 3);
  const at = (x: number, y: number) =>
    data[Math.min(height - 1, Math.max(0, y)) * width + (((x % width) + width) % width)]! / 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sobel gradients (equirectangular: east = +u, north = -v)
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -gx * strength,
        ny = gy * strength,
        nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * width + x) * 3;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SRC_OUT, { recursive: true });
  const onlyArg = args.indexOf('--only');
  const only = new Set(
    onlyArg >= 0 && args[onlyArg + 1]
      ? (args[onlyArg + 1] as string).split(',')
      : ['day', 'night', 'clouds', 'bathy', 'normal', 'height'],
  );
  const src = (k: keyof typeof SOURCES) => fetchCached(SOURCES[k].url, SOURCES[k].file);
  if (only.has('day'))
    await sharp(await src('day'))
      .resize(4096, 2048, { kernel: 'lanczos3' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(join(SRC_OUT, 'earth-day.jpg'));
  if (only.has('night'))
    await sharp(await src('night'))
      .resize(4096, 2048, { kernel: 'lanczos3' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(join(SRC_OUT, 'earth-night.jpg'));
  if (only.has('clouds'))
    await sharp(await src('clouds'))
      .greyscale()
      .resize(4096, 2048, { kernel: 'lanczos3' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(join(SRC_OUT, 'earth-clouds.jpg'));
  if (only.has('bathy'))
    await sharp(await src('bathymetry'))
      .resize(2048, 1024, { kernel: 'lanczos3' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(join(SRC_OUT, 'earth-bathy.jpg'));
  if (only.has('normal')) {
    const normal = await normalMap(await src('elevation'), 4096, 2048, 6);
    await sharp(normal, { raw: { width: 4096, height: 2048, channels: 3 } })
      .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(join(SRC_OUT, 'earth-normal.jpg'));
  }
  if (only.has('height'))
    // Height map for vertex displacement and the snow line; greyscale, sea level = 0.
    await sharp(await src('elevation'))
      .greyscale()
      .resize(2048, 1024, { kernel: 'lanczos3' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(join(OUT, 'earth-height.jpg'));
  for (const f of [
    'earth-day.jpg',
    'earth-night.jpg',
    'earth-clouds.jpg',
    'earth-bathy.jpg',
    'earth-normal.jpg',
    'earth-height.jpg',
  ]) {
    const dir = f === 'earth-height.jpg' ? OUT : SRC_OUT;
    if (!existsSync(join(dir, f))) continue;
    const m = await sharp(join(dir, f)).metadata();
    console.log(`${f} ${m.width}x${m.height} ${(m.size ?? 0) / 1e6} MB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
