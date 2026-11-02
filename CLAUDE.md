# CLAUDE.md — World War 3

A turn-based grand strategy game (1 turn = 1 month, starting January 2027) set in a near-future global war (Civilization meets
Hearts of Iron), rendered on a photoreal 3D globe. Built with Vite + React 18 + TypeScript
(strict), three / @react-three/fiber / drei / postprocessing, and zustand.

## Standing rules

1. **Read `docs/DESIGN.md` and `docs/DECISIONS.md` before starting any task.** Record new
   non-obvious decisions in `docs/DECISIONS.md`.
2. **Task workflow.** For every task:
   - Create a branch named `feat/<topic>` or `fix/<topic>` (`docs/<topic>` for documentation-only work).
   - Finish with `npm run check` green.
   - Run `npm run e2e` to save a Playwright screenshot of the game to
     `docs/screenshots/<branch>.png` (slashes become dashes). **Open the screenshot and look at it.**
   - Commit, then `git checkout main && git merge --no-ff <branch>` and `git push origin main`.
3. **Hardware target: Apple M3, 8 GB unified memory.** 60 fps, < 1.5 GB RAM, < 400 MB GPU
   textures. Never ship textures larger than 4096 px; prefer KTX2/Basis. Use instancing for
   repeated objects. Keep the simulation off the main thread. See `docs/PERF.md`.
4. **The simulation must be deterministic.** Use the seeded RNG (`src/sim/rng.ts`). Never use
   `Date.now`, `new Date` or `Math.random` inside `src/sim` (lint enforces this). Cover the
   simulation with unit tests.
5. **Real-world data must cite a source.** Every `data/` file has top-level `"source"` and
   `"asOf"`, and a row in `docs/DATA_SOURCES.md`. Never invent statistics silently. If you
   estimate, mark it `"estimate": true`.
6. **Real people** appear only as names, titles and trait scores derived from the public record.
   Never use photos or likenesses. Mark fictional successors `"fictional": true`.
7. **Assets need clear licences:** NASA public domain, Natural Earth public domain, or
   MIT/CC0/CC-BY. Record each one with its licence in `docs/DATA_SOURCES.md`.
8. **The UI never shows a number without a tooltip explaining it.** Use `src/ui/Stat.tsx`.

## Layout

- `src/sim/` — pure deterministic simulation (no DOM, no three). Runs in a Web Worker.
- `src/render/` — globe, map layers, units, effects.
- `src/ui/` — React HUD and panels.
- `src/state/` — zustand stores and the worker bridge (`simBridge.ts`).
- `data/` — JSON game data (top-level `source` + `asOf` required, validated in tests).
- `scripts/` — Node data-build scripts.
- `public/textures/` — runtime textures.
- `docs/` — DESIGN, DECISIONS, DATA_SOURCES, PERF, screenshots/.

## Commands

- `npm run dev` / `build` / `preview`
- `npm run typecheck` / `lint` / `test`
- `npm run e2e` — Playwright smoke test + screenshot. If the bundled browser version doesn't
  match, set `PW_CHROMIUM_PATH=/path/to/chrome`.
- `npm run check` = typecheck + lint + test + build (runs in CI on every push; a
  separate CI job then runs `npm run e2e`).
