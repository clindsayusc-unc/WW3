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
