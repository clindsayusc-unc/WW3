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

## D-027 — 2026-11-02 — Research as modifiers — PARTLY SUPERSEDED

> **Extended by D-079:** 81 techs in five eras, unlocks, abilities, starting capability, a queue,
> theft, sharing and export controls. Effects are still summed into `nation.modifiers`.

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

## D-039 — 2026-11-02 — Audio synthesised, no files — PARTLY SUPERSEDED

> **Drone and noise sources superseded by D-060.** Sounds are still synthesised with no files, but
> only from sine and triangle tones; the ambient drone is gone.

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

## D-047 — 2026-11-02 — Balance pass from multi-seed soaks

Headless soaks (`scripts/soak.ts`, six seeds) showed Ukraine falling in 7–10 months. Causes and
fixes: (1) the occupied Donetsk region had no Russian garrison because starting units were placed
only in owned regions — units are now placed in every controlled region, with extra weight for
occupied ones; (2) the AI's odds estimate ignored the defender bonuses the battle applies (home
soil, entrenchment, mobilisation, supply, front-width congestion), so Ukraine's AI attacked into
Rostov at ruinous odds — `estimateOdds` now mirrors `runCombat`, for the AI and the player's odds
display alike; (3) entrenchment raised to ×1.5, front width to 6 units with a (6/n)^0.7 saturation;
(4) capitulation needs the capital in enemy hands for three consecutive months. Result: Ukraine
survives in 6/6 seeds, holding 3–4 of 7 regions at a negotiated peace after 5–8 months.

## D-048 — 2026-11-02 — Log noise and proposal frequency

AI-to-AI trade agreements between non-majors are executed silently (they still affect relations
and growth); rejections are logged only when a major or the player is involved. AI trade proposals
run at 1.5%/pair/month (0.6% toward the player) so the player's inbox holds a few meaningful offers
rather than a flood. Starting garrisons weight the capital by +0.08 population share instead of
+0.3, so the capital holds a strong but not overwhelming share of the army.

## D-049 — 2026-11-02 — The playable leader is whoever directs foreign and defence policy

Supersedes the leader choice in D-042. `data/leaders.json` gains an `effectiveLeader` per entry
(`name`, `title`, `party`, `since`, `role`, `basis`), and the playable leader card, the AI
personality (`traits`, `rationale`) and `NationState.leaderName` all follow it:

- parliamentary systems and constitutional monarchies → the head of government (UK, Germany,
  India, Japan, Israel, Pakistan, Italy, Spain, Canada, Australia, …);
- Iran → the Supreme Leader (`role: supremeLeader`);
- presidential and semi-presidential systems where the president directs foreign and defence
  policy → the president (USA, Russia, France, South Korea, Turkey, Brazil, Finland, …);
- one-party states → the paramount party leader; ruling monarchies → whoever actually runs policy.

The head of state (and a third-person head of government) stays as a secondary field: shown on the
full leader card and under the card in the nation panel, with the `basis` as tooltip. The loader
throws when an entry lacks a valid `effectiveLeader` — there is deliberately no fallback to the head
of state, which caused the bug. `tests/leaders.test.ts` checks every major, the parliamentary and
Iranian cases, internal consistency and that the world/game objects use the effective leader. Saves
made earlier get their leader names refreshed on load (`refreshLeaders`). All 44 entries were
re-verified by web search on 2026-11-02.

## D-050 — 2026-11-02 — Real terrain, supply as a level, and movement that costs

Terrain is no longer a latitude heuristic. `scripts/build-geography.ts` reads NOAA ETOPO 2022 (2′
stride via OPeNDAP) and NASA MODIS IGBP land cover (via GIBS imagery + colormap) over the region-ID
raster and writes `data/terrain.json`: mean/std/max elevation, a ruggedness index (mean |Δz| to the
four 3.7 km neighbours), land-cover shares and a `terrain` class (plains, hills, mountains, desert,
jungle, forest, marsh, urban, arctic, ice; rules in the file). The old `terrain` table in
`data/units.json` is gone; combat, movement and supply rules live in `src/sim/terrain.ts` and are
documented in `docs/BALANCE.md`. Supply is now a level 0..1 per region (`RegionState.supply`,
`supplied` kept as `≥ 0.25` for the UI and old saves): depots are a nation's own regions, supply
decays per hop by terrain × infrastructure (+ river/mountain crossings), crosses the sea from ports
through convoy-safe zones (submarines cut it) and is capped by the destination port. Units bank
movement points (`Unit.moveProgress`) because mountains, jungle and winter cost more than a month.
Old saves are migrated on load (`refreshLeaders`).

## D-051 — 2026-11-02 — Crossings, oceans, depth and seasons

`data/crossings.json` lists, per adjacent land pair, rivers that run along the border (Natural
Earth 10m rivers, scalerank ≤ 7), mountain borders (Natural Earth range polygons or ETOPO border
ruggedness ≥ 120 m) and hand-listed passes (Khyber, Khunjerab, Nathu La, Brenner, Darial, …).
Attackers pay the crossing penalty only on the hop in; units already inside (a bridgehead) do not;
the "Combat Engineering & Bridging" tech halves it. Landings require sea control of every zone on
the route, a shared connected water body (the Caspian is not the Gulf even where a k-means sea zone
spans both — `waterBodies` in `data/terrain.json`), a distance bound (700 km self-lift, 2,000 km
with amphibious groups) and lift (two formations per amphibious group per month; marines and
special forces lift themselves across one zone). Assaults from the sea fight at ×0.5 (×0.7 with sea
dominance and air superiority) against ×1.3 coastal defence, and live off the beach (35 % supply)
until a port is taken. Occupiers suffer partisans scaled by depth from their own soil and by the
size of the occupied country; recovery in occupied territory is a third of the home rate and zero in
deep winter. Weather per region and month comes from a MERRA-2 2023 climatology
(`data/climate.json`); winter, monsoon and heat indices drive attack, air, movement and attrition.
The calibration scenarios in `src/sim/scenarios.test.ts` pin the outcomes; ranges and reasoning
are in `docs/BALANCE.md`.

## D-052 — 2026-11-02 — Chokepoints as state

Twelve maritime chokepoints (`data/chokepoints.json`) resolve onto sea zones and shore regions.
`GameState.chokepoints` holds status (open / contested / closed), the closing nation and mines;
`GameState.oilPrice` is an index derived from closures. A shore controller at war may close a
strait (`chokepoint` command; the AI closes when an enemy depends on it more than it does); ships
in the strait may mine or sweep it. Closed straits block hostile fleets and convoys (`stepKind`,
`seaRoute`, supply); enemy naval dominance in every adjacent zone contests a closure. Economics:
oil shocks hit importers and reward exporters, listed dependents lose growth, and closing the
Taiwan Strait or Malacca slows research and raises production costs for semiconductor importers.
Zone names in `data/regions.meta.json` are still basin + nearest country from D-021 and are
sometimes odd (the Persian Gulf is "Arabian Sea — Oman"); fixing sea-zone generation is a
separate task.

## D-053 — 2026-11-02 — Terrain map mode, chokepoint overlay, explained odds

Map mode 7 "Terrain" tints each region by land cover and shades it by elevation (palette texels,
no new textures). The label canvas draws chokepoint icons (anchor / ! / ✕ in green, amber, red,
toggled with C). The worker's `odds` reply is now an `OddsReport`: attacker and defender modifier
lists (terrain, crossing, amphibious assault, weather, supply, home soil, entrenchment, coastal
defence, mobilisation, quality, tech, front width, air and naval support) with a sentence each, plus
a route preview (per-step movement cost and supply, months to arrive). The context panel shows the
region's terrain, relief, land cover, infrastructure, ports, supply, this month's weather and the
year's climate, crossing features toward the other highlighted region, and chokepoint status with
close / reopen / mine / clear buttons on the strait's sea zone. `window.ww3` is merged, not
replaced, by the app so the renderer's `perf()` survives a game start.

## D-054 — 2026-11-02 — Cinematic globe: precomputed atmosphere, living ocean, two cloud layers, terrain relief

Supersedes the rim-shell and ocean parts of D-035. `src/render/atmosphere.ts` precomputes, once at
load (≈ 100–400 ms, half-float tables, 0.6 MB GPU), a Bruneton-style transmittance table
T(r, μ) (256 × 64) and a single-scattering table (512 × 128: view cosine by impact parameter with the
ground-hitting half and the limb half each getting 64 rows, × sun cosine (exponential mapping over
[−1, 1]) × 16 slices of ν = cos(view, sun); RGB Rayleigh, A Mie, phase functions applied at run
time). Because the camera can never enter the atmosphere (`MIN_DISTANCE` 1.05 > top of atmosphere
1.0235), every ray starts at the top boundary, so the table needs no radius dimension and no
subtraction trick: the limb shell looks the entry ray up directly, and the surface and clouds use
`colour × T(entry → ground) + inscatter` for aerial perspective. Heights are scaled ×2.5
(`ATMOSPHERE_SCALE`) so the limb reads from orbit; scattering coefficients are divided by the same
factor so vertical optical depths stay physical (zenith transmittance 0.95/0.89/0.76). Sunlight on
the ground is tinted by the same transmittance (orange at the terminator); a warm "twilight" ambient
band stands in for the multiple scattering a single-scattering table lacks. The in-scatter on
ground rays is scaled to 0.22 (`uAerial`) because the physically correct blue haze washes the
political map out from 1,400 km up.

Ocean: a 256² tileable wave normal map is generated procedurally at start-up (`waves.ts`, sines
plus hashed value noise, no asset) and sampled in one or two scrolling octaves whose strength grows
as the camera descends; GGX glint with the atmosphere-tinted sun, Fresnel sky reflection, three-band
depth tint from the GEBCO bathymetry and seasonal sea ice (edge broken with cloud-texture noise).
Clouds: the same NASA cloud map drawn twice — a lower layer and a mirrored, slower upper layer at
1.011 — for parallax; both cast shadows projected along the sun; `src/sim/storms.ts` (deterministic
per seed/turn, tropical basins by season plus mid-latitude lows) adds up to eight spiralling storm
systems that drift along their monthly track in real time (cosmetic; `stormAt()` is the hook for air
operations). Terrain: `earth-height.jpg` (GEBCO_08, 2048 × 1024) displaces the sphere vertices by up
to 0.0035 (≈ 22 km, Everest ×2.5) as the camera comes closer; borders, front lines, arrows, fires
and unit sprites follow the same displacement through a CPU copy of the height map
(`terrainHeight.ts`). Snow line and sea ice follow latitude, elevation and the in-game month
(hemispheres mirrored).

## D-055 — 2026-11-02 — Every effect has a Low/Medium/High level; the auto-scaler caps them

Extends D-040. `src/render/quality.ts` defines five effect keys (atmosphere, ocean, clouds, terrain,
war) with a level each; the quality preset sets all five and each can then be overridden in
Settings (persisted in `localStorage` as `ww3.effects`). Levels are compiled into the shaders as
`#define`s (a change recompiles the globe and cloud materials) and read by the war layers for
particle density, glow and trail counts. `DynamicResolution` still steps the DPR down at 18 ms
frames; when the DPR floor is reached and frames stay above 20 ms for 2.5 s it lowers a global cap
(high → medium → low) that every level is clamped to, and it lifts the cap again only after 15 s of
fast frames at full DPR. The cap is shown in Settings ("Auto-scaler active").

## D-056 — 2026-11-02 — Cinematic camera

Replaces the damped fly-to of D-036 with timed flights: duration from the angular distance and the
zoom change (0.7–2.8 s), smoother-step easing, log-space zoom, and on flights longer than 25° a
zoom-out bump proportional to the distance so the globe swings past instead of sliding. Drag,
wheel and inertia keep the exponential damping. The main menu orbits slowly with a sinusoidal
latitude drift and a breathing zoom. Strike cam: nuclear launches (the only state-recorded strikes)
can request a chase camera that trails the missile head behind and above it, lingers on the
impact, then flies to the target at distance 1.35. Any click, wheel or key skips it; the "Strike
cam" toggle in Settings (`ww3.strikeCam`) disables it. The sub-solar offset of D-045 is now a
store value (`sunOffset`, default 38°) so screenshots and future lighting modes can put the
terminator anywhere.

