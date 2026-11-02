/** Anti-aliased-looking country borders as line segments slightly above the surface (D-035). */
import { useEffect, useMemo, useState } from 'react';
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import { mesh as topoMesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import topoUrl from '../../data/regions.topo.json?url';
import { latLonToVec3 } from './geo';
import { useUiStore } from '../state/uiStore';

interface BorderSets {
  countries: Float32Array;
  regions: Float32Array;
}
let cached: Promise<BorderSets> | null = null;

function loadBorders(): Promise<BorderSets> {
  if (cached) return cached;
  cached = fetch(topoUrl)
    .then((r) => r.json())
    .then((topo: Topology<{ regions: GeometryCollection<{ iso3: string }> }>) => {
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
      let out: number[] = [];
      const push = (coords: number[][], radius: number) => {
        for (let i = 0; i + 1 < coords.length; i++) {
          const a = latLonToVec3(coords[i]![1]!, coords[i]![0]!, radius);
          const b = latLonToVec3(coords[i + 1]![1]!, coords[i + 1]![0]!, radius);
          out.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      };
      for (const line of lines.coordinates) push(line, 1.0015);
      for (const line of coast.coordinates) push(line, 1.0012);
      const countries = new Float32Array(out);
      out = [];
      for (const line of inner.coordinates) push(line, 1.0013);
      return { countries, regions: new Float32Array(out) };
    });
  return cached;
}

function makeLines(positions: Float32Array, color: string, order: number): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mat = new LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
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
  const countries = useMemo(() => (sets ? makeLines(sets.countries, '#e6edf7', 3) : null), [sets]);
  const regions = useMemo(() => (sets ? makeLines(sets.regions, '#cbd5e1', 3) : null), [sets]);
  const dist = useUiStore((s) => s.cameraDistance);
  useEffect(() => {
    if (countries)
      (countries.material as LineBasicMaterial).opacity = Math.max(
        0.2,
        Math.min(0.75, (2.8 - dist) * 0.45),
      );
    if (regions) {
      const a = Math.max(0, Math.min(0.4, (1.9 - dist) * 0.6));
      (regions.material as LineBasicMaterial).opacity = a;
      regions.visible = a > 0.01;
    }
  }, [dist, countries, regions]);
  return (
    <>
      {countries && <primitive object={countries} />}
      {regions && <primitive object={regions} />}
    </>
  );
}
