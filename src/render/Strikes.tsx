/**
 * Missile and air-strike arcs (D-038, D-057): launch flash, a glowing head with a fading
 * mid-course trail, interception bursts where the target has missile defence, impact flashes.
 * Support strikes are inferred from last turn's battles (aircraft in range, ships in adjacent
 * zones); nuclear strikes come from the state and can trigger the strike cam (D-056).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  SRGBColorSpace,
} from 'three';
import { greatCirclePoints, latLonToVec3 } from './geo';
import { useLevels } from './levels';
import { loadWorld } from '../sim/world';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { playSound } from '../ui/audio';
import type { GameState } from '../sim/types';

const world = loadWorld();

interface Arc {
  points: Vector3[];
  line: Line;
  head: Sprite;
  start: number;
  duration: number;
  /** Progress at which the missile is destroyed, or 1 for an impact. */
  interceptAt: number;
  burstDone: boolean;
  nuclear: boolean;
}
interface Flash {
  sprite: Sprite;
  start: number;
  duration: number;
  size: number;
  ring: boolean;
}

function radialTexture(stops: [number, string][]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
const flashTexture = () =>
  radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.25, 'rgba(255,220,150,0.9)'],
    [0.6, 'rgba(255,120,40,0.35)'],
    [1, 'rgba(255,60,0,0)'],
  ]);
const burstTexture = () =>
  radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.2, 'rgba(190,230,255,0.9)'],
    [0.5, 'rgba(90,160,255,0.3)'],
    [1, 'rgba(40,90,255,0)'],
  ]);
function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(200,230,255,0.9)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const TRAIL_VERT = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TRAIL_FRAG = /* glsl */ `
  precision highp float;
  uniform float uProgress;
  uniform float uTail;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vT;
  void main() {
    if (vT > uProgress) discard;
    float tail = smoothstep(uProgress - uTail, uProgress, vT);
    float glow = 0.35 + 0.65 * tail;
    gl_FragColor = vec4(uColor * (0.6 + 1.2 * tail), glow * uOpacity);
  }
`;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface StrikeSpec {
  from: number;
  to: number;
  nuclear: boolean;
  /** 0..1 chance the target intercepts. */
  defence: number;
  seed: number;
}

/** Interception chance at a region: missile-defence tech of its controller plus air-defence units. */
function defenceAt(game: GameState, region: number): number {
  const ctrl = game.regions[region]?.controller;
  const tech = ctrl ? (game.nations[ctrl]?.modifiers.missileDefence ?? 0) : 0;
  let aa = 0;
  for (const u of Object.values(game.units))
    if (u.region === region && u.type === 'airDefense' && u.owner === ctrl) aa++;
  return Math.min(0.8, tech * 2.2 + aa * 0.12 + (tech > 0 ? 0.1 : 0));
}

/** Last turn's strikes: support fire into each battle, plus the state's nuclear strikes. */
export function strikesForTurn(
  game: GameState,
  previous: GameState,
  maxPerBattle: number,
): StrikeSpec[] {
  const out: StrikeSpec[] = [];
  const lastTurn = game.turn - 1;
  const battles = game.log.filter(
    (l) => l.turn === lastTurn && l.kind === 'battle' && l.region !== undefined,
  );
  for (const b of battles) {
    const region = b.region!;
    const meta = world.regions.get(region);
    if (!meta) continue;
    const sides = b.nations ?? [];
    const near = new Set<number>([region, ...meta.neighbours]);
    for (const n of meta.neighbours)
      for (const nn of world.regions.get(n)?.neighbours ?? []) near.add(nn);
    const origins = new Map<number, number>();
    for (const u of Object.values(previous.units)) {
      if (!sides.includes(u.owner) || !near.has(u.region) || u.region === region) continue;
      const t = world.unitTypes.get(u.type);
      if (!t) continue;
      const strikes =
        (t.domain === 'air' && (meta.neighbours.includes(u.region) ? 1 : 2) <= t.range) ||
        (t.domain === 'sea' && t.strike > 0 && meta.neighbours.includes(u.region));
      if (strikes) origins.set(u.region, (origins.get(u.region) ?? 0) + 1);
    }
    const defence = defenceAt(previous, region);
    let i = 0;
    for (const [from] of [...origins.entries()].sort((x, y) => y[1] - x[1])) {
      if (i >= maxPerBattle) break;
      out.push({ from, to: region, nuclear: false, defence, seed: region * 97 + from * 13 + i });
      i++;
    }
  }
  for (const s of game.strikes.filter((x) => x.turn === lastTurn && x.kind === 'nuclear')) {
    const target = game.regions[s.to]?.controller;
    const defence = target ? (previous.nations[target]?.modifiers.missileDefence ?? 0) : 0;
    out.push({
      from: s.from,
      to: s.to,
      nuclear: true,
      defence: Math.min(0.9, defence * 2),
      seed: s.to,
    });
  }
  return out;
}