## D-057 — 2026-11-02 — War visuals

- Front lines: TopoJSON mesh edges between regions whose controllers are at war, rebuilt when
  control, treaties or wars change; drawn with `LineSegments2` as an animated dashed ember line
  over a wider additive glow (bloom picks it up), width and glow scaling with zoom and fading from
  orbit.
- Offensive arrows: for each of the player's stacks whose path ends in an enemy-controlled land
  region, a curved tapering ribbon with an arrow head and a scrolling stripe (one mesh, normal
  blending with a dark outline so it reads on bright terrain).
- Burning regions: a region attribute texture (2048 × 1: devastation, burning, at war) lets the
  globe shader dim night lights by devastation (−85 % at full), scorch the daytime albedo and add
  an ember glow; `Fires.tsx` scatters flickering additive point lights (count by level and
  intensity) and slow rising smoke particles (normal blending) inside each burning region.
  Burning = a battle or strike there last turn, else lingering fires scaled by devastation.
- Wakes: carrier, destroyer and amphibious stacks in sea zones get a tapered foam ribbon aligned
  with their last move (or a stable hashed heading), scrolling and following the arrival
  animation; submarines leave none.
- Missiles: support fire into each battle is inferred from the previous state (aircraft within
  range, ships in adjacent zones; up to 4 arcs per battle on High) and drawn with a launch flash, a
  bright head with a fading trail (per-vertex progress attribute) and either an impact flash or an
  interception burst with an expanding ring mid-course. Interception chance = the target
  controller's missile-defence modifier × 2.2 + 0.12 per air-defence unit (capped 0.8), decided
  by a hash so it is stable per turn. Nuclear strikes fire a salvo of three.

## D-058 — 2026-11-02 — Enclosed seas are their own, correctly named sea zones

Resolves the naming problem noted in D-052 and refines D-021. `scripts/fix-sea-zones.ts`
post-processes the region-ID raster: 26 enclosed and marginal seas (Persian Gulf, Gulf of Oman, Red
Sea, Gulf of Aden, Black Sea with Azov, Caspian, Baltic with Kattegat, North Sea with Skagerrak,
Western Mediterranean, Tyrrhenian, Adriatic, Ionian with the Gulfs of Sidra and Gabès, Aegean with
Marmara, Levantine, Yellow Sea with Bohai, Taiwan Strait, East China Sea, Sea of Japan, Sea of
Okhotsk, Bering Sea, Gulf of Mexico, Hudson Bay with Ungava, Gulf of California, Gulf of Thailand,
Java Sea, Andaman Sea) are flood-filled from seed points inside a hand-drawn polygon that stops at
the connecting strait, so a fill can never leak past a strait the raster does not resolve. Inland
water the world ocean cannot reach (Great Lakes, Baikal, Victoria, Balkhash, the Aral…) is no longer
sea at all: those pixels join the nearest land region, so lakeside regions are not "coastal" and
navies cannot sit in Lake Baikal. Leftover k-means slivers under 400 pixels fold into the
neighbouring zone with the longest shared edge; zones are renumbered compactly (land ids unchanged,
sea ids 1013–1184; `enclosed: true` marks the carved seas); adjacency is recomputed from the raster
plus the hand-listed straits (Skagerrak and Messina added, the Danish straits now link North Sea
and Baltic); open-ocean names stay "basin — nearest country" with more basins (Barents, Norwegian,
Labrador, Philippine, Coral, Tasman, Weddell…). Chokepoint zones are re-resolved from the same
probes (Hormuz = Persian Gulf | Gulf of Oman, Turkish straits = Black Sea | Aegean, Danish straits
= North Sea | Baltic). The Taiwan Strait Crisis scenario now places the PLA Navy in the Taiwan
Strait zone and the US carriers in the East China Sea by name. Tests resolve zones by name instead
of id. Named seas are labelled on the globe in every map mode.

## D-059 — 2026-11-02 — Military depth: supply network, fog of war, air, naval, strategic operations

The warfare layer gains depth without new data files; every rule is read back to the player through
battle odds, battle reports and tooltips. Modules: `src/sim/intel.ts`, `air.ts`, `naval.ts`,
`strikes.ts`, `commanders.ts`; `military.ts` and `game.ts` extended. Turn order is now AI → economy →
production → research → space/missile tick → intel tick → supply → air operations → movement →
naval combat → land combat → supply → attrition → recovery → commerce raiding → blockades →
capitulations → chokepoints → diplomacy → tension → events.

- **Supply network.** Depots are no longer every owned region but the capital, industrial regions
  (≥ 5 % of the nation's population, or infrastructure ≥ 0.75 with ≥ 2 %) and major ports
  (`isDepot`). Supply spreads from them along owned and allied land and controlled sea zones as
  before (D-050); home regions linked to the capital never drop below `HOME_SUPPLY_FLOOR` 0.55.
  Bombed infrastructure (`RegionState.infraDamage`, from missile strikes and strategic bombing,
  −5 %/month recovery) raises the per-hop loss and caps port landings; enemy interdiction wings
  multiply the final level by 1 − 0.15/wing (floor 0.55). Out-of-supply units lose 4 strength and an
  extra 4 morale a month. Map mode 8 "Supply" shades land by level with depots brightened and sea
  zones by the controlling fleet (amber = contested).
- **Fog of war.** `intelLevel(viewer, region)` ∈ 0..4: own/allied territory or units 4; adjacent
  2; plus a global bonus from satellites (+1 at ≥ 1.5 effective, +2 at ≥ 5), ISR techs (`intel`
  modifier, up to +2), recon wings over the region (+2), a spy network on the controller (+1); minus
  the controller's `enemyIntel` (counterspace), −1 when at war with the controller, −2 while
  cyber-blinded. Allies share coverage. Foreign stacks render only above level 0, as a generic
  domain symbol with an estimated count below level 3; the context panel shows count bands, and
  `estimateOdds` reports a band and "little intelligence" below level 3. The AI is omniscient: it
  reads the full state, as before. Spy operations cost 0.04 % of GDP for 6 months of coverage.
- **Air war.** `Unit.mission` for wings: superiority (full air-to-air, normal strike weight), cas
  (×1.5 strike, ×0.4 air), interdiction (supply −15 %/wing, +2 attrition on enemy movers in range),
  bombing (the most valuable enemy region in range: +0.02 devastation and +0.04 infrastructure
  damage per wing-sortie), recon (intel +2). `missionsFor(type)` restricts them (bombers cannot
  sweep, fighters cannot bomb). Any wing flying over the enemy is intercepted: loss = 5 × air
  defence (air-defence brigades in the target, superiority fighters within one step, ships
  alongside) ÷ (air-power tech × (1 + 0.6 × escorts)), bombers ×0.8, drones ×1.2, CAS ×1.2, recon
  ×0.6, capped at 25. Air superiority is a visible modifier on both sides of every land battle:
  ×(0.85 + 0.3 × share). Carrier groups project strike and air weight one zone beyond their own at
  half weight.
- **Naval war.** `zoneControl`: the strongest allied fleet controls a zone when it has at least
  twice the power of every fleet at war with it, otherwise the zone is contested. Hostile fleets in
  one zone fight (`runNavalCombat`, K = 2; submarines hit surface groups at ×1.3 and are hit at
  ×0.5 except by destroyer groups; ships below 25 % withdraw) and write a sea battle report.
  Submarines in a zone raid the trade of enemies whose ports open on it (−0.25 pp growth per
  sub-month per victim, capped 1.5, unless escorts are present, which instead cost the sub 4
  strength each). A nation whose ports (≥ 50 % of capacity) all face enemy-controlled zones is
  blockaded: growth −2 × share, research ×0.85, production cost +10 %. Amphibious hops now carry a
  preparation timer (`Unit.prep`: 1 month for marines and special forces, 2 for others) instead of
  the 1.5-point hop cost; the route preview says so.
- **Strategic strikes.** `NationState.missiles` starts at defence spending ÷ 2 (cap 400) and grows
  by spending ÷ 50 a month (more with strike tech and mobilisation). A strike fires a salvo of 8 at
  a region of a nation at war; each missile is intercepted with probability
  min(0.8, 2.2 × missileDefence + 0.12 per air-defence brigade + 0.1 if any defence) × (1 −
  strikePower), the same formula the renderer used for its arcs (D-057), which now draw the
  state's real launched/intercepted counts. Hits: infrastructure +6 % damage each; industry +3 %
  devastation each and a one-month production stall at ≥ 4 hits; military 3 strength per hit over
  the units present. Tension +2, relations −6.
- **Cyber and space.** Cyber operations (3-month cooldown): success 0.4 + cyberAttack −
  cyberDefence; economy −1.5 pp for 3 months, intel blinds for 2 months, production +1 month on
  every queued item; attribution 60 % (less with attack tech) costs 12 relations. Satellites
  (`NationState.satellites`, start = spending ÷ 40 + 2 if nuclear, cap 16; launches $2.5 bn, ×0.6
  with Reusable Launch Cadence, cap 24) drive the global intel bonus. ASAT needs Counterspace
  Capabilities and a war, destroys up to 30 % (max 4) of the target's satellites, costs 30
  relations with the target and 8 with everyone else, and adds 12 debris per satellite to
  `GameState.debris`, which decays 1/month, degrades every constellation's sensors (−40 % at 60)
  and destroys a satellite with probability debris ÷ 400 per satellite per month — the shooter's
  included.
- **Experience and commanders.** `Unit.experience` 0..100 (10 at start, 35 for armies already at
  war, +6 per battle survived, +5 per fleet action) gives ×(0.95 + 0.25 × xp/100). 35 % of new land
  formations get a generated commander (`maybeCommander`, names from region-keyed syllable pools,
  always `fictional: true`): aggressive +10 % attack / −5 % defence, defensive +10 % defence,
  logistician +15 supply points, cautious −12 % losses / −5 % attack.
- **Battle reports.** Every land and sea battle writes a `BattleReport` (sides with unit types and
  strength before/after, strength-weighted modifier lists, air superiority share, firepower,
  losses, outcome) kept for the last turn; the battle alert and the monthly summary open the
  battle modal. The military screen gains Overview (strength by domain vs every major: land, air,
  sea, strategic = warheads/10 + missiles/20 + 2 × satellites), Air wings (mission per wing),
  Operations (target, missiles, cyber, spies, ASAT, satellite launches) and Intelligence tabs.
- **AI.** Wings pick missions by type and whether the enemy is in range; missile strikes at
  15 % + aggression/400 per month on the enemy region with the most troops (military) or value
  (infrastructure/industry); cyber operations at 8 % + paranoia/1000 against enemies and hostile
  majors; satellites are replaced while the treasury allows; ASAT at 6 % + risk/1000 with the
  tech; spies on the main threat.
- **Calibration.** The Korean DMZ scenario adds four KPA air-defence brigades (the SAM belt) and
  pins combined losses (> 500), Gyeonggi falling no earlier than month 3 and at least ten
  battles instead of the attacker's losses alone: the ROK corps used to hop across the Yellow Sea
  the month the war began, emptying Gyeonggi for the KPA to walk into and counter-attack; with
  the two-month preparation timer it leaves later and the bill is shared differently (23 battles,
  attacker −367, defender −284; Seoul still holds). The other eight scenarios kept their ranges
  unchanged. The AI also drops orders whose first step became impossible since they were given
  (liberated regions, peace deals) before planning, which `sim.test.ts` requires.
- **Saves** from before this entry are migrated in `refreshLeaders` (experience 10, superiority
  missions, no commanders, satellites and missiles from spending, empty reports).

## D-060 — 2026-11-02 — Ambient music bed and clean-tone sound effects

Supersedes the drone and the noise buffers of D-039. The four-oscillator drone read as hiss and is
removed. Audio is one WebAudio graph (`src/ui/audio.ts`): Master → Music bus and Effects bus, with
three volumes and a music switch persisted in `localStorage` (`ww3.audio`, D-040 style) and shown as
sliders in Settings and on the main menu; the mute toggle zeroes the master without losing the
values; slider positions are squared into gains so they feel linear.

- **Music** (`src/ui/music.ts`) is composed procedurally from clean tones only (no noise sources, no
  samples, no square or sawtooth waves): four pad voices (sine + detuned sine + soft triangle
  octave) swelling over 3.5 s through a slow chord progression in D minor (Dm add9, B♭maj7, Fmaj7,
  Cmaj7, Am7, Dm), a sub-bass on the root, and sparse piano-like notes (triangle with a sine octave,
  3 s decay) from a seeded generator, all through a 1.4 kHz low-pass and a clean feedback delay
  (0.42 s, 35 %). Chords change every 12 s (±2 s), 9 s at DEFCON 2 and 7 s at DEFCON 1, when a slow
  pulsing fifth joins and level, brightness and echo rise slightly (`setMusicIntensity`, driven from
  the player's DEFCON in `App.tsx`). Start and stop fade over about 2.5 s. **Off by default**; a
  one-time dismissible hint in game points to Settings (`ww3.musicHint`). Royalty-free tracks were
  considered and rejected for now: the procedural bed needs no download, no licence row and no
  bundle weight; `docs/DATA_SOURCES.md` records that no audio files ship.
- **Effects audit.** Every noise buffer is gone (battle and nuclear used filtered white noise):
  battle is now a pitch-dropping sine thump, nuclear a long swell of two detuned sub sines with a
  falling fifth. Square and sawtooth waves (click, alert, end turn, reject) became sine or triangle
  at lower gains. Stingers sit in A minor so they do not clash with the bed.
- The audio module tests (`src/ui/audio.test.ts`) cover the pure parts: settings parsing and
  clamping, the music-off default and the DEFCON → intensity mapping; the graph itself needs a
  browser and is exercised by the e2e settings step.

## D-061 — 2026-11-02 — Economy depth: resource chains, trade network, sanctions, war finance, domestic politics

The economy becomes a living system the player reads like SimCity for a nation. New modules:
`src/sim/trade.ts` (trade network, resource market, sanctions regimes), `src/sim/domestic.ts`
(approval, protests, elections, coups); `economy.ts` gains potential output, inflation, interest,
recessions, taxes and war bonds. Turn order: AI → **trade & market** → economy → **domestic** →
production → research → … (rest as D-059). Every effect is measured against the world of January
2027, so the starting state — including the sanctions already in force, which IMF growth
forecasts already price in — carries zero penalties (`runTrade(…, calibrate = true)` in
`initEconomy`).

- **Data.** `data/resources.json`: producer shares for six resources with a source each (EIA oil,
  Energy Institute gas, IEA refining + USGS MCS 2026 rare earths, TrendForce ≤ 16 nm chips, FAOSTAT
  cereals, worldsteel 2025 steel); rows not read directly off a source are listed in
  `estimatedProducers`. The remainder (1 − Σ listed) is diffuse output any non-blockaded importer
  can buy. Unit types and research branches list weighted inputs (`unitInputs`). `data/trade.json`:
  175 bilateral goods-trade pairs (US$ bn, ≈ 2024); only US–China (USTR 2025) is read directly, the
  rest are rounded approximations of national customs data and the file is `estimate: true`.
  `data/politics.json`: EIU Democracy Index 2024 regime categories and election terms for the 44
  nations with a researched leader. `data/economy.json`: IMF WEO inflation (PCPIPCH, 2026) for every
  nation, built by `scripts/build-economy.ts` (Node's fetch is blocked by the sandbox proxy, so the
  IMF file was downloaded with curl into `.cache/nations/` first).
- **Market.** Demand per resource = (w × GDP share + (1 − w) × population share) × (1 + warDemand ×
  (mobilisation + ½ if at war)). Supply = producer share × controlled share × (1 − devastation); a
  conqueror runs `seizedYield` of a capitulated producer's capacity (chips 10 %: fabs need foreign
  tools). Exporters' surpluses are split among importers in six proportional passes weighted by
  deficit × access; access = policy × route. Policy: war or embargo 0; sanctions 0 for strategic
  goods (food exempt); complying with secondary sanctions 0.2. Satisfaction = (home use + imports)
  ÷ demand. Prices move 40 %/month toward (demand ÷ delivered)^1.6 relative to the start (0.6–5).
  The chokepoint oil index of D-052 is kept as a separate risk premium.
- **Routes.** A pair trades overland when it shares a land border (or one side has no sea access
  to the other's waters, e.g. the Caspian); otherwise along the shortest sea-zone path between
  their coasts avoiding zones controlled by an enemy of either party and straits closed against
  them. Contested waters carry 50 %, a detour more than two zones longer 85 %, landing in a
  neighbour at war with neither and finishing by rail 80 % (this keeps Ukraine supplied through
  Poland while Russia holds the Black Sea). No path: cut. BFS results are cached per origin and
  blocked-zone signature each turn; pairs where neither side has hostile waters skip routing.
- **Trade term.** Each listed pair's volume = data × √(GDP ratio of both vs start) × policy (war 0,
  embargo 0, sanctions 0.3, complying with secondary sanctions 0.3) × route × treaty (+6 %, not
  inside the EU) × relations (−15 % below −40, +5 % above 50) × 0.75 if one side defies the
  other's secondary sanctions. Lost trade is the same number for both partners, so sanctions are
  symmetric by construction: growth −0.6 pp per 1 % of GDP lost (clamp −8…+1.5), and the smaller
  economy feels the same loss more. Resources add shortages (−gdpWeight × relative shortfall),
  export earnings (½ × Δ earnings ÷ GDP) and import prices; financial sanctions add −2 pp × the
  rise in the sanctioners' share of world GDP. Research loses 30 % × that share (replacing the flat
  ×0.85 of D-026) and up to 60 % from shortages of the current branch's inputs; production lines
  advance 1 − 0.75 × weighted input shortage per month (≥ 25 %) and cost +50 % × the shortage.
