/** Synthesised UI sounds and an ambient drone via WebAudio; no audio files (D-039). */
import { useUiStore } from '../state/uiStore';

type SoundName =
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

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;

function ensure(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0): void {
  const c = ensure();
  if (!c || !master || useUiStore.getState().muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(c.currentTime + dur + 0.05);
}

function noise(dur: number, gain: number, lowpass: number): void {
  const c = ensure();
  if (!c || !master || useUiStore.getState().muted) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start();
}

export function playSound(name: SoundName): void {
  switch (name) {
    case 'click':
      tone(1800, 0.04, 'square', 0.05);
      break;
    case 'open':
      tone(600, 0.08, 'sine', 0.08, 300);
      break;
    case 'close':
      tone(500, 0.08, 'sine', 0.06, -200);
      break;
    case 'order':
      tone(900, 0.06, 'triangle', 0.08);
      tone(1200, 0.08, 'triangle', 0.06);
      break;
    case 'endTurn':
      tone(220, 0.25, 'sawtooth', 0.08, 60);
      tone(440, 0.3, 'sine', 0.06);
      break;
    case 'alert':
      tone(880, 0.12, 'square', 0.06);
      setTimeout(() => tone(880, 0.12, 'square', 0.06), 160);
      break;
    case 'accept':
      tone(523, 0.1, 'sine', 0.08);
      setTimeout(() => tone(784, 0.15, 'sine', 0.08), 100);
      break;
    case 'reject':
      tone(300, 0.2, 'sawtooth', 0.06, -100);
      break;
    case 'battle':
      noise(0.5, 0.25, 600);
      tone(80, 0.5, 'sine', 0.15, -40);
      break;
    case 'nuclear':
      noise(2.5, 0.5, 300);
      tone(45, 2.5, 'sine', 0.3, -20);
      break;
  }
}

export function startDrone(): void {
  const c = ensure();
  if (!c || !master || drone) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  const osc: OscillatorNode[] = [];
  for (const [f, type] of [
    [55, 'sine'],
    [55.3, 'sine'],
    [110.2, 'triangle'],
    [164.8, 'sine'],
  ] as [number, OscillatorType][]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.value = f > 100 ? 0.08 : 0.25;
    o.connect(g).connect(gain);
    o.start();
    osc.push(o);
  }
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.04;
  lfo.connect(lfoGain).connect(gain.gain);
  lfo.start();
  drone = { osc, gain };
  setDroneVolume(useUiStore.getState().muted ? 0 : 0.12);
}

export function setDroneVolume(v: number): void {
  if (!drone || !ctx) return;
  drone.gain.gain.setTargetAtTime(v, ctx.currentTime, 1.5);
}
