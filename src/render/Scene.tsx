import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { ACESFilmicToneMapping, NoToneMapping } from 'three';
import { Globe, loadGlobeTextures, type GlobeTextures } from './Globe';
import { CameraRig } from './CameraRig';
import { Borders } from './Borders';
import { Labels } from './Labels';
import { Units } from './Units';
import { Strikes } from './Strikes';
import { FrontLines } from './FrontLines';
import { Arrows } from './Arrows';
import { Fires } from './Fires';
import { Wakes } from './Wakes';
import { loadRegionIdMap, type RegionIdMap } from './regionIds';
import { loadHeightMap, setHeightMap } from './terrainHeight';
import { DynamicResolution, QUALITY } from './quality';
import { installPerfProbe } from './perf';
import { useUiStore } from '../state/uiStore';

interface Assets {
  textures: GlobeTextures;
  idMap: RegionIdMap;
}

let assetPromise: Promise<Assets> | null = null;
export function loadAssets(aniso: number): Promise<Assets> {
  if (!assetPromise)
    assetPromise = Promise.all([loadGlobeTextures(aniso), loadRegionIdMap(), loadHeightMap()]).then(
      ([textures, idMap, heightMap]) => {
        setHeightMap(heightMap);
        return { textures, idMap };
      },
    );
  return assetPromise;
}

function FrameGovernor({ dyn }: { dyn: DynamicResolution }) {
  const { gl, setDpr } = useThree();
  useEffect(() => installPerfProbe(gl), [gl]);
  const last = useRef(performance.now());
  const frames = useRef(0);
  const acc = useRef(0);
  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    const dpr = dyn.update(dt);
    if (dpr !== null) setDpr(dpr);
    if (dyn.cap !== useUiStore.getState().autoCap) useUiStore.getState().setAutoCap(dyn.cap);
    frames.current++;
    acc.current += dt;
    if (acc.current >= 1000) {
      useUiStore.getState().setFps(Math.round((frames.current * 1000) / acc.current));
      frames.current = 0;
      acc.current = 0;
    }
    void gl;
  });
  return null;
}

function Contents({ assets }: { assets: Assets }) {
  const quality = useUiStore((s) => s.quality);
  const q = QUALITY[quality];
  const dyn = useMemo(() => new DynamicResolution(q), [q]);
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMapping = q.postprocessing ? NoToneMapping : ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
  }, [gl, q]);
  return (
    <>
      <FrameGovernor dyn={dyn} />
      <color attach="background" args={['#02040a']} />
      <Stars radius={60} depth={30} count={q.stars} factor={3} saturation={0.1} fade speed={0.2} />
      <Globe textures={assets.textures} idMap={assets.idMap} segments={q.segments} />
      <Borders />
      <FrontLines />
      <Arrows />
      <Fires />
      <Wakes />
      <Units />
      <Strikes />
      <Labels />
      <CameraRig idMap={assets.idMap} />
      {q.postprocessing && (
        <EffectComposer multisampling={0}>
          <Bloom luminanceThreshold={0.75} luminanceSmoothing={0.2} intensity={0.55} mipmapBlur />
          <Vignette eskil={false} offset={0.25} darkness={0.55} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}

export function Scene() {
  const quality = useUiStore((s) => s.quality);
  const q = QUALITY[quality];
  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadAssets(q.anisotropy)
      .then(setAssets)
      .catch((e: Error) => setError(e.message));
  }, [q.anisotropy]);
  return (
    <div className="scene-root">
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45, near: 0.01, far: 50 }}
        dpr={[q.minDpr, q.maxDpr]}
        gl={{
          antialias: !q.postprocessing,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
          logarithmicDepthBuffer: false,
        }}
        frameloop="always"
      >
        <Suspense fallback={null}>{assets && <Contents assets={assets} />}</Suspense>
      </Canvas>
      {!assets && !error && (
        <div className="loading" data-testid="loading">
          <div className="loading-title">WORLD WAR 3</div>
          <div className="loading-sub">Loading globe…</div>
        </div>
      )}
      {error && <div className="loading">Failed to load globe assets: {error}</div>}
    </div>
  );
}
