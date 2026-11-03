/** The globe: surface, two cloud layers and the scattering limb (D-035, D-054). */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  CompressedTexture,
  type CompressedTextureMipmap,
  DataTexture,
  NoColorSpace,
  RedFormat,
  UnsignedByteType,
  type WebGLRenderer,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import {
  ATMOSPHERE_FRAG,
  ATMOSPHERE_VERT,
  CLOUD_FRAG,
  CLOUD_VERT,
  GLOBE_FRAG,
  GLOBE_VERT,
  MAX_STORMS,
} from './globeShader';
import { createCountryIndex, createPalette, createRegionAttr, type RegionIdMap } from './regionIds';
import { fillCountryIndex, fillPalette, fillRegionAttr } from './palette';
import { latLonToVec3, sunDirection } from './geo';
import { atmosphereTables, atmosphereUniforms, RT, type AtmosphereTables } from './atmosphere';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { HeightMap } from './terrainHeight';
import { makeWaveNormal } from './waves';
import { terrainDisplacement } from './displacement';
import { useLevels } from './levels';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { loadWorld } from '../sim/world';
import { generateStorms } from '../sim/storms';
import { forgetTexture, noteTexture, noteTextureBytes } from './perf';
import { SUN } from './sun';

export interface GlobeTextures {
  day: Texture;
  night: Texture;
  normal: Texture;
  clouds: Texture;
  bathy: Texture;
  height: Texture;
  waves: Texture;
  atmosphere: AtmosphereTables;
}

/**
 * Basis Universal transcoder (three/examples, MIT). With no transcoder path set, the loader
 * resolves its bundled JS + WASM through `import.meta.url`, so Vite ships them in dist/assets and
 * the native app works offline.
 */
let ktx2: KTX2Loader | null = null;
function ktx2Loader(gl: WebGLRenderer): KTX2Loader {
  if (!ktx2) ktx2 = new KTX2Loader().setWorkerLimit(2).detectSupport(gl);
  return ktx2;
}

/** Sum of the transcoded mip levels: exactly what is uploaded to the GPU. */
function mipBytes(t: CompressedTexture): number {
  let b = 0;
  for (const m of t.mipmaps as { data: ArrayBufferView }[]) b += m.data.byteLength;
  return b;
}

/**
 * Loads a KTX2 texture (D-082). `reduce` drops the top mip level (a quarter of the memory) for
 * the Low preset. After the upload the CPU copy of the mip chain is released.
 */
async function ktx(
  gl: WebGLRenderer,
  name: string,
  srgb: boolean,
  reduce: boolean,
): Promise<CompressedTexture> {
  const t = (await ktx2Loader(gl).loadAsync(
    `${import.meta.env.BASE_URL}textures/${name}.ktx2`,
  )) as CompressedTexture;
  const mips = t.mipmaps as CompressedTextureMipmap[];
  if (reduce && mips.length > 1 && mips[0]!.width >= 4096) {
    t.mipmaps = mips.slice(1);
    t.image = { width: mips[1]!.width, height: mips[1]!.height } as typeof t.image;
  }
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.name = name;
  const key = `${name}-${t.uuid}`;
  noteTextureBytes(key, mipBytes(t));
  t.onUpdate = () => {
    for (const m of t.mipmaps as { data: ArrayBufferView }[]) m.data = new Uint8Array(0);
  };
  t.addEventListener('dispose', () => forgetTexture(key));
  return t;
}

