/** Unit stacks as camera-facing instanced sprites anchored to region centroids, with movement animation (D-038). */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { SymbolAtlas, TILE, ATLAS_SIZE, type Affiliation } from './symbolAtlas';
import { greatCirclePoints, latLonToVec3 } from './geo';
import { getHeightMap, heightAt } from './terrainHeight';
import { terrainDisplacement } from './displacement';
import { currentLevels } from './levels';
import { loadWorld } from '../sim/world';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { alliesOf, atWar } from '../sim/query';
import type { GameState, Unit } from '../sim/types';

const world = loadWorld();
const MAX_INSTANCES = 1500;
const ANIM_SECONDS = 1.4;

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec2 iUv;
  attribute float iScale;
  attribute float iHighlight;
  uniform float pixelScale;
  uniform float tileUv;
  varying vec2 vUv;
  varying float vFade;
  varying float vHighlight;
  void main() {
    vUv = iUv + uv * tileUv;
    vHighlight = iHighlight;
    vec3 camDir = normalize(cameraPosition);
    vec3 n = normalize(iPos);
    // fade near the limb
    float facing = dot(n, camDir);
    float horizon = 1.0 / length(cameraPosition);
    vFade = smoothstep(horizon + 0.01, horizon + 0.12, facing);
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    // constant screen size: scale by view depth
    float s = iScale * pixelScale * -mv.z;
    mv.xy += position.xy * s;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D atlas;
  uniform float brightness;
  varying vec2 vUv;
  varying float vFade;
  varying float vHighlight;
  void main() {
    vec4 c = texture2D(atlas, vUv);
    if (c.a * vFade < 0.02) discard;
    c.rgb *= brightness;
    c.rgb += vec3(0.6, 0.5, 0.2) * vHighlight * 0.6;
    gl_FragColor = vec4(c.rgb, c.a * vFade);
  }
`;

interface Stack {
  key: string;
  region: number;
  owner: string;
  units: Unit[];
  from: number | null; // previous region if the stack moved as one
}

function affiliationFor(game: GameState, owner: string): Affiliation {
  if (owner === game.player) return 'F';
  if (atWar(game, game.player, owner)) return 'H';
  if (alliesOf(world, game, game.player).includes(owner)) return 'F';
  return 'N';
}

function dominantSidc(units: Unit[]): string {
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
  let best = units[0]!.type;
  for (const [t, c] of counts) if (c > (counts.get(best) ?? 0)) best = t;
  return world.unitTypes.get(best)?.sidc ?? 'SFGPUCI----';
}

export function buildStacks(game: GameState): Stack[] {
  const map = new Map<string, Stack>();
  for (const u of Object.values(game.units)) {
    const key = `${u.region}|${u.owner}`;
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        region: u.region,
        owner: u.owner,
        units: [],
        from: u.prevRegion !== u.region ? u.prevRegion : null,
      };
      map.set(key, s);
    } else if (s.from !== null && u.prevRegion !== s.from) s.from = null;
    s.units.push(u);
  }
  return [...map.values()];
}

export function Units() {
  const { gl } = useThree();
  const atlas = useMemo(() => new SymbolAtlas(), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          atlas: { value: atlas.texture },
          pixelScale: { value: 1 },
          tileUv: { value: TILE / ATLAS_SIZE },
          brightness: { value: 1.1 },
        },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [atlas],
  );
  const mesh = useMemo(() => {
    const geo = new PlaneGeometry(1, 1);
    geo.setAttribute('iPos', new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3));
    geo.setAttribute('iUv', new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 2), 2));
    geo.setAttribute('iScale', new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1));
    geo.setAttribute(
      'iHighlight',
      new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1),
    );
    const m = new InstancedMesh(geo, material, MAX_INSTANCES);
    const identity = new Matrix4();
    for (let i = 0; i < MAX_INSTANCES; i++) m.setMatrixAt(i, identity);
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }, [material]);

  const stacks = useRef<Stack[]>([]);
  const animStart = useRef(0);
  const paths = useRef(new Map<string, Vector3[]>());
  const game = useGameStore((s) => s.game);

  useEffect(() => {
    if (!game) return;
    stacks.current = buildStacks(game);
    paths.current.clear();
    for (const s of stacks.current) {
      if (s.from === null) continue;
      const a = world.regions.get(s.from);
      const b = world.regions.get(s.region);
      if (!a || !b) continue;
      paths.current.set(s.key, greatCirclePoints(a.lat, a.lon, b.lat, b.lon, 24, 1.006, 0.004));
    }
    animStart.current = performance.now();
  }, [game]);

  useFrame(({ camera }) => {
    if (!game) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('iPos') as InstancedBufferAttribute;
    const uv = geo.getAttribute('iUv') as InstancedBufferAttribute;
    const scale = geo.getAttribute('iScale') as InstancedBufferAttribute;
    const hi = geo.getAttribute('iHighlight') as InstancedBufferAttribute;
    const ui = useUiStore.getState();
    const t = Math.min(1, (performance.now() - animStart.current) / 1000 / ANIM_SECONDS);
    const ease = 1 - Math.pow(1 - t, 3);
    const selectedSet = new Set(ui.selectedUnitIds);
    let n = 0;
    const dist = camera.position.length();
    const fovScale = Math.tan(((camera as { fov?: number }).fov ?? 45) * 0.5 * (Math.PI / 180)) * 2;
    material.uniforms.pixelScale!.value =
      (fovScale / gl.domElement.clientHeight) * (dist > 2.8 ? 30 : dist > 1.8 ? 38 : 48);
    // Far out, show only the player's forces and enemies; everyone appears when close or in military mode.
    const showAll = dist < 2.0 || ui.mapMode === 'military';
    const displace = terrainDisplacement(dist, currentLevels().terrain);
    for (const s of stacks.current) {
      if (n >= MAX_INSTANCES) break;
      if (!showAll && s.owner !== game.player && !atWar(game, game.player, s.owner)) continue;
      const meta = world.regions.get(s.region);
      if (!meta) continue;
      const tile = atlas.get(dominantSidc(s.units), affiliationFor(game, s.owner), s.units.length);
      const path = paths.current.get(s.key);
      let p: Vector3;
      if (path && t < 1) {
        const idx = ease * (path.length - 1);
        const i0 = Math.floor(idx);
        const i1 = Math.min(path.length - 1, i0 + 1);
        p = path[i0]!.clone().lerp(path[i1]!, idx - i0);
      } else {
        const hm = getHeightMap();
        const lift = 1.004 + (hm ? heightAt(hm, meta.lat, meta.lon) * displace : 0);
        p = latLonToVec3(meta.lat, meta.lon, lift);
      }
      // Nudge the sprite a little toward the camera so it floats above borders/labels.
      pos.setXYZ(n, p.x, p.y, p.z);
      uv.setXY(n, tile.u, 1 - tile.v - TILE / ATLAS_SIZE);
      scale.setX(n, 1);
      hi.setX(
        n,
        s.units.some((u) => selectedSet.has(u.id)) ? 1 : ui.selectedRegion === s.region ? 0.4 : 0,
      );
      n++;
    }
    mesh.count = n;
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    scale.needsUpdate = true;
    hi.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
