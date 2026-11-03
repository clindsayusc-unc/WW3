/**
 * Audio (D-060): one WebAudio graph with Master → Music and Effects buses, persisted volumes,
 * and UI sounds synthesised from clean oscillator tones only (no noise buffers, no square or
 * sawtooth waves). The ambient music bed lives in music.ts and plays on the music bus.
 */
import { useUiStore } from '../state/uiStore';
import type { AudioSettings } from './audioPrefs';

export {
  AUDIO_KEY,
  DEFAULT_AUDIO,
  MUSIC_HINT_KEY,
  loadAudioSettings,
  parseAudioSettings,
  saveAudioSettings,
} from './audioPrefs';
export type { AudioSettings } from './audioPrefs';

export type SoundName =
  | 'click'
  | 'order'
  | 'endTurn'
  | 'alert'
  | 'battle'
  | 'nuclear'
  | 'open'
  | 'close'
  | 'accept'
  | 'reject';

/** Perceptual volume curve: sliders feel linear, gains are squared. */
export const volumeGain = (v: number): number => Math.min(1, Math.max(0, v)) ** 2;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  effects: GainNode;
  music: GainNode;
}
let graph: Graph | null = null;

export function audioGraph(): Graph | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!graph) {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    const effects = ctx.createGain();
    const music = ctx.createGain();
    effects.connect(master);
    music.connect(master);
    master.connect(ctx.destination);
    graph = { ctx, master, effects, music };
    applyVolumes(useUiStore.getState().audio, useUiStore.getState().muted);
  }
  if (graph.ctx.state === 'suspended') void graph.ctx.resume();
  return graph;
}

/** Pushes the store's volumes into the graph (smoothly, so slider drags do not click). */
export function applyVolumes(s: AudioSettings, muted: boolean): void {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  graph.master.gain.setTargetAtTime(muted ? 0 : volumeGain(s.master), t, 0.05);
  graph.effects.gain.setTargetAtTime(volumeGain(s.effects), t, 0.05);
  graph.music.gain.setTargetAtTime(volumeGain(s.music), t, 0.05);
}

/**
 * One clean note on the effects bus: sine or triangle, soft attack, exponential release, optional
 * pitch slide. `at` delays the start (seconds) without timers.
 */
