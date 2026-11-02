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
  TextureLoader,
  Vector2,
  Vector3,
} from 'three';
import {
  ATMOSPHERE_FRAG,
  ATMOSPHERE_VERT,
  CLOUD_FRAG,
  CLOUD_VERT,
  GLOBE_FRAG,
  GLOBE_VERT,
} from './globeShader';
import { createCountryIndex, createPalette, type RegionIdMap } from './regionIds';
import { fillCountryIndex, fillPalette } from './palette';
import { sunDirection } from './geo';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { loadWorld } from '../sim/world';
import { noteTexture } from './perf';

export interface GlobeTextures {
  day: Texture;
  night: Texture;
  normal: Texture;
  clouds: Texture;
  bathy: Texture;
}

const loader = new TextureLoader();
function tex(url: string, srgb: boolean, aniso: number): Promise<Texture> {
  return new Promise((resolve, reject) =>
    loader.load(
      url,
      (t) => {
        t.colorSpace = srgb ? SRGBColorSpace : t.colorSpace;
        t.wrapS = RepeatWrapping;
        t.minFilter = LinearMipmapLinearFilter;
        t.magFilter = LinearFilter;
        t.anisotropy = aniso;
        t.generateMipmaps = true;
        noteTexture(t.image.width, t.image.height, true);
        resolve(t);
      },
      undefined,
      () => reject(new Error(`texture ${url}`)),
    ),
  );
}

export async function loadGlobeTextures(aniso: number): Promise<GlobeTextures> {
  const [day, night, normal, clouds, bathy] = await Promise.all([
    tex('/textures/earth-day.jpg', true, aniso),
    tex('/textures/earth-night.jpg', true, aniso),
    tex('/textures/earth-normal.jpg', false, aniso),
    tex('/textures/earth-clouds.jpg', false, 2),
    tex('/textures/earth-bathy.jpg', false, 2),
  ]);
  return { day, night, normal, clouds, bathy };
}

interface Props {
  textures: GlobeTextures;
  idMap: RegionIdMap;
  segments: number;
}

const world = loadWorld();
const CLOUD_SPEED = 0.0006; // uv per second

export function Globe({ textures, idMap, segments }: Props) {
  const meshRef = useRef<Mesh>(null);
  const { camera } = useThree();
  const palette = useMemo(() => createPalette(), []);
  const countryIndex = useMemo(() => createCountryIndex(), []);
  const sun = useMemo(() => new Vector3(1, 0, 0), []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: GLOBE_VERT,
        fragmentShader: GLOBE_FRAG,
        uniforms: {
          dayMap: { value: textures.day },
          nightMap: { value: textures.night },
          normalMap: { value: textures.normal },
          cloudMap: { value: textures.clouds },
          bathyMap: { value: textures.bathy },
          idMap: { value: idMap.texture },
          palette: { value: palette.texture },
          countryIndex: { value: countryIndex.texture },
          idMapSize: { value: new Vector2(idMap.width, idMap.height) },
          sunDir: { value: sun },
          cloudOffset: { value: 0 },
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
        },
      }),
    [textures, idMap, palette, countryIndex, sun],
  );
  const atmosphere = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: ATMOSPHERE_FRAG,
        uniforms: {
          sunDir: { value: sun },
          cameraPos: { value: new Vector3() },
          intensity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: BackSide,
        blending: AdditiveBlending,
      }),
    [sun],
  );
  const clouds = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          cloudMap: { value: textures.clouds },
          sunDir: { value: sun },
          offset: { value: 0 },
          cameraPos: { value: new Vector3() },
          fade: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [textures, sun],
  );

  // Palette updates whenever the game state or map mode changes.
  const game = useGameStore((s) => s.game);
  const mapMode = useUiStore((s) => s.mapMode);
  useEffect(() => {
    if (!game) return;
    fillPalette(palette.data, world, game, mapMode);
    palette.texture.needsUpdate = true;
    fillCountryIndex(countryIndex.data, world, game);
    countryIndex.texture.needsUpdate = true;
  }, [game, mapMode, palette, countryIndex]);

  useFrame((_, dt) => {
    const u = material.uniforms;
    const t = (u.time!.value as number) + dt;
    u.time!.value = t;
    const month = game?.date.month ?? 1;
    const camLon = (Math.atan2(-camera.position.z, camera.position.x) * 180) / Math.PI;
    sunDirection(month, t, camLon, sun);
    const ui = useUiStore.getState();
    u.hoverId!.value = ui.hoverRegion ?? 0;
    u.selectedId!.value = ui.selectedRegion ?? 0;
    const dist = camera.position.length();
    // Border thickness in texels: ~1 texel when close, up to 3 when far; region borders fade when far.
    u.borderScale!.value = Math.min(3, Math.max(1, (dist - 1) * 1.6));
    u.regionBorderAlpha!.value = Math.max(0, Math.min(1, (2.2 - dist) / 0.9));
    // Clouds fade out below ~1.9 so the political map stays readable when zoomed in.
    const cloudFade = Math.max(0, Math.min(1, (dist - 1.3) / 0.6));
    u.cloudFade!.value = cloudFade;
    clouds.uniforms.fade!.value = cloudFade;
    u.overlayStrength!.value = ui.mapMode === 'political' ? 0.85 : 1;
    u.cloudOffset!.value = (t * CLOUD_SPEED) % 1;
    u.showClouds!.value = ui.showClouds ? 1 : 0;
    (u.cameraPos!.value as Vector3).copy(camera.position);
    (atmosphere.uniforms.cameraPos!.value as Vector3).copy(camera.position);
    (clouds.uniforms.cameraPos!.value as Vector3).copy(camera.position);
    clouds.uniforms.offset!.value = (t * CLOUD_SPEED) % 1;
    atmosphere.uniforms.intensity!.value = Math.min(1.2, 0.6 + (dist - 1) * 0.4);
  });

  const showClouds = useUiStore((s) => s.showClouds);
  const cameraDistance = useUiStore((s) => s.cameraDistance);
  return (
    <group>
      <mesh ref={meshRef} material={material} name="globe">
        <sphereGeometry args={[1, segments, segments / 2]} />
      </mesh>
      {showClouds && (
        <mesh material={clouds} renderOrder={1} visible={cameraDistance > 1.3}>
          <sphereGeometry args={[1.006, Math.max(48, segments / 2), Math.max(24, segments / 4)]} />
        </mesh>
      )}
      <mesh material={atmosphere} renderOrder={2}>
        <sphereGeometry args={[1.035, 96, 48]} />
      </mesh>
    </group>
  );
}

export const SPACE_COLOR = new Color('#02040a');
