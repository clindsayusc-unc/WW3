# Performance Budget & Log

**Target hardware:** Apple M3, 8 GB unified memory.

| Budget               | Limit                                            | Status (feat/playable-v1)                                     |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Frame rate           | 60 fps sustained on the globe view               | Not yet measured on an M3 (see below); designed for it        |
| Process memory (RAM) | < 1.5 GB                                         | JS heap 71 MB after a 20 s sweep (headless Chrome)            |
| GPU texture memory   | < 400 MB                                         | ≈ 213 MB (RGBA8 + mipmaps, computed at upload)                |
| Single texture size  | ≤ 4096 px on its longest side; prefer KTX2/Basis | All ≤ 4096×2048; JPG/PNG (no KTX2 encoder available, D-022)   |
| Main thread          | No simulation work; the sim runs in a Web Worker | Yes — `src/sim/worker.ts`; a turn takes ~150 ms in the worker |

## Rules of thumb

- Use instancing (`InstancedMesh` / drei `<Instances>`) for any object drawn more than ~20 times.
  Unit stacks are one `InstancedMesh` (max 1,500 instances).
- Use KTX2 + mipmaps for every texture once an encoder is available. Don't decode large PNG/JPEG
  files at runtime beyond the five globe maps.
- Keep draw calls under about 300 on the globe view. Current scene: globe, clouds, atmosphere,
  2 border line sets, 1 instanced unit mesh, stars, transient strike arcs/flashes ≈ 10–40 calls.
- Cap DPR at 2 (`High`), 1.5 (`Medium`), 1 (`Low`). Dynamic resolution (D-040) lowers DPR by 0.1 when
  the frame-time EMA exceeds 18 ms and raises it slowly below 12 ms.
- Send only the state the UI needs from the worker. Today the full `GameState` (~1 MB) is posted
  per command; move to diffs if this shows up in profiles.

## How to measure

```bash
npm run perf
```

runs the Playwright test `performance probe` (set `PERF=1`), which starts a game as the USA, sweeps
the camera through eight stops for 20 seconds and writes `docs/perf-last-run.json` with average and
p95 frame time, fps, JS heap, texture count and estimated texture megabytes. In the browser the same
probe is `window.ww3.perf(20)` (returns a promise) from the dev-tools console — run it on the M3 in
Chrome or Safari and paste the numbers into the log below.

## Log

| Date       | Branch           | Measurement                                                                                                                 | Notes                                                                                                                                                |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-02 | chore/bootstrap  | JS bundle 1.03 MB (280 kB gzip)                                                                                             | Placeholder sphere only; not yet profiled on M3.                                                                                                     |
| 2026-11-02 | feat/playable-v1 | JS bundle 2.6 MB (700 kB gzip) + worker 560 kB + regions.topo.json 2.5 MB (900 kB gzip); textures 4.9 MB on disk            | Single chunk; code-splitting the modals and lazy-loading the TopoJSON borders are the next bundle wins.                                              |
| 2026-11-02 | feat/playable-v1 | 20 s sweep, headless Chrome 156 + SwiftShader (software GL) at 1440×900, DPR 1: avg 560 ms/frame (1.8 fps), p95 1,021 ms    | **Not representative** — software rasteriser. Fragment cost is dominated by the globe shader (~17 texture taps/pixel); on an M3 GPU this is ≪ 16 ms. |
| 2026-11-02 | feat/playable-v1 | JS heap 71 MB; 26 textures ≈ 213 MB GPU (day/night/normal/clouds 4096² RGBA8+mips ≈ 45 MB each, ID map 33.5 MB, rest small) | Within budget. Reduce by loading clouds/bathymetry at 2048 on `Low`.                                                                                 |
| 2026-11-02 | feat/playable-v1 | Simulation: 60 turns in 8.6 s headless (≈ 145 ms/turn, 196 nations, ~1,500–2,100 units); `structuredClone` ≈ 10 ms/turn     | `scripts/soak.ts`; profile with `node --cpu-prof --import tsx scripts/soak.ts 36`.                                                                   |

## Known hot spots / next steps

1. Measure on the actual M3 (Chrome and Safari) and record fps at full globe, Europe (dist 1.5) and
   Taiwan (dist 1.2). If below 60, first lower `High` DPR to 1.5 and drop the second set of
   country-border ID taps in the shader.
2. Globe shader: 5 ID-map taps + 4 country-index taps per pixel for borders. Could be replaced by a
   precomputed border texture (one tap).
3. Labels overlay redraws every frame; throttle to every second frame when the camera is still.
4. Code-split modals (`React.lazy`) and the TopoJSON border fetch (already lazy via `?url`).
5. KTX2/Basis textures once `toktx` is available in CI (saves ~70% GPU memory).