- **Growth and cycles.** Potential output grows at trend (IMF rate converging to 2 % with a
  15-year half-life) + infrastructure + tech + taxes; actual growth adds the shocks (trade,
  resources, sanctions, war, mobilisation, debt, inflation, events, chokepoints) and a recovery
  term of 0.3 pp per 1 % output gap (−3…+8). Persistent shocks therefore become bounded level
  losses (gap ≈ shock ÷ 30) and recover when they end — no runaway decline. Six months of
  contraction is a recession; it ends when growth tops 0.5 %. The old fixed debt drag above 120 %
  now starts at max(120 %, the starting ratio) so Japan is not penalised for its baseline.
- **Inflation, interest, debt.** Inflation moves 15 %/month toward anchor (IMF 2026 value decaying
  to 2.5 % with a 3-year half-life) + demand pressure (40 × positive gap, 10 × negative) + real
  deficits above 3 % of GDP (× 0.35) + mobilisation (0/1/3) + import prices + shortages + rise in
  sanctions (× 12); clamp −3…400. It erodes debt (÷ 1 + π/1200 a month) and half as much cash.
  The average interest rate moves 1/24 a month toward 1.5 + 0.9π + 5 × (debt ratio above
  max(90 %, start)) + 4 for three years after a default + 4 × sanctions; it replaces D-026's fixed
  4 %. The deficit term uses real borrowing (after erosion), which breaks the inflation → interest
  → deficit → inflation loop that otherwise ran away. Default at max(250 %, start + 80 %).
- **Taxes, mobilisation, war bonds.** `setTaxRate` 15–45 % (28 % neutral; −0.06 pp growth and
  −0.6 approval per point above). Mobilisation keeps D-026's effects and adds inflation and resource
  demand. War bonds (`issueWarBonds`): 1.5 % of GDP to treasury and debt, needs a war or
  mobilisation, 6-month cooldown, at war +3 approval and −3 weariness; the AI issues them when at
  war and short of cash.
- **Sanctions regimes.** `GameState.embargoes` (total, food included) and
  `secondarySanctions` (`from>to`) beside D-024's `sanctions`. Starting state: US embargoes on Cuba,
  North Korea and Iran; US secondary sanctions on Iran and Russia (2025–26 measures). A third party
  complies with secondary sanctions when it is allied with the sanctioner, or (not friendly with the
  target) trades at least 1.5× more with the sanctioner; allies and friends (relations ≥ 40) of the
  target defy and lose 25 % of their trade with the sanctioner — once per sanctioner. Coalitions:
  the player can rally one (`rallySanctions`); a nation joins when relations with the leader minus
  relations with the target, plus loyalty, outweigh its trade dependence, and it has no friendship
  with the target. AI: joins a friendly major's coalition against nations it dislikes (≤ −25),
  lifts sanctions once relations recover above 10, embargoes bitter enemies, and sanctions a
  hostile major only if the trade at stake is under 2.5 % of its GDP (or it is very aggressive).
- **Domestic politics.** Approval (0–100) moves 12 %/month toward 50 + growth + inflation + taxes
  + social spending + weariness + rally + mobilisation + shortages + lost territory + output gap +
  stability; it feeds stability (±0.01 per point from 50). Protests start below 30 / 26 / 22
  (democracy / hybrid / autocracy) with stability under 55. Elections for democracies and hybrid
  regimes come from `leaders.json` `nextElection`, then every term; the player's first election
  never falls before turn 6 (a grace period: France votes in April 2027). Vote share = 50 + 0.7 ×
  (approval − 50) + incumbency (1, hybrid 10) ± 3; the player is warned at 12, 6, 3 and 1 months
  and loses the game below 50 % (`Defeat.kind = 'election'`). AI governments that lose are
  replaced by a generated successor (`fictional`). Coup risk (autocracies; hybrids at half) sums
  low approval, low stability, battlefield defeat, an army under 8 % of the budget, recession and
  protests (≤ 8 %/month); a successful coup ends the player's game (`'coup'`) or installs a
  fictional military council.
- **UI.** Economy screen (E): Overview (KPIs, GDP/growth/inflation/debt charts from
  `GameState.history`, growth breakdown), Budget & war finance (spending, taxes, mobilisation,
  war bonds), Trade (top partners with status), Resources (balance per resource, suppliers,
  prices, throttles), Sanctions (coalitions, join/embargo/secondary/lift, rally), Domestic
  (approval breakdown, election poll, coup risk). Top bar adds Inflation and Approval. Map mode 4
  draws trade routes as flowing arcs (`src/render/TradeRoutes.tsx`, one additive mesh, rebuilt only
  when the state changes); map mode 9 colours nations by their position in a chosen resource. The
  Diplomacy screen gains embargo, secondary-sanction, rally and lift actions.
- **Tests** (`src/sim/economy.test.ts`): calibrated baseline, Taiwan blockade → global chip
  shortage throttling fighters, AI research and costs, G7-wide rare-earth embargo, sanctions
  symmetry, embargoes, secondary-sanction compliance and defiance, coalitions, war bonds, taxes,
  elections, coup risk and a 240-turn soak with bounds on every value.
- **Performance.** The trade step costs ≈ 35 ms per turn in Node (turn ≈ 370 ms vs 353 ms before):
  pair access is cached in a typed array per turn, sea routing runs only when one side has hostile
  waters. `GameState.history` keeps ≤ 240 samples for the 14 majors and the player.
- **Saves** from before this entry are migrated in `refreshLeaders` → `migrateEconomy`: the loaded
  world becomes the new baseline and elections are rescheduled at least six months out.

## D-071 — 2026-11-02 — Diplomacy AI: personalities, memory, deals, statements, blocs, UN, war plans

AI leaders now behave like Civilization leaders grounded in real politics. New modules in `src/sim`:

