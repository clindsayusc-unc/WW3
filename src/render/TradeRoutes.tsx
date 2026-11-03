/**
 * Trade routes as flowing arcs (D-061), shown in the Economy map mode. Each bilateral route from
 * the simulation becomes one ribbon from capital to capital through the sea zones its cargo
 * actually uses, lifted into a gentle arc. Width follows volume; colour follows status; dashes
 * flow from the larger partner to the smaller. Cut routes stand still and pulse. One mesh.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { latLonToVec3 } from './geo';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { loadWorld } from '../sim/world';
import type { TradeRoute, TradeStatus } from '../sim/types';

const world = loadWorld();

export const ROUTE_COLOR: Record<TradeStatus, string> = {
  open: '#4ade80',
  rerouted: '#fbbf24',
  contested: '#fb923c',
  cut: '#ef4444',
  sanctioned: '#f472b6',
  embargoed: '#ef4444',
  war: '#ef4444',
};

/** Okabe–Ito route colours for the colourblind palette (D-080). */
export const ROUTE_COLOR_CB: Record<TradeStatus, string> = {
  open: '#56b4e9',
  rerouted: '#f0e442',
  contested: '#e69f00',
  cut: '#d55e00',
  sanctioned: '#cc79a7',
  embargoed: '#d55e00',
  war: '#d55e00',
};

const VERT = /* glsl */ `
  attribute float aT;
  attribute float aSide;
  attribute float aLen;
  attribute float aFlow;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vT;
  varying float vSide;
  varying float vLen;
  varying float vFlow;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vT = aT;
    vSide = aSide;
    vLen = aLen;
    vFlow = aFlow;
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  uniform float time;
  varying float vT;
  varying float vSide;
  varying float vLen;
  varying float vFlow;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
    float ends = smoothstep(0.0, 0.04, vT) * smoothstep(1.0, 0.96, vT);
    // Dashes every ~0.03 radians, flowing along the route (direction from aFlow's sign).
    float d = fract(vT * vLen * 30.0 - time * 0.9 * vFlow);
    float dash = vFlow == 0.0 ? 0.55 + 0.45 * sin(time * 3.0) : 0.35 + 0.65 * smoothstep(0.0, 0.25, d) * smoothstep(1.0, 0.6, d);
    gl_FragColor = vec4(vColor * (0.7 + 0.6 * dash), vAlpha * edge * ends * (0.45 + 0.55 * dash));
  }
`;

/** Points of a route: capital → sea zones it runs through → capital, as unit vectors. */
function routePoints(r: TradeRoute): Vector3[] {
  const ca = world.capitalRegion.get(r.a);
  const cb = world.capitalRegion.get(r.b);
  const ids = [ca, ...(r.land ? [] : r.via), cb].filter((x): x is number => x !== undefined);
  const pts: Vector3[] = [];
  for (const id of ids) {
    const m = world.regions.get(id);
    if (!m) continue;
    const v = latLonToVec3(m.lat, m.lon, 1);
    if (pts.length > 0 && pts[pts.length - 1]!.distanceTo(v) < 0.01) continue;
    pts.push(v);
  }
  return pts;
}

/** Densify a polyline on the sphere with slerp, then smooth it with two Chaikin passes. */
function smoothPath(pts: Vector3[]): Vector3[] {
  let out: Vector3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const omega = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    const n = Math.max(2, Math.ceil(omega / 0.03));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      if (omega < 1e-5) out.push(a.clone());
      else {
        const sa = Math.sin((1 - t) * omega) / Math.sin(omega);
        const sb = Math.sin(t * omega) / Math.sin(omega);
        out.push(a.clone().multiplyScalar(sa).add(b.clone().multiplyScalar(sb)).normalize());
      }
    }
  }
  out.push(pts[pts.length - 1]!.clone());
  for (let pass = 0; pass < 2; pass++) {
    const next: Vector3[] = [out[0]!];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]!;
      const b = out[i + 1]!;
      next.push(a.clone().lerp(b, 0.25).normalize(), a.clone().lerp(b, 0.75).normalize());
    }
    next.push(out[out.length - 1]!);
    out = next;
  }
  return out;
}

