/**
 * HOI-style offensive arrows (D-057): curved ribbons from each of the player's moving stacks to the
 * hostile region at the end of its path, with a scrolling stripe and an arrow head. One mesh.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { latLonToVec3 } from './geo';
import { getHeightMap, heightAt } from './terrainHeight';
import { terrainDisplacement } from './displacement';
import { useLevels } from './levels';
import { nationColor } from './palette';
import { useGameStore } from '../state/gameStore';
import { loadWorld } from '../sim/world';
import { atWar } from '../sim/query';
import type { GameState } from '../sim/types';
import { useDispose } from './useDispose';

const world = loadWorld();

export interface ArrowSpec {
  from: number;
  to: number;
  owner: string;
  /** Stack size, for width. */
  weight: number;
}

/** Planned attacks: the player's (and allies') stacks whose path ends in an enemy-controlled region. */
export function plannedAttacks(game: GameState): ArrowSpec[] {
  const map = new Map<string, ArrowSpec>();
  for (const u of Object.values(game.units)) {
    if (u.owner !== game.player || u.path.length === 0) continue;
    const target = u.path[u.path.length - 1]!;
    const ctrl = game.regions[target]?.controller;
    if (!ctrl || ctrl === u.owner || !atWar(game, u.owner, ctrl)) continue;
    if (world.regions.get(target)?.sea) continue;
    const key = `${u.region}>${target}`;
    const a = map.get(key);
    if (a) a.weight++;
    else map.set(key, { from: u.region, to: target, owner: u.owner, weight: 1 });
  }
  return [...map.values()];
}

const VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aHeight;
  attribute vec3 aColor;
  uniform float uDisplace;
  varying float vT;
  varying float vSide;
  varying vec3 vColor;
  void main() {
    vT = aT;
    vSide = aSide;
    vColor = aColor;
    vec3 p = position * (1.0 + aHeight * uDisplace);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  uniform float time;
  varying float vT;
  varying float vSide;
  varying vec3 vColor;
  void main() {
    float edge = 1.0 - smoothstep(0.7, 1.0, abs(vSide));
    float outline = smoothstep(0.6, 0.78, abs(vSide));
    float stripe = smoothstep(0.35, 0.65, fract(vT * 7.0 - time * 0.7));
    float fadeIn = smoothstep(0.0, 0.1, vT);
    vec3 col = mix(vColor * (0.75 + 0.5 * stripe), vec3(0.08, 0.03, 0.02), outline * 0.85);
    gl_FragColor = vec4(col, 0.88 * edge * fadeIn);
  }
`;

/** Builds one ribbon with an arrow head along a curved path on the sphere. */
function appendArrow(
  spec: ArrowSpec,
  pos: number[],
  t: number[],
  side: number[],
  hgt: number[],
  col: number[],
  idx: number[],
  color: Color,
): void {
  const a = world.regions.get(spec.from);
  const b = world.regions.get(spec.to);
  if (!a || !b) return;
  const A = latLonToVec3(a.lat, a.lon, 1);
  const B = latLonToVec3(b.lat, b.lon, 1);
  const omega = Math.acos(Math.max(-1, Math.min(1, A.dot(B))));
  if (omega < 1e-4) return;
  const hm = getHeightMap();
  const N = 22;
  // perpendicular bulge: curve the shaft to one side like a HOI arrow
  const mid = A.clone().add(B).normalize();
  const perp = new Vector3().crossVectors(A, B).normalize();
  const bulge = Math.min(0.25, omega * 0.2) * (spec.from % 2 === 0 ? 1 : -1);
  const widthBase =
    (0.0022 + Math.min(0.003, spec.weight * 0.0003)) * Math.min(1.6, Math.max(0.8, omega * 10));
  const base = pos.length / 3;
  const points: Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const sa = Math.sin((1 - s) * omega) / Math.sin(omega);
    const sb = Math.sin(s * omega) / Math.sin(omega);
    const p = A.clone().multiplyScalar(sa).add(B.clone().multiplyScalar(sb));
    p.add(perp.clone().multiplyScalar(bulge * Math.sin(Math.PI * s) * omega));
    p.add(mid.clone().multiplyScalar(0.0));
    points.push(p.normalize());
  }
  const headStart = 0.78;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const p = points[i]!;
    const next = points[Math.min(N, i + 1)]!;
    const prev = points[Math.max(0, i - 1)]!;
    const tangent = next.clone().sub(prev).normalize();
    const right = new Vector3().crossVectors(p, tangent).normalize();
    // shaft tapers up; head widens then narrows to a point
    let w = widthBase * (0.55 + 0.45 * s);
    if (s > headStart) w = widthBase * 2.2 * (1 - (s - headStart) / (1 - headStart));
    const { lat, lon } = vecLatLon(p);
    const h = hm ? heightAt(hm, lat, lon) : 0;
    for (const sd of [-1, 1]) {
      const q = p
        .clone()
        .add(right.clone().multiplyScalar(w * sd))
        .normalize()
        .multiplyScalar(1.0032);
      pos.push(q.x, q.y, q.z);
      t.push(s);
      side.push(sd);
      hgt.push(h);
      col.push(color.r, color.g, color.b);
    }
    if (i < N) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
}

function vecLatLon(v: Vector3): { lat: number; lon: number } {
  const lat = (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
  const lon = (Math.atan2(-v.z, v.x) * 180) / Math.PI;
  return { lat, lon };
}

export function Arrows() {
  const game = useGameStore((s) => s.game);
  const levels = useLevels();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { time: { value: 0 }, uDisplace: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [],
  );
  useDispose(material);
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), material);
    m.renderOrder = 4;
    m.frustumCulled = false;
    return m;
  }, [material]);
  useEffect(() => {
    if (!game) return;
    const specs = plannedAttacks(game);
    const pos: number[] = [];
    const t: number[] = [];
    const side: number[] = [];
    const hgt: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const color = new Color('#ff3b2a').lerp(nationColor(game.player), 0.3);
    for (const s of specs) appendArrow(s, pos, t, side, hgt, col, idx, color);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aT', new Float32BufferAttribute(t, 1));
    geo.setAttribute('aSide', new Float32BufferAttribute(side, 1));
    geo.setAttribute('aHeight', new Float32BufferAttribute(hgt, 1));
    geo.setAttribute('aColor', new Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.visible = specs.length > 0;
  }, [game, mesh]);
  useFrame(({ camera }, dt) => {
    material.uniforms.time!.value = (material.uniforms.time!.value as number) + dt;
    material.uniforms.uDisplace!.value = terrainDisplacement(
      camera.position.length(),
      levels.terrain,
    );
  });
  return <primitive object={mesh} />;
}
