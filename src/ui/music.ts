/**
 * Procedural ambient music bed (D-060): slow minor-key pads, a sub bass and sparse piano-like
 * notes, all from sine and triangle oscillators through a low-pass filter and a clean feedback
 * delay. No noise sources, no samples. Intensity (0..2) follows the player's DEFCON: higher
 * intensity adds a slow pulsing fifth, quicker chord changes and a touch more volume.
 */
import { audioGraph } from './audio';

/** Intensity level for a DEFCON: calm at 5–3, tense at 2, tenser at 1 (pure, tested). */
export function musicIntensityFor(defcon: number): 0 | 1 | 2 {
  return defcon <= 1 ? 2 : defcon === 2 ? 1 : 0;
}

/** Chord progression in D minor (Hz): root, third, fifth, colour tone. */
const PROGRESSION: readonly (readonly number[])[] = [
  [146.83, 174.61, 220.0, 261.63], // Dm(add9)
  [116.54, 146.83, 174.61, 220.0], // Bb maj7
  [174.61, 220.0, 261.63, 329.63], // F maj7
  [130.81, 164.81, 196.0, 246.94], // C maj7
  [110.0, 130.81, 164.81, 196.0], // Am7
  [146.83, 174.61, 220.0, 293.66], // Dm
];
/** Melody pool (Hz) above the pads: D minor pentatonic-ish, one octave up. */
const MELODY = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33];

export const FADE_SECONDS = 2.5;
const BASE_LEVEL = 0.22;

interface Voice {
  osc: OscillatorNode[];
  gain: GainNode;
}

interface Player {
  out: GainNode; // fade in/out
  level: GainNode; // intensity
  filter: BiquadFilterNode;
  delay: DelayNode;
  feedback: GainNode;
  sub: Voice;
  pulse: Voice;
  pads: Voice[];
  chord: number;
  intensity: 0 | 1 | 2;
  timer: number | null;
  seed: number;
}
let player: Player | null = null;

/** Small deterministic generator so the bed varies without Math.random. */
function next(p: Player): number {
  p.seed = (p.seed * 1664525 + 1013904223) >>> 0;
  return p.seed / 4294967296;
}

function voice(
  ctx: AudioContext,
  dest: AudioNode,
  freqs: number[],
  types: OscillatorType[],
  levels: number[],
): Voice {
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(dest);
  const osc = freqs.map((f, i) => {
    const o = ctx.createOscillator();
    o.type = types[i % types.length] ?? 'sine';
    o.frequency.value = f;
    const lv = ctx.createGain();
    lv.gain.value = levels[i] ?? 1;
    o.connect(lv).connect(g);
    o.start();
    return o;
  });
  return { osc, gain: g };
}

function build(): Player | null {
  const g = audioGraph();
  if (!g) return null;
  const { ctx, music } = g;
  const out = ctx.createGain();
  out.gain.value = 0;
  const level = ctx.createGain();
  level.gain.value = BASE_LEVEL;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  filter.Q.value = 0.4;
  // A clean stereo-less echo for space: 0.42 s, 35 % feedback, filtered darker each pass.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.42;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const dark = ctx.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 900;
  delay.connect(dark).connect(feedback).connect(delay);
  const wet = ctx.createGain();
  wet.gain.value = 0.4;
  level.connect(filter);
  filter.connect(out);
  filter.connect(delay);
  delay.connect(wet).connect(out);
  out.connect(music);
  // Pads: four voices, each a sine fundamental with a quiet detuned sine and a triangle octave.
  const pads: Voice[] = [];
  for (let i = 0; i < 4; i++)
    pads.push(voice(ctx, level, [220, 220.6, 440], ['sine', 'sine', 'triangle'], [1, 0.6, 0.18]));
  const sub = voice(ctx, level, [73.42, 73.6], ['sine', 'sine'], [1, 0.7]);
  const pulse = voice(ctx, level, [110, 164.81], ['sine', 'triangle'], [1, 0.35]);
  const p: Player = {
    out,
    level,
    filter,
    delay,
    feedback,
    sub,
    pulse,
    pads,
    chord: 0,
    intensity: 0,
    timer: null,
    seed: 20270101,
  };
  return p;
}

