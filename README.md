# World War 3

A turn-based near-future grand strategy game (Civilization meets Hearts of Iron) on a
3D globe. One turn is one month, and the campaign starts in January 2027. The design brief is
in [`docs/DESIGN.md`](docs/DESIGN.md), the project rules are in [`CLAUDE.md`](CLAUDE.md), and
decisions, data sources and the performance budget are in [`docs/`](docs/).

> This is a fictional simulation. Real nations and leaders appear only as names, titles and
> trait scores derived from the public record.

## Play it on your Mac

Requirements: macOS on Apple silicon (the target is an M3 with 8 GB), a current Chrome or Safari, Git
(which comes with Xcode Command Line Tools: `xcode-select --install`), and **Node.js 22.12 or newer**.

1. Install Node 22 if you don't have it. Use one of these:

   ```bash
   brew install node@22 && brew link --overwrite --force node@22
   ```

   or, with [nvm](https://github.com/nvm-sh/nvm) (the repo has an `.nvmrc`):

   ```bash
   nvm install 22 && nvm use 22
   ```

   Check it with `node -v` (it should print `v22.x` or newer).

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

   Open **http://localhost:5173** in your browser. The dev server reloads as code changes.
   Press `Ctrl+C` in the terminal to stop it.

4. Get the latest version later:

   ```bash
   git pull && npm install && npm run dev
   ```

To play an optimised production build instead of the dev server:

```bash
npm run build && npm run preview
```

then open **http://localhost:4173**.

A native macOS app (Tauri v2) is planned. Until then the game runs in the browser.

### Troubleshooting (macOS)

- **`npm install` fails or the engines check complains**: run `node -v`. You need 22.12 or newer.
- **Blank or black screen**: the game needs WebGL 2, which is on by default in current Safari and Chrome.
  In Chrome, `chrome://gpu` shows whether hardware acceleration is on.
- **Port 5173 is busy**: run `npm run dev -- --port 5174`.

## Development

| Command          | What it does                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`    | Vite dev server                                                                                                 |
| `npm run check`  | typecheck + lint + unit tests + production build (CI runs this)                                                 |
| `npm test`       | Vitest unit tests (simulation, data validation)                                                                 |
| `npm run e2e`    | Playwright smoke test; saves `docs/screenshots/<branch>.png`. Run `npx playwright install chromium` once first. |
| `npm run format` | Prettier                                                                                                        |

CI (GitHub Actions) runs `check` on every push, then the `e2e` job.