- **Personality** (`personality.ts`). Traits (D-049) plus **agendas** from `data/agendas.json`
  (reunification, territorial recovery, regional hegemony, alliance preservation, regime survival,
  non-alignment, transactional, economic development — each with targets, a sphere and a flashpoint,
  cited from the public record) produce goal weights (security, expansion, prosperity, cohesion,
  survival, restraint). Nations without a researched agenda default to economic development
  (regime survival for autocracies). Each leader keeps a **memory** (`GameState.memory`, ≤ 14
  entries per holder) of grievances and favours: attacked us (40), sanctioned us (8, ×1.5 for regime
  survival), honoured / sat out Article 5, aid received, arming our enemy, vetoed our resolution,
  generous or insulting offers, threats. Repeated memories accumulate in one entry. Grievances
  decay 1.5–10 %/month (faster for pragmatists, slower for paranoid nationalists); favours 3–12 %.
  **Opinion** = relations + favours − grievances (±50) and is what the AI uses everywhere it judges
  another nation (deals, proposals, votes, war plans, aid). Memory also pulls the relations
  baseline in `decayRelations` (¼ of each side's memory, ±30).
- **Deals** (`deals.ts`). A deal bundles items each side gives: money, regions, basing rights, tech
  sharing, lifting sanctions, arms sales, joining a war, treaties. The AI values every item in US$
  bn-equivalent from its own leader's view (money weighted by economic priority, a transactional
  agenda and a thin treasury; ceding land by nationalism and territorial recovery, capitals never;
  basing by sovereignty cost, the risk of drawing fire and protection against a shared threat;
  joining a war by the odds, nuclear risk, restraint, hostility to the target and agenda claims),
  adds a trust term (opinion and legitimacy) and accepts when the net value ≥ 0. Acceptance
  likelihood = logistic(1.5 × value ÷ scale), scale = 0.4 % of GDP + 1 — so the bar is ≥ 50 %
  exactly when the verdict is accept. Hard refusals (attack an ally, cede a capital, arm an ally's
  enemy, hand tech to a rival, anything while at war) have likelihood 0. Close calls (within 4 ×
  scale) get a **counter-offer**: ask for the shortfall in cash (if affordable) or drop the costliest
  item; a counter is only made if it would itself be accepted. The evaluation is pure, so the
  negotiation screen shows exactly what the simulation will decide. Basing rights make the host's
  territory friendly to the guest for movement and supply (`hasBasing`).
- **Statements** (`statements.ts`). Template-driven dispatches (threat, warning, praise, request,
  offer, condemnation, communiqué) whose tone (blunt / cold / measured / formal) follows traits;
  the template is picked by a hash so statements never consume the RNG. Only statements involving a
  major or the player are kept (≤ 40). Shown as illustrated portrait cards (`src/ui/Portrait.tsx`:
  one generic bust for everyone with the nation's colours, the leader's initials and an office
  insignia — never a likeness).
- **Blocs** (`blocs.ts`). Live membership in `GameState.blocs` (alliesOf and the relations baseline
  read it). NATO Article 5 / CSTO Article 4 replace D-024's blanket rule: each partner computes a
  willingness (loyalty, alliance-preservation and transactional/non-aligned agendas, opinion of the
  victim and the attacker, nuclear risk, bloc cohesion, borders) and fights at ≥ 45; NATO members
  below it answer with aid (and the victim remembers); treaty partners who walk away lose
  legitimacy. Partners allied to both sides stay out. Cohesion drifts toward a target from relations
  among the six largest members, a shared adversary, wars between members, departures and
  transactional leaders. Annual summits (NATO July, SCO September, CSTO November, AUKUS December)
  warm or sour relations, name the threat, press NATO low spenders and share AUKUS technology. A
  member at war with another member leaves; one whose opinion of the bloc's leading powers falls
  below −30 while cohesion is under 40 may walk out (8 %/month, hash-drawn). The player can leave a
  bloc.
- **UN Security Council** (`un.ts`, `data/unsc.json`). The real 2027 Council; elected seats rotate
  from 2028 (largest economy of the outgoing member's region not recently seated — simulated).
  Resolutions: sanctions, ceasefire, condemnation; nine votes and no permanent-member veto. Votes
  come from opinion of sponsor vs target, the target's legitimacy, bloc solidarity, non-alignment
  and who started the war. The AI tables a condemnation (majors) or ceasefire (minors) against a
  fresh aggressor, a yearly ceasefire in long wars and sanctions after nuclear use. AI resolutions
  wait a month so the player can vote (a P5 player's "no" is a veto; a player who does not vote
  backs its own drafts, opposes drafts aimed at itself and otherwise abstains). Adopted sanctions bind every
  nation that is not a friend of the target; ceasefires are accepted by war-weary parties and cost
  the others legitimacy; condemnations cost legitimacy and stability. Vetoes cost the vetoer 3
  legitimacy. **Legitimacy** (`NationState.legitimacy`, 0–100, drifts to 50) also falls 6–12 for
  starting a war and enters every deal's trust term.
- **Strategic layer** (`strategy.ts`). Every AI major keeps a **war plan**: a target chosen from
  hostility, agenda claims, shared flashpoint tension and relative weakness (score × expansion
  weight, against a bar raised by restraint); a coalition sounded out with joinWar asks; and a
  threshold = 1.75 − risk/120 − aggression/400 (×2.2 against a target with ≥ 50 warheads, ×1.3–1.8
  against smaller arsenals). Credible second-strike arsenals take 90 points off a target's score.
  Readiness = odds ÷ threshold; at 0.5–1 the AI rearms (+6 military budget); at 0.85 it publicly
  threatens the target (dispatch, flashpoint +4). It attacks only when readiness ≥ 1, the plan is
  at least six months old and has been announced, the flashpoint is hot (≥ 55) or opinion ≤ −60, it
  is not busy with another major, and a roll under aggression × risk × 5 % × (1 + claim) × (1 −
  restraint/2) succeeds; coalition partners re-confirm and join. Minors keep D-032's opportunistic
  rule. **No AI ever declares war on an ally**: `declareWar` refuses it for every non-player
  attacker, joinWar refuses it, and partners allied to both sides stay neutral.
- **Balancing coalitions.** Threat index = ½ share of world output + ½ share of military power + 3 ×
  share of world output in conquered foreign land. At ≥ 0.30 for the player (0.42 for an AI power,
  checked every six months) the AI powers whose opinion of the hegemon is below 25 + 150 × (threat −
  0.3) + paranoia/5 form a coalition: relations among members +10, defensive pacts among the five
  strongest, a grievance against the hegemon, +5 military budget, war plans re-targeted (the
  nuclear penalty is shared: 35 instead of 90). It dissolves below 0.22.
- **UI.** The Diplomacy screen has tabs: Nations (with the leader's agenda, what they remember about
  you, visible war-plan intelligence, aid received and your aid programme), Negotiate (deal builder
  with live acceptance bar, line-by-line valuation, counter-offers), Dispatches, Blocs and UN
  Security Council (council, pending vote with your ballot, tabling with a vote forecast, history).
  A "Wire" button in the top bar opens the dispatches with a count of new statements. AI nations at
  war send the player arms requests as deal proposals.
- **Turn order.** AI → strategy (coalitions, war plans) → aid (D-072) → trade … → relations drift →
  blocs → UN → memory decay → escalation → events.
- **Saves** from before this entry are migrated in `refreshLeaders` → `migrateDiplomacy`.

## D-072 — 2026-11-02 — Western aid as AI diplomacy; Ukraine calibration

Ukraine collapsed within months on some seeds. Two causes, two fixes:

- **Aid** (`src/sim/aid.ts`). Every month each NATO/EU member decides how much to send to a partner
  fighting a rival: the victim of aggression (a defender) when the donor's opinion of it is ≥ 5 and
  of the aggressor ≤ −20 — never a great power more than twice the donor's size. Annual aid = GDP × 0.25 % × relations factor ×
  trait factor (loyalty, alliance preservation +, transactional −, non-alignment −, aggression) ×
  hostility to the aggressor × domestic approval (aid fatigue below 65) × 1.6 if the donor borders
  the aggressor × 1.25 if the recipient has lost territory; capped at 1.2 % of GDP (Kiel Institute
  Ukraine Support Tracker scale). Autocratic patrons (regime survival / regional hegemony agendas)
  back like-minded regimes at 40 %. Each package is 40 % money (recipient treasury), 45 % arms
  (banked and delivered as mechanised, artillery and air-defence formations through the recipient's
  production queue, ≤ 2 a month, tagged with the donor) and 15 % munitions (`aidSupply` =
  munitions ÷ the recipient's military budget × ½, ≤ 0.35: multiplies regional supply, adds a
  "Foreign aid" combat modifier of 1 + 0.6 × aidSupply for both attack and defence, and speeds
  refits ×(1 + 1.5 × aidSupply)). A transactional donor (the United States in 2027) gives no money
  and 30 % of the arms; European donors buy a quarter of their arms aid from US industry (PURL),
  credited to the US treasury. Aid costs the donor treasury and a little approval (nationalist
  publics tire faster), earns the recipient's favour and the aggressor's grievance, and produces
  periodic statements. `GameState.aidSuspended` lists donors that have cut aid (events, politics,
  tests); the player runs its own programmes at 0.1–0.3 % of GDP (`setAid`). Start of 2027: about
  US$ 7 bn a month reaches Ukraine (≈ US$ 85 bn a year), the Kiel tracker's order of magnitude.
- **Defensive AI.** Ukraine's AI was counter-invading Russia (Volgograd, Stavropol, Tatarstan)
  while Russian forces staged through Belarus toward an empty Kyiv. Now (`ai.ts`): a nation on the
  defensive (own land occupied, or facing a stronger enemy) liberates its own regions but does not
  invade the enemy homeland while its own land is occupied (and otherwise only at ≥ 2.2:1); the
  capital is defended first — enemy formations adjacent to it count wherever they stand (including
  a co-belligerent's territory), its garrison holds, and the nearest formations (each region keeps
  one) reinforce it until the garrison's defence reaches 1.1 × the adjacent enemy attack. The
  defender also gets a **Capital** modifier ×1.3 in its own capital region. `declareWar` now
  measures "unjustified war" on the relation before the declaration (the old code read it after
  setting it to −100, so the stability penalty never applied).
- **Calibration** (`src/sim/ukraine-aid.test.ts`, `ukraine-noaid.test.ts`, `tests/ukraineRun.ts`):
  World of 2027, Brazil as a passive player, seeds 1–10, 24 months. With aid Kyiv held in all 10
  seeds (the test requires ≥ 7); with every donor suspended it fell in 4 of 10, in months 4–6, two
  of them ending in capitulation (the test requires ≥ 3). Average turn ≈ 287 ms. The same runs assert that no AI declares war on (or joins a war against)
  an ally. The Baltic calibration ("no NATO response") now also suspends NATO/EU aid; the Korea
  calibration's loss bounds were lowered because the ROK AI holds Seoul instead of feeding its
  garrison into counter-attacks (docs/BALANCE.md).

## D-073 — 2026-11-02 — Sourced trade data, leader re-check, turn-time budget

- `data/trade.json` was re-sourced pair by pair (174 of 175 from official statistics; IRN–IRQ
  partly estimated). Each row's reporter, year, figure and URL is in `rowSources` and the per-pair
  table in `docs/DATA_SOURCES.md`; the top-level `estimate` flag is gone and `estimated` lists the
  one remaining estimate. Large changes against the old approximations: US–Taiwan 158 → 256 (AI
  servers), US–Switzerland 85 → 180 (gold), US–Vietnam 149 → 210, US–Canada 762 → 716, China–Germany
  250 → 211. The economy is still calibrated to zero penalties at the start (D-061), so these move
  the weight of each relationship, not the starting growth.
- `data/leaders.json` re-verified (second pass, no officeholder changes; Finland and Netherlands
  election dates corrected).
- **Turn time.** The turn had crept to ≈ 360–560 ms in Node. Profiling showed `runSupply` (two
  calls a turn) dominating: one scan of every region per nation, a linear extract-max, and
  per-call string cache keys. Now: home regions grouped in one pass; a binary max-heap over typed
  arrays; a single best-level array (every land region a nation's search enters is friendly to it
  and alliances are symmetric, so each search counts for each region it reaches — the same result
  as the old per-ally max); nations at peace skip sea-balance lookups (no enemy can threaten their
  convoys); `isFriendly` uses a cached ally `Set`; the geography memo and the air cache compare
  numeric versions instead of building strings (the air cache keyed on `Object.keys(units).length`,
  rebuilding an array of ~1,300 keys on every lookup). The turn now averages ≈ 280–310 ms with all
  of D-071/D-072 included (`docs/PERF.md`).

## D-074 — 2026-11-02 — Event chains and a 133-event deck

- **Chains** (`data/chains.json`, `src/sim/events.ts`). Six multi-step flashpoint crises: Taiwan
  (customs quarantine → the quarantine bites → incident at sea / energy squeeze → brink), Korea
  (nuclear test → Seoul's response → island shelling → retaliation), Baltic (hybrid operation in
  Narva → Article 4 consultations → NATO reinforcement → Russian forces on the border), Gulf
  (tanker seizure → escorts / mines → fast boats swarm a destroyer), Kashmir (massacre → strikes or
  water squeeze → retaliation → the brink) and the Arctic (Lomonosov claim → Svalbard → frigate
  standoff → boarding crisis). Each step names an `actor` list: the player decides when listed
  (the step arrives as a decision, bypassing the two-event cap), otherwise the first living nation
  decides. A `chain` effect schedules the next step 1–2 months later (`GameState.chains`); an entry
  starts with `weight`% a month when its conditions hold and no step of that chain is pending, and at
  most one chain starts per month. Every chain is acyclic, every step has a choice that ends it,
  and every path ends within five steps (tested). Escalating paths can end in war
  (`war` effects go through `declareWar`, so allies, Article 5 and the ally guard all apply).
- **AI choices.** Choices carry a `stance` (escalate / hold / de-escalate). An AI actor picks by
  seeded draw weighted by (traits)²: escalation by aggression, risk tolerance and nationalism (×0.8);
  de-escalation by pragmatism, caution and economic priority; hold a flat 0.35. World events whose
  outcomes are not decisions (pandemics, crashes, assassination attempts) give each choice a
  `chance` instead; the old world events gained alternative outcomes this way.
- **Deck.** 133 events: 73 in `data/events.json` (36 new: snap elections, interference,
  impeachment, corruption, coup plots and coups next door, assassination attempts, pandemics,
  drug-resistant infections, bond routs, a tech bubble, currency crises, tariff wars, ransomware,
  satellite and bank hacks, hurricanes, floods, drought, wildfires, earthquakes, scientist and
  general defections, moles, quantum, battery, interceptor and vaccine breakthroughs, plus seven
  world events) + 36 flashpoint events + 25 chain steps. New effects: `chain`, `succession`,
  `legitimacy`, `support`; new conditions: `regime`, `notMajor`. Every event and choice has a
  category for the news wire.
- **Visible trade-offs.** The decision modal lists each choice's effects as chips ("Stability (you)
  +5", "Relations you–China −12", "WAR: …", "The crisis continues…"), green when they help the
  player and red when they hurt (`src/ui/effectText.ts`).

## D-075 — 2026-11-02 — Leader succession

- **Term limits** (`data/politics.json` `incumbentEligible`): the United States (22nd Amendment),
  France (two consecutive terms), South Korea and the Philippines (single term), Mexico (no
  re-election), Brazil (Lula re-elected in 2026) and Turkey (two terms; only an early election would
  let Erdoğan stand). At the next election the governing party fields a generated, fictional
  candidate who loses the incumbency bonus (1 point; 10 in hybrid regimes); if the party wins, the
  candidate takes office (the player's game continues under the new leader), if it loses the old
  rules apply (an AI government is replaced, the player loses).
- **Health crises.** No ages are modelled (birth dates are not in the data). The monthly risk is
  0.06 % rising by 0.015 % for every year in office beyond four (≤ 0.4 %). The player answers a
  decision (temporary transfer of power, conceal it, or step down for a successor); an AI leader
  recovers or hands over (50/50).
- **Other successions.** Impeachment (player decision), assassination (world event, 25 % lethal)
  and coups (D-061) all go through `succeedLeader`: a fictional successor, marked `fictional`, with
  `leaderSince` reset. ~~Traits stay with the office (party or regime line).~~ **Superseded by
  D-078:** successors get their own generated traits from their party or faction profile.

## D-076 — 2026-11-02 — Escalation ladder, deterrence and the nuclear aftermath

- **Ladder** (`ESCALATION_LADDER`, `escalationRung`): posturing → sanctions (great powers
  sanctioning each other) → proxy conflict (a great power arming a nation at war with another) →
  limited conventional war (any war involving a great power) → general war (great powers at war with
  each other, or three at once) → tactical nuclear use (1–3 detonations) → strategic exchange (≥ 4).
  Each rung lists what moves the world up and down. **DEFCON** is now computed from an explicit
  factor list (`defconFactors`) shown in the UI; the rules are unchanged from D-028.
- **Second strike** (`secondStrike`): warheads on ballistic-missile submarines at sea (120 per SSBN
  formation, scaled by its strength) survive a disarming first strike at 90 %, the rest at 30 %;
  survivors are reduced by the adversary's missile defence. ≥ 50 penetrating warheads is assured,
  ≥ 10 limited. Sinking SSBNs weakens it. `deterrentAgainst` also counts allies — an ally's assured
  second strike stays assured only inside NATO, otherwise it counts as limited (extended deterrence
  is less credible). War plans (D-071) now use this instead of raw warhead counts.
- **AI nuclear use** (`nuclearDecision`, pure): only at DEFCON 1 and at war; desperation = 80 × the
  share of the homeland lost + 30 if the capital is lost + 50 after suffering a nuclear strike;
  the leader's bar is its nuclear-threshold trait, +20 against an assured enemy second strike (not
  after being struck), −10 × a regime-survival agenda. Above the bar it launches with 25 % a month.
  Retaliation probability is multiplied by 1 / 0.8 / 0.3 for an assured / limited / no second strike.
- **Launch** requires DEFCON 1 and two confirmations — the command carries `confirmations` and the
  reducer refuses fewer than two; the UI's arm-then-confirm buttons supply them. The release screen
  shows both sides' second-strike status.
- **Consequences**, abstracted with no imagery: fallout (`RegionState.fallout` 1 in the struck
  region, 0.35 in its land neighbours, −3 %/month) tints the map ochre-grey in every map mode;
  global cooling (`nuclearWinter`, +0.6 °C per detonation, −7 %/month) costs every economy 0.4 pp of
  growth per °C each month and erodes stability; the attacker loses 40 legitimacy, every government
  remembers a grievance (60 for the victim, 25 for the rest) and every non-friend sanctions it.
  `nuclearLog` records each strike. A full exchange (eight detonations, D-028) ends the game with a
  sombre "Nobody wins" screen: detonations, people living in struck regions (not casualties), nations
  struck, world output against January 2027, cooling, warheads remaining, months from first use.
- **UI.** Escalation screen (X, or click Tension): gauge, ladder, flashpoints, and a DEFCON and
  deterrence table for the player, the majors and every nuclear power with each AI's nuclear posture.

## D-077 — 2026-11-02 — The WW3 Wire

`src/sim/news.ts` turns each month's log into ≤ 14 wire stories in one voice: "DATELINE, Month Year
(WW3 Wire) — lede. Context." (tension and DEFCON for war stories, relations for diplomacy, approval
for politics, growth and inflation for the economy, detonation count and cooling for nuclear
stories). Priorities: 3 = breaking (nuclear use, capitulations, great-power war declarations,
Article 5, coups and assassinations in great powers, bloc walk-outs), 2 = top story, 1 = brief;
battle reports and routine trade deals are dropped unless they involve the player. Datelines are
the capital of the first nation involved; world events are datelined from the nations their
effects name. `GameState.wire` keeps 150 stories. The News screen (N) filters by category, by
importance or "about us", and by text; priority-3 stories of the last month show as a dismissable
banner. The old one-line headlines remain for the ticker.

