/**
 * scripts/build-textures.ts — downloads NASA public-domain imagery and builds the runtime
 * globe textures (≤ 4096 px, see docs/PERF.md).
 *
 *   node scripts/build-textures.ts [--cache DIR]
 *
 * Outputs in public/textures/:
 *   earth-day.jpg     4096×2048  NASA Blue Marble Next Generation (August 2004)
 *   earth-night.jpg   4096×2048  NASA Black Marble 2016 (city lights)
 *   earth-normal.jpg  4096×2048  tangent-space normal map derived from GEBCO_08 elevation
 *   earth-clouds.jpg  4096×2048  NASA Blue Marble cloud cover (greyscale, used as alpha)
 *   earth-bathy.jpg   2048×1024  GEBCO bathymetry shading (ocean depth tint)
 *
 * KTX2/Basis output is not produced because no encoder is available in the build container
 * (see docs/DECISIONS.md D-022); the loader falls back to these JPGs.
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
  const [day, night, clouds, elev, bath] = await Promise.all(
    Object.values(SOURCES).map((s) => fetchCached(s.url, s.file)),
  );
  await sharp(day!)
    .resize(4096, 2048, { kernel: 'lanczos3' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(OUT, 'earth-day.jpg'));
  await sharp(night!)
    .resize(4096, 2048, { kernel: 'lanczos3' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(OUT, 'earth-night.jpg'));
  await sharp(clouds!)
    .greyscale()
    .resize(4096, 2048, { kernel: 'lanczos3' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(join(OUT, 'earth-clouds.jpg'));
  await sharp(bath!)
    .resize(2048, 1024, { kernel: 'lanczos3' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(join(OUT, 'earth-bathy.jpg'));
  const normal = await normalMap(elev!, 4096, 2048, 6);
  await sharp(normal, { raw: { width: 4096, height: 2048, channels: 3 } })
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(join(OUT, 'earth-normal.jpg'));
  for (const f of [
    'earth-day.jpg',
    'earth-night.jpg',
    'earth-clouds.jpg',
    'earth-bathy.jpg',
    'earth-normal.jpg',
  ]) {
    const m = await sharp(join(OUT, f)).metadata();
    console.log(`${f} ${m.width}x${m.height} ${(m.size ?? 0) / 1e6} MB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
