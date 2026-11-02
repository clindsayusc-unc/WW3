/** 2D canvas overlay with country, capital and region labels; fades by zoom and culls overlaps (D-037). */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { latLonToVec3 } from './geo';
import { loadWorld } from '../sim/world';
import { useGameStore } from '../state/gameStore';
import { useUiStore } from '../state/uiStore';
import { nationHex } from './palette';
import { chokepointState } from '../sim/geography';

const CHOKE_COLOR = { open: '#4ade80', contested: '#fbbf24', closed: '#f87171' } as const;

interface LabelItem {
  text: string;
  pos: Vector3;
  priority: number;
  kind: 'country' | 'capital' | 'city' | 'region' | 'sea' | 'seaNamed';
  color: string;
}

const world = loadWorld();

function buildItems(): LabelItem[] {
  const items: LabelItem[] = [];
  // Country labels at the population-weighted centroid of their regions.
  const acc = new Map<string, { x: number; y: number; z: number; w: number }>();
  for (const r of world.regionList) {
    if (r.sea || !world.nations.has(r.iso3)) continue;
    const v = latLonToVec3(r.lat, r.lon, 1);
    const w = Math.max(1e-6, r.areaKm2);
    const a = acc.get(r.iso3) ?? { x: 0, y: 0, z: 0, w: 0 };
    a.x += v.x * w;
    a.y += v.y * w;
    a.z += v.z * w;
    a.w += w;
    acc.set(r.iso3, a);
  }
  for (const n of world.nationList) {
    const a = acc.get(n.iso3);
    if (!a) continue;
    const v = new Vector3(a.x, a.y, a.z).normalize();
    items.push({
      text: n.name.toUpperCase(),
      pos: v,
      priority: Math.log10(n.gdpUsdBn + 1) + (n.major ? 2 : 0),
      kind: 'country',
      color: '#e8eef6',
    });
  }
  for (const c of world.cities) {
    items.push({
      text: c.name,
      pos: latLonToVec3(c.lat, c.lon, 1),
      priority: (c.capital ? 1.5 : 0) + Math.log10(c.population + 1) * 0.3,
      kind: c.capital ? 'capital' : 'city',
      color: '#cbd5e1',
    });
  }
  for (const r of world.regionList) {
    if (r.sea) {
      // Enclosed seas carry real names (D-058); open-ocean cells are "basin — country".
      const named = !r.name.includes(' — ');
      items.push({
        text: named ? r.name.toUpperCase() : r.name,
        pos: latLonToVec3(r.lat, r.lon, 1),
        priority: named ? 0.7 : 0.2,
        kind: named ? 'seaNamed' : 'sea',
        color: '#7dd3fc',
      });
    } else
      items.push({
        text: r.name,
        pos: latLonToVec3(r.lat, r.lon, 1),
        priority: 0.5 + r.populationShare,
        kind: 'region',
        color: '#a7b4c6',
      });
  }
  return items;
}

