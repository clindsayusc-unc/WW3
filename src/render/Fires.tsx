/**
 * Burning regions (D-057): flickering orange point lights scattered inside each burning region
 * (bright at night, bloomed) and slow smoke plumes as soft additive-free particles. Two draw calls.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { latLonToVec3 } from './geo';
import { getHeightMap, heightAt } from './terrainHeight';
import { terrainDisplacement } from './displacement';
import { useLevels } from './levels';
import { burningRegions } from './palette';
import { useGameStore } from '../state/gameStore';
import { loadWorld } from '../sim/world';
import { SUN } from './sun';
import { useDispose } from './useDispose';

const world = loadWorld();

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smokeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

const FIRE_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aHeight;
  uniform float time;
  uniform float pixelScale;
  uniform float uDisplace;
  uniform vec3 sunDir;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vSeed = aSeed;
    vec3 n = normalize(position);
    vec3 p = position * (1.0 + aHeight * uDisplace);
    float night = 1.0 - smoothstep(-0.2, 0.15, dot(n, normalize(sunDir)));
    float facing = dot(n, normalize(cameraPosition));
    float horizon = 1.0 / length(cameraPosition);
    float fade = smoothstep(horizon + 0.02, horizon + 0.12, facing);
    float flicker = 0.6 + 0.4 * sin(time * (9.0 + aSeed * 6.0) + aSeed * 40.0) * sin(time * 3.7 + aSeed * 11.0);
    vAlpha = aIntensity * (0.4 + 0.8 * night) * flicker * fade;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = pixelScale * (3.0 + 4.5 * aIntensity) * (0.7 + 0.3 * flicker) / max(-mv.z, 0.05);
    gl_Position = projectionMatrix * mv;
  }
`;
const FIRE_FRAG = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float core = exp(-r * r * 6.0);
    float halo = exp(-r * r * 1.8) * 0.35;
    vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.5), core * 0.8);
    gl_FragColor = vec4(col * (core + halo) * 1.6, (core + halo) * vAlpha);
  }
`;

const SMOKE_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aHeight;
  attribute vec3 aDrift;
  uniform float time;
  uniform float pixelScale;
  uniform float uDisplace;
  uniform vec3 sunDir;
  varying float vAlpha;
  varying float vLight;
  void main() {
    vec3 n = normalize(position);
    float cycle = 22.0 + aSeed * 10.0;
    float t = fract(time / cycle + aSeed);
    vec3 p = position * (1.0 + aHeight * uDisplace + t * 0.02) + aDrift * t * 0.015;
    float facing = dot(n, normalize(cameraPosition));
    float horizon = 1.0 / length(cameraPosition);
    float fade = smoothstep(horizon + 0.02, horizon + 0.12, facing);
    float life = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.55, 1.0, t));
    vAlpha = aIntensity * life * fade * 0.4;
    float ndl = dot(n, normalize(sunDir));
    vLight = 0.08 + 0.5 * smoothstep(-0.2, 0.3, ndl);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = pixelScale * (7.0 + 30.0 * t) / max(-mv.z, 0.05);
    gl_Position = projectionMatrix * mv;
  }
`;
const SMOKE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D map;
  varying float vAlpha;
  varying float vLight;
  void main() {
    float a = texture2D(map, gl_PointCoord).a;
    vec3 col = vec3(0.22, 0.2, 0.19) * vLight + vec3(0.02);
    gl_FragColor = vec4(col, a * vAlpha);
  }
`;

interface ParticleSet {
  position: Float32Array;
  seed: Float32Array;
  intensity: Float32Array;
  height: Float32Array;
  drift: Float32Array;
}

function scatter(fires: Map<number, number>, perRegion: number): ParticleSet {
  const hm = getHeightMap();
  const pos: number[] = [];
  const seed: number[] = [];
  const inten: number[] = [];
  const hgt: number[] = [];
  const drift: number[] = [];
  const tmp = new Vector3();
  for (const [id, b] of fires) {
    const meta = world.regions.get(id);
    if (!meta) continue;
    const n = Math.max(2, Math.round(perRegion * (0.3 + b)));
    // scatter within ~a third of the region's equivalent radius
    const rDeg = Math.min(2.2, (Math.sqrt(meta.areaKm2) / 111) * 0.35);
    for (let i = 0; i < n; i++) {
      const u = hash(id * 131 + i * 7);
      const v = hash(id * 977 + i * 13);
      const ang = u * Math.PI * 2;
      const rad = Math.sqrt(v) * rDeg;
      const lat = meta.lat + Math.sin(ang) * rad;
      const lon =
        meta.lon + (Math.cos(ang) * rad) / Math.max(0.2, Math.cos((meta.lat * Math.PI) / 180));
      latLonToVec3(lat, lon, 1.0025, tmp);
      pos.push(tmp.x, tmp.y, tmp.z);
      seed.push(hash(id * 17 + i * 3));
      inten.push(b * (0.6 + 0.4 * hash(i * 31 + id)));
      hgt.push(hm ? heightAt(hm, lat, lon) : 0);
      // wind: eastward with a little randomness
      const east = new Vector3(0, 1, 0).cross(tmp).normalize();
      drift.push(east.x * (0.6 + u * 0.8), east.y * (0.6 + u * 0.8), east.z * (0.6 + u * 0.8));
    }
  }
  return {
    position: new Float32Array(pos),
    seed: new Float32Array(seed),
    intensity: new Float32Array(inten),
    height: new Float32Array(hgt),
    drift: new Float32Array(drift),
  };
}

function geometryFrom(set: ParticleSet): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(set.position, 3));
  geo.setAttribute('aSeed', new Float32BufferAttribute(set.seed, 1));
  geo.setAttribute('aIntensity', new Float32BufferAttribute(set.intensity, 1));
  geo.setAttribute('aHeight', new Float32BufferAttribute(set.height, 1));
  geo.setAttribute('aDrift', new Float32BufferAttribute(set.drift, 3));
  return geo;
}

export function Fires() {
  const sun = SUN;
  const game = useGameStore((s) => s.game);
  const levels = useLevels();
  const smokeTex = useMemo(() => smokeTexture(), []);
  const fireMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: FIRE_VERT,
        fragmentShader: FIRE_FRAG,
        uniforms: {
          time: { value: 0 },
          pixelScale: { value: 1 },
          uDisplace: { value: 0 },
          sunDir: { value: sun },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [sun],
  );
  const smokeMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SMOKE_VERT,
        fragmentShader: SMOKE_FRAG,
        uniforms: {
          time: { value: 0 },
          pixelScale: { value: 1 },
          uDisplace: { value: 0 },
          sunDir: { value: sun },
          map: { value: smokeTex },
        },
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    [sun, smokeTex],
  );
  useDispose(fireMat, smokeMat, smokeTex);
  const fires = useMemo(() => {
    const p = new Points(new BufferGeometry(), fireMat);
    p.renderOrder = 5;
    p.frustumCulled = false;
    return p;
  }, [fireMat]);
  const smoke = useMemo(() => {
    const p = new Points(new BufferGeometry(), smokeMat);
    p.renderOrder = 5;
    p.frustumCulled = false;
    return p;
  }, [smokeMat]);
  useEffect(() => {
    if (!game) return;
    const burning = burningRegions(world, game);
    const density = levels.war >= 2 ? 14 : levels.war === 1 ? 8 : 4;
    const f = scatter(burning, density);
    fires.geometry.dispose();
    fires.geometry = geometryFrom(f);
    fires.visible = burning.size > 0;
    const s = scatter(burning, levels.war >= 2 ? 10 : levels.war === 1 ? 5 : 0);
    smoke.geometry.dispose();
    smoke.geometry = geometryFrom(s);
    smoke.visible = burning.size > 0 && levels.war >= 1;
  }, [game, fires, smoke, levels.war]);
  useFrame(({ camera, gl, size }, dt) => {
    const d = terrainDisplacement(camera.position.length(), levels.terrain);
    const fov = ((camera as { fov?: number }).fov ?? 45) * (Math.PI / 180);
    const px = ((size.height * gl.getPixelRatio()) / (2 * Math.tan(fov / 2))) * 0.0005;
    for (const m of [fireMat, smokeMat]) {
      m.uniforms.time!.value = (m.uniforms.time!.value as number) + dt;
      m.uniforms.uDisplace!.value = d;
      m.uniforms.pixelScale!.value = px;
    }
  });
  return (
    <>
      <primitive object={smoke} />
      <primitive object={fires} />
    </>
  );
}
