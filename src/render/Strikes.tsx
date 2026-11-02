/** Missile/air strike arcs with glowing heads and explosion flashes for last turn's battles (D-038). */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  CanvasTexture,
  SRGBColorSpace,
} from 'three';
import { greatCirclePoints, latLonToVec3 } from './geo';
import { loadWorld } from '../sim/world';
import { useGameStore } from '../state/gameStore';
import { playSound } from '../ui/audio';

const world = loadWorld();

interface Arc {
  points: Vector3[];
  line: Line;
  head: Mesh;
  start: number;
  duration: number;
  nuclear: boolean;
}
interface Flash {
  sprite: Sprite;
  start: number;
  duration: number;
  size: number;
}

function flashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,220,150,0.9)');
  g.addColorStop(0.6, 'rgba(255,120,40,0.35)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function Strikes() {
  const group = useMemo(() => new Group(), []);
  const arcs = useRef<Arc[]>([]);
  const flashes = useRef<Flash[]>([]);
  const flashTex = useMemo(() => flashTexture(), []);
  const game = useGameStore((s) => s.game);
  const previous = useGameStore((s) => s.previous);

  useEffect(() => {
    if (!game || !previous || game.turn === previous.turn) return;
    const now = performance.now();
    const lastTurn = game.turn - 1;
    // Battles this turn → flashes; attackers' origin → arcs.
    const battles = game.log.filter(
      (l) => l.turn === lastTurn && l.kind === 'battle' && l.region !== undefined,
    );
    let i = 0;
    for (const b of battles) {
      const meta = world.regions.get(b.region!);
      if (!meta) continue;
      addFlash(meta.lat, meta.lon, now + i * 120, 0.035, false);
      // Arc from the nearest attacking stack's previous position.
      const attackers = b.nations ?? [];
      const origin = Object.values(previous.units).find(
        (u) =>
          attackers.includes(u.owner) &&
          u.owner !== (game.regions[b.region!]?.controller ?? '') &&
          world.regions.get(u.region)?.neighbours.includes(b.region!),
      );
      if (origin) {
        const o = world.regions.get(origin.region)!;
        addArc(o.lat, o.lon, meta.lat, meta.lon, now + i * 120, false);
      }
      i++;
    }
    for (const s of game.strikes.filter((x) => x.turn === lastTurn && x.kind === 'nuclear')) {
      const a = world.regions.get(s.from);
      const b = world.regions.get(s.to);
      if (!a || !b) continue;
      addArc(a.lat, a.lon, b.lat, b.lon, now, true);
      addFlash(b.lat, b.lon, now + 1800, 0.12, true);
      playSound('nuclear');
    }
    if (battles.length > 0) playSound('battle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  function addArc(
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
    start: number,
    nuclear: boolean,
  ): void {
    const points = greatCirclePoints(aLat, aLon, bLat, bLon, 48, 1.004, nuclear ? 0.18 : 0.06);
    const geo = new BufferGeometry();
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => arr.set([p.x, p.y, p.z], i * 3));
    geo.setAttribute('position', new Float32BufferAttribute(arr, 3));
    geo.setDrawRange(0, 0);
    const mat = new LineBasicMaterial({
      color: nuclear ? new Color('#ffd27a') : new Color('#ff9a5c'),
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const line = new Line(geo, mat);
    line.renderOrder = 6;
    const head = new Mesh(
      new SphereGeometry(nuclear ? 0.006 : 0.003, 8, 8),
      new MeshBasicMaterial({ color: '#fff4d6' }),
    );
    head.renderOrder = 7;
    group.add(line, head);
    arcs.current.push({ points, line, head, start, duration: nuclear ? 1800 : 1100, nuclear });
  }
  function addFlash(lat: number, lon: number, start: number, size: number, nuclear: boolean): void {
    const mat = new SpriteMaterial({
      map: flashTex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      color: nuclear ? '#ffffff' : '#ffd9a0',
    });
    const sprite = new Sprite(mat);
    sprite.position.copy(latLonToVec3(lat, lon, 1.01));
    sprite.scale.setScalar(0.0001);
    sprite.renderOrder = 8;
    group.add(sprite);
    flashes.current.push({ sprite, start, duration: nuclear ? 3500 : 900, size });
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
      if (t > 1.6) {
        group.remove(a.line, a.head);
        a.line.geometry.dispose();
        arcs.current.splice(arcs.current.indexOf(a), 1);
        continue;
      }
      a.line.visible = true;
      const p = Math.min(1, t);
      a.line.geometry.setDrawRange(0, Math.max(2, Math.floor(p * a.points.length)));
      (a.line.material as LineBasicMaterial).opacity = t > 1 ? Math.max(0, 1 - (t - 1) / 0.6) : 0.9;
      const idx = Math.min(a.points.length - 1, Math.floor(p * (a.points.length - 1)));
      a.head.visible = t <= 1;
      a.head.position.copy(a.points[idx]!);
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
      const grow = Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5);
      f.sprite.scale.setScalar(f.size * (0.4 + grow));
      (f.sprite.material as SpriteMaterial).opacity = 1 - t * t;
    }
  });
  return <primitive object={group} />;
}
