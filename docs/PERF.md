# Performance Budget & Log

**Target hardware:** Apple M3, 8 GB unified memory.

| Budget               | Limit                                            | Status (feat/perf-native, D-082/D-083)                                                                                                           |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frame rate           | 60 fps sustained on the globe view               | M3 baseline 59.4 fps at DPR 1.3 (Prompt 2). This pass lowers GPU work per frame (fewer passes, DPR capped by pixel budget, KTX2 sampling); **not re-measured on the M3** — see "How to measure on the Mac" |
| Process memory (RAM) | < 1.5 GB                                         | Native app, 20 turns: **1,244 MB peak** (Linux WebKitGTK build, software GL, PSS of app + WebKit processes). Chromium, 20 turns: 1,421 MB peak (SwiftShader). macOS figure comes from the `native` CI job |
| GPU texture memory   | < 400 MB                                         | **65 MB** (KTX2, was 225 MB); 33 MB on Low                                                                                                       |
| Single texture size  | ≤ 4096 px on its longest side; prefer KTX2/Basis | All ≤ 4096 × 2048; the five colour maps are KTX2 (UASTC/ETC1S); ID and height maps stay lossless PNG/JPEG (read on the CPU) — tested in `tests/data.test.ts` |
| Main thread          | No simulation work; the sim runs in a Web Worker | Yes — worker turn 403 ms mean, 593 ms p95 over 20 turns (headless Chromium, this container)                                                     |

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

runs `e2e/perf.spec.ts` (`PERF=1`; `PERF_SECONDS` sets the sweep length, default 15): it starts a
game as the USA, then at **Low, Medium and High** sweeps the camera through eight stops and records
frame time (avg, p95), **draw calls and triangles per frame** (summed over every pass, scene and
post-processing), JS heap, GPU texture MB (bytes actually uploaded, by format), DPR and canvas size;
then it plays **20 turns** recording the worker's turn time and the summed PSS of the browser's
processes after each. Output: `docs/perf-last-run.json`. In a browser the sweep alone is
`window.ww3.perf(20)`; `window.ww3.drawList()` lists every drawable in the scene.

### How to measure on the Mac (M3)

The development container is Linux with no GPU, so frame times here come from a software
rasteriser and say nothing about the M3. On the Mac:

1. `npm run perf` with Chrome installed (`PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
   uses the real GPU; drop the SwiftShader flags in `playwright.config.ts` for this run).
2. `npm run tauri build && npm run native:verify` — the packaged app, 20 turns, phys_footprint of the
   app and its WebKit processes (what Activity Monitor shows). The `native` CI job does the same on
   an Apple-silicon runner after every push to `main`.
3. Paste both into the log below.

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

| 2026-11-03 | feat/perf-native (before) | Headless Chromium 156 + SwiftShader, 1440 × 900, 12 s sweeps. **Low** 57 ms/frame, 3.2 calls, 5 k tris, DPR 0.6; **Medium** 355 ms, 25.6 calls, 44 k tris, DPR 1.0; **High** 1,844 ms, 26.7 calls, 104 k tris, DPR 1.8 (2591 × 1619 canvas). Textures 225 MB at every level; JS heap 81–87 MB. 20 turns: worker 414 ms mean / 654 ms p95; browser PSS 1,080 MB at start, 1,288 MB peak | Baseline for this pass. |
| 2026-11-03 | feat/perf-native (after) | Same setup. **Low** 78 ms, 3.8 calls, 7 k tris, 33 MB textures; **Medium** 251 ms, 16.1 calls, 16 k tris, 65 MB; **High** 259 ms, 19.0 calls, 51 k tris (sweep average; a still High frame at DPR 1 is 22 calls, 108 k tris), 65 MB, DPR capped at 1.65 and settling at 0.9 in software. JS heap 65–75 MB. 20 turns: worker 403 ms mean / 593 ms p95; browser PSS 1,045 MB at start, 1,421 MB peak | Frame times are SwiftShader's (the High gain is mostly the DPR cap). Software GL keeps decompressed copies of compressed textures, so the 160 MB texture saving barely shows in process memory here; on the M3 the textures stay compressed in unified memory. |
| 2026-11-03 | feat/perf-native (native) | `npm run native:verify` on the Linux build of the Tauri app (WebKitGTK 2.52, Mesa llvmpipe under Xvfb): **20/20 turns, peak 1,244 MB** (PSS of the app + WebKit web and network processes), worker 569 ms mean / 1,028 ms p95, 65 MB textures, no errors; 106 s | Same shell and frontend as the macOS bundle; macOS numbers come from the `native` CI job (`docs/native-verify-darwin.json` artifact). |

## Native and performance pass (D-082 – D-084)

- **Textures:** KTX2 for the five colour maps (UASTC day/normal, ETC1S night/clouds/bathymetry),
  region IDs packed RG8, height map R8 from the CPU copy: 225 → 65 MB (33 MB on Low, which drops
  the top mip). Transcoder workers end after loading; CPU mip copies are released after upload.
- **Draw calls:** ≈ 9 scene objects (one instanced mesh for all units, one merged border set, two
  front-line sets, globe, two cloud shells, atmosphere, stars) plus post-processing; bloom levels
  8 → 6 (High) / 5 (Medium). 26.7 → 22 calls on a still High frame.
- **Frame pacing:** on-demand rendering; full rate while anything moves, 30 fps after 8 s idle,
  15 fps after 60 s, 20 fps under a modal, none while hidden or minimised.
- **DPR:** capped by a pixel budget per preset (High 3.6 MP, Medium 2.2, Low 1.2) and by the
  display; resumes from the last settled DPR. No `preserveDrawingBuffer`.
- **Lazy screens:** 14 screens split into chunks (≈ 163 kB not parsed at startup).
- **Disposal:** layer materials/textures freed on replace/unmount; strike materials no longer leak;
  switching to/from Low disposes the previous texture set.
- **Audio:** the score streams from `<audio>` elements (no decoded PCM in memory); 7.5 MB of MP3 on
  disk.

## Known hot spots / next steps

1. Measure this branch on the actual M3 (Chrome, Safari and the native app; see "How to measure on
   the Mac") and record fps at full globe, Europe (dist 1.5) and Taiwan (dist 1.2). If below 60 the auto-scaler will first lower the DPR, then cap effects at
   Medium (one cloud layer's shadow, one wave octave) and Low (no aerial perspective, no smoke or
   wakes); record which cap it settles on. The largest per-pixel costs on High are the two
   atmosphere table lookups (4 taps) and the second wave octave.
2. Globe shader: 5 ID-map taps + 4 country-index taps per pixel for borders. Could be replaced by a
   precomputed border texture (one tap).
3. Labels overlay redraws every rendered frame; the cadence scheduler now limits that when idle.
4. ~~Code-split modals~~ (done, D-082). The world data chunk (1.6 MB) and the worker (1.8 MB) are the
   remaining large bundles.
5. ~~KTX2/Basis textures~~ (done, D-082).
6. The main thread keeps two full GameState copies (`game`, `previous`); the worker posts the whole
   state per command. Diffs would cut both memory and structured-clone time.

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