/** The height map as a one-channel texture from the CPU copy (no second decode, 1 byte/texel). */
function heightTexture(map: HeightMap): DataTexture {
  const t = new DataTexture(map.data, map.width, map.height, RedFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.flipY = true;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  const key = `height-${t.uuid}`;
  noteTexture(map.width, map.height, true, 1, key);
  t.addEventListener('dispose', () => forgetTexture(key));
  return t;
}

/**
 * Loads the globe's textures. `reduced` (Low preset) halves the 4096-px maps. Bathymetry and the
 * height map are 2048 px already.
 */
export async function loadGlobeTextures(
  gl: WebGLRenderer,
  heightMap: HeightMap,
  reduced: boolean,
): Promise<GlobeTextures> {
  const [day, night, normal, clouds, bathy] = await Promise.all([
    ktx(gl, 'earth-day', true, reduced),
    ktx(gl, 'earth-night', true, reduced),
    ktx(gl, 'earth-normal', false, reduced),
    ktx(gl, 'earth-clouds', false, reduced),
    ktx(gl, 'earth-bathy', false, reduced),
  ]).finally(() => {
    // The transcoder workers each keep a WASM heap sized for a 4096-px texture; nothing else is
    // loaded until the preset changes, so end them now (a new loader is made on demand).
    ktx2?.dispose();
    ktx2 = null;
  });
  return {
    day,
    night,
    normal,
    clouds,
    bathy,
    height: heightTexture(heightMap),
    waves: (waves ??= makeWaveNormal()),
    atmosphere: atmosphereTables(),
  };
}

let waves: Texture | null = null;

/** Frees every GPU texture of a set (used when the Low preset swaps resolutions). */
export function disposeGlobeTextures(t: GlobeTextures): void {
  // The wave normal map and the atmosphere tables are shared by every set and stay resident.
  for (const tex of [t.day, t.night, t.normal, t.clouds, t.bathy, t.height]) tex.dispose();
}

/** Applies the preset's anisotropic filtering to the colour maps (no reload needed). */
export function setAnisotropy(t: GlobeTextures, aniso: number): void {
  for (const tex of [t.day, t.night, t.normal]) {
    if (tex.anisotropy !== aniso) {
      tex.anisotropy = aniso;
      // Compressed textures re-upload their (released) mip data on needsUpdate; anisotropy is a
      // sampler parameter, so only refresh the uncompressed ones.
      if (!(tex as CompressedTexture).isCompressedTexture) tex.needsUpdate = true;
    }
  }
}

interface Props {
  textures: GlobeTextures;
  idMap: RegionIdMap;
  segments: number;
}

const world = loadWorld();
const CLOUD_SPEED = 0.0006; // uv per second (lower layer)
const CLOUD_SPEED_2 = 0.00035; // upper layer drifts slower → parallax
/** Real seconds over which this month's storms drift across their track. */
const STORM_DRIFT_SECONDS = 240;

export function Globe({ textures, idMap, segments }: Props) {
  const meshRef = useRef<Mesh>(null);
  const { camera } = useThree();
  const palette = useMemo(() => createPalette(), []);
  const countryIndex = useMemo(() => createCountryIndex(), []);
  const regionAttr = useMemo(() => createRegionAttr(), []);
  const sun = SUN;
  const levels = useLevels();
  const stormUniform = useMemo(
    () => Array.from({ length: MAX_STORMS }, () => new Vector4(0, 0, 1, 0.01)),
    [],
  );
  const stormParams = useMemo(
    () => Array.from({ length: MAX_STORMS }, () => new Vector4(0, 1, 0, 1)),
    [],
  );

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: GLOBE_VERT,
        fragmentShader: GLOBE_FRAG,
        defines: {
          ATMO_LEVEL: levels.atmosphere,
          OCEAN_LEVEL: levels.ocean,
          CLOUD_LEVEL: levels.clouds,
          TERRAIN_LEVEL: levels.terrain,
        },
        uniforms: {
          ...atmosphereUniforms(textures.atmosphere),
          dayMap: { value: textures.day },
          nightMap: { value: textures.night },
          normalMap: { value: textures.normal },
          cloudMap: { value: textures.clouds },
          bathyMap: { value: textures.bathy },
          heightMap: { value: textures.height },
          waveMap: { value: textures.waves },
          idMap: { value: idMap.texture },
          palette: { value: palette.texture },
          countryIndex: { value: countryIndex.texture },
          regionAttr: { value: regionAttr.texture },
          idMapSize: { value: new Vector2(idMap.width, idMap.height) },
          sunDir: { value: sun },
          cloudOffset: { value: 0 },
          cloudOffset2: { value: 0 },
          overlayStrength: { value: 1 },
          borderScale: { value: 1 },
          regionBorderAlpha: { value: 0 },
          hoverId: { value: 0 },
          selectedId: { value: 0 },
          time: { value: 0 },
          normalStrength: { value: 0.6 },
          cameraPos: { value: new Vector3() },
          showClouds: { value: 1 },
          cloudFade: { value: 1 },
          uMonth: { value: 1 },
          uWaveStrength: { value: 0 },
          uDisplace: { value: 0 },
          uGroundLight: { value: 1.45 },
          uAerial: { value: 0.22 },
          uStormCount: { value: 0 },
          uStorms: { value: stormUniform },
          uStormParams: { value: stormParams },
        },
      }),
    // levels are applied through `defines` below, not by rebuilding the material
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textures, idMap, palette, countryIndex, regionAttr, sun, stormUniform, stormParams],
  );
  const atmosphere = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: ATMOSPHERE_FRAG,
        uniforms: {
          ...atmosphereUniforms(textures.atmosphere),
          sunDir: { value: sun },
          cameraPos: { value: new Vector3() },
          intensity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: BackSide,
        blending: AdditiveBlending,
      }),
    [sun, textures],
  );
  const cloudMaterial = (layer: number, alpha: number) =>
    new ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      defines: { ATMO_LEVEL: levels.atmosphere, CLOUD_LEVEL: levels.clouds },
      uniforms: {
        ...atmosphereUniforms(textures.atmosphere),
        cloudMap: { value: textures.clouds },
        sunDir: { value: sun },
        offset: { value: 0 },
        cameraPos: { value: new Vector3() },
        fade: { value: 1 },
        uLayer: { value: layer },
        uAlpha: { value: alpha },
        time: { value: 0 },
        uGroundLight: { value: 1.45 },
        uAerial: { value: 0.22 },
        uStormCount: { value: 0 },
        uStorms: { value: stormUniform },
        uStormParams: { value: stormParams },
      },
      transparent: true,
      depthWrite: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clouds = useMemo(() => cloudMaterial(0, 0.88), [textures, sun]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clouds2 = useMemo(() => cloudMaterial(1, 0.55), [textures, sun]);

  // Materials made here are not owned by React: free their GPU programs and uniforms when they
  // are replaced (a texture-set swap) or the globe unmounts (D-082).
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => atmosphere.dispose(), [atmosphere]);
  useEffect(
    () => () => {
      clouds.dispose();
      clouds2.dispose();
    },
    [clouds, clouds2],
  );

  // Recompile when an effect level changes (rare: settings or the auto-scaler).
  useEffect(() => {
    material.defines = {
      ATMO_LEVEL: levels.atmosphere,
      OCEAN_LEVEL: levels.ocean,
      CLOUD_LEVEL: levels.clouds,
      TERRAIN_LEVEL: levels.terrain,
    };
    material.needsUpdate = true;
    for (const m of [clouds, clouds2]) {
      m.defines = { ATMO_LEVEL: levels.atmosphere, CLOUD_LEVEL: levels.clouds };
      m.needsUpdate = true;
    }
  }, [levels, material, clouds, clouds2]);

  // Palette and region attributes update whenever the game state or map mode changes.
  const game = useGameStore((s) => s.game);
  const mapMode = useUiStore((s) => s.mapMode);
  const paletteMode = useUiStore((s) => s.prefs.palette);
  const resourceView = useUiStore((s) => s.resourceView);
  const stormsSince = useRef(0);
  useEffect(() => {
    if (!game) return;
    fillPalette(palette.data, world, game, mapMode, resourceView, paletteMode === 'colourblind');
    palette.texture.needsUpdate = true;
    fillCountryIndex(countryIndex.data, world, game);
    countryIndex.texture.needsUpdate = true;
    fillRegionAttr(regionAttr.data, world, game);
    regionAttr.texture.needsUpdate = true;
  }, [game, mapMode, resourceView, paletteMode, palette, countryIndex, regionAttr]);
  const storms = useMemo(
    () => (game ? generateStorms(game.seed, game.turn, game.date.month) : generateStorms(1, 0, 1)),
    [game],
  );
  useEffect(() => {
    stormsSince.current = performance.now();
  }, [storms]);

  useFrame((_, dt) => {
    const u = material.uniforms;
    const t = (u.time!.value as number) + dt;
    u.time!.value = t;
    const month = game?.date.month ?? 1;
    const ui = useUiStore.getState();
    const camLon = (Math.atan2(-camera.position.z, camera.position.x) * 180) / Math.PI;
    sunDirection(month, t, camLon, sun, ui.sunOffset);
    u.hoverId!.value = ui.hoverRegion ?? 0;
    u.selectedId!.value = ui.selectedRegion ?? 0;
    u.uMonth!.value = month;
    const dist = camera.position.length();
    // Border thickness in texels: ~1 texel when close, up to 3 when far; region borders fade when far.
    u.borderScale!.value = Math.min(3, Math.max(1, (dist - 1) * 1.6));
    u.regionBorderAlpha!.value = Math.max(0, Math.min(1, (2.2 - dist) / 0.9));
    // Clouds fade out below ~1.9 so the political map stays readable when zoomed in.
    const cloudFade = Math.max(0, Math.min(1, (dist - 1.3) / 0.6));
    u.cloudFade!.value = cloudFade;
    clouds.uniforms.fade!.value = cloudFade;
    clouds2.uniforms.fade!.value = cloudFade;
    u.overlayStrength!.value = ui.mapMode === 'political' ? 0.92 : 1;
    const off1 = (t * CLOUD_SPEED) % 1;
    const off2 = (t * CLOUD_SPEED_2) % 1;
    u.cloudOffset!.value = off1;
    u.cloudOffset2!.value = off2;
    u.showClouds!.value = ui.showClouds ? 1 : 0;
    // Waves show up as the camera comes down; far away the ocean stays glassy with a wide glint.
    u.uWaveStrength!.value = 0.06 + 0.54 * Math.max(0, Math.min(1, (2.6 - dist) / 1.2));
    u.uDisplace!.value = terrainDisplacement(dist, levels.terrain);
    (u.cameraPos!.value as Vector3).copy(camera.position);
    (atmosphere.uniforms.cameraPos!.value as Vector3).copy(camera.position);
    for (const m of [clouds, clouds2]) {
      (m.uniforms.cameraPos!.value as Vector3).copy(camera.position);
      m.uniforms.time!.value = t;
    }
    clouds.uniforms.offset!.value = off1;
    clouds2.uniforms.offset!.value = off2;
    // Storms drift slowly along their monthly track.
    const frac = Math.min(
      1,
      (performance.now() - stormsSince.current) / 1000 / STORM_DRIFT_SECONDS,
    );
    const n = levels.clouds >= 2 ? Math.min(MAX_STORMS, storms.length) : 0;
    for (let i = 0; i < n; i++) {
      const s = storms[i]!;
      const c = latLonToVec3(s.lat + s.driftLat * frac, s.lon + s.driftLon * frac, 1);
      stormUniform[i]!.set(c.x, c.y, c.z, (s.radiusDeg * Math.PI) / 180);
      stormParams[i]!.set(s.intensity, s.spin, i * 1.7, s.kind === 'cyclone' ? 1 : 0);
    }
    u.uStormCount!.value = n;
    clouds.uniforms.uStormCount!.value = n;
    clouds2.uniforms.uStormCount!.value = n;
  });

  const showClouds = useUiStore((s) => s.showClouds);
  const cameraDistance = useUiStore((s) => s.cameraDistance);
  const cloudSegs = Math.max(48, segments / 2);
  return (
    <group>
      <mesh ref={meshRef} material={material} name="globe">
        <sphereGeometry args={[1, segments, segments / 2]} />
      </mesh>
      {showClouds && (
        <mesh material={clouds} renderOrder={1} visible={cameraDistance > 1.3}>
          <sphereGeometry args={[1.0045, cloudSegs, cloudSegs / 2]} />
        </mesh>
      )}
      {showClouds && levels.clouds >= 1 && (
        <mesh material={clouds2} renderOrder={1} visible={cameraDistance > 1.3}>
          <sphereGeometry args={[1.011, cloudSegs, cloudSegs / 2]} />
        </mesh>
      )}
      <mesh material={atmosphere} renderOrder={2}>
        <sphereGeometry args={[RT, 96, 48]} />
      </mesh>
    </group>
  );
}

export const SPACE_COLOR = new Color('#02040a');