## D-078 — 2026-11-02 — Successor personalities from party and faction profiles

Supersedes the "traits stay with the office" part of D-075. Successors used to inherit their
predecessor's traits exactly.

- **Data** (`data/factions.json`): for each of the 44 nations with a researched leader, its main
  parties or power factions (136 in all) — e.g. Republicans / Democrats; CCP leadership / PLA
  hardliners / economic reformers; Kremlin vertical / siloviki / technocrats / liberal opposition;
  Principlists / IRGC / pragmatic conservatives / reformists; Labour / Conservatives / Reform UK —
  each with its kind (party, faction, military), a rough weight (share of support or power), a
  one-line public position, a cited Wikipedia article (all 136 links checked) and a trait profile:
  the authors' editorial translation of those positions onto the eight 0–100 traits
  (`estimate: true`). `incumbent` names the current leader's faction.
- **State.** `NationState.leaderFaction` and `leaderTraits` (null while the researched leader is in
  office). `traitsOf(world, iso, state)` returns the successor's traits when there are any; every
  simulation call site now passes the state (19 of them), so a successor changes how the nation
  negotiates, votes, aids, plans wars, speaks and decides on nuclear use.
- **Which faction.** Orderly successions (term limit, health, resignation, impeachment,
  assassination) keep the leader's faction; an election lost brings the largest civilian
  opposition faction; a coup brings the military faction (else the most hawkish one); a revolution
  brings the largest, least paranoid civilian opposition.
- **Traits.** National baseline = mean of the weight-averaged faction profiles and the researched
  leader's traits (the strategic culture any government inherits). Successor = 65 % faction profile
  + 35 % baseline + seeded variation of ±8, clamped to the faction's bounds (profile ± `spread`,
  default 18). Regime change weights the faction at 75 %, adds a shift — coup: aggression +10, risk
  +8, pragmatism −10, nationalism +8, paranoia +12, economy −8, loyalty −8, nuclear bar −8;
  revolution: +4, +6, −6, +6, +8, −6, −10, −4 — widens the variation (±10 / ±12) and the bounds
  (+12 around the shifted centre). If the draw lands within 12 trait points (sum of absolute
  differences) of the predecessor, traits are pushed apart inside the bounds: a successor is a new
  person, not a copy.
- **Revolutions.** An AI autocracy or hybrid regime with six months of mass protest and stability
  under 25 falls with 5 % a month; the opposition forms a transitional government.
- **Fictional and marked.** Successors keep generated names (now from country-specific pools) and
  `leaderFictional`; the leader card shows a "fictional" chip and the faction, and the diplomacy
  screen shows every leader's current traits with their origin.
- **Saves** from before this entry keep their successors' inherited traits (`leaderTraits` null).
- **Tests** (`src/sim/succession.test.ts`): every nation × every cause produces traits at least 12
  points from the predecessor and inside the faction's bounds; successors in a running game drive
  `traitsOf`; determinism; faction choice per cause; coups and revolutions shift further than
  orderly successions; a term-limited US president is succeeded within the Republican profile.

## D-079 — 2026-11-02 — The research tree: 81 techs, real starting capability, the technology war

Supersedes the "40 techs for v1" part of D-027; the brief's ~80 are in.

- **Data** (`data/techs.json`): 81 technologies, about ten per branch, in five **eras** —
  I Fielded (2027), II Near term (2028–30), III Mid term (2031–33), IV Long term (2034–36),
  V Frontier (2037–40). Each has a `year` (earliest plausible fielding), a two-to-three sentence
  real-world framing naming the programmes it stands for, a cost (era averages ≈ 135 / 315 / 500 /
  900 / 1,500 RP; the US and China make ≈ 90 RP a month at the start, Russia ≈ 23), prerequisites
  from the same or earlier eras (cross-branch links: the sixth-generation fighter needs the AI pilot,
  adaptive-cycle engines and CCAs) and effects. `tier` is kept equal to `era` for older code (deal
  values, headlines). The file is `estimate: true`: years beyond era I are the authors' reading of
  public roadmaps. New effect keys: `missileRate`, `hypersonicDefence`, `espionage`,
  `counterIntel`, `satelliteSurvival`; the old unused `droneResistance` and `deterrence` now act.
