/**
 * Carrier and fleet wakes (D-057): a tapered foam ribbon trailing each naval stack, aligned with
 * its heading (last move, else a stable pseudo-heading), scrolling and fading with distance.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
} from 'three';
import { greatCirclePoints, latLonToVec3 } from './geo';
import { buildStacks } from './Units';
import { useLevels } from './levels';
import { useGameStore } from '../state/gameStore';
import { loadWorld } from '../sim/world';

const world = loadWorld();
const ANIM_SECONDS = 1.4;

function foamTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  // V-shaped wake: two bright edges diverging from the bow, turbulent centre
  for (let x = 0; x < 256; x++) {
    const t = x / 256;
    const half = 4 + t * 26;
    for (let y = 0; y < 64; y++) {
      const dy = Math.abs(y - 32);
      const edge = Math.exp(-((dy - half) * (dy - half)) / 6) * (1 - t * 0.6);
      const centre = Math.max(0, 1 - dy / (half * 0.8)) * 0.35 * (1 - t);
      const noise = 0.75 + 0.25 * Math.sin(x * 0.7 + y * 1.3) * Math.sin(x * 0.23 - y * 0.9);
      const a = Math.min(1, (edge + centre) * noise);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  return tex;
}

const VERT = /* glsl */ `
  attribute vec2 aUv;
  attribute float aFade;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = aUv;
    vec3 n = normalize(position);
    float facing = dot(n, normalize(cameraPosition));
    float horizon = 1.0 / length(cameraPosition);
    vFade = aFade * smoothstep(horizon + 0.02, horizon + 0.1, facing);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D map;
  uniform float time;
  uniform float uAlpha;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float a = texture2D(map, vec2(vUv.x - time * 0.15, vUv.y)).a;
    a *= texture2D(map, vec2(vUv.x * 0.7 + time * 0.05, vUv.y)).a * 0.6 + 0.4;
    gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, a * vFade * uAlpha);
  }
`;

interface Wake {
  key: string;
  path: Vector3[] | null; // movement path during the arrival animation
  pos: Vector3;
  heading: Vector3; // unit tangent, direction of travel
  length: number;
  width: number;
}

export function Wakes() {
  const game = useGameStore((s) => s.game);
  const levels = useLevels();
  const tex = useMemo(() => foamTexture(), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { map: { value: tex }, time: { value: 0 }, uAlpha: { value: 1 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [tex],
  );
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), material);
    m.renderOrder = 4;
    m.frustumCulled = false;
    return m;
  }, [material]);
  const wakes = useRef<Wake[]>([]);
  const animStart = useRef(0);

  useEffect(() => {
    if (!game) return;
    const list: Wake[] = [];
    for (const s of buildStacks(game)) {
      const meta = world.regions.get(s.region);
      if (!meta?.sea) continue;
      const types = s.units.map((u) => world.unitTypes.get(u.type)?.id ?? '');
      const carrier = types.includes('carrierGroup');
      const surface = types.some((t) => t === 'destroyerGroup' || t === 'amphibiousGroup');
      if (!carrier && !surface) continue; // submarines leave no wake
      const pos = latLonToVec3(meta.lat, meta.lon, 1.0022);
      let heading: Vector3;
      let path: Vector3[] | null = null;
      if (s.from !== null) {
        const a = world.regions.get(s.from);
        if (a) {
          path = greatCirclePoints(a.lat, a.lon, meta.lat, meta.lon, 24, 1.0022, 0);
          heading = pos
            .clone()
            .sub(latLonToVec3(a.lat, a.lon, 1.0022))
            .normalize();
        } else heading = new Vector3(0, 1, 0).cross(pos).normalize();
      } else {
        // stable pseudo-heading: rotate east by a hash of the region
        const east = new Vector3(0, 1, 0).cross(pos).normalize();
        const north = pos.clone().cross(east).normalize();
        const ang = ((s.region * 2654435761) % 360) * (Math.PI / 180);
        heading = east.multiplyScalar(Math.cos(ang)).add(north.multiplyScalar(Math.sin(ang)));
      }
      list.push({
        key: s.key,
        path,
        pos,
        heading,
        length: carrier ? 0.03 : 0.018,
        width: carrier ? 0.006 : 0.0035,
      });
    }
    wakes.current = list;
    animStart.current = performance.now();
  }, [game]);

  useFrame(({ camera }, dt) => {
    material.uniforms.time!.value = (material.uniforms.time!.value as number) + dt;
    const dist = camera.position.length();
    const show = levels.war >= 1 && dist < 2.4 && wakes.current.length > 0;
    mesh.visible = show;
    if (!show) return;
    material.uniforms.uAlpha!.value = Math.min(1, (2.4 - dist) / 0.5) * (levels.war >= 2 ? 1 : 0.7);
    const t = Math.min(1, (performance.now() - animStart.current) / 1000 / ANIM_SECONDS);
    const ease = 1 - Math.pow(1 - t, 3);
    const pos: number[] = [];
    const uv: number[] = [];
    const fade: number[] = [];
    const idx: number[] = [];
    const SEG = 8;
    for (const w of wakes.current) {
      let p = w.pos;
      let heading = w.heading;
      if (w.path && t < 1) {
        const fi = ease * (w.path.length - 1);
        const i0 = Math.floor(fi);
        const i1 = Math.min(w.path.length - 1, i0 + 1);
        p = w.path[i0]!.clone().lerp(w.path[i1]!, fi - i0);
        heading = w.path[i1]!.clone()
          .sub(w.path[Math.max(0, i0 - 1)]!)
          .normalize();
      }
      const n = p.clone().normalize();
      const fwd = heading
        .clone()
        .sub(n.clone().multiplyScalar(heading.dot(n)))
        .normalize();
      const right = new Vector3().crossVectors(n, fwd).normalize();
      const base = pos.length / 3;
      for (let i = 0; i <= SEG; i++) {
        const s = i / SEG;
        const centre = p.clone().sub(fwd.clone().multiplyScalar(s * w.length));
        const half = w.width * (0.25 + s);
        for (const sd of [-1, 1]) {
          const q = centre
            .clone()
            .add(right.clone().multiplyScalar(half * sd))
            .normalize()
            .multiplyScalar(1.0022);
          pos.push(q.x, q.y, q.z);
          uv.push(s, sd * 0.5 + 0.5);
          fade.push(1);
        }
        if (i < SEG) {
          const k = base + i * 2;
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aUv', new Float32BufferAttribute(uv, 2));
    geo.setAttribute('aFade', new Float32BufferAttribute(fade, 1));
    geo.setIndex(idx);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  });
  return <primitive object={mesh} />;
}
