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

const LINE_VERT = /* glsl */ `
  attribute float height;
  uniform float uDisplace;
  void main() {
    vec3 p = position * (1.0 + height * uDisplace);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const LINE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() { gl_FragColor = vec4(uColor, uOpacity); }
`;

function makeLines(
  positions: Float32Array,
  heights: Float32Array,
  color: string,
  order: number,
): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('height', new Float32BufferAttribute(heights, 1));
  const mat = new ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: 0.35 },
      uDisplace: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });
  const obj = new LineSegments(geo, mat);
  obj.renderOrder = order;
  return obj;
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
  const countries = useMemo(
    () => (sets ? makeLines(sets.countries, sets.countriesHeight, '#e6edf7', 3) : null),
    [sets],
  );
  const regions = useMemo(
    () => (sets ? makeLines(sets.regions, sets.regionsHeight, '#cbd5e1', 3) : null),
    [sets],
  );
  const dist = useUiStore((s) => s.cameraDistance);
  useEffect(() => {
    if (countries)
      (countries.material as ShaderMaterial).uniforms.uOpacity!.value = Math.max(
        0.2,
        Math.min(0.75, (2.8 - dist) * 0.45),
      );
    if (regions) {
      const a = Math.max(0, Math.min(0.4, (1.9 - dist) * 0.6));
      (regions.material as ShaderMaterial).uniforms.uOpacity!.value = a;
      regions.visible = a > 0.01;
    }
  }, [dist, countries, regions]);
  useFrame(({ camera }) => {
    const d = terrainDisplacement(camera.position.length(), currentLevels().terrain);
    if (countries) (countries.material as ShaderMaterial).uniforms.uDisplace!.value = d;
    if (regions) (regions.material as ShaderMaterial).uniforms.uDisplace!.value = d;
  });
  return (
    <>
      {countries && <primitive object={countries} />}
      {regions && <primitive object={regions} />}
    </>
  );
}
