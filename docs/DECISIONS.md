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