function appendRoute(
  r: TradeRoute,
  highlight: boolean,
  buf: { pos: number[]; t: number[]; side: number[]; len: number[]; flow: number[]; alpha: number[]; col: number[]; idx: number[] },
  colors: Record<TradeStatus, string> = ROUTE_COLOR,
): void {
  const raw = routePoints(r);
  if (raw.length < 2) return;
  const pts = smoothPath(raw);
  // Cumulative arc length (radians).
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1]! + pts[i - 1]!.angleTo(pts[i]!));
  const total = acc[acc.length - 1]! || 1;
  const vol = Math.max(r.volume, r.reference);
  const width = (0.0011 + 0.0042 * Math.sqrt(vol / 840)) * (highlight ? 1.25 : 1);
  const lift = 0.006 + Math.min(0.05, total * 0.035);
  const stopped = r.status === 'cut' || r.status === 'war' || r.status === 'embargoed';
  const gdpA = world.nations.get(r.a)?.gdpUsdBn ?? 0;
  const gdpB = world.nations.get(r.b)?.gdpUsdBn ?? 0;
  const flow = stopped ? 0 : gdpA >= gdpB ? 1 : -1;
  const color = new Color(colors[r.status]);
  const alpha = highlight ? 0.95 : 0.5;
  const base = buf.pos.length / 3;
  const up = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    const s = acc[i]! / total;
    const p = pts[i]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const tangent = next.clone().sub(prev).normalize();
    const right = up.crossVectors(p, tangent).normalize();
    const h = 1.004 + lift * Math.sin(Math.PI * s);
    for (const sd of [-1, 1]) {
      const q = p.clone().add(right.clone().multiplyScalar(width * sd)).normalize().multiplyScalar(h);
      buf.pos.push(q.x, q.y, q.z);
      buf.t.push(s);
      buf.side.push(sd);
      buf.len.push(total);
      buf.flow.push(flow);
      buf.alpha.push(alpha);
      buf.col.push(color.r, color.g, color.b);
    }
    if (i < pts.length - 1) {
      const k = base + i * 2;
      buf.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
}

export function TradeRoutes() {
  const game = useGameStore((s) => s.game);
  const mapMode = useUiStore((s) => s.mapMode);
  const colourblind = useUiStore((s) => s.prefs.palette === 'colourblind');
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    [],
  );
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), material);
    m.renderOrder = 5;
    m.frustumCulled = false;
    m.visible = false;
    return m;
  }, [material]);
  useEffect(() => {
    const show = mapMode === 'economy' && !!game;
    mesh.visible = show;
    if (!show || !game) return;
    const buf = { pos: [], t: [], side: [], len: [], flow: [], alpha: [], col: [], idx: [] } as Parameters<typeof appendRoute>[2];
    // Player routes last so they draw on top.
    const routes = [...game.economy.routes].sort(
      (x, y) => Number(x.a === game.player || x.b === game.player) - Number(y.a === game.player || y.b === game.player),
    );
    for (const r of routes) appendRoute(r, r.a === game.player || r.b === game.player, buf, colourblind ? ROUTE_COLOR_CB : ROUTE_COLOR);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(buf.pos, 3));
    geo.setAttribute('aT', new Float32BufferAttribute(buf.t, 1));
    geo.setAttribute('aSide', new Float32BufferAttribute(buf.side, 1));
    geo.setAttribute('aLen', new Float32BufferAttribute(buf.len, 1));
    geo.setAttribute('aFlow', new Float32BufferAttribute(buf.flow, 1));
    geo.setAttribute('aAlpha', new Float32BufferAttribute(buf.alpha, 1));
    geo.setAttribute('aColor', new Float32BufferAttribute(buf.col, 3));
    geo.setIndex(buf.idx);
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }, [game, mapMode, mesh, colourblind]);
  useFrame((_, dt) => {
    if (!mesh.visible) return;
    material.uniforms.time!.value = (material.uniforms.time!.value as number) + dt;
  });
  return <primitive object={mesh} />;
}