/** Glide a voice to a new set of frequencies with a slow swell. */
function setVoice(ctx: AudioContext, v: Voice, freqs: number[], gain: number, attack: number): void {
  const t = ctx.currentTime;
  v.osc.forEach((o, i) => {
    const f = freqs[Math.min(i, freqs.length - 1)]!;
    o.frequency.cancelScheduledValues(t);
    o.frequency.setTargetAtTime(f, t, 0.8);
  });
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(gain, t, attack);
}

function playChord(p: Player): void {
  const g = audioGraph();
  if (!g) return;
  const { ctx } = g;
  const chord = PROGRESSION[p.chord % PROGRESSION.length]!;
  const slowAttack = p.intensity === 2 ? 2.2 : 3.5;
  chord.forEach((f, i) => {
    const pad = p.pads[i]!;
    // Fundamental, a slightly detuned copy and a soft triangle an octave up.
    setVoice(ctx, pad, [f, f * 1.003, f * 2], 0.11 - i * 0.015, slowAttack);
  });
  const root = chord[0]!;
  setVoice(ctx, p.sub, [root / 2, (root / 2) * 1.002], 0.18, 4);
  // Pulse: a slow swelling fifth, only when tense.
  const pulseGain = p.intensity === 0 ? 0 : p.intensity === 1 ? 0.05 : 0.09;
  setVoice(ctx, p.pulse, [root, root * 1.5], pulseGain, 1.5);
  // A sparse piano-like note: triangle with a quick decay, sometimes two.
  const notes = next(p) < (p.intensity === 0 ? 0.55 : 0.8) ? 1 + (next(p) < 0.3 ? 1 : 0) : 0;
  for (let k = 0; k < notes; k++) {
    const f = MELODY[Math.floor(next(p) * MELODY.length)]!;
    const t0 = ctx.currentTime + 1.5 + k * 2.4 + next(p) * 2;
    const o = ctx.createOscillator();
    const h = ctx.createOscillator();
    const env = ctx.createGain();
    o.type = 'triangle';
    h.type = 'sine';
    o.frequency.value = f;
    h.frequency.value = f * 2;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);
    const hg = ctx.createGain();
    hg.gain.value = 0.25;
    o.connect(env);
    h.connect(hg).connect(env);
    env.connect(p.level);
    o.start(t0);
    h.start(t0);
    o.stop(t0 + 3.3);
    h.stop(t0 + 3.3);
  }
  p.chord += 1;
  const bar = p.intensity === 2 ? 7000 : p.intensity === 1 ? 9000 : 12000;
  p.timer = window.setTimeout(() => playChord(p), bar + next(p) * 2000);
}

/** Starts the bed (idempotent) with a gentle fade in. */
export function startMusic(): void {
  if (!player) player = build();
  const g = audioGraph();
  if (!player || !g) return;
  if (player.timer === null) playChord(player);
  player.out.gain.cancelScheduledValues(g.ctx.currentTime);
  player.out.gain.setTargetAtTime(1, g.ctx.currentTime, FADE_SECONDS / 3);
}

/** Fades the bed out and stops scheduling; oscillators keep running silently so a restart is instant. */
export function stopMusic(): void {
  const g = audioGraph();
  if (!player || !g) return;
  player.out.gain.cancelScheduledValues(g.ctx.currentTime);
  player.out.gain.setTargetAtTime(0, g.ctx.currentTime, FADE_SECONDS / 3);
  if (player.timer !== null) {
    window.clearTimeout(player.timer);
    player.timer = null;
  }
}

export function isMusicPlaying(): boolean {
  return !!player && player.timer !== null;
}

/** Raises the bed's tension: a pulsing fifth, faster changes, slightly more level and brightness. */
export function setMusicIntensity(intensity: 0 | 1 | 2): void {
  const g = audioGraph();
  if (!player || !g || player.intensity === intensity) return;
  player.intensity = intensity;
  const t = g.ctx.currentTime;
  player.level.gain.setTargetAtTime(BASE_LEVEL * (1 + 0.12 * intensity), t, 2);
  player.filter.frequency.setTargetAtTime(1400 + 500 * intensity, t, 3);
  player.feedback.gain.setTargetAtTime(0.35 + 0.08 * intensity, t, 2);
  const root = PROGRESSION[(player.chord + PROGRESSION.length - 1) % PROGRESSION.length]![0]!;
  setVoice(g.ctx, player.pulse, [root, root * 1.5], intensity === 0 ? 0 : intensity === 1 ? 0.05 : 0.09, 1.5);
}
