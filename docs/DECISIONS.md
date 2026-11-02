# Decisions Log

Record every non-obvious decision here: ID, date, decision, why. Newest at the bottom.
Supersede rather than edit: add a new entry that references the old one and mark the old
entry `SUPERSEDED`. **`docs/DESIGN.md` (the design brief) wins over any entry here.**

## D-001 — 2026-11-02 — Design brief missing at bootstrap — SUPERSEDED

> **Superseded by D-014.** The design brief has now been received and saved verbatim to `docs/DESIGN.md`.

The bootstrap prompt's design-brief section was empty. `docs/DESIGN.md` holds a
placeholder asking for the brief. Decisions below are provisional and must be checked
against the brief once it lands.

## D-002 — 2026-11-02 — Toolchain versions

Vite 8, React 18.3 (pinned to 18 as requested; R3F 8 / drei 9 / postprocessing 2 are the
React-18-compatible lines), TypeScript 6 strict (+ `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), three 0.187, zustand 5, vitest 5, Playwright 1.64, ESLint 10
flat config + typescript-eslint, Prettier 3. Node ≥ 22.12 (`.nvmrc` = 22; CI uses 22). The bootstrap
prompt said "Node 20+". 22 meets that, and it is required: vitest 5 needs Node ≥ 22.12, and Node 20
reached end-of-life on 2026-04-30.

## D-003 — 2026-11-02 — Simulation architecture

`src/sim` is a pure, immutable reducer: `createGame(seed)` → `GameState`,
`applyCommand(state, command)` → new `GameState`. The state is plain data (safe for structured clone),
so it can be saved, replayed and diffed. It runs in a module Web Worker (`src/sim/worker.ts`);
`src/state/simBridge.ts` owns the worker and pushes each new state into a zustand store.
Later: move to sending diffs (patches) instead of whole states once the state gets big.

## D-004 — 2026-11-02 — Determinism is enforced by lint, not just convention

ESLint rules on `src/sim/**` ban `Math.random`, `Date.now`, `performance.now`, `new Date`,
DOM globals, and imports of three/React/zustand/render/ui/state. RNG is mulberry32 with
its uint32 state stored in `GameState`, so the RNG stream is part of the save.

## D-005 — 2026-11-02 — Calendar without `Date` — SUPERSEDED

> **Superseded by D-013.** With monthly turns the day-level days-from-civil algorithm is unnecessary; the calendar is now pure integer month arithmetic. The principle (no `Date` in `src/sim`) still holds.

In-game dates use a pure days-from-civil algorithm (`src/sim/calendar.ts`), so even
fixed-epoch calendar maths never touches `Date`.

## D-006 — 2026-11-02 — Turn length = 1 week; start date 2027-01-01 — SUPERSEDED

> **Superseded by D-013.** The brief's core loop fixes **1 turn = 1 month**, starting January 2027. Weekly turns conflicted with it.

Provisional. Weekly turns are a common middle ground between Civilization (years) and
Hearts of Iron (hours) for a global war. These values live in `data/scenario.json` and
`src/sim/game.ts`. Revisit once the brief arrives.

## D-007 — 2026-11-02 — `<Stat>` is the only way to show a number

`src/ui/Stat.tsx` requires a `tooltip` prop, so the type system enforces the "no number
without a tooltip" rule. Later: add a lint rule that flags bare numbers in JSX.

## D-008 — 2026-11-02 — Data validation is part of `npm run check`

`scripts/validate-data.ts` checks that every `data/**/*.json` has a top-level `source` and an
`asOf` date (YYYY-MM or YYYY-MM-DD). It runs inside vitest (`tests/data.test.ts`), so `check`
covers it.

## D-009 — 2026-11-02 — E2E is not part of `check`/CI yet — SUPERSEDED

> **Superseded by D-015.** E2E now runs in CI as its own job after `check`, at the owner's request. Local usage notes (`PW_CHROMIUM_PATH`, screenshot naming) still apply.

`npm run e2e` builds, serves on :4173, opens the game in headless Chromium with SwiftShader
WebGL, advances a turn and saves `docs/screenshots/<branch>.png`. It is kept out of
`check` so CI stays fast and doesn't need a browser. Set `PW_CHROMIUM_PATH` to use a
preinstalled Chromium. In this dev container that path is
`/opt/pw-browsers/chromium-1243/chrome-linux*/chrome`. The screenshot file name comes
from the git branch (slashes become dashes) or `SCREENSHOT_NAME`.

## D-010 — 2026-11-02 — Branch/merge flow

Work happens on `feat/*`, `fix/*` or `chore/*` branches and merges into `main` with `--no-ff`. The
cloud-session branch `claude/festive-tesla-vknpy1` is also pushed with the same commits so
the session's tracking branch stays in sync with the work.

## D-011 — 2026-11-02 — Placeholder globe

The globe is a plain-coloured sphere with stars and orbit controls. Real textures (NASA Blue
Marble / Black Marble, converted to KTX2 at ≤ 4096 px) come in Prompt 1, so no assets
without a clear licence ship at bootstrap.

> Still in force. The brief's Pillar 1 ("the globe is the star: photoreal, cinematic, alive")
> sets the bar the placeholder must eventually meet.

## D-012 — 2026-11-02 — Chunk-size warning raised to 2 MB

three + R3F + drei produce a single chunk of about 1 MB. The warning limit is raised for now;
code-splitting comes in the perf pass (see `docs/PERF.md`).

## D-013 — 2026-11-02 — 1 turn = 1 calendar month, campaign starts January 2027

Source: brief, "Core loop (1 turn = 1 month)" and "Fantasy" ("starting from the world as it
stands in January 2027"). Supersedes D-005 and D-006.

- `src/sim/calendar.ts` holds pure month arithmetic (`addMonths`, `isoYearMonth`) with no
  `Date` and no day-level maths.
- `src/sim/game.ts`: `START_DATE = { year: 2027, month: 1 }`, `MONTHS_PER_TURN = 1`.
- `GameState.date` is now a `YearMonth` (`{ year, month }`) plus `isoDate` (`"2027-01"`) for
  logs, saves and tests. This replaces the old `yyyy-mm-dd` string.
- The HUD shows the month by name ("January 2027") via `src/ui/format.ts`.
- `data/scenario.json` now has `startMonth: "2027-01"` and `monthsPerTurn: 1`.
- The brief's Deterrence victory ("survive to 2040") is therefore turn 156 (January 2040).
  A unit test pins this.

## D-014 — 2026-11-02 — Design brief adopted as the source of truth

`docs/DESIGN.md` holds the brief exactly as given. Supersedes D-001. When this log and the
brief disagree, the brief wins, and the conflicting entry is marked superseded here.
Requirements from the brief that bind future work:

- 14 playable majors (USA, China, Russia, India, UK, France, Germany, Japan, South Korea,
  Iran, Israel, Turkey, Pakistan, Brazil); about 195 countries; about 1,000 land regions (Natural Earth
  admin-1, merged) and about 150 sea zones.
- Real current leaders, researched and date-stamped, with 0–100 trait scores. Portraits are
  stylized cards, never photos. A **splash screen must state the game is a fictional simulation**.
- Map colouring uses the **region-ID texture technique** (an ID map plus a palette lookup in the
  shader), not per-region meshes.
- Data comes from public figures (IMF, SIPRI, FAS, IISS-style public estimates), each with
  `source` and `asOf` (already enforced by D-008).
- Native macOS packaging with **Tauri v2** is in scope. Until then the game runs as a Vite web
  app in the browser (see D-017).

## D-015 — 2026-11-02 — E2E runs in CI as a separate job

Supersedes D-009. `.github/workflows/check.yml` has two jobs: `check` (typecheck, lint,
test, build) and `e2e`, with `needs: check`. The `e2e` job installs Playwright Chromium (with OS
deps), runs `npm run e2e`, and uploads the screenshot and Playwright report as artifacts. It is
slower, which is acceptable. Local `npm run e2e` is still not part of `npm run check`.

## D-016 — 2026-11-02 — `docs/<topic>` branch prefix for documentation-only work

Extends D-010 and the CLAUDE.md branch rule. The owner asked for a `docs/design-brief`
branch, so documentation-only changes may use `docs/<topic>` alongside `feat/` and `fix/`.

## D-017 — 2026-11-02 — The owner plays locally on macOS

The owner runs the game on their Mac, not in the cloud container. `README.md` documents
the macOS steps: install Node 22 via Homebrew or nvm, then `git clone`, `npm install`,
`npm run dev`, and open `http://localhost:5173`. Anything that only works in the
container (for example `PW_CHROMIUM_PATH`) must stay optional.

## D-018 — 2026-11-02 — Tooltips explain _cause_, not just meaning

The brief says "every number has a tooltip explaining its cause". This tightens D-007:
`<Stat>` tooltips should say where the value comes from or what changes it (for example "advances one
month each time you end the turn"), not just restate the label. Later, once values come from
modifiers, tooltips should list the contributing modifiers.

## D-019 — 2026-11-02 — Map pipeline: Natural Earth admin-1 merged into ~1,000 regions

`scripts/build-map.ts` downloads Natural Earth 1:10m admin-1, 1:50m admin-0 and 1:10m populated
places (public domain, cached in `.cache/`, git-ignored) and merges the 4,596 admin-1 units into
1,012 land regions. Per-country target counts scale with `1.3·√(area/1e5 km²) + 1.3·√(pop/1e7)`,
globally rescaled to hit ~1,000, with majors forced to ≥ 20 (CHN 33, IND 27, RUS 26, USA 24).
Merging is greedy: the lightest unit (weight = ½ area share + ½ city-population share) merges into
its lightest topological neighbour (via `topojson.neighbors`), disconnected specks (< 5,000 km²)
merge into the nearest unit, and disconnected large islands (Hawaii, Alaska) stay separate.
Geometry is simplified with Visvalingam keeping 8% of vertices (quantised to 1e-5°), then rings
under ~4 km² are dropped unless they are a region's last ring. Output: `data/regions.topo.json`
(2.6 MB) and `data/regions.meta.json`. Generated files are committed so the game runs offline.

## D-020 — 2026-11-02 — Sovereignty and territory mapping

Natural Earth dependencies fold into their sovereign (Greenland → Denmark, Puerto Rico/Guam →
USA, Hong Kong/Macau → China, Falklands → UK, French overseas territories → France). Codes are
remapped to ISO 3166-1 alpha-3 (SDS→SSD, PSX→PSE, KOS→XKX). De-facto states not in the ISO list
fold into their de-jure state (Northern Cyprus → Cyprus, Somaliland → Somalia, Western Sahara →
Morocco as administering power, Siachen → India). Taiwan and Kosovo are independent nations.
Antarctica is one neutral, non-ownable region (`iso3: ATA`); Vatican City has a region but no
nation entry. Specks under 50 km² more than 300 km from any same-country unit are dropped.

## D-021 — 2026-11-02 — Sea zones by k-means over ocean pixels; adjacency from the raster

Instead of geometric Voronoi/clipping, 150 seeds are placed by k-means++ with Lloyd relaxation
(seeded mulberry32) over cos-latitude-weighted ocean pixels, and every water pixel takes its nearest
seed (a spherical Voronoi diagram in raster space). Adjacency (land–land, land–sea, sea–sea) comes
from scanning the 4096×2048 ID raster for neighbouring pixel pairs (≥ 2 shared pixels), plus eight
hand-listed straits and canals the raster cannot resolve (Bosporus, Suez, Panama, Gibraltar, Danish
straits, Hormuz, Bab-el-Mandeb, Kerch). Sea-zone names are basin + nearest coastal country.
Regions smaller than a pixel (micro-states) get their centroid pixel painted so they exist on the map.

## D-022 — 2026-11-02 — Textures: NASA JPG at 4096×2048, no KTX2 yet

`scripts/build-textures.ts` builds day (Blue Marble Next Generation, August), night (Black Marble
2016), a Sobel normal map from GEBCO_08 elevation, bathymetry and clouds. No Basis/KTX2 encoder
(`toktx`, `basisu`) is available in the build container, so the runtime loads JPG/PNG (D-011
updated). GPU texture memory is ≈ 180 MB with mipmaps, under the 400 MB budget. The ID map is an
uncompressed RGBA `DataTexture` with nearest filtering (ids must not be interpolated).

## D-023 — 2026-11-02 — Starting forces derived from public figures

Land formations = active personnel ÷ 25,000 (50% infantry, 25% mechanised, 15% armoured, 10%
artillery, +1 air-defence per 10), capped so upkeep stays within ~75% of real defence spending.
Air wings scale with spending; navies come from `data/forces.json`. Force quality =
`0.5 + 0.5·log10(spend per soldier in $k / 10)`, clamped 0.5–1.5, multiplying combat value and
(to the power 1.5) unit cost and upkeep, so poorer armies are cheaper to keep.

## D-024 — 2026-11-02 — Blocs as implicit defence pacts; proposals resolve immediately

NATO and CSTO membership counts as a defensive pact between all members (no 496 explicit treaty
rows); other obligations (US–Japan, US–ROK, US–Philippines, ANZUS, US–Taiwan posture, Russia–DPRK,
PRC–DPRK) are explicit treaties. Allies with alliance loyalty < 35 may stay out unless they are NATO
members. Player proposals are evaluated and answered in the same command (the AI reply and its
reason appear instantly); AI proposals to the player wait in `state.proposals` (max 4) for three
turns. Sanction pressure scales with the sanctioner's share of world GDP.

## D-025 — 2026-11-02 — Amphibious moves as "extra adjacency"

Marines and special forces may move from a coastal region to any land region sharing a sea zone,
provided the mover holds sea control there (friendly naval attack power ≥ enemy's, at least one
ship). This keeps movement one-step-per-turn and lets the AI use the same pathfinder (BFS over
regions + amphibious edges) without an embark/disembark state machine. Carriers and destroyers
provide the control; amphibious groups add transport flavour and strike support only.

## D-026 — 2026-11-02 — Economy scale

Money is USD bn. Monthly revenue = GDP × 28% ÷ 12 × share of population still controlled. Budget
shares sum to 100%: military pays upkeep first and the remainder flows to the treasury for
production; research → RP = 10·√($bn/month); infrastructure above 20% adds growth; social above
30% adds stability; debt service pays 4% interest first, shortfalls are borrowed. Debt above
250% of GDP triggers a default (debt halves, stability −12, growth −2 pp for 24 months). Treasury
cannot go negative. Growth is clamped to −15…+12% per year.

## D-027 — 2026-11-02 — Research as modifiers

Tech effects are summed into `nation.modifiers` (`landAttack`, `airPower`, `researchSpeed`,
`gdpGrowth`, `missileDefence`, …) and read by combat, economy and escalation. 40 techs in 8 branches
(5 tiers) for v1; the brief's ~80 come later.

## D-028 — 2026-11-02 — Tension, DEFCON and nuclear use

Flashpoint tension drifts toward a target set by the rivalry (war 95, relations < −80 → 72,
< −60 → 58, < −40 → 45, else 30; dead parties → 15) by ≤ 2/month. Global tension approaches
0.6 × mean flashpoint + 6 per major at war + 2 per mobilised major + 15 per detonation. DEFCON is
derived per nation (tension thresholds, war with a major, war with a nuclear power, lost territory).
Nuclear strikes need DEFCON 1 and a war with the target; the UI requires two confirmations. A strike
devastates the target's most populous region, costs 10 warheads, sets tension to 100, −35/−60
relations with everyone, −1 pp world growth for a year, and triggers retaliation with probability
0.55 + (100 − threshold)/120. Eight detonations is a full exchange: "nobody wins".

## D-029 — 2026-11-02 — Combat model

Per land region with units of nations at war: Lanchester-style, damage to a side = 3 × enemy
firepower, spread by strength. Firepower = Σ strength × attack/defence × quality × tech × terrain
(armour bonus; defender terrain ×, home soil ×1.3, entrenched ≥ 6 months ×1.25, total mobilisation
×1.1) × supply (0.6 if cut off), with attack saturating beyond 8 units (front width) and air/naval
support weighted by air superiority. Units below 20% retreat to a friendly neighbour or die; an
emptied region flips to the strongest attacker (or back to an allied owner: liberation). Supply is a
BFS from the capital through friendly land. Capitulation: capital lost and ≤ 30% of population
controlled → regions pass to their occupiers, units disband, the victor gains 30% of the GDP.

## D-030 — 2026-11-02 — Event DSL

Events in `data/events.json` and inside `data/flashpoints.json` share one effect vocabulary
(relation, tension, flashpoint, stability, treasury %GDP, gdp %, growth modifier, sanction, war,
peace, defcon, research, units, mobilize, warheads, news) and condition vocabulary (atWar,
tensionMin/Max, flashpointMin/Max, stabilityMin/Max, relationMin/Max, hasBloc, isNation, notNation,
hasNukes, minTurn/maxTurn, notCapitulated). Player-scope events queue as modals (one per month,
35% + tension/400 chance); world-scope events pick a random eligible subject and apply their first
choice. Unanswered events take option 1 when the turn ends.

## D-031 — 2026-11-02 — Victory thresholds

Hegemony: player + defence partners ≥ 55% of world GDP and ≥ 35% of population. Conquest: all
13 rival majors capitulated. Diplomatic: a World Order Resolution passed (≥ 60% of other nations'
GDP with relations ≥ 15, no P5 veto below −30) while the bloc holds ≥ 45% of world GDP. Deterrence:
January 2040 reached as the largest economy with zero detonations. Defeat: capitulation, stability
< 10 for three months, or eight detonations. Checks start at turn 12.

## D-032 — 2026-11-02 — AI

Every non-player nation each turn: budget from traits (aggression → military, economic priority →
research/infrastructure, threat → military), mobilisation from war status, research by branch
weights, production while treasury > reserve and upkeep < 85% of military budget (disbands when over
130%), attacks on adjacent enemy regions when odds ≥ 1.05–1.5 (lower for risk-tolerant leaders),
reinforcement of the weakest front (capped at 60% of the army), fleets toward enemy coasts when
stronger, peace when weariness ≥ 70 or < 50% of home territory held, pacts/trade/sanctions by
relation thresholds, war declarations with probability (aggression/100)² × 0.04 × flashpoint
multiplier against hostile neighbours when the power ratio favours it (×0.15 against nuclear powers
without nukes of one's own), and nuclear use only at DEFCON 1 when collapsing. Each nation records a
one-line `aiNote` shown in the UI.

## D-033 — 2026-11-02 — Reducer clones once, then mutates

`applyCommand` does `structuredClone(state)` once and lets subsystems mutate the copy. The public
contract stays pure (tests assert the input is untouched); internals stay simple and fast. Per-turn
caches (`controlShare`, allies, upkeep) are `WeakMap`s keyed by the state object and invalidated by
`regionsVersion` / `diplomacyVersion` counters stored in the state. A turn takes ~150 ms in Node.

## D-034 — 2026-11-02 — Region-ID texture technique

`public/textures/regions-id.png` encodes the region id in R (low byte) and G (high byte) and a land
flag in B. The globe shader decodes the id and samples a 2048×1 RGBA palette `DataTexture` for fill
colour/alpha (one texel per region; a map-mode change rewrites the palette, an ownership change
rewrites one texel). A second 2048×1 texture maps region → nation index so the shader can draw
thicker country borders by comparing nation indices of neighbouring texels; region borders compare
ids and fade out when zoomed out. Picking reads the same PNG into a `Uint16Array` on the CPU.

## D-035 — 2026-11-02 — Globe shading

Single `ShaderMaterial`: Lambert diffuse with a tangent-frame normal map, day/night blend with a
soft terminator, Black Marble lights on the dark side, Blinn-Phong ocean glint with a Fresnel tint,
bathymetry-deepened ocean colour, cloud shadows from the cloud map (offset by the cloud rotation),
political overlay, borders, hover/selection and an in-surface rim. A back-facing shell draws a
Rayleigh-style limb (blue on the lit side, orange band at the terminator); a separate cloud sphere
rotates slowly. Country borders are additionally drawn as `LineSegments` from the TopoJSON mesh so
they stay crisp at 300 km altitude. Post-processing: bloom, vignette, ACES tone mapping.

## D-036 — 2026-11-02 — Camera

A custom rig (not drei `OrbitControls`): spherical lat/lon/distance with exponential damping and
inertia, log-scale wheel zoom between distance 1.05 (≈ 320 km) and 4.2, drag speed proportional to
altitude, fly-to via damped targets, and a tilt toward the horizon below distance 1.6. Left-click
selects, right-click orders selected units. Camera near plane scales with altitude.

## D-037 — 2026-11-02 — Labels on a 2D canvas overlay

Country, capital, city, region and sea-zone labels are drawn on one `<canvas>` over the WebGL
canvas each frame: projected, back-face culled against the limb, faded by zoom bands, sorted by
priority and placed with AABB collision culling. No per-label DOM nodes.

## D-038 — 2026-11-02 — Units and strikes

Unit stacks (one per region × owner) are instanced camera-facing quads with per-instance atlas UVs.
milsymbol renders MIL-STD-2525C symbols (friendly/hostile/neutral relative to the player) with a
count badge into a 2048² canvas atlas on demand. Stacks that moved animate along a great circle for
1.4 s. Battles produce flash sprites and strike arcs from the attacker's previous region; nuclear
strikes draw a high arc with a large flash. Far from the globe, only the player's units show unless
the military map mode is active.

## D-039 — 2026-11-02 — Audio synthesised, no files

UI clicks, order/accept/reject tones, end-turn, alert stingers, battle noise and a nuclear rumble
are synthesised with WebAudio oscillators and filtered noise; a four-oscillator ambient drone starts
with the first game. Mute lives in the UI store.

## D-040 — 2026-11-02 — Quality presets and dynamic resolution

Low/Medium/High set max DPR (1/1.5/2), sphere segments (96/160/256), anisotropy and whether the
post-processing chain runs (Low uses renderer ACES tone mapping instead). High is the default (M3).
A frame-time EMA lowers DPR by 0.1 steps when frames exceed 18 ms and raises it slowly below 12 ms.
The preset is stored in `localStorage`.

## D-041 — 2026-11-02 — Saves

Autosave to IndexedDB (idb-keyval) after every state change; named slots; JSON export/import. The
state is plain data, so a save is the `GameState` verbatim (`version: 1`).

## D-042 — 2026-11-02 — Leader cards without likenesses

Cards show flag emoji, name, title, party/since, trait bars and the public-record rationale from
`data/leaders.json`, with a procedural SVG portrait (concentric geometry in the nation's accent). No
photos. Nations without a researched leader use `DEFAULT_TRAITS` and a generic title.

## D-043 — 2026-11-02 — Lint exemptions for render code

eslint-plugin-react-hooks 7 ships React Compiler rules (`immutability`, `purity`, `refs`) that flag
mutating three.js objects inside `useFrame`. Those rules and `react-refresh/only-export-components`
are off for `src/render/**`; everything else keeps the full rule set. `src/sim/worker.ts` and sim
tests may read `performance.now` for timing; the simulation modules still may not.

## D-044 — 2026-11-02 — Scenario start state

"World of 2027": Russia–Ukraine at war since 2022 (turn −34) with Donetsk/Luhansk (one merged
region) under Russian control, weariness 30/35, existing sanctions on Russia, North Korea, Iran,
Cuba, Venezuela and Syria. "Taiwan Strait Crisis": same world with Taiwan tension 90, US–China
−78, PLA reinforcements and amphibious groups in the strait, three US carrier groups moved west.
Seeds come from the clock at New Game; everything after is deterministic.

## D-045 — 2026-11-02 — The sun follows the camera

The sub-solar longitude is the camera longitude + 38° (plus a slow ±12° real-time sway), with the
declination from the in-game month. The viewed hemisphere is therefore always in afternoon light
with the terminator and city lights visible at the limb, instead of the player's country spending
half of real time in darkness. Astronomically wrong, deliberately: readability of the political map
wins over simulating the time of day.

## D-046 — 2026-11-02 — Performance probe in the app

`window.ww3.perf(seconds)` (installed by `src/render/perf.ts`) sweeps the camera through eight
stops and resolves with average/p95 frame time, fps, JS heap (Chrome only), texture count and the
estimated GPU bytes of uploaded textures. `npm run perf` runs it under Playwright and writes
`docs/perf-last-run.json`. Headless SwiftShader numbers are recorded in `docs/PERF.md` as
non-representative; the M3 figures must be measured on the owner's machine.
