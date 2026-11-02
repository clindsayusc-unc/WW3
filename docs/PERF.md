# Performance Budget & Log

**Target hardware:** Apple M3, 8 GB unified memory.

| Budget               | Limit                                            | Status (feat/playable-v1)                                                                                             |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Frame rate           | 60 fps sustained on the globe view               | Not yet measured on an M3 (see below); every effect has a Low/Medium/High level and the auto-scaler caps them (D-055) |
| Process memory (RAM) | < 1.5 GB                                         | JS heap 82 MB after a 20 s sweep (headless Chrome, feat/cinematic-globe)                                              |
| GPU texture memory   | < 400 MB                                         | ≈ 225 MB (RGBA8 + mipmaps, computed at upload; + height map 11 MB, wave map 0.3 MB, atmosphere tables 0.6 MB)         |
| Single texture size  | ≤ 4096 px on its longest side; prefer KTX2/Basis | All ≤ 4096×2048; JPG/PNG (no KTX2 encoder available, D-022)                                                           |
| Main thread          | No simulation work; the sim runs in a Web Worker | Yes — `src/sim/worker.ts`; a turn takes ~150 ms in the worker                                                         |

## Rules of thumb

- Use instancing (`InstancedMesh` / drei `<Instances>`) for any object drawn more than ~20 times.
  Unit stacks are one `InstancedMesh` (max 1,500 instances).
- Use KTX2 + mipmaps for every texture once an encoder is available. Don't decode large PNG/JPEG
  files at runtime beyond the five globe maps.
- Keep draw calls under about 300 on the globe view. Current scene: globe, 2 cloud layers, limb
  shell, 2 border line sets, front lines (2), arrows (1), fires (2), wakes (1), 1 instanced unit mesh,
  stars, transient strike arcs/flashes ≈ 15–60 calls; the post-processing chain adds its passes.
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

| 2026-11-02 | feat/cinematic-globe | 20 s sweep, headless Chrome 156 + SwiftShader at 1440×900: avg 1,348 ms/frame (0.7 fps), p95 4,612 ms; 33 textures ≈ 225 MB GPU; JS heap 82 MB | **Not representative** (software rasteriser; 2.4× the previous software number). Fragment cost per globe pixel rose from ~17 to ~30 texture taps on High (height, wave ×2, two cloud-shadow taps, 2 atmosphere table taps ×2 (ν slices) + 2 transmittance taps). Low drops to ~18 taps (no aerial perspective, one cloud tap, no waves). |
| 2026-11-02 | feat/cinematic-globe | JS bundle 3.6 MB (main) + 1.4 MB worker; textures 4.9 MB on disk (+ 73 kB height map); atmosphere tables ≈ 150–400 ms CPU once at load | `three/examples` lines (LineSegments2) and the new layers add ≈ 1 MB; code-splitting is still the next bundle win. |

## Known hot spots / next steps

1. Measure on the actual M3 (Chrome and Safari) and record fps at full globe, Europe (dist 1.5) and
   Taiwan (dist 1.2). If below 60 the auto-scaler will first lower the DPR, then cap effects at
   Medium (one cloud layer's shadow, one wave octave) and Low (no aerial perspective, no smoke or
   wakes); record which cap it settles on. The largest per-pixel costs on High are the two
   atmosphere table lookups (4 taps) and the second wave octave.
2. Globe shader: 5 ID-map taps + 4 country-index taps per pixel for borders. Could be replaced by a
   precomputed border texture (one tap).
3. Labels overlay redraws every frame; throttle to every second frame when the camera is still.
4. Code-split modals (`React.lazy`) and the TopoJSON border fetch (already lazy via `?url`).
5. KTX2/Basis textures once `toktx` is available in CI (saves ~70% GPU memory).

## Geography pass (D-050–D-053)

- Simulation: ~150 ms per turn early, ~400 ms late-game with 3–4,000 units in Node (soak of 120
  turns ≈ 42 s in vitest, 160 s before the fixes) after caching `alliesOf` by diplomacy version,
  indexing naval units per zone and memoising sea balances, lift and landing targets per state with
  numeric keys. The hot spots are now `runSupply` (one Dijkstra per living nation, allied
  territory included), `decayRelations` (pre-existing) and the per-unit attrition/recovery loops.
- Data: +0.85 MB of JSON (`terrain`, `climate`, `crossings`, `infrastructure`, `chokepoints`)
  bundled with the app; no new textures. The terrain map mode is palette texels only.
- Overlay: chokepoint icons are 12 canvas draws per frame on the existing label layer.

## Cinematic globe pass (D-054–D-058)

- Per-pixel budget of the globe shader on High: day, night, normal, height (vertex), bathymetry,
  2 wave octaves, 2 cloud shadows, 5 ID + 4 country-index taps for borders, palette, region
  attributes, 2 scattering + 2 transmittance taps (aerial perspective), 1 sun-transmittance tap.
  Medium drops one wave octave and one cloud shadow; Low drops aerial perspective, waves and
  cloud shadows (rim glow and a single glint instead).
- The limb shell is a 96 × 48 sphere at the top of the atmosphere drawn back-face only: it costs
  one scattering lookup per pixel of the annulus, nothing over the globe (depth-tested away).
- The two cloud spheres are 128 × 64 segments at High and sample the cloud map once each plus
  the storm loop (≤ 8 iterations, High only) and the aerial-perspective taps.
- Front lines rebuild only when control, treaties or wars change (TopoJSON mesh, ≈ 1–3 k segments)
  and re-upload positions only when the terrain displacement changes by > 0.00015.
- Fires: ≤ 14 points + 10 smoke particles per burning region on High (two draw calls total);
  wakes rebuild one small geometry per frame for ≤ 300 naval stacks and are skipped above
  distance 2.4.
- The atmosphere tables are computed on the main thread during the loading overlay; move them to
  the worker if the loading screen ever feels sluggish.
