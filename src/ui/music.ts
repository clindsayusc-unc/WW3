/**
 * Ambient score (D-084): CC0 tracks (credits in docs/DATA_SOURCES.md) streamed from
 * public/audio/music through two <audio> elements that crossfade on the Music bus, so the
 * Master and Music sliders and the mute switch apply as before. The playlist follows the
 * player's DEFCON: calm at 5–3, tense at 2, crisis at 1. If a track cannot be decoded the
 * procedural bed of D-060 (musicBed.ts) takes over.
 */
import { audioGraph, setStingerDuck } from './audio';
import { musicIntensityFor, setBedIntensity, startBed, stopBed } from './musicBed';

export { musicIntensityFor };

export interface Track {
  file: string;
  title: string;
  author: string;
}

/** Playlists per intensity (0 calm, 1 tense, 2 crisis). */
export const PLAYLISTS: readonly (readonly Track[])[] = [
  [
    { file: 'observing-the-star.mp3', title: 'Observing the Star', author: 'yd' },
    { file: 'tragic-ambient.mp3', title: 'Tragic Ambient Main Menu', author: 'HaelDB' },
  ],
  [{ file: 'sirens-in-darkness.mp3', title: 'Sirens in Darkness', author: 'The Cynic Project' }],
  [{ file: 'bleeding-out.mp3', title: 'Bleeding Out', author: 'HaelDB' }],
];

/** Next track index in a playlist after `current` (pure, tested): cycles, single tracks loop. */
export function nextTrack(length: number, current: number): number {
  return length <= 1 ? 0 : (current + 1) % length;
}

export const CROSSFADE_SECONDS = 4;
/** Score level on the Music bus: mastered to −20 LUFS, a touch under the effects. */
const SCORE_LEVEL = 0.8;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
}

interface Player {
  decks: [Deck, Deck];
  active: 0 | 1;
  intensity: 0 | 1 | 2;
  index: number;
  playing: boolean;
  fallback: boolean;
}
let player: Player | null = null;

function trackUrl(t: Track): string {
  return `${import.meta.env.BASE_URL}audio/music/${t.file}`;
}

function build(): Player | null {
  const g = audioGraph();
  if (!g) return null;
  const deck = (): Deck => {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const gain = g.ctx.createGain();
    gain.gain.value = 0;
    g.ctx.createMediaElementSource(el).connect(gain).connect(g.music);
    return { el, gain };
  };
  const p: Player = {
    decks: [deck(), deck()],
    active: 0,
    intensity: 0,
    index: 0,
    playing: false,
    fallback: false,
  };
  for (const [i, d] of p.decks.entries()) {
    d.el.addEventListener('ended', () => {
      if (!p.playing || p.active !== i) return;
      const list = PLAYLISTS[p.intensity]!;
      p.index = nextTrack(list.length, p.index);
      play(p, list[p.index]!, 1.5);
    });
    d.el.addEventListener('error', () => {
      if (!p.playing || p.active !== i) return;
      // No decoder or no file: fall back to the generated bed for this session.
      p.fallback = true;
      fade(d, 0, 0.5);
      setBedIntensity(p.intensity);
      startBed();
    });
  }
  return p;
}

function fade(d: Deck, to: number, seconds: number): void {
  const g = audioGraph();
  if (!g) return;
  const t = g.ctx.currentTime;
  d.gain.gain.cancelScheduledValues(t);
  d.gain.gain.setValueAtTime(d.gain.gain.value, t);
  d.gain.gain.linearRampToValueAtTime(to, t + seconds);
}

/** Crossfades to `track` on the idle deck. */
function play(p: Player, track: Track, seconds = CROSSFADE_SECONDS): void {
  if (p.fallback) return;
  const out = p.decks[p.active];
  const next: 0 | 1 = p.active === 0 ? 1 : 0;
  const inn = p.decks[next];
  inn.el.src = trackUrl(track);
  inn.el.currentTime = 0;
  inn.el.loop = PLAYLISTS[p.intensity]!.length <= 1;
  void inn.el.play().catch(() => undefined);
  fade(inn, SCORE_LEVEL, seconds);
  fade(out, 0, seconds);
  const old = out.el;
  window.setTimeout(
    () => {
      if (p.decks[p.active].el !== old) old.pause();
    },
    seconds * 1000 + 100,
  );
  p.active = next;
}

/** Starts the score (idempotent) with a crossfade in. */
export function startMusic(): void {
  if (!player) player = build();
  const p = player;
  if (!p) return;
  if (p.fallback) {
    startBed();
    return;
  }
  if (p.playing) return;
  p.playing = true;
  play(p, PLAYLISTS[p.intensity]![p.index % PLAYLISTS[p.intensity]!.length]!);
}

/** Fades the score out and pauses it once silent. */
export function stopMusic(): void {
  stopBed();
  const p = player;
  if (!p || !p.playing) return;
  p.playing = false;
  for (const d of p.decks) fade(d, 0, CROSSFADE_SECONDS / 2);
  window.setTimeout(
    () => {
      if (!p.playing) for (const d of p.decks) d.el.pause();
    },
    (CROSSFADE_SECONDS / 2) * 1000 + 100,
  );
}

export function isMusicPlaying(): boolean {
  return !!player?.playing;
}

/** Switches playlist when tension changes; crossfades only if the playlist actually changes. */
export function setMusicIntensity(intensity: 0 | 1 | 2): void {
  setBedIntensity(intensity);
  const p = player;
  if (!p) return;
  if (p.intensity === intensity) return;
  p.intensity = intensity;
  p.index = 0;
  if (p.playing) play(p, PLAYLISTS[intensity]![0]!);
}

/** The track now playing (for the Settings credit line), or null. */
export function nowPlaying(): Track | null {
  const p = player;
  if (!p?.playing || p.fallback) return null;
  return PLAYLISTS[p.intensity]![p.index % PLAYLISTS[p.intensity]!.length] ?? null;
}

/**
 * Ducks the score under a stinger: down to `depth` of its level in 80 ms, back over `seconds`.
 */
export function duckMusic(depth = 0.35, seconds = 2.5): void {
  const g = audioGraph();
  const p = player;
  if (!g || !p?.playing) return;
  const d = p.decks[p.active];
  const t = g.ctx.currentTime;
  d.gain.gain.cancelScheduledValues(t);
  d.gain.gain.setValueAtTime(d.gain.gain.value, t);
  d.gain.gain.linearRampToValueAtTime(SCORE_LEVEL * depth, t + 0.08);
  d.gain.gain.linearRampToValueAtTime(SCORE_LEVEL, t + 0.08 + seconds);
}

setStingerDuck(duckMusic);
