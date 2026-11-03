#!/usr/bin/env bash
# Verifies a packaged build of the native app (D-083): launches it in autoplay mode, which starts
# a new game and ends N turns unattended, samples the memory of the app and its WebKit helper
# processes every second, and fails if the peak reaches the 1.5 GB budget or the run fails.
#
#   scripts/native-verify.sh [path/to/app-or-binary] [turns]
#
# macOS: pass the .app (default: src-tauri/target/release/bundle/macos/World War 3.app).
#        Memory = phys_footprint per process (what Activity Monitor's "Memory" column shows),
#        read with `footprint` when available, else RSS; summed over the app and the
#        com.apple.WebKit.* processes it started.
# Linux: pass the binary (default: src-tauri/target/release/ww3). Run under xvfb-run when
#        there is no display. Memory = proportional set size (PSS) summed over the process tree,
#        so pages shared between WebKit processes are counted once.
#
# Writes the app's own report and the memory samples to docs/native-verify-<os>.json.
set -euo pipefail
cd "$(dirname "$0")/.."

OS="$(uname -s)"
TURNS="${2:-20}"
BUDGET_MB=1536
REPORT="$(mktemp -t ww3-autoplay.XXXXXX).json"
OUT="docs/native-verify-$(echo "$OS" | tr '[:upper:]' '[:lower:]').json"

if [[ "$OS" == "Darwin" ]]; then
  APP="${1:-src-tauri/target/release/bundle/macos/World War 3.app}"
  BIN="$(find "$APP/Contents/MacOS" -maxdepth 1 -type f -perm -u+x | head -n 1)"
else
  BIN="${1:-src-tauri/target/release/ww3}"
fi
[[ -x "$BIN" ]] || { echo "No executable at $BIN — build first (npm run tauri build)"; exit 1; }

# WebKit helpers already running belong to other apps; only new ones are ours (macOS).
before_webkit=""
if [[ "$OS" == "Darwin" ]]; then
  before_webkit="$(pgrep -f 'com.apple.WebKit' || true)"
fi

echo "Launching $BIN with WW3_AUTOPLAY=$TURNS"
WW3_AUTOPLAY="$TURNS" WW3_AUTOPLAY_REPORT="$REPORT" "$BIN" &
APP_PID=$!
START=$(date +%s)

descendants() { # pid → itself and every descendant (Linux)
  local p=$1
  echo "$p"
  for c in $(pgrep -P "$p" || true); do descendants "$c"; done
}

mem_mb() {
  if [[ "$OS" == "Darwin" ]]; then
    local pids="$APP_PID"
    for p in $(pgrep -f 'com.apple.WebKit' || true); do
      grep -qx "$p" <<<"$before_webkit" || pids="$pids $p"
    done
    local total_kb=0
    for p in $pids; do
      local kb=""
      if command -v footprint >/dev/null 2>&1; then
        # "phys_footprint: 123 MB" (or KB/GB) in footprint's summary for the process.
        kb=$(footprint "$p" 2>/dev/null | awk '/phys_footprint:/ {v=$2; u=$3; if (u ~ /^G/) v*=1048576; else if (u ~ /^M/) v*=1024; print int(v); exit}')
      fi
      [[ -n "$kb" ]] || kb=$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ' || echo 0)
      total_kb=$((total_kb + ${kb:-0}))
    done
    echo $((total_kb / 1024))
  else
    local total_kb=0
    for p in $(descendants "$APP_PID"); do
      local kb
      kb=$(awk '/^Pss:/ {print $2}' "/proc/$p/smaps_rollup" 2>/dev/null || echo 0)
      total_kb=$((total_kb + ${kb:-0}))
    done
    echo $((total_kb / 1024))
  fi
}

PEAK=0
SAMPLES=()
TIMEOUT=$((TURNS * 120 + 300))
while kill -0 "$APP_PID" 2>/dev/null; do
  m=$(mem_mb || echo 0)
  SAMPLES+=("$m")
  (( m > PEAK )) && PEAK=$m
  if (( $(date +%s) - START > TIMEOUT )); then
    echo "Timed out after ${TIMEOUT}s"
    kill "$APP_PID" || true
    break
  fi
  sleep 1
done
wait "$APP_PID" || true
ELAPSED=$(( $(date +%s) - START ))

if [[ ! -s "$REPORT" ]]; then
  echo "FAIL: the app exited without an autoplay report (peak ${PEAK} MB after ${ELAPSED}s)"
  exit 1
fi

node -e '
const fs = require("fs");
const [report, out, peak, budget, elapsed, os, ...samples] = process.argv.slice(1);
const r = JSON.parse(fs.readFileSync(report, "utf8"));
const res = { os, at: new Date().toISOString(), elapsedSeconds: +elapsed, peakProcessMB: +peak,
  budgetMB: +budget, memorySamplesMB: samples.map(Number), app: r };
fs.writeFileSync(out, JSON.stringify(res, null, 2) + "\n");
console.log(`turns ${r.turnsPlayed}/${r.turnsRequested} (${r.finalDate}), worker turn mean ${r.workerTurnMs.mean.toFixed(0)} ms, peak memory ${peak} MB of ${budget} MB → ${out}`);
if (!r.ok) { console.error("FAIL: " + (r.error ?? "not every turn was played")); process.exit(1); }
if (+peak >= +budget) { console.error("FAIL: over the memory budget"); process.exit(1); }
console.log("PASS");
' "$REPORT" "$OUT" "$PEAK" "$BUDGET_MB" "$ELAPSED" "$OS" "${SAMPLES[@]}"
