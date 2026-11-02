# Decisions Log

Record every non-obvious decision here: ID, date, decision, why. Newest at the bottom.
Supersede rather than edit: add a new entry that references the old one.

## D-001 — 2026-11-02 — Design brief missing at bootstrap

The bootstrap prompt's design-brief section was empty. `docs/DESIGN.md` holds a
placeholder asking for the brief. Decisions below are provisional and must be checked
against the brief once it lands.

## D-002 — 2026-11-02 — Toolchain versions

Vite 8, React 18.3 (pinned to 18 as requested; R3F 8 / drei 9 / postprocessing 2 are the
React-18-compatible lines), TypeScript 6 strict (+ `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), three 0.187, zustand 5, vitest 5, Playwright 1.64, ESLint 10
flat config + typescript-eslint, Prettier 3. Node ≥ 22.12 (`.nvmrc` = 22; CI uses 22). The brief
said "Node 20+". 22 meets that, and it is required: vitest 5 needs Node ≥ 22.12, and Node 20
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

## D-005 — 2026-11-02 — Calendar without `Date`

In-game dates use a pure days-from-civil algorithm (`src/sim/calendar.ts`), so even
fixed-epoch calendar maths never touches `Date`.

## D-006 — 2026-11-02 — Turn length = 1 week; start date 2027-01-01

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

## D-009 — 2026-11-02 — E2E is not part of `check`/CI yet

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

## D-012 — 2026-11-02 — Chunk-size warning raised to 2 MB

three + R3F + drei produce a single chunk of about 1 MB. The warning limit is raised for now;
code-splitting comes in the perf pass (see `docs/PERF.md`).
