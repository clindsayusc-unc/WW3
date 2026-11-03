/**
 * Encodes the globe's colour textures to KTX2 / Basis Universal (D-082) with the MIT-licensed
 * `ktx2-encoder` (a WebAssembly build of Binomial's basis_universal encoder).
 *
 *   node --import tsx scripts/build-ktx2.ts            # every texture
 *   node --import tsx scripts/build-ktx2.ts day night  # just these
 *
 * Inputs: assets/textures/earth-*.jpg (written by scripts/build-textures.ts).
 * Outputs: public/textures/earth-*.ktx2.
 *
 * - UASTC (+ RDO + Zstandard) for the day map and the normal map, where block artefacts would show
 *   on the hero surface and in the lighting; it transcodes to ASTC 4×4 or BC7 (1 byte per pixel).
 * - ETC1S for night lights, clouds and bathymetry: smaller files, transcodes to ETC2/BC1
 *   (0.5 byte per pixel) or BC7.
 * Each file carries a full mip chain and is flipped vertically, matching the orientation the
 * JPEGs had with `flipY` (compressed textures cannot be flipped at upload).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'assets', 'textures');
const OUT = join(ROOT, 'public', 'textures');

interface Spec {
  name: string;
  uastc: boolean;
  srgb: boolean;
  normal?: boolean;
  quality?: number;
}

const SPECS: Spec[] = [
  { name: 'day', uastc: true, srgb: true },
  { name: 'normal', uastc: true, srgb: false, normal: true },
  { name: 'night', uastc: false, srgb: true, quality: 200 },
  { name: 'clouds', uastc: false, srgb: false, quality: 230 },
  { name: 'bathy', uastc: false, srgb: false, quality: 200 },
];

const imageDecoder = async (buf: Uint8Array) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

const only = process.argv.slice(2);
for (const s of SPECS) {
  if (only.length && !only.includes(s.name)) continue;
  const t0 = performance.now();
  const src = readFileSync(join(SRC, `earth-${s.name}.jpg`));
  const out = await encodeToKTX2(new Uint8Array(src), {
    isUASTC: s.uastc,
    enableRDO: s.uastc,
    rdoQualityLevel: 1,
    needSupercompression: true,
    qualityLevel: s.quality ?? 128,
    compressionLevel: 2,
    generateMipmap: true,
    isYFlip: true,
    isPerceptual: s.srgb,
    isSetKTX2SRGBTransferFunc: s.srgb,
    isNormalMap: !!s.normal,
    imageDecoder,
    outputBufferSize: 64 << 20,
  });
  writeFileSync(join(OUT, `earth-${s.name}.ktx2`), out);
  console.log(
    `earth-${s.name}.ktx2  ${(out.length / 1048576).toFixed(2)} MB  ${s.uastc ? 'UASTC' : 'ETC1S'}  ${((performance.now() - t0) / 1000).toFixed(0)} s`,
  );
}
