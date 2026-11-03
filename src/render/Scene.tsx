import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { ACESFilmicToneMapping, NoToneMapping } from 'three';
import {
  Globe,
  disposeGlobeTextures,
  loadGlobeTextures,
  setAnisotropy,
  type GlobeTextures,
} from './Globe';
import { CameraRig } from './CameraRig';
import { Borders } from './Borders';
import { Labels } from './Labels';
import { Units } from './Units';
import { Strikes } from './Strikes';
import { FrontLines } from './FrontLines';
import { Arrows } from './Arrows';
import { TradeRoutes } from './TradeRoutes';
import { Fires } from './Fires';
import { Wakes } from './Wakes';
import { loadRegionIdMap, type RegionIdMap } from './regionIds';
import { loadHeightMap, setHeightMap, type HeightMap } from './terrainHeight';
import {
  CADENCE_MS,
  DynamicResolution,
  QUALITY,
  cadenceFor,
  dprCap,
  loadSettledDpr,
  saveSettledDpr,
  type Cadence,
} from './quality';
import { installPerfProbe } from './perf';
import { idleSeconds, isBusy, noteInput } from './activity';
import { useUiStore } from '../state/uiStore';

interface Assets {
  textures: GlobeTextures;
  idMap: RegionIdMap;
}

/** CPU-side maps (no GPU needed): loaded once, shared by every texture set. */
let basePromise: Promise<{ idMap: RegionIdMap; heightMap: HeightMap }> | null = null;
function loadBase() {
  if (!basePromise)
    basePromise = Promise.all([loadRegionIdMap(), loadHeightMap()]).then(([idMap, heightMap]) => {
      setHeightMap(heightMap);
      return { idMap, heightMap };
    });
  return basePromise;
}

/**
 * Loads the globe textures with the renderer (KTX2 transcoding needs its capabilities). Switching
 * to or from the Low preset loads the other resolution and frees the previous set once the new
 * one is on screen (D-082).
 */
function AssetLoader({ onReady }: { onReady: (a: Assets) => void }) {
  const { gl } = useThree();
  const quality = useUiStore((s) => s.quality);
  const reduced = quality === 'low';
  const current = useRef<{ reduced: boolean; textures: GlobeTextures } | null>(null);
  useEffect(() => {
    if (current.current?.reduced === reduced) return;
    let cancelled = false;
    void loadBase()
      .then(async ({ idMap, heightMap }) => {
        const textures = await loadGlobeTextures(gl, heightMap, reduced);
        if (cancelled) {
          disposeGlobeTextures(textures);
          return;
        }
        const previous = current.current;
        current.current = { reduced, textures };
        onReady({ textures, idMap });
        // Free the old set after React has swapped the materials over.
        if (previous) setTimeout(() => disposeGlobeTextures(previous.textures), 0);
      })
      .catch((e: Error) => useUiStore.getState().setAssetError(e.message));
    return () => {
      cancelled = true;
    };
  }, [gl, reduced, onReady]);
  useEffect(
    () => () => {
      if (current.current) disposeGlobeTextures(current.current.textures);
      current.current = null;
    },
    [],
  );
  return null;
}

/**
 * Frame scheduler (D-082). The canvas renders on demand; this loop asks for a frame at the
 * cadence that fits: every display frame while the player interacts or something animates,
 * 30 fps after 8 s idle, 15 fps after a minute, 20 fps under a modal, none while hidden.
 */
function FrameScheduler() {
  const { invalidate } = useThree();
  useEffect(() => {
    const now0 = performance.now();
    noteInput(now0);
    const onInput = () => noteInput(performance.now());
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true });
    const onVisible = () => {
      noteInput(performance.now());
      invalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const ui = useUiStore.getState();
      const c: Cadence = cadenceFor({
        hidden: document.hidden,
        covered: ui.modal !== null && ui.modal !== 'battle',
        busy: isBusy(now),
        idleSeconds: idleSeconds(now),
      });
      setCadence(c);
      const interval = CADENCE_MS[c];
      if (interval === Infinity) return;
      // A 2 ms tolerance keeps a 60 Hz display at exactly every 2nd/4th frame.
      if (now - last >= interval - 2) {
        last = now;
        invalidate();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) window.removeEventListener(e, onInput);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [invalidate]);
  return null;
}

