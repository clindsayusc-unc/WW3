# Performance Budget & Log

**Target hardware:** Apple M3, 8 GB unified memory.

| Budget               | Limit                                            | Status (feat/playable-v1)                                                                                             |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Frame rate           | 60 fps sustained on the globe view               | **59.4 fps avg on the M3 (Chrome, DPR 1.3)** after Prompt 2 — the real-hardware baseline in the log below; every effect has a Low/Medium/High level and the auto-scaler caps them (D-055) |
| Process memory (RAM) | < 1.5 GB                                         | JS heap 179 MB after a 20 s sweep on the M3 (82 MB headless)                                                          |
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
| 2026-11-02 | feat/cinematic-globe (Prompt 2) | **Real hardware baseline — Apple M3, 8 GB, Chrome, `window.ww3.perf(20)`:** 59.4 fps avg, 16.8 ms avg frame, 18.5 ms p95, 1,189 frames; DPR settled at 1.3 (native 2.0); JS heap 179 MB; textures 225 MB | Measured by the owner on the target machine. This is the number every later branch is held to: fps must not fall and the DPR must settle at 1.3 or higher. |
| 2026-11-02 | feat/military-depth | No new textures or draw calls. Per state change: fog-of-war estimates resolved once per stack in `buildStacks` (not per frame); supply map mode is palette texels; the battle report and military tabs are plain DOM. Simulation: 120-turn soak ≈ 110 s in vitest (was ≈ 42 s before air operations, naval combat, intel caching and the AI's strategic operations were added) — still off the main thread in the worker | Hot spots added: `runAirOperations` (regionsInRange per wing), `zoneControl` per sea zone, `intelLevel` cache rebuild per state. See "Military depth pass" below. |
| 2026-11-02 | feat/research-tree | No new textures or draw calls; the research screen is ~81 DOM nodes + one SVG of ~110 links inside a CSS-transformed canvas (zoom/pan touch only the transform). Simulation: `scripts/soak.ts 36` ≈ 363 ms/turn in Node (2,300 units by turn 36). Research adds one cost breakdown per nation per month (allies cached, one pass over nations) and the AI technology war runs only on hash-drawn months | Starting technologies raise modifiers from turn 0 but add no per-turn work. |
| 2026-11-03 | feat/balance | No rendering changes. Simulation: `scripts/soak.ts 156 USA` 326 → 278 ms/turn (idle, one thread, Xeon 2.1 GHz vCPU); self-play (`npm run selfplay`, 3 workers) 331 ms mean, 602 ms p95 per AI turn, ≈ 110 MB heap per worker, 593 MB RSS in all | Research costs no longer loop over every nation per nation (sanction and export-control shares, diffusion); the supply heap swaps without allocating. See `docs/BALANCE.md` (D-081). |

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

## Military depth pass (D-059)

- Renderer: no new meshes. Fog of war is resolved in `buildStacks` when the state changes (one
  `intelLevel` lookup per foreign stack, cached per state); the per-frame loop only reads the
  precomputed symbol and count. The supply map mode writes the palette texture like every other
  mode; sea-zone control colours come from `zoneControl`, cached per state. Conventional missile
  arcs reuse the strike layer of D-057 (≤ 3 arcs per salvo, capped at 6 × the per-battle limit).
- Simulation (worker): the 120-turn soak rose from ≈ 42 s to ≈ 110 s in vitest. The additions per
  turn are `runAirOperations` (one `regionsInRange` flood per wing on a non-superiority mission,
  plus `airDefenceAt` over all units per intruded region, cached per region × intruder),
  `runNavalCombat` and `runCommerceRaiding` (indexed by zone), `runBlockades` (`zoneControl` per
  port zone, cached) and the AI's strategic operations (one scan of the regions per nation at war
  with missiles). Next wins if the turn time shows in play: index units by region once per turn and
  share it across `airDefenceAt`, `supportFor` and the AI; skip `runAirOperations` for nations with
  no wars.
- Rule kept: the baseline fps on the M3 (59.4 avg, DPR 1.3) must not fall. Nothing in this pass
  touches the globe shader or adds per-frame work on the main thread beyond the DOM panels.

## Economy depth pass (D-061)

- Simulation (worker): `runTrade` adds ≈ 35 ms per turn in Node (turn 353 → ≈ 370 ms on the
  seed-1 USA probe). First version cost 260 ms: string-keyed per-resource access checks and a full
  BFS per exporter–importer pair. Now pair access (policy × route) is computed once per turn into
  a `Float64Array`, routing is skipped when neither side has hostile or contested waters, BFS runs
  once per origin and blocked-zone signature over a prebuilt sea-only adjacency with typed arrays,
  and the six-pass allocation works on typed arrays. `GameState.history` adds ≤ 240 × 15 small
  samples (≈ 100 kB in a late save).
- Renderer: the trade layer is one additive ribbon mesh (≈ 175 routes, ≈ 20–40 k vertices) built
  only when the state or map mode changes and hidden outside map mode 4; per frame it updates one
  uniform. The resources map mode writes the palette texture like the others.
- The 240-turn soak in `src/sim/economy.test.ts` takes ≈ 150 s in vitest.

## Diplomacy AI pass (D-071, D-072, D-073)

- Budget: **turn < 400 ms** in Node. Before this pass the World of 2027 turn measured ≈ 360–560 ms
  on the dev container (player BRA, seeds 1–12). Profiling (`node --cpu-prof`) put `runSupply` at
  ≈ 45 % of the turn (≈ 110 ms per call, two calls a turn); the air cache rebuilt
  `Object.keys(units)` on every interdiction lookup; the geography memo built a version string
  per call. Fixes in D-073 cut the turn to ≈ 250 ms before the new systems.
- New per-turn work: strategy (13 majors; target selection every six months or when a plan lapses,
  cached military power per state), aid (≈ 70 candidate donors × the nations at war), blocs
  (cohesion from ≤ 15 pairs per bloc), UN (≤ 1 vote a month), memory decay (≤ 14 entries per
  holder). Together ≈ 20–30 ms.
- Result: the 10-seed × 24-month Ukraine calibration averages **≈ 287 ms per turn** (first
  turn ≈ 500 ms while V8 warms up). The calibration test asserts < 800 ms (1,200 ms on CI) because
  vitest runs files in parallel and contention inflates wall time.
- UI: the negotiation panel evaluates the draft deal on the main thread (pure function, < 1 ms);
  the UN tab forecasts 15 votes per render. No renderer changes.

## Escalation and events pass (D-074 – D-077)

- New per-turn work: due chain steps and at most one chain entry check (six chains), health
  checks for the 44 led nations, the nuclear aftermath (one pass over regions only while fallout
  exists), and the wire (one pass over the month's log). Together < 5 ms; the World of 2027 turn
  measured ≈ 315 ms over 30 months on seed 5 (dev container).
- UI: the Escalation screen computes DEFCON factors, second strikes and nuclear postures for ≈ 20
  powers per render (pure functions over the state); the News screen filters ≤ 150 stories.