export function Strikes() {
  const group = useMemo(() => new Group(), []);
  const arcs = useRef<Arc[]>([]);
  const flashes = useRef<Flash[]>([]);
  const flashTex = useMemo(() => flashTexture(), []);
  const burstTex = useMemo(() => burstTexture(), []);
  const ringTex = useMemo(() => ringTexture(), []);
  const game = useGameStore((s) => s.game);
  const previous = useGameStore((s) => s.previous);
  const levels = useLevels();

  useEffect(() => {
    if (!game || !previous || game.turn === previous.turn) return;
    const now = performance.now();
    const lastTurn = game.turn - 1;
    const specs = strikesForTurn(game, previous, levels.war >= 2 ? 4 : levels.war === 1 ? 2 : 1);
    let i = 0;
    let nuclearShown = false;
    for (const s of specs) {
      const a = world.regions.get(s.from);
      const b = world.regions.get(s.to);
      if (!a || !b) continue;
      const salvo = s.nuclear ? 3 : 1;
      for (let k = 0; k < salvo; k++) {
        const r = hash(s.seed * 31 + k * 7 + game.turn);
        const intercept = levels.war >= 1 && r < s.defence ? 0.55 + hash(s.seed + k) * 0.3 : 1;
        const jitter = k === 0 ? 0 : (k === 1 ? 1 : -1) * 0.6;
        const start = now + i * 140 + k * 220;
        const points = addArc(
          a.lat + jitter * 0.3,
          a.lon + jitter,
          b.lat + jitter * 0.2,
          b.lon + jitter * 0.5,
          start,
          s.nuclear,
          intercept,
        );
        if (s.nuclear && !nuclearShown) {
          nuclearShown = true;
          const ui = useUiStore.getState();
          if (ui.strikeCam && intercept >= 1)
            ui.requestStrikeCam({ points, duration: 2600, lat: b.lat, lon: b.lon });
        }
      }
      i++;
    }
    // Battles also flash at the fight itself.
    for (const l of game.log) {
      if (l.turn !== lastTurn || l.kind !== 'battle' || l.region === undefined) continue;
      const meta = world.regions.get(l.region);
      if (meta)
        addFlash(meta.lat, meta.lon, now + 300 + hash(l.region) * 400, 0.03, flashTex, 900, false);
    }
    if (specs.some((s) => s.nuclear)) playSound('nuclear');
    else if (specs.length > 0) playSound('battle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  function addArc(
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
    start: number,
    nuclear: boolean,
    interceptAt: number,
  ): Vector3[] {
    const points = greatCirclePoints(aLat, aLon, bLat, bLon, 64, 1.004, nuclear ? 0.18 : 0.06);
    const geo = new BufferGeometry();
    const arr = new Float32Array(points.length * 3);
    const ts = new Float32Array(points.length);
    points.forEach((p, i) => {
      arr.set([p.x, p.y, p.z], i * 3);
      ts[i] = i / (points.length - 1);
    });
    geo.setAttribute('position', new Float32BufferAttribute(arr, 3));
    geo.setAttribute('aT', new Float32BufferAttribute(ts, 1));
    const mat = new ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: {
        uProgress: { value: 0 },
        uTail: { value: nuclear ? 0.5 : 0.35 },
        uOpacity: { value: 1 },
        uColor: { value: new Color(nuclear ? '#ffd27a' : '#ff9a5c') },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const line = new Line(geo, mat);
    line.renderOrder = 6;
    line.frustumCulled = false;
    const head = new Sprite(
      new SpriteMaterial({
        map: flashTex,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        color: '#ffffff',
      }),
    );
    head.scale.setScalar(nuclear ? 0.014 : 0.008);
    head.renderOrder = 7;
    group.add(line, head);
    const duration = nuclear ? 2600 : 1300;
    arcs.current.push({
      points,
      line,
      head,
      start,
      duration,
      interceptAt,
      burstDone: false,
      nuclear,
    });
    // Launch flash.
    addFlash(aLat, aLon, start, nuclear ? 0.05 : 0.022, flashTex, 420, false);
    return points;
  }
  function addFlash(
    lat: number,
    lon: number,
    start: number,
    size: number,
    tex: CanvasTexture,
    duration: number,
    ring: boolean,
    pos?: Vector3,
  ): void {
    const mat = new SpriteMaterial({
      map: tex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      color: '#ffffff',
    });
    const sprite = new Sprite(mat);
    sprite.position.copy(pos ?? latLonToVec3(lat, lon, 1.01));
    sprite.scale.setScalar(0.0001);
    sprite.renderOrder = 8;
    group.add(sprite);
    flashes.current.push({ sprite, start, duration, size, ring });
  }

  useFrame(() => {
    const now = performance.now();
    for (const a of [...arcs.current]) {
      const t = (now - a.start) / a.duration;
      if (t < 0) {
        a.line.visible = false;
        a.head.visible = false;
        continue;
      }
      const end = a.interceptAt;
      if (t > end + 0.8) {
        group.remove(a.line, a.head);
        a.line.geometry.dispose();
        arcs.current.splice(arcs.current.indexOf(a), 1);
        continue;
      }
      a.line.visible = true;
      const p = Math.min(end, t);
      const u = (a.line.material as ShaderMaterial).uniforms;
      u.uProgress!.value = p;
      u.uOpacity!.value = t > end ? Math.max(0, 1 - (t - end) / 0.6) : 1;
      const idx = Math.min(a.points.length - 1, Math.floor(p * (a.points.length - 1)));
      a.head.visible = t <= end;
      a.head.position.copy(a.points[idx]!);
      if (t >= end && !a.burstDone) {
        a.burstDone = true;
        const at = a.points[idx]!;
        if (end < 1) {
          // interception: blue-white burst and an expanding ring in mid-course
          addFlash(0, 0, now, a.nuclear ? 0.06 : 0.035, burstTex, 700, false, at);
          addFlash(0, 0, now, a.nuclear ? 0.09 : 0.05, ringTex, 900, true, at);
        } else {
          addFlash(0, 0, now, a.nuclear ? 0.12 : 0.03, flashTex, a.nuclear ? 3500 : 800, false, at);
        }
      }
    }
    for (const f of [...flashes.current]) {
      const t = (now - f.start) / f.duration;
      if (t < 0) {
        f.sprite.visible = false;
        continue;
      }
      if (t > 1) {
        group.remove(f.sprite);
        flashes.current.splice(flashes.current.indexOf(f), 1);
        continue;
      }
      f.sprite.visible = true;
      if (f.ring) {
        f.sprite.scale.setScalar(f.size * (0.2 + 1.6 * t));
        (f.sprite.material as SpriteMaterial).opacity = (1 - t) * (1 - t);
      } else {
        const grow = Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5);
        f.sprite.scale.setScalar(f.size * (0.4 + grow));
        (f.sprite.material as SpriteMaterial).opacity = 1 - t * t;
      }
    }
  });
  return <primitive object={group} />;
}