- **Starting capability** (`data/tech-start.json`, `estimate: true`): what 28 nations field in
  January 2027 with a `basis` line of the programmes counted — e.g. the US 28 techs (Dark Eagle,
  PrSM, Starshield, Intel 18A; no mass FPV base, no sixth-gen yet), China 32 (DF-17, DF-21D/26,
  Micius QKD, rare-earth refining, Ascend; no ≤ 3 nm logic), Russia 24 (Zircon, Avangard, mass
  FPV, EW), Ukraine 19 (sea drones, ground robots), Israel 19 (Iron Beam), Taiwan 13 (TSMC A16).
  Prerequisites are always closed. Other nations: tactical drones, precision strike and a CERT at
  ≥ $5 bn defence budget, tactical drones at ≥ $1 bn. **Calibration:** the economy was calibrated
  to IMF forecasts that already price in today's technology, so `NationState.techBaseline` stores
  the starting `gdpGrowth` and `stability` modifiers and the economy reads only the change
  (`techDelta`). Military modifiers count in full — a real capability gap is the point. The
  calibrated war scenarios (Ukraine, Korea, Baltic, Taiwan, …) stayed inside their ranges.
- **Costs** (`techCostBreakdown`): base × max(0.35, 1 − ally discount − diffusion − credit) ×
  export controls. Each ally (treaty partner, NATO/CSTO member) already fielding the tech, and not
  sanctioning or export-controlling us, takes 10 % off (max 30 %): alliance tech sharing as passive
  spillover. Once nations with half the world's GDP field it, another 10 % ("it has been done").
  Stolen or shared designs (`techCredit`) cover up to 60 %.