let cadence: Cadence = 'full';
function setCadence(c: Cadence): void {
  cadence = c;
}
/** The scheduler's current cadence (for the perf overlay and the governor). */
export function currentCadence(): Cadence {
  return cadence;
}

function FrameGovernor({ dyn }: { dyn: DynamicResolution }) {
  const { gl, scene, setDpr, size } = useThree();
  const quality = useUiStore((s) => s.quality);
  useEffect(() => installPerfProbe(gl, scene), [gl, scene]);
  // Re-cap when the window changes size or moves to another display.
  useEffect(() => {
    const cap = dprCap(quality, size.width, size.height, window.devicePixelRatio || 1);
    const changed = dyn.setMax(cap);
    if (changed !== null) setDpr(changed);
  }, [dyn, quality, size.width, size.height, setDpr]);
  const last = useRef(performance.now());
  const frames = useRef(0);
  const acc = useRef(0);
  const sinceSave = useRef(0);
  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    frames.current++;
    acc.current += dt;
    if (acc.current >= 1000) {
      useUiStore.getState().setFps(Math.round((frames.current * 1000) / acc.current));
      frames.current = 0;
      acc.current = 0;
    }
    // Only full-rate frames tell us how fast the GPU is; throttled ones are slow on purpose.
    if (cadence !== 'full' || dt > 250) return;
    const dpr = dyn.update(dt);
    if (dpr !== null) setDpr(dpr);
    if (dyn.cap !== useUiStore.getState().autoCap) useUiStore.getState().setAutoCap(dyn.cap);
    sinceSave.current += dt;
    if (sinceSave.current > 10_000) {
      sinceSave.current = 0;
      saveSettledDpr(quality, dyn.current);
    }
  });
  return null;
}

function Contents({ assets }: { assets: Assets }) {
  const quality = useUiStore((s) => s.quality);
  const q = QUALITY[quality];
  const { gl, setDpr } = useThree();
  const dyn = useMemo(() => {
    const cap = dprCap(
      quality,
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
    );
    const d = new DynamicResolution({ ...q, maxDpr: cap }, loadSettledDpr(quality) ?? cap);
    return d;
  }, [q, quality]);
  useEffect(() => setDpr(dyn.current), [dyn, setDpr]);
  useEffect(() => {
    gl.toneMapping = q.postprocessing ? NoToneMapping : ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
  }, [gl, q]);
  useEffect(() => setAnisotropy(assets.textures, q.anisotropy), [assets, q.anisotropy]);
  return (
    <>
      <FrameScheduler />
      <FrameGovernor dyn={dyn} />
      <color attach="background" args={['#02040a']} />
      <Stars radius={60} depth={30} count={q.stars} factor={3} saturation={0.1} fade speed={0.2} />
      <Globe textures={assets.textures} idMap={assets.idMap} segments={q.segments} />
      <Borders />
      <FrontLines />
      <Arrows />
      <TradeRoutes />
      <Fires />
      <Wakes />
      <Units />
      <Strikes />
      <Labels />
      <CameraRig idMap={assets.idMap} />
      {q.postprocessing && (
        <EffectComposer multisampling={0}>
          {/* Five mip levels instead of eight: the glow reaches far enough at globe scale, and the
              three smallest levels were six extra passes a frame (D-082). */}
          <Bloom
            luminanceThreshold={0.75}
            luminanceSmoothing={0.2}
            intensity={0.55}
            mipmapBlur
            levels={quality === 'high' ? 6 : 5}
          />
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
  const error = useUiStore((s) => s.assetError);
  return (
    <div className="scene-root">
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45, near: 0.01, far: 50 }}
        dpr={[q.minDpr, q.maxDpr]}
        gl={{
          antialias: !q.postprocessing,
          powerPreference: 'high-performance',
          // No preserveDrawingBuffer: on Apple's tile-based GPUs it forces a copy every frame.
          preserveDrawingBuffer: false,
          logarithmicDepthBuffer: false,
        }}
        frameloop="demand"
      >
        <AssetLoader onReady={setAssets} />
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
