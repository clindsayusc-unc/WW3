/**
 * Audio (D-060): one WebAudio graph with Master → Music and Effects buses, persisted volumes,
 * and UI sounds synthesised from clean oscillator tones only (no noise buffers, no square or
 * sawtooth waves). The ambient music bed lives in music.ts and plays on the music bus.
 */
import { useUiStore } from '../state/uiStore';
import type { AudioSettings } from './audioSettings';

export {
  AUDIO_KEY,
  DEFAULT_AUDIO,
  MUSIC_HINT_KEY,
  loadAudioSettings,
  parseAudioSettings,
  saveAudioSettings,
} from './audioSettings';
export type { AudioSettings } from './audioSettings';

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
  env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur / 4));
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