export function Labels() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const items = useRef<LabelItem[] | null>(null);
  const { camera, gl, size } = useThree();
  const tmp = useRef(new Vector3()).current;

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.className = 'label-layer';
    canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    gl.domElement.parentElement?.appendChild(canvas);
    canvasRef.current = canvas;
    items.current = buildItems();
    return () => {
      canvas.remove();
    };
  }, [gl]);

  useFrame(() => {
    const canvas = canvasRef.current;
    const list = items.current;
    if (!canvas || !list) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== size.width * dpr || canvas.height !== size.height * dpr) {
      canvas.width = size.width * dpr;
      canvas.height = size.height * dpr;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const ui = useUiStore.getState();
    if (ui.screen !== 'game') return;
    const game = useGameStore.getState().game;
    const dist = camera.position.length();
    const camDir = camera.position.clone().normalize();
    // Chokepoint overlay (D-053): an anchor icon with the strait's status colour, always on top.
    if (ui.showChokepoints && game) {
      const horizon0 = 1 / dist;
      for (const c of world.chokepoints) {
        const pos = latLonToVec3(c.lat, c.lon, 1);
        const facing = pos.dot(camDir);
        if (facing < horizon0 + 0.02) continue;
        tmp.copy(pos).multiplyScalar(1.003).project(camera);
        if (tmp.z > 1) continue;
        const x = (tmp.x * 0.5 + 0.5) * size.width;
        const y = (-tmp.y * 0.5 + 0.5) * size.height;
        const s = chokepointState(game, c.id);
        const color = CHOKE_COLOR[s.status];
        const r = dist > 2.6 ? 6 : 8;
        ctx.globalAlpha = Math.min(1, (facing - horizon0) / 0.2);
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2,6,12,0.85)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = `700 ${r + 2}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(
          s.status === 'closed' ? '✕' : s.status === 'contested' ? '!' : '⚓',
          x,
          y + 0.5,
        );
        if (dist < 2.6) {
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.letterSpacing = '0.04em';
          const label = `${c.name.toUpperCase()}${s.status !== 'open' ? ` · ${s.status.toUpperCase()}` : ''}${s.mined ? ' · MINED' : ''}`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(2,6,12,0.85)';
          ctx.strokeText(label, x, y + r + 9);
          ctx.fillStyle = color;
          ctx.fillText(label, x, y + r + 9);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (!ui.showLabels) return;
    // Visibility by kind and zoom.
    const countryAlpha = dist > 3.6 ? 0.6 : dist < 1.25 ? Math.max(0, (dist - 1.1) / 0.15) : 1;
    const capitalAlpha = dist < 2.6 ? Math.min(1, (2.6 - dist) / 0.4) : 0;
    const cityAlpha = dist < 1.9 ? Math.min(1, (1.9 - dist) / 0.3) : 0;
    const regionAlpha = dist < 1.32 ? Math.min(1, (1.32 - dist) / 0.15) : 0;
    const seaAlpha = dist < 1.7 && ui.mapMode === 'military' ? Math.min(1, (1.7 - dist) / 0.3) : 0;
    const seaNamedAlpha = dist < 2.3 ? Math.min(0.85, (2.3 - dist) / 0.4) : 0;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const sorted = list
      .map((it) => {
        const alpha =
          it.kind === 'country'
            ? countryAlpha
            : it.kind === 'capital'
              ? capitalAlpha
              : it.kind === 'city'
                ? cityAlpha
                : it.kind === 'region'
                  ? regionAlpha
                  : it.kind === 'seaNamed'
                    ? seaNamedAlpha
                    : seaAlpha;
        return { it, alpha };
      })
      .filter((x) => x.alpha > 0.02)
      .sort((a, b) => b.it.priority - a.it.priority);
    const horizon = 1 / dist; // cos of the angle to the limb
    for (const { it, alpha } of sorted) {
      // back-face cull with a soft margin
      const facing = it.pos.dot(camDir);
      if (facing < horizon + 0.03) continue;
      tmp.copy(it.pos).multiplyScalar(1.002).project(camera);
      if (tmp.z > 1) continue;
      const x = (tmp.x * 0.5 + 0.5) * size.width;
      const y = (-tmp.y * 0.5 + 0.5) * size.height;
      if (x < -50 || y < -20 || x > size.width + 50 || y > size.height + 20) continue;
      const isCountry = it.kind === 'country';
      const fontSize = isCountry
        ? Math.max(10, Math.min(15, 9 + it.priority * 1.2))
        : it.kind === 'capital'
          ? 12
          : 11;
      const sea = it.kind === 'seaNamed';
      ctx.font = `${sea ? 'italic ' : ''}${isCountry ? 700 : it.kind === 'capital' ? 600 : 400} ${sea ? 10 : fontSize}px Inter, system-ui, sans-serif`;
      if (isCountry) ctx.letterSpacing = '0.14em';
      else if (sea) ctx.letterSpacing = '0.2em';
      else ctx.letterSpacing = '0em';
      const w = ctx.measureText(it.text).width + 14;
      const h = fontSize + 10;
      const box = { x: x - w / 2, y: y - h / 2, w, h };
      if (
        placed.some(
          (p) =>
            box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
        )
      )
        continue;
      placed.push(box);
      const edgeFade = Math.min(1, (facing - horizon) / 0.25);
      ctx.globalAlpha = alpha * edgeFade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let color = it.color;
      if (isCountry && game) {
        const iso = world.nationList.find((n) => n.name.toUpperCase() === it.text)?.iso3;
        if (iso === game.player) color = '#fde68a';
        else if (iso && !game.nations[iso]?.alive) color = '#64748b';
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(2,6,12,0.8)';
      ctx.strokeText(it.text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(it.text, x, y);
      if (it.kind === 'capital' || it.kind === 'city') {
        ctx.beginPath();
        ctx.arc(x, y + h / 2 + 3, it.kind === 'capital' ? 2.5 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = it.kind === 'capital' ? '#fbbf24' : '#cbd5e1';
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });
  return null;
}

export { nationHex };