- **Sanctions slow research** in two ways: the existing ×(1 − 0.3 × sanctioners' GDP share) on
  research points (D-061), and **export controls** — `GameState.techControls` (`from>to`), seeded
  with the US, Dutch and Japanese chip and tool controls on China — which multiply the cost of
  semiconductor and AI techs by 1 + 1.2 × the GDP share of nations sanctioning or controlling the
  target (reduced by sanction resistance; China's sovereign-EUV tech is the way out). Controllers
  and sanctioners share nothing. The player can impose or lift controls (relations −8 / +4).
- **Queue.** `researchQueue` holds projects after the current one; `queueResearch` puts the whole
  missing path to a tech in order (prerequisites first, earlier eras and cheaper first), replacing
  the queue or, with shift-click, appending. Research completes up to two projects a month when
  points are banked and starts the next queued project whose prerequisites are met.
- **Units** (`data/units.json` `requiresTech`): sixth-generation fighter wing (AA 13, signature 0.55,
  $22 bn), loyal-wingman CCA wing ($4 bn, 3 months), drone swarm group (attack 7, built in a month,
  signature 1.4), laser air-defence brigade (AA 11, ×2 counter-drone weight, half weight against
  cruise missiles and 0.1 against hypersonics). `signature` replaces the hard-coded bomber/drone
  interception factors; `uncrewed` types get drone-strength tech and are hunted by the defender's
  `droneResistance` (EW, counter-UAS, microwave) and laser brigades. Production refuses a locked
  type; the AI substitutes researched successors for fighters, drones and air defence.
- **Abilities** (`techs.json` `abilities`): hypersonic strike (a strike option: four glide
  vehicles for eight missiles' stock, interception ×0.35 plus the defender's `hypersonicDefence`
  from glide-phase interceptors and the space sensor layer, hits ×1.5; the AI uses it against
  defended targets); AI battle management (×1.08 attack and defence, shown as a battle modifier);
  quantum-secure communications (enemy blinding and sabotage cyber operations at half odds, theft
  −15 points); space-based sensors (intel, missile and hypersonic defence); directed energy (the
  laser brigade).
- **Espionage** (`src/sim/techwar.ts`): steal a tech the target fields whose prerequisites you hold;
  0.01 % of GDP, four-month cooldown. Success 35 % + espionage + ½ cyber attack − 0.3 × their
  cyber defence − their counter-intelligence (+15 with a spy network, −15 against quantum comms),
  5–85 %; success covers half the cost. Exposure is rolled separately (40 % + counter-intelligence
  + 0.3 × cyber defence − ½ espionage): relations −15, legitimacy −2, the victim's allies −4, a
  "stole our technology" grievance, tension +1.
- **Sharing:** hand any fielded tech to an ally or a partner at relations ≥ 50 whose prerequisites
  are met: it is granted at once, +6 relations and a favour (8 + 2 × era); the recipient's enemies
  (relations ≤ −40) resent era-2+ transfers. The deal item and the AUKUS summit (D-071) still
  grant techs.
- **AI** (`runTechWar`, after research): each AI great power steals with 1.5 % + paranoia/4000 +
  aggression/4000 a month (about one operation every two months worldwide) from the rival major it dislikes (opinion ≤ 0) with the most valuable
  stealable tech, and shares its cheapest era ≤ 2 tech with the ally furthest behind at 1 % +
  loyalty/4000. Decisions and outcomes use hash draws (`hashDraw`), so they never shift the
  simulation's random stream. AI research picks by branch weight × 1.25 if it unlocks something ÷
  effective cost.
- **Screen** (`src/ui/modals/ResearchModal.tsx`, layout in `src/ui/researchLayout.ts`): era columns
  left to right and a band per branch in its colour; every tech in the first column of its era
  right of all its prerequisites, so links always run left to right, stacked in lanes. Wheel zoom
  around the cursor, drag to pan (a drag never clicks), zoom/fit buttons, branch highlight chips
  and search. Click queues the path, shift-click appends; hovering a tech lights its whole path
  and opens a card with era, year, framing, effects, unlocks, prerequisites, a cost breakdown
  (allies, diffusion, stolen credit, export controls), time and path length, and which great
  powers field it. Side tabs: Queue (reorder, remove, rate breakdown with every factor), Espionage
  (targets, odds, steal, export controls), Sharing. Production marks locked units; the strike
  panel adds hypersonic buttons with the interception chance in the tooltip.
- **Saves** from before this entry: unknown tech ids are dropped, the starting technologies are
  granted, techs whose prerequisites are missing are removed, the baseline is the loaded world
  (`migrateResearch`).
- **Tests:** `src/sim/research.test.ts` (data integrity, eras, starting capability, calibration,
  ally discount, export controls, sanctions, queue, unlocks, abilities, theft, sharing, AI tech war
  without RNG use, migration, determinism), `src/ui/research.test.ts` (layout: no overlaps, links
  left to right, nodes inside their era column; effect labels).


## D-080 — 2026-11-03 — Onboarding, advisor, design system and readability

The game should be approachable on the first evening and feel premium after the hundredth turn.

- **Design system** (`src/styles.css` `:root`). Tokens for type (`--text-xs` 12 px … `--text-5xl`
  56 px), spacing (2/4/6/8/12/16/20/24/32 px), radii (4/8/14/pill), motion (`--ease-out`,
  120/200/350 ms), elevation and surfaces. Every font size, gap, padding, margin and radius in the
  style sheet was mechanically mapped onto the nearest token (10 → 12, 14 → 12, 18 → 16 for
  spacing; every font size ≤ 12 → 12 px). `tests/typeScale.test.ts` fails on any raw or sub-12 px
  font size; the canvas map labels went from 10–11 px to 12–16 px. Icons are
  [Lucide](https://lucide.dev) (ISC licence — functionally MIT; recorded in DATA_SOURCES), one per
  screen and alert kind (`src/ui/iconMaps.ts`), replacing the emoji. Modals take an `icon`; the
  nav shows icon + label and collapses to icons (tooltips keep the names) through a container query
  on the scaled UI root when the effective width is under 1,720 px. The top bar now sits above modal
  backdrops, so screens switch directly from the nav.
- **UI scale** (Settings → Accessibility, 85–150 %). Everything except the globe lives in
  `.ui-root`, sized `100vw / s × 100vh / s` and `transform: scale(s)`: the transform makes it the
  containing block of every `position: fixed` panel, so layout is computed at the effective size and
  scaled crisply, and the WebGL canvas keeps its own resolution. Code that reads screen coordinates
  (tooltips, tutorial spotlight, research tree) divides by the scale.
- **Text ≥ 12 px everywhere.** The research tree's zoomed-out overview would draw node text under
  12 px, so below ×0.95 zoom it becomes a coloured block diagram (text hidden) and the hover card
  carries the words; it now opens at ×1. The tutorial e2e measures every visible text node (CSS size
  × all scale transforms) on every screen it visits and fails below 12 px.
- **Colourblind-safe palettes** (`prefs.palette`). Map modes switch to viridis (economy, military,
  tension, supply), a blue–grey–orange diverging ramp for relations with reddish purple for war,
  Okabe–Ito hues for blocs, resources and trade routes. `:root[data-palette='colourblind']` swaps the
  UI's `--good/--bad/--warn` to sky blue / orange / yellow; hard-coded green/red accents in the UI
  were replaced by those variables.
- **Tooltips** (`src/ui/overlays/TooltipLayer.tsx`). One JS layer replaces the CSS `::after`
  tooltips (which clipped at screen edges): it serves every `data-tip` and every `<Tip>`, clamps to
  the screen, and lets rich tooltips take the pointer so their rows open nested tooltips (three
  levels). `<Stat breakdown>` renders an itemised cause table whose rows carry their own sources:
  growth (trend, trade → the partners whose volume changed, sanctions → who sanctions you, war →
  wars and occupied share, technology → techs researched since 2027, events, chokepoints),
  approval, research rate and battle odds (`src/ui/breakdowns.ts`, unit-tested: the growth rows sum
  to the growth breakdown).
- **Undo** (`src/sim/undo.ts`, worker). Orders whose outcome is known in advance — moves, air
  missions, production, research, budget, taxes, mobilisation, disbanding, aid — push the state
  before them (≤ 20) onto a stack in the worker; anything that rolls dice or informs another
  government (war, strikes, cyber, theft, proposals, votes) and ending the turn clear it, so undo can
  never take back a revealed outcome (no save-scumming a failed theft). Ctrl+Z or the Undo button,
  which names the order it would undo. States are immutable, so keeping them costs only memory.
- **Confirmations** (`src/ui/confirmText.ts`, `ConfirmDialog`). A gate in `simBridge.dispatch`
  holds back irreversible commands — war, sanctions, embargoes, secondary sanctions, demands,
  missile and hypersonic strikes, cyber operations, ASAT, research theft, closing or mining a strait,
  leaving a bloc, export controls — and asks with a specific consequence (war names the target's
  treaty partners). Switchable in Settings. Nuclear release keeps its own two-step arm/confirm.
- **Advisor** (`src/sim/advisor.ts`, pure and tested). Every month the fictional chief of staff,
  Col. Iris Halden, ranks rule-based recommendations with the reason in numbers — economy (idle
  research, a looming election with low approval, stability, recession, deficit, inflation,
  shortages, research budget), military (enemy at the capital, units cut off, idle air wings,
  deterring a stronger hostile power, idle treasury), diplomacy (unanswered proposals, a pending
  Security Council vote, a weary war, a hot flashpoint, a defensive pact with the strongest
  friendly power, a trade agreement with a big partner). The top three take the best of each
  category first. The dock sits under the context panel ("Go" opens the right screen, preselecting
  the nation or flying to the region); A folds it.
- **Tutorial** (`src/ui/tutorial`). 27 steps over the first five months, on by default for a first
  game (menu toggle; H replays it; Settings can restart it). Each step spotlights an element by
  `data-testid` (a dimmed overlay with a pulsing ring, pointer-transparent so the real control
  works) and either waits for Next or completes itself when its task is done (switch map mode,
  select a region, open a screen, queue research, build a unit, end the turn). A pending decision
  event pauses it with a note. Col. Halden is fictional (rule 6), drawn with the same generic
  portrait as everyone and labelled so.
- **Shortcuts overlay** (`?`): `src/ui/shortcuts.ts` is the single list the overlay renders
  (tested for duplicates). New keys: Ctrl+Z undo, A advisor, H tutorial, ? shortcuts.
- **Briefing**. The monthly summary became an intelligence briefing: a classification band, a
  generated bottom line, key indicators each with a 24-month sparkline and delta (GDP, growth,
  approval, treasury, inflation, debt), a diverging bar chart of relations with every great power,
  operations, headlines and the full log folded away. Charts are inline SVG (`src/ui/charts.tsx`).
- **Prefs** live in `localStorage` (`ww3.prefs`, parsed defensively, unit-tested).

## D-081 — 2026-11-03 — Self-play balance pass

A headless runner (`scripts/selfplay.ts`, `npm run selfplay`) plays complete all-AI games from
January 2027 to January 2040 on worker threads and writes metrics and charts to `docs/balance/`.
Fifty seeded games before and fifty after the changes below; the numbers are in `docs/BALANCE.md`.

- **Observer mode** (`NewGameOptions.observer`, `GameState.observer`): the AI also runs the nominal
  player (Tuvalu in self-play), AI→player proposals resolve like any AI pair, and player-scope events
  are not drawn (world events and chains run as usual). A normal game is unchanged.
- **Victory for any nation** (`victoryFor`): the player's victory check, factored so the runner can
  score every great power each month. The Diplomatic victory stays player-only (only the player can
  table the World Order Resolution).
- **Deterrence by standing** (supersedes the Deterrence clause of D-031). "Top GDP in 2040" made the
  United States the winner of 45 of 50 all-AI games and was out of reach for 12 of the 14 playable
  powers whatever they did. The Deterrence victory now goes, in January 2040 and with no nuclear
  detonation, to the great power with the most **standing**: 0.5 × ln(effective output ÷ its own
  trend output) + 0.5 × ln((regions held + 10) ÷ (regions held in 2027 + 10)). The ten-region damping
  stops one region more or less from swinging a small state (Israel, Pakistan) far more than a large
  one. The trend is the economy's own
  trend growth (`trendGrowth`), so India's faster trend does not hand it the win, and starting
  positions are recorded at game creation (`GameState.standingStart`; older saves measure from the
  turn they are loaded). A military-share term was tried and dropped: nations that start lightly
  armed and rearm (Germany: 2.9 % → 7.5 % of great-power strength) won 45 of 50 games on it — a
  cheap strategy, not an achievement. Re-scoring the finished games of intermediate runs under each
  candidate formula picked the weights (`docs/BALANCE.md`). In the final 50 games eight great powers
  win; Germany, France, the UK, Japan, Russia and Iran never do, because the AI leaves their
  economies 7–18 % under trend (importers' resource and trade shocks from recurring Gulf wars;
  Russia's and Iran's war and sanctions). That is the target this pass does not meet; fixing it is a
  retune of the D-061 resource-shock model, left for its own pass.
- **Research pacing.** The tree was shallow: the US could reach an era-V technology down a single
  four-technology path in about two years. Three changes, calibrated with the runner's
  focused-research probe (the player at 30 % research, auto-queueing toward the frontier):
  1. **Era gate** (`techs.json` `eras[].gate`; `eraGateMet`, `canResearch`): researching an era-N
     technology needs 10 / 8 / 6 / 5 technologies of era N−1 or later for eras II–V. `pathTo` adds
     the cheapest missing ones, so one click still queues a complete path; the research card lists the
     gate with the count fielded. Sharing and stolen designs still require only prerequisites.
  2. **Base costs** of eras II–V × 1.15 / 1.4 / 1.65 / 1.85 (era averages ≈ 135 / 362 / 699 / 1,475 /
     2,776 RP).
  3. **Ahead-of-its-time premium** (`PREMATURE_PREMIUM` = 0.45): +45 % per year before a
     technology's plausible fielding `year`. It uses data the tree already had and paces the frontier
     to its historical window without making on-time research dearer. Shown in the cost tooltip.
  Result: a focused US reaches era V in late 2037, China in mid-2038 (before: 2035 as reported for broad
  research; 2028 for the runner's probe on the old tree). A focused US fields 41 technologies after
  five years (the old tree: 45–49 for the probe, 53 in the reported game).
  The AI's research choice now weights great powers' projects by 1 + 0.5 × (era − 1) so they climb
  toward the frontier instead of finishing every early technology first.
- **Nuclear restraint.** 10 % of all-AI games saw a detonation (2 % a full exchange), most often an
  India–Pakistan war started by India against Pakistan's limited deterrent. `AI_LAUNCH_CHANCE`
  0.25 → 0.12 a month once desperation passes the threshold; a nuclear-armed attacker facing a
  *limited* deterrent needs ×1.6 the usual force ratio (was ×1.3) and scores the target 35 lower
  (was 25).
- **Event wars the chooser would plainly lose.** In a third of the games Iran answered the Gulf
  incident chain ("fast boats swarm a destroyer") by attacking the escort — a declaration of war on
  the United States that brought every NATO member in under Article 5 and kept Europe at war, and
  Hormuz contested, for years. `warPrudence` scales an AI's event choice whose effects have it
  declare war by (its strength ÷ the target side's)², floor 0.03; the stance weights are otherwise
  unchanged and the random draw is the same one.
- **Order of battle.** The AI never built bombers, carriers, ballistic-missile or amphibious ships,
  marines or special forces. Great powers now buy bombers (a share of air orders), and those with
  four or more ships add carriers, amphibious groups and — with ≥ 100 warheads — SSBNs (which count
  toward an assured second strike); 6–7 % of land orders are marines (coastal) or special forces.
- **Landless states.** A nation left holding no land by a peace (Lebanon after an Israeli occupation,
  17 of 50 games) stayed alive for years with nothing; it now capitulates to whoever holds its
  capital. At war the three-month capital rule (D-047) still applies.
- **Turn time.** Research costs looped over every nation per nation (sanctioners' and export
  controllers' share, diffusion): now one pass over the sanction lists and a per-state diffusion set.
  The supply search's binary heap swapped via array destructuring (an allocation per swap); now plain
  temporaries. The sums keep their order, so results are identical, except that the diffusion set is
  computed once per month: a technology finished this month counts toward diffusion next month.

## D-082 — 2026-11-03 — Performance pass: KTX2, on-demand rendering, adaptive DPR, lazy screens

Measured with `npm run perf` (`e2e/perf.spec.ts`, numbers in `docs/PERF.md`). The container has no
Mac and no GPU, so frame times are SwiftShader's; draw calls, triangles, texture bytes, heap and
worker turn time are hardware-independent and are what this pass optimised against.

- **KTX2 / Basis Universal for every large texture** (supersedes the JPEG fallback of D-022). An
  encoder is now available as an npm package (`ktx2-encoder`, MIT, a WASM build of basis_universal),
  so `scripts/build-ktx2.ts` encodes the five colour maps: UASTC + RDO + Zstandard for the day map
  and the normal map (artefacts would show on the hero surface and in the lighting), ETC1S for night
  lights, clouds and bathymetry. Each file carries a full mip chain and is flipped at encode time
  (compressed textures cannot be flipped at upload). At run time `KTX2Loader` transcodes to ASTC 4×4
  or BC7 (1 byte/texel) where available, else ETC2/BC1, else RGBA. The JPEG sources moved to
  `assets/textures/` so they no longer ship. On disk 4.5 MB → 8.9 MB; on the GPU 225 MB → 65 MB.
  The loader's transcoder workers are ended once a set has loaded (each keeps a WASM heap sized for
  a 4096-px image), and the CPU copy of each mip chain is released after upload.
- **Low preset loads half-resolution maps** by dropping the top mip level of each 4096-px KTX2
  (33 MB on the GPU). Switching to or from Low loads the other set and disposes the previous one.
- **Region-ID map packed into RG8** (id low byte, id high byte with the land flag in bit 7; ids stay
  under 2,048): 33.5 → 16.8 MB. The height map's GPU copy is an R8 texture made from the CPU copy
  the renderer already decodes (11 → 2.8 MB, one image decode instead of two).
- **On-demand rendering with a cadence scheduler** (`Scene.tsx`, `quality.ts` `cadenceFor`).
  `frameloop="demand"`; a requestAnimationFrame loop invalidates at the cadence that fits: every
  display frame while the player interacts or something moves (camera flight, drag, inertia,
  strike cam, missile arcs — `activity.ts` `keepAwake`), 30 fps after 8 s without input, 15 fps
  after a minute, 20 fps under a modal, nothing while the window is hidden (`document.hidden`, which
  WKWebView also reports when the app is minimised or on another Space). The globe's own slow
  motion (clouds, waves, storms) reads fine at 15–30 fps; a 2 ms tolerance keeps the throttled
  rates at exact divisors of a 60 Hz display. The dynamic-resolution governor ignores throttled
  frames (they are slow on purpose).
- **Adaptive DPR cap** (`dprCap`): the lowest of the preset's maximum, the display's DPR and a pixel
  budget (High 3.6 MP, Medium 2.2 MP, Low 1.2 MP). A Retina 1440 × 900 window on High starts at
  DPR 1.65 instead of 2 (5.2 MP); the auto-scaler then settles as before (the M3 baseline settled at
  1.3). The settled DPR is saved per preset so the next session starts there, and the cap follows
  window resizes and display changes. `preserveDrawingBuffer` is off: on Apple's tile-based GPUs it
  forces the frame to be copied out every frame.
- **Draw calls.** The scene is already instanced (one `InstancedMesh` for every unit stack, one
  canvas atlas for the symbols); a frame at High was ≈ 27 calls, most of them post-processing. The
  two border line sets are merged into one draw call (kind attribute; the draw range stops before
  the region borders while they are faded out), and bloom uses 6 mip levels on High and 5 on
  Medium instead of 8 (six fewer passes). Now 22 calls at High.
- **GPU resources are disposed.** Materials made with `useMemo` were never freed; `useDispose`
  frees them (and their textures) when replaced or unmounted. Strike arcs and flashes freed their
  geometry but leaked one material per arc and per flash; they now dispose both.
- **Lazy screens.** Every modal (budget, production, research, diplomacy, military, economy,
  briefing, settings, nuclear, battle report, escalation, shortcuts), the end screen and the
  tutorial are `React.lazy` chunks (≈ 160 kB of JS no longer parsed at startup). The news modal stays
  in the main chunk because the breaking-news banner shares its module.
- **Autosave is debounced** (1.5 s): orders arrive in bursts and each write serialises the whole
  state.
- The perf probe now sums draw calls and triangles over every pass of a frame (`info.autoReset` off
  during the sweep), counts only display frames that drew something, accounts textures by their real
  uploaded bytes, and the profile also plays 20 turns, recording worker turn time and the summed
  PSS of the browser's processes.

## D-083 — 2026-11-03 — Native macOS app with Tauri v2

- **Shell.** `src-tauri/` is a minimal Tauri v2 app (Rust): one window titled "World War 3",
  1440 × 900 (min 1100 × 700), the space colour as background so no white flash on launch, the
  Vite `dist/` embedded (fonts, textures, KTX2 transcoder and music included), so it runs offline.
  Bundle targets `app` and `dmg`, minimum macOS 12, ad-hoc signed (`signingIdentity: "-"`): Apple
  silicon refuses to run code with no signature at all, and an ad-hoc signature avoids the
  "damaged app" message that a stripped linker signature can cause. It is not notarised; the README
  explains how to open it (Privacy & Security → Open Anyway, or remove the quarantine flag).
- **Saves in the app data folder.** Rust commands `save_write` / `save_read` / `save_list` /
  `save_delete` / `saves_path` keep each save as `<name>.save.json` plus a small
  `<name>.meta.json` for the load list, in `~/Library/Application Support/game.ww3.worldwar3/saves`.
  Writes go through a temporary file and a rename. Names are sanitised to `[A-Za-z0-9 ._-]`, max 64,
  no leading dot, so a save name can never escape the folder. The browser build keeps IndexedDB
  (`src/state/saves.ts` picks the backend with `isTauri()`). Custom commands rather than the fs
  plugin: no file-system permission scope to get wrong.
- **Fullscreen**: F11 or Ctrl+⌘+F (the macOS convention) and a Settings button; the native window
  via a `toggle_fullscreen` command, the Fullscreen API in a browser.
- **CSP.** Scripts only from the app; `'wasm-unsafe-eval'` and `'unsafe-eval'` because WebKit (tested
  with WebKitGTK 2.52) does not honour `'wasm-unsafe-eval'` for the Basis transcoder's WASM in a blob
  worker — without `'unsafe-eval'` the globe textures never load and no error is surfaced. The app
  loads no remote content, so the exposure is limited to the bundled code.
- **Icon.** An original design (`assets/icon/icon.svg`): an abstract night globe with a graticule,
  soft invented land shapes and one amber trajectory arc. No flags, insignia or real-world emblems.
  `tauri icon` generates the `.icns`, `.ico` and PNGs.
- **Verification mode.** `WW3_AUTOPLAY=<turns>` makes the frontend start a game, end that many turns
  (first choice of every event), fly the camera between theatres, and hand a report (turns, worker
  times, fps, texture MB, errors) to the shell, which writes it to `WW3_AUTOPLAY_REPORT` and quits.
  `scripts/native-verify.sh` launches the packaged app this way and samples memory every second:
  on macOS `phys_footprint` (Activity Monitor's "Memory") of the app plus the `com.apple.WebKit.*`
  processes it started, on Linux the PSS of the process tree. It fails at 1.5 GB.
- **Builds.** A macOS `.app`/`.dmg` cannot be produced on Linux, and this project's development
  container is Linux. `.github/workflows/native.yml` builds on GitHub's Apple-silicon runner
  (`macos-14`), uploads the unsigned `.app` (zipped) and `.dmg`, then runs `native-verify.sh` on the
  bundle. Locally on a Mac: `npm run tauri build`. The Linux build of the same shell
  (`npm run tauri build -- --no-bundle`) was used here to verify the shell, the CSP, saves and the
  autoplay run end to end on WebKitGTK.

## D-084 — 2026-11-03 — Ambient score tracks and alert stingers

- **Score.** Four CC0 tracks from OpenGameArt (credits and links in `docs/DATA_SOURCES.md` and in
  Settings → Audio): calm "Observing the Star" (yd) and "Tragic Ambient Main Menu" (HaelDB) at DEFCON
  5–3, tense "Sirens in Darkness" (The Cynic Project) at 2, crisis "Bleeding Out" (HaelDB) at 1.
  Transcoded to 96 kbps stereo MP3 (MP3 is the one compressed format both WKWebView and Chromium's
  open-source build decode) and loudness-normalised to −20 LUFS; 7.5 MB in all. Two `<audio>`
  elements stream them through `MediaElementSource` nodes into the existing Music bus (D-060), so
  Master, Music and mute apply unchanged; tracks crossfade over 4 s, the calm playlist cycles, single
  tracks loop. Streaming keeps memory flat (no decoded PCM buffers). If a track cannot be decoded the
  procedural bed of D-060 (`musicBed.ts`) takes over for the session. Music stays off by default.
- **Stingers.** `playStinger` adds short phrases in D minor from the same clean sine/triangle tones:
  war (open fifths swelling like brass over a drum hit), nuclear (the D-060 swell plus a falling
  dissonant tritone), DEFCON drop (three falling staccato notes over a pulse), capitulation, capture,
  peace (the game's only major chord), research breakthrough, event, victory and defeat. Once per
  month, only the most important one plays (`stingerFor`, pure and tested), and the score ducks
  beneath it (to 30 %, back over 2.5 s; 5 s for nuclear). Orders within a month never trigger one.
- The three sliders remain Master, Music and Effects (stingers are effects).
- **Case-only file name collision.** `src/ui/audioSettings.ts` and `src/ui/AudioSettings.tsx` built
  on Linux but not on a case-insensitive macOS volume, where `./AudioSettings` resolved to the `.ts`
  file; the first macOS CI build failed on it. The settings module is now `audioPrefs.ts`, and
  `tests/data.test.ts` fails on any two modules whose names differ only by case.

## D-085 — 2026-11-03 — The 2026 Iran war is still on when the campaign opens

Checked against reporting on 3 November 2026 (sources in `docs/DATA_SOURCES.md`). The data had
described the US-Israeli war on Iran as "ended in a fragile ceasefire" under the Islamabad
Memorandum. That was out of date: the memorandum (17 June) collapsed on 8 July, the US reinstated
its naval blockade of Iranian ports, Iran has all but closed the Strait of Hormuz (≈ 10 % of
pre-war transits), the US struck Qeshm Island on 2 November, and Brent is ≈ US$105. Qatar and
Pakistan are mediating talks; no ceasefire is in force. Mojtaba Khamenei remains Supreme Leader and
Pezeshkian president, so `data/leaders.json` was already correct.

- **Starting war.** `data/forces.json` `startingWars` entries are now objects
  (`attackers`, `defenders`, `since`, optional per-nation `mobilization`, `warWeariness`,
  `defcon`). USA + Israel vs Iran since turn −11 (28 February 2026), one coalition war, so a US–Iran
  peace also ends Israel's part (Israel has no separate truce with Iran and is planning joint strikes
  with the US). The US is not mobilised (0); Iran is on a war footing (2, DEFCON 2). Russia–Ukraine
  `since` is corrected from −34 to −59 (24 February 2022), which moves the UN anniversary check to
  February.
- **Hormuz closed at start.** `startingChokepoints` in `data/forces.json` sets Hormuz `closed` by
  Iran. Kept in the hand-maintained forces file, not the generated `chokepoints.json`. The normal
  rules then apply: the closure lapses the month Iran is out of every war, and turns `contested` when
  US sea dominance covers both sides of the strait (a stand-in for the escorted convoys).
- **Oil index baseline.** `oilPrice` 1.00 now means "all straits open", the pre-war 2025 market
  (Brent ≈ US$69, EIA), not "January 2027". Setup computes the index from the starting closures
  (`oilIndex`), so the campaign opens at ×1.60 ≈ US$110, close to the observed ≈ US$105.
- **Calibration.** Trade and shortage penalties are still zero on turn 0 (the IMF baseline already
  reflects the war). One fix was needed: the shortage term floored its reference at 0.05 in both the
  numerator and the denominator, so a Gulf importer cut off on turn 0 started with a penalty; the
  floor now guards only the division. The chokepoint growth effects (Gulf trade loss, oil-import bill,
  exporter windfall) do apply from turn 1, as with any closure. Reopening the strait therefore gives a
  real recovery. Some of that cost may double-count the IMF forecast; we accept that so that ending
  the closure matters.
- **Escalation.** With two majors at war, the January 2027 world starts on rung 4 (great powers at
  war), not 3.
- **Flashpoint.** `iran-israel-gulf` tension rises from 70 to 80. Its description and events now
  describe talks rather than a ceasefire; the US decision event ("A deal with Iran on the table")
  can end the war (`peace` USA–IRN).

## D-086 — 2026-11-03 — Simple mode: the president's game

The full game asks a new player to learn budgets, production queues, an 81-tech tree, supply and
unit orders before the first month makes sense. Simple mode is a second way to play the same
simulation, understandable in two minutes. Nothing is removed from the simulation; the details are
managed for the player.

- **Mode lives in the game state** (`GameState.mode`, `GameState.simple`), because it changes what
  the simulation does each month and must be saved, replayed and deterministic. `setMode` switches
  at any time (Settings → How you play) and touches nothing else: the switching test checks the rest
  of the state is deep-equal before and after, both ways. Saves without `mode` are Full. New Game asks
  "How do you want to play?" first; Simple is selected for a first game (`prefs.lastMode` null) and
  the last choice afterwards.
- **The AI runs the player** (`aiNation(…, managed = true)` in `ai.ts`): budget, mobilisation,
  research, production, unit placement and air missions, from the player leader's traits, exactly as
  for an AI nation, plus war bonds. It does **not** take strategic strikes, cyber, ASAT or spy
  operations, diplomacy, sanctions or nuclear decisions — those stay the player's, through Decision
  Cards and Attack/Defend. Three managed-only adjustments, because the AI's budget ignored the voters
  it never faced: social spending has a floor of 40 % (+10 while support is under 50), and unspent
  military money (treasury over two months' revenue) is moved to social and infrastructure. Without
  them a managed United States spent 44 % on the military at war with Iran, hoarded US$ 4 trn and fell
  from 56 to 35 approval in 14 months; with them it holds ≈ 50, close to an untouched Full game. The
  player's spending lean (`militaryBias`, ±15 points in steps of 5) is applied after these rules,
  moving points between the army and social spending.
- **Stances.** Attack or Defend per nation (`setStance`). Attack declares war if needed (confirmed in
  the UI) and lets the managed AI invade at 0.9 × its attack threshold even when on the defensive,
  concentrating reinforcements on that front. Defend never invades (own land is still liberated); in
  peacetime it makes that nation the garrison target and raises the garrison chance from 15 to 50 %.
  Attack orders lapse when the war ends.
- **Decision Cards** (`src/sim/simple.ts`) are derived from the state, never stored: a pure
  function both the UI and the worker evaluate, so a `decide {card, option}` command names a card and
  the worker re-derives it and applies the option's ordinary commands (`resolveEvent`, `respond`,
  `propose`, `setStance`, `setMilitaryBias`, `setTaxRate`, `issueWarBonds`, `leaveBloc`). Kinds, in
  priority order: crises (the event deck's player decisions, replacing the event modal), peace offers,
  wars (Attack / Hold the line / Offer peace), threats (a war plan against us, or a hostile power:
  Guard the border / Sanctions or talks / Strike first), money shortages, pacts with great powers,
  arms requests, sanctions to lift or impose, a defence pact a friendly nation would sign, a bloc
  falling apart, and military spending. At most three a month; at least one at the start of every
  month (military spending when nothing else is on the desk); answered cards come back after a
  per-kind cooldown. Every option shows its likely effect in words — odds from `warOdds` (side
  strength ratio → "Likely win, heavy losses"), feelings from relation changes ("China will be
  furious"), acceptance from the AI's own `evaluateProposal`. Each option carries `sensible`; a test
  plays 60 Simple turns by clicking only card buttons and End Turn and asserts every card has a
  sensible option. Unanswered cards are left as they are (crises take their first option, as in Full).
- **HUD.** Four meters: Money (treasury), Military strength (share of the strongest great power's
  power, and rank), Public support, Danger of nuclear war (max of global tension and 22 per DEFCON
  step below 5, with "DEFCON n (5 = peace)" beside it). Date, goal line, one End Turn button, one
  Advanced button that opens every Full screen, and Settings. The map shows Countries, plus a War view
  (the military map mode) while at war; unit symbols are drawn only in the war view.
- **Goal tracker.** "Be the top power in 2040 without a nuclear war: N % of the way there": the share
  of the time to January 2040 elapsed, scaled by the standing rank (1st ×1, each place −15 %, floor
  30 %). After a detonation the line switches to the Hegemony victory (bloc share of world GDP ÷ 55 %).
- **Report.** `endTurn` writes up to three plain bullets (`simple.report`): new wars and peace,
  regions lost or taken, a nuclear detonation, alert level changes, approval swings, an election
  within three months, money, the ongoing war, research, one world headline — highest score first.
- **Tutorial.** Simple mode has its own five steps (`SIMPLE_TUTORIAL_STEPS`); the 27-step tutorial
  is unchanged for Full mode.
- **Keyboard.** In Simple mode only Enter, Escape, H, L, ? and the two map keys act; screens are
  reached through Advanced.