function tone(
  freq: number,
  dur: number,
  type: 'sine' | 'triangle',
  gain: number,
  slide = 0,
  at = 0,
  attack = Math.min(0.02, dur / 4),
): void {
  const g = audioGraph();
  if (!g || useUiStore.getState().muted) return;
  const { ctx, effects } = g;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const env = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(env).connect(effects);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** UI sounds: short, soft, musical (A minor pentatonic for the stingers). */
export function playSound(name: SoundName): void {
  switch (name) {
    case 'click':
      tone(1320, 0.035, 'sine', 0.05);
      break;
    case 'open':
      tone(660, 0.09, 'sine', 0.07, 220);
      break;
    case 'close':
      tone(660, 0.09, 'sine', 0.05, -220);
      break;
    case 'order':
      tone(880, 0.07, 'triangle', 0.06);
      tone(1320, 0.09, 'triangle', 0.045, 0, 0.05);
      break;
    case 'endTurn':
      tone(220, 0.35, 'triangle', 0.07);
      tone(330, 0.4, 'sine', 0.05, 0, 0.08);
      tone(440, 0.5, 'sine', 0.04, 0, 0.16);
      break;
    case 'alert':
      tone(880, 0.14, 'triangle', 0.05);
      tone(880, 0.14, 'triangle', 0.05, 0, 0.18);
      break;
    case 'accept':
      tone(523, 0.12, 'sine', 0.07);
      tone(784, 0.18, 'sine', 0.07, 0, 0.1);
      break;
    case 'reject':
      tone(330, 0.22, 'triangle', 0.05, -90);
      break;
    case 'battle':
      // A low drum-like thump: pitch drops fast, no noise.
      tone(140, 0.45, 'sine', 0.18, -95);
      tone(70, 0.6, 'sine', 0.12, -30, 0.02);
      break;
    case 'nuclear':
      // Deep swell from two detuned sub tones and a slow falling fifth.
      tone(44, 3, 'sine', 0.3, -12);
      tone(44.6, 3, 'sine', 0.25, -12);
      tone(66, 2.2, 'triangle', 0.08, -20, 0.4);
      break;
  }
}

/**
 * Alert stingers (D-084): short musical phrases for the moments that matter, built from the same
 * clean sine and triangle tones, in D minor to sit under the score. The score ducks beneath them.
 */
export type StingerKind =
  | 'nuclear'
  | 'war'
  | 'defeat'
  | 'victory'
  | 'capitulation'
  | 'defcon'
  | 'capture'
  | 'peace'
  | 'research'
  | 'event';

/** Highest first: only the most important stinger of a month plays. */
export const STINGER_PRIORITY: readonly StingerKind[] = [
  'nuclear',
  'defeat',
  'victory',
  'war',
  'capitulation',
  'defcon',
  'capture',
  'peace',
  'research',
  'event',
];

/** Notes (Hz) used below: D minor around D3–D5. */
const N = {
  D2: 73.42,
  A2: 110,
  D3: 146.83,
  F3: 174.61,
  A3: 220,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  Fs4: 369.99,
  G4: 392,
  A4: 440,
  Bb4: 466.16,
  C5: 523.25,
  D5: 587.33,
  F5: 698.46,
  A5: 880,
};

let duck: ((depth?: number, seconds?: number) => void) | null = null;
/** music.ts registers its ducking here (keeps this module free of the music import cycle). */
export function setStingerDuck(fn: (depth?: number, seconds?: number) => void): void {
  duck = fn;
}

export function playStinger(kind: StingerKind): void {
  if (useUiStore.getState().muted) return;
  duck?.(kind === 'research' || kind === 'event' ? 0.6 : 0.3, kind === 'nuclear' ? 5 : 2.5);
  switch (kind) {
    case 'nuclear':
      playSound('nuclear');
      // A thin, dissonant high tritone that slowly falls away above the sub swell.
      tone(N.A5, 3.5, 'sine', 0.025, -60, 0.6, 1.2);
      tone(622.25, 3.5, 'sine', 0.02, -45, 0.7, 1.2);
      break;
    case 'war':
      // Low open fifths swelling like brass, a drum hit, and a minor third answering above.
      tone(140, 0.5, 'sine', 0.2, -85);
      tone(N.D2, 2.4, 'triangle', 0.09, 0, 0.02, 0.25);
      tone(N.A2, 2.4, 'triangle', 0.07, 0, 0.02, 0.25);
      tone(N.D3, 2.2, 'triangle', 0.06, 0, 0.05, 0.3);
      tone(N.F4, 1.4, 'triangle', 0.045, 0, 0.55, 0.08);
      tone(N.D4, 1.8, 'triangle', 0.045, 0, 0.95, 0.08);
      break;
    case 'defcon':
      // Three falling staccato notes over a pulse: the clock ticking toward the brink.
      tone(N.A4, 0.22, 'triangle', 0.06);
      tone(N.F4, 0.22, 'triangle', 0.06, 0, 0.26);
      tone(N.D4, 0.6, 'triangle', 0.065, 0, 0.52);
      tone(N.D2, 1.2, 'sine', 0.12, 0, 0.52, 0.05);
      break;
    case 'capitulation':
      tone(N.A3, 0.9, 'triangle', 0.06, 0, 0, 0.06);
      tone(N.D3, 1.8, 'triangle', 0.06, 0, 0.45, 0.1);
      tone(N.D2, 2, 'sine', 0.1, 0, 0.45, 0.2);
      break;
    case 'capture':
      tone(N.D4, 0.3, 'triangle', 0.05);
      tone(N.A4, 0.7, 'triangle', 0.05, 0, 0.18);
      tone(110, 0.4, 'sine', 0.1, -40);
      break;
    case 'peace':
      // D major: a warm resolution, the only major chord in the game's palette.
      tone(N.D4, 2.4, 'sine', 0.05, 0, 0, 0.3);
      tone(N.Fs4, 2.4, 'sine', 0.04, 0, 0.12, 0.3);
      tone(N.A4, 2.4, 'sine', 0.04, 0, 0.24, 0.3);
      tone(N.D5, 2.2, 'sine', 0.025, 0, 0.36, 0.3);
      break;
    case 'research':
      tone(N.D5, 0.25, 'sine', 0.04);
      tone(N.F5, 0.25, 'sine', 0.04, 0, 0.09);
      tone(N.A5, 0.6, 'sine', 0.04, 0, 0.18);
      break;
    case 'event':
      // Two soft bell strikes (fundamental plus a quiet octave).
      tone(N.A4, 1.2, 'sine', 0.05);
      tone(N.A5, 0.8, 'sine', 0.015);
      tone(N.E4, 1.4, 'sine', 0.05, 0, 0.28);
      tone(659.25, 0.9, 'sine', 0.015, 0, 0.28);
      break;
    case 'victory':
      tone(N.D4, 0.3, 'triangle', 0.06);
      tone(N.Fs4, 0.3, 'triangle', 0.06, 0, 0.18);
      tone(N.A4, 0.3, 'triangle', 0.06, 0, 0.36);
      tone(N.D5, 2.6, 'triangle', 0.06, 0, 0.54, 0.05);
      tone(N.D3, 2.8, 'sine', 0.08, 0, 0.54, 0.2);
      tone(N.A3, 2.8, 'sine', 0.05, 0, 0.54, 0.2);
      break;
    case 'defeat':
      tone(N.D5, 0.5, 'triangle', 0.05);
      tone(N.Bb4, 0.5, 'triangle', 0.05, 0, 0.4);
      tone(N.G4, 0.5, 'triangle', 0.05, 0, 0.8);
      tone(N.D4, 3, 'triangle', 0.05, 0, 1.2, 0.1);
      tone(N.D2, 3.2, 'sine', 0.12, 0, 1.2, 0.3);
      break;
  }
}
