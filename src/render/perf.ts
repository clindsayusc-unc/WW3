/** Dev/e2e performance probe and GPU texture accounting (D-046, D-082). */
import type { Object3D, Scene, WebGLRenderer } from 'three';
import { useUiStore } from '../state/uiStore';
import { useGameStore } from '../state/gameStore';
import { noteInput } from './activity';

export interface PerfResult {
  quality: string;
  frames: number;
  avgMs: number;
  fps: number;
  p95Ms: number;
  /** Draw calls per frame, summed over every pass (scene + post-processing). */
  drawCalls: number;
  drawCallsMax: number;
  /** Triangles per frame (lines and points are counted separately by three and not included). */
  triangles: number;
  jsHeapMB: number | null;
  textures: number;
  geometries: number;
  /** Estimated GPU texture memory: the bytes we upload, by real format (compressed or RGBA8). */
  textureMB: number;
  dpr: number;
  canvasPx: [number, number];
  /** Worker time of the last turn (ms). */
  lastTurnMs: number;
}

/** Dev/e2e probe: `window.ww3.perf(seconds)` sweeps the camera and resolves with a PerfResult. */
export function installPerfProbe(gl: WebGLRenderer, scene: Scene): void {
  const w = window as unknown as { ww3?: Record<string, unknown> };
  w.ww3 = w.ww3 ?? {};
  // Every visible drawable in the scene graph: what one scene render submits (before culling).
  w.ww3.drawList = () => {
    const out: { name: string; type: string; instances?: number }[] = [];
    const visit = (o: Object3D) => {
      if (!o.visible) return;
      const d = o as Object3D & {
        isMesh?: boolean;
        isLine?: boolean;
        isPoints?: boolean;
        isSprite?: boolean;
        count?: number;
        isInstancedMesh?: boolean;
      };
      if (d.isMesh || d.isLine || d.isPoints || d.isSprite)
        out.push({
          name: o.name || o.parent?.name || '',
          type: o.type,
          ...(d.isInstancedMesh ? { instances: d.count } : {}),
        });
      for (const c of o.children) visit(c);
    };
    visit(scene);
    return out;
  };
  w.ww3.textureMB = () => gpuTextureBytes() / 1048576;
  w.ww3.perf = (seconds = 20): Promise<PerfResult> =>
    new Promise((resolve) => {
      const ui = useUiStore.getState();
      const frames: number[] = [];
      const calls: number[] = [];
      const tris: number[] = [];
      const t0 = performance.now();
      let last = t0;
      // Count every pass of a frame: three resets `info` per render() call by default, and the
      // post-processing chain calls render() once per pass.
      const autoReset = gl.info.autoReset;
      gl.info.autoReset = false;
      gl.info.reset();
      const stops: [number, number, number][] = [
        [38, -98, 2.6],
        [50, 10, 1.8],
        [25, 120, 1.25],
        [20, 78, 1.6],
        [-15, -55, 2.2],
        [55, 37, 1.4],
        [35, 139, 1.2],
        [0, 20, 3.4],
      ];
      const tick = () => {
        const now = performance.now();
        // The canvas renders on demand (D-082): count only display frames that drew something,
        // and keep the scheduler at full rate as if the player were moving the camera.
        noteInput(now);
        if (gl.info.render.calls > 0) {
          frames.push(now - last);
          calls.push(gl.info.render.calls);
          tris.push(gl.info.render.triangles);
          gl.info.reset();
          last = now;
        }
        const elapsed = (now - t0) / 1000;
        const stop =
          stops[Math.min(stops.length - 1, Math.floor((elapsed / seconds) * stops.length))]!;
        ui.fly(stop[0], stop[1], stop[2]);
        if (elapsed < seconds) requestAnimationFrame(tick);
        else {
          gl.info.autoReset = autoReset;
          // The first sample spans the time before the probe started.
          frames.shift();
          calls.shift();
          tris.shift();
          const sorted = [...frames].sort((a, b) => a - b);
          const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
          const avg = mean(frames);
          const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          const size = gl.domElement;
          resolve({
            quality: useUiStore.getState().quality,
            frames: frames.length,
            avgMs: avg,
            fps: 1000 / avg,
            p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? avg,
            drawCalls: mean(calls),
            drawCallsMax: Math.max(0, ...calls),
            triangles: mean(tris),
            jsHeapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
            textures: gl.info.memory.textures,
            geometries: gl.info.memory.geometries,
            textureMB: gpuTextureBytes() / 1048576,
            dpr: gl.getPixelRatio(),
            canvasPx: [size.width, size.height],
            lastTurnMs: useGameStore.getState().lastTurnMs,
          });
        }
      };
      requestAnimationFrame(tick);
    });
}

/** Estimated GPU bytes of the textures we upload, keyed so a re-upload replaces its entry. */
const textureBytes = new Map<string, number>();
let anon = 0;

/** Records an uncompressed texture: `bytesPerPixel` (RGBA8 = 4) and a full mip chain if `mipmaps`. */
export function noteTexture(
  width: number,
  height: number,
  mipmaps: boolean,
  bytesPerPixel = 4,
  key = `anon-${anon++}`,
): void {
  textureBytes.set(key, width * height * bytesPerPixel * (mipmaps ? 4 / 3 : 1));
}

/** Records a texture by its exact byte size (compressed textures report their own mip sizes). */
export function noteTextureBytes(key: string, bytes: number): void {
  textureBytes.set(key, bytes);
}

/** Forgets a texture that was disposed. */
export function forgetTexture(key: string): void {
  textureBytes.delete(key);
}

export function gpuTextureBytes(): number {
  let total = 0;
  for (const b of textureBytes.values()) total += b;
  return total;
}
