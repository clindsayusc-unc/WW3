/** Crisp country/region borders as line segments that follow the displaced terrain (D-035, D-054). */
import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Color, Float32BufferAttribute, LineSegments, ShaderMaterial } from 'three';
import { mesh as topoMesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import topoUrl from '../../data/regions.topo.json?url';
import { latLonToVec3 } from './geo';
import { getHeightMap, heightAt } from './terrainHeight';
import { terrainDisplacement } from './displacement';
import { currentLevels } from './levels';
import { useUiStore } from '../state/uiStore';

interface BorderSets {
  countries: Float32Array;
  countriesHeight: Float32Array;
  regions: Float32Array;
  regionsHeight: Float32Array;
}
let cached: Promise<BorderSets> | null = null;

export type RegionTopology = Topology<{
  regions: GeometryCollection<{ id: number; iso3: string; name: string }>;
}>;
let topoCache: Promise<RegionTopology> | null = null;
export function loadTopology(): Promise<RegionTopology> {
  if (!topoCache) topoCache = fetch(topoUrl).then((r) => r.json() as Promise<RegionTopology>);
  return topoCache;
}

function loadBorders(): Promise<BorderSets> {
  if (cached) return cached;
  cached = loadTopology().then((topo) => {
    type G = { properties?: { iso3?: string } };
    const lines = topoMesh(
      topo,
      topo.objects.regions,
      (a, b) => a !== b && (a as G).properties?.iso3 !== (b as G).properties?.iso3,
    );
    const coast = topoMesh(topo, topo.objects.regions, (a, b) => a === b);
    const inner = topoMesh(
      topo,
      topo.objects.regions,
      (a, b) => a !== b && (a as G).properties?.iso3 === (b as G).properties?.iso3,
    );
    const hm = getHeightMap();
    let out: number[] = [];
    let hs: number[] = [];
    const push = (coords: number[][], radius: number) => {
      for (let i = 0; i + 1 < coords.length; i++) {
        const a = latLonToVec3(coords[i]![1]!, coords[i]![0]!, radius);
        const b = latLonToVec3(coords[i + 1]![1]!, coords[i + 1]![0]!, radius);
        out.push(a.x, a.y, a.z, b.x, b.y, b.z);
        hs.push(
          hm ? heightAt(hm, coords[i]![1]!, coords[i]![0]!) : 0,
          hm ? heightAt(hm, coords[i + 1]![1]!, coords[i + 1]![0]!) : 0,
        );
      }
    };
    for (const line of lines.coordinates) push(line, 1.0015);
    for (const line of coast.coordinates) push(line, 1.0012);
    const countries = new Float32Array(out);
    const countriesHeight = new Float32Array(hs);
    out = [];
    hs = [];
    for (const line of inner.coordinates) push(line, 1.0013);
    return {
      countries,
      countriesHeight,
      regions: new Float32Array(out),
      regionsHeight: new Float32Array(hs),
    };
  });
  return cached;
}

// One draw call for both border sets (D-082): country borders and coasts first, inner region
// borders after them, told apart by a per-vertex kind. When region borders are faded out the draw
// range stops at the end of the country set, so their vertices cost nothing.
const LINE_VERT = /* glsl */ `
  attribute float height;
  attribute float kind;
  uniform float uDisplace;
  varying float vKind;
  void main() {
    vKind = kind;
    vec3 p = position * (1.0 + height * uDisplace);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const LINE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCountryColor;
  uniform vec3 uRegionColor;
  uniform float uCountryOpacity;
  uniform float uRegionOpacity;
  varying float vKind;
  void main() {
    bool region = vKind > 0.5;
    float a = region ? uRegionOpacity : uCountryOpacity;
    if (a < 0.005) discard;
    gl_FragColor = vec4(region ? uRegionColor : uCountryColor, a);
  }
`;

function makeLines(sets: BorderSets): { obj: LineSegments; countryVertices: number } {
  const nc = sets.countries.length / 3;
  const nr = sets.regions.length / 3;
  const pos = new Float32Array((nc + nr) * 3);
  pos.set(sets.countries, 0);
  pos.set(sets.regions, nc * 3);
  const hs = new Float32Array(nc + nr);
  hs.set(sets.countriesHeight, 0);
  hs.set(sets.regionsHeight, nc);
  const kind = new Float32Array(nc + nr);
  kind.fill(1, nc);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('height', new Float32BufferAttribute(hs, 1));
  geo.setAttribute('kind', new Float32BufferAttribute(kind, 1));
  const mat = new ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: {
      uCountryColor: { value: new Color('#e6edf7') },
      uRegionColor: { value: new Color('#cbd5e1') },
      uCountryOpacity: { value: 0.35 },
      uRegionOpacity: { value: 0 },
      uDisplace: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });
  const obj = new LineSegments(geo, mat);
  obj.renderOrder = 3;
  obj.name = 'borders';
  return { obj, countryVertices: nc };
}

export function Borders() {
  const [sets, setSets] = useState<BorderSets | null>(null);
  useEffect(() => {
    let alive = true;
    loadBorders()
      .then((p) => alive && setSets(p))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const lines = useMemo(() => (sets ? makeLines(sets) : null), [sets]);
  useEffect(
    () => () => {
      lines?.obj.geometry.dispose();
      (lines?.obj.material as ShaderMaterial | undefined)?.dispose();
    },
    [lines],
  );
  const dist = useUiStore((s) => s.cameraDistance);
  useEffect(() => {
    if (!lines) return;
    const u = (lines.obj.material as ShaderMaterial).uniforms;
    u.uCountryOpacity!.value = Math.max(0.2, Math.min(0.75, (2.8 - dist) * 0.45));
    const a = Math.max(0, Math.min(0.4, (1.9 - dist) * 0.6));
    u.uRegionOpacity!.value = a;
    lines.obj.geometry.setDrawRange(0, a > 0.01 ? Infinity : lines.countryVertices);
  }, [dist, lines]);
  useFrame(({ camera }) => {
    if (!lines) return;
    const d = terrainDisplacement(camera.position.length(), currentLevels().terrain);
    (lines.obj.material as ShaderMaterial).uniforms.uDisplace!.value = d;
  });
  return lines ? <primitive object={lines.obj} /> : null;
}
