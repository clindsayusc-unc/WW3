# World War 3

A turn-based near-future grand strategy game (Civilization meets Hearts of Iron) on a photoreal
3D globe. One turn is one month, the campaign starts in January 2027, and you can play any of the
14 major powers: USA, China, Russia, India, UK, France, Germany, Japan, South Korea, Iran, Israel,
Turkey, Pakistan and Brazil. The design brief is in [`docs/DESIGN.md`](docs/DESIGN.md), project rules
in [`CLAUDE.md`](CLAUDE.md), and decisions, data sources and the performance budget in
[`docs/`](docs/).

> This is a fictional simulation. Nations, leaders and events are simulated from public data (IMF,
> SIPRI, FAS, Natural Earth, NASA) and editorial estimates; real people appear only as names, titles
> and trait scores derived from the public record. Nothing here predicts or advocates anything.

![Full globe, political map mode](docs/screenshots/globe-full.png)

## Play it on your Mac

Requirements: macOS on Apple silicon (the target is an M3 with 8 GB), a current Chrome or Safari, Git
(from Xcode Command Line Tools: `xcode-select --install`) and **Node.js 22.12 or newer**.

1. Install Node 22 if you don't have it:

   ```bash
   brew install node@22 && brew link --overwrite --force node@22
   ```

   or with [nvm](https://github.com/nvm-sh/nvm) (the repo has an `.nvmrc`):

   ```bash
   nvm install 22 && nvm use 22
   ```

2. Clone and install:

   ```bash
   git clone https://github.com/clindsayusc-unc/WW3.git
   cd WW3
   npm install
   ```

3. Run the game:

   ```bash
   npm run dev
   ```

   Open **http://localhost:5173**. For the optimised build: `npm run build && npm run preview`, then
   open **http://localhost:4173**.

All map data and textures are committed, so the game runs offline. Rebuilding them from the
original sources (Natural Earth, NASA, IMF, World Bank) is optional: `npm run build:map`,
`npm run build:textures`, `npm run build:nations`.

## The native macOS app (Apple silicon)

World War 3 also ships as a native app built with [Tauri v2](https://tauri.app): a small Rust shell
around the same game, using macOS's own WebKit. Everything (textures, data, fonts, music) is
bundled, so it runs fully offline. Saves are files in
`~/Library/Application Support/game.ww3.worldwar3/saves/` (Settings → Saves shows the path), and
**F11** or **Ctrl ⌘ F** toggles fullscreen (also a button in Settings → Display).

### Download a build

Every push to `main` builds the app on an Apple-silicon runner (`.github/workflows/native.yml`).
Open the repository's **Actions → native** run and download the `ww3-macos-arm64` artifact: it holds
`World War 3_0.1.0_aarch64.dmg` and a zipped `World War 3.app`.

### Build it yourself

Requirements: Xcode Command Line Tools (`xcode-select --install`), Node 22.12+ and Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```bash
npm install
```

```bash
npm run tauri build
```

The app lands in `src-tauri/target/release/bundle/macos/World War 3.app` and the disk image in
`src-tauri/target/release/bundle/dmg/`. `npm run tauri dev` runs the native shell against the Vite
dev server with hot reload.

### Opening an unsigned app

The build is **not signed or notarised** with an Apple Developer ID (it carries only an ad-hoc
signature), so Gatekeeper blocks the first launch with "World War 3 cannot be opened because Apple
cannot check it for malicious software" (or "… is damaged" for a download). To open it:

1. Open the `.dmg` and drag **World War 3** into **Applications**.
2. Double-click the app once; macOS refuses and offers only **Done** / **Move to Bin**. Choose **Done**.
3. Open **System Settings → Privacy & Security**, scroll to **Security**, and click **Open Anyway**
   next to "World War 3 was blocked…". Confirm with your password, then **Open**.
   (On macOS 14 and earlier you can instead Control-click the app in Finder → **Open** → **Open**.)

macOS remembers the choice; later launches open normally. If you prefer the Terminal, removing the
quarantine flag that the browser added to the download does the same thing:

```bash
xattr -dr com.apple.quarantine "/Applications/World War 3.app"
```

Only do this for builds you made yourself or downloaded from this repository's Actions runs.

### Verifying a build

`npm run native:verify` launches the packaged app in an unattended mode (`WW3_AUTOPLAY=20`): it starts
a new game as the USA, ends 20 turns (taking the first choice of every event), sweeps the camera, and
writes a report, while the script samples the memory of the app and its WebKit processes every
second (phys_footprint, as Activity Monitor shows it). It fails if the peak reaches 1.5 GB. The CI
job runs it after every build; numbers are recorded in `docs/PERF.md`.

## How to play

New Game first asks **how you want to play**:

- **Simple** (the default for a first game): your ministers run the economy, budget, factories,
  research and armies. Each month you answer one to three **Decision Cards** — a crisis, a war, an
  offer, a threat, military spending — whose buttons say in plain words what will probably happen.
  Click a country on the globe and press **Attack** or **Defend**; armies go to the fronts on their
  own. Four meters (money, military strength, public support, danger of nuclear war), a one-line goal
  and a three-line report each month. **Advanced** opens every Full screen.
- **Full**: every lever by hand, as below. Switch at any time in Settings without losing your game.

1. **New Game** → pick a scenario (_World of 2027_ or _Taiwan Strait Crisis_) and a nation from the
   leader cards.
2. Each month: read the alerts and news ticker, set your **Budget** (B), queue **Production** (P),
   pick **Research** (R), talk to other nations in **Diplomacy** (D) and review your forces in
   **Military** (M): strength by domain against your rivals, air-wing missions, missile strikes,
   cyber operations, spies and satellites. Then press **End Turn** (Enter).
   Map mode 8 shows the supply network and who controls each sea zone; enemy forces appear only as
   far as your intelligence reaches; a battle alert opens the full battle report.
3. **Move or attack**: click a region with your units, click the stack in the right-hand panel to
   select it, then right-click a destination. The panel shows the estimated odds before you commit.
   You can only enter regions of nations you are at war with. Marines and special forces can cross a
   sea zone you control.
4. **Win** by hegemony (your bloc holds 55% of world GDP), conquest (every rival major capitulates),
   diplomacy (pass a World Order Resolution with a dominant bloc) or deterrence (reach January 2040
   as the top power without a nuclear war). Lose by capitulation, regime collapse or a full nuclear
   exchange, which nobody wins.

Every number in the interface has a tooltip explaining where it comes from. Settings (⚙) has
Master, Music and Effects volume sliders. The ambient score (CC0 tracks, credited in Settings and
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)) is off by default; switched on, it follows your
DEFCON from calm to tense to crisis, and short stingers mark wars, DEFCON drops, capitulations,
peace, research breakthroughs and events.

### Controls

| Input                   | Action                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Drag / scroll           | Orbit / zoom (full globe down to ~320 km)                          |
| Left click              | Select region or sea zone                                          |
| Right click             | Move/attack with the selected units                                |
| `Enter`                 | End turn                                                           |
| `1`–`8`                 | Map modes: political, blocs, relations, economy, military, tension, terrain, supply |
| `B` `P` `R` `D` `M` `S` | Budget, Production, Research, Diplomacy, Military, Summary         |
| `L`                     | Toggle labels                                                      |
| `F11` / `Ctrl ⌘ F`      | Fullscreen                                                         |
| `Esc`                   | Close window / clear selection                                     |

Settings (⚙) has quality presets (Low/Medium/High, default High), sound, labels and clouds toggles,
named saves and JSON export/import. The game autosaves after every change (to IndexedDB in a
browser, to a file in the native app); **Continue** on the main menu resumes it.

## Development

| Command                  | What it does                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Vite dev server                                                                                                                                                                                                                                 |
| `npm run check`          | typecheck + lint + unit tests + production build (CI runs this)                                                                                                                                                                                 |
| `npm test`               | Vitest: determinism, economy bounds, combat monotonicity, AI order validity, 120-turn soak, data validation                                                                                                                                     |
| `npm run e2e`            | Playwright: new game as USA, every screen, war declaration + move order, 10 turns; Taiwan Strait Crisis as China for 50 turns; no console errors; screenshots in `docs/screenshots/`. Set `PW_CHROMIUM_PATH` if the bundled browser is missing. |
| `npm run perf`           | Performance profile: camera sweep at Low, Medium and High (frame time, draw calls, triangles, JS heap, GPU texture MB), then 20 turns with worker turn time and browser process memory; writes `docs/perf-last-run.json` |
| `npm run tauri build`    | Native app: `.app` and `.dmg` on macOS (see above)                                                                                                                                                                                              |
| `npm run native:verify`  | Launch the packaged app, play 20 turns unattended, check memory < 1.5 GB                                                                                                                                                                        |
| `npm run build:ktx2`     | Re-encode the globe textures to KTX2 / Basis Universal                                                                                                                                                                                          |
| `npm run soak`           | Headless 60-turn simulation with timing and a world event log                                                                                                                                                                                   |
| `npm run selfplay -- --games 50 --label run` | All-AI self-play to January 2040 on worker threads; writes winners, wars, nuclear use, GDP and research trajectories, turn times, NaN and stuck-state findings and SVG charts to `docs/balance/<label>/` (`--probe` adds the focused-research pace probe, `--compare a b` charts two runs). See `docs/BALANCE.md`. |
| `npm run build:map`      | Rebuild regions/sea zones/ID texture from Natural Earth                                                                                                                                                                                         |
| `npm run build:textures` | Rebuild globe textures from NASA imagery                                                                                                                                                                                                        |
| `npm run build:nations`  | Rebuild `data/nations.json` from the IMF/World Bank APIs                                                                                                                                                                                        |

Layout: `src/sim` (pure deterministic simulation, runs in a Web Worker), `src/render` (globe, layers,
units, camera), `src/ui` (React HUD and screens), `src/state` (zustand stores, worker bridge, saves),
`data/` (JSON with `source` + `asOf`), `scripts/` (data builds), `public/textures/` (runtime KTX2),
`assets/` (texture and icon sources), `src-tauri/` (native shell).

CI (GitHub Actions) runs `check` on every push, then the `e2e` job; pushes to `main` also build and
verify the macOS app.
