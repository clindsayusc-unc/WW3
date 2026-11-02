/** Dev/e2e performance probe and GPU texture accounting (D-046). */
import type { WebGLRenderer } from 'three';
import { useUiStore } from '../state/uiStore';

/** Dev/e2e probe: `window.ww3.perf(seconds)` sweeps the camera and resolves with fps, heap and texture memory. */
export function installPerfProbe(gl: WebGLRenderer): void {
  const w = window as unknown as { ww3?: Record<string, unknown> };
  w.ww3 = w.ww3 ?? {};
  w.ww3.perf = (seconds = 20) =>
    new Promise((resolve) => {
      const ui = useUiStore.getState();
      const frames: number[] = [];
      const t0 = performance.now();
      let last = t0;
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
        frames.push(now - last);
        last = now;
        const elapsed = (now - t0) / 1000;
        const stop =
          stops[Math.min(stops.length - 1, Math.floor((elapsed / seconds) * stops.length))]!;
        ui.fly(stop[0], stop[1], stop[2]);
        if (elapsed < seconds) requestAnimationFrame(tick);
        else {
          const sorted = [...frames].sort((a, b) => a - b);
          const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
          const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          let textureBytes = 0;
          for (const t of textureBytesList) textureBytes += t;
          resolve({
            frames: frames.length,
            avgMs: avg,
            fps: 1000 / avg,
            p95Ms: sorted[Math.floor(sorted.length * 0.95)],
            jsHeapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
            textures: gl.info.memory.textures,
            geometries: gl.info.memory.geometries,
            textureMB: textureBytes / 1048576,
            drawCalls: gl.info.render.calls,
            dpr: gl.getPixelRatio(),
          });
        }
      };
      requestAnimationFrame(tick);
    });
}
/** Estimated GPU bytes of the textures we upload (RGBA8 + mipmaps). */
const textureBytesList: number[] = [];
export function noteTexture(width: number, height: number, mipmaps: boolean): void {
  textureBytesList.push(width * height * 4 * (mipmaps ? 4 / 3 : 1));
}
