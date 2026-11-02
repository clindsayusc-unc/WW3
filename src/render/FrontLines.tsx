/**
 * Front lines (D-057): borders between regions whose controllers are at war, drawn as thick
 * animated dashed lines with a soft glow underneath. Rebuilt when control or wars change.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Vector2 } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mesh as topoMesh } from 'topojson-client';
import { loadTopology, type RegionTopology } from './Borders';
import { latLonToVec3 } from './geo';
import { getHeightMap, heightAt } from './terrainHeight';
import { terrainDisplacement } from './displacement';
import { useLevels } from './levels';
import { useGameStore } from '../state/gameStore';
import { atWar } from '../sim/query';
import type { GameState } from '../sim/types';

interface FrontGeometry {
  /** lat, lon pairs per segment vertex (2 per segment). */
  latLon: Float32Array;
  heights: Float32Array;
}

export function buildFrontLines(topo: RegionTopology, game: GameState): FrontGeometry {
  type G = { properties?: { id?: number } };
  const controller = (g: unknown): string | null => {
    const id = (g as G).properties?.id;
    return id === undefined ? null : (game.regions[id]?.controller ?? null);
  };
  const lines = topoMesh(topo, topo.objects.regions, (a, b) => {
    if (a === b) return false;
    const ca = controller(a);
    const cb = controller(b);
    return !!ca && !!cb && ca !== cb && atWar(game, ca, cb);
  });
  const hm = getHeightMap();
  const ll: number[] = [];
  const hs: number[] = [];
  for (const line of lines.coordinates) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      ll.push(a[1]!, a[0]!, b[1]!, b[0]!);
      hs.push(hm ? heightAt(hm, a[1]!, a[0]!) : 0, hm ? heightAt(hm, b[1]!, b[0]!) : 0);
    }
  }
  return { latLon: new Float32Array(ll), heights: new Float32Array(hs) };
}

function positionsFor(front: FrontGeometry, lift: number, displace: number): Float32Array {
  const n = front.latLon.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 1 + lift + front.heights[i]! * displace;
    const v = latLonToVec3(front.latLon[i * 2]!, front.latLon[i * 2 + 1]!, r);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

export function FrontLines() {
  const game = useGameStore((s) => s.game);
  const levels = useLevels();
  const [topo, setTopo] = useState<RegionTopology | null>(null);
  useEffect(() => {
    let alive = true;
    loadTopology()
      .then((t) => alive && setTopo(t))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const key = game ? `${game.regionsVersion}|${game.diplomacyVersion}|${game.wars.length}` : '';
  const front = useMemo(
    () => (topo && game ? buildFrontLines(topo, game) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topo, key],
  );

  const lineMat = useMemo(
    () =>
      new LineMaterial({
        color: 0xffb08a,
        linewidth: 2.5,
        transparent: true,
        opacity: 0.95,
        dashed: true,
        dashSize: 0.012,
        gapSize: 0.006,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const glowMat = useMemo(
    () =>
      new LineMaterial({
        color: 0xff4a1a,
        linewidth: 5,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const lines = useMemo(() => {
    const geo = new LineSegmentsGeometry();
    const l = new LineSegments2(geo, lineMat);
    l.renderOrder = 4;
    l.frustumCulled = false;
    return l;
  }, [lineMat]);
  const glow = useMemo(() => {
    const geo = new LineSegmentsGeometry();
    const g = new LineSegments2(geo, glowMat);
    g.renderOrder = 4;
    g.frustumCulled = false;
    return g;
  }, [glowMat]);

  const uploaded = useRef(-1);
  useEffect(() => {
    uploaded.current = -1;
  }, [front]);

  useFrame(({ camera, size, gl }, dt) => {
    const dpr = gl.getPixelRatio();
    lineMat.resolution.set(size.width * dpr, size.height * dpr);
    glowMat.resolution.set(size.width * dpr, size.height * dpr);
    const dist = camera.position.length();
    const d = terrainDisplacement(dist, levels.terrain);
    const visible = !!front && front.latLon.length > 0;
    lines.visible = visible;
    glow.visible = visible && levels.war >= 1;
    if (!front || !visible) return;
    if (Math.abs(uploaded.current - d) > 0.00015) {
      uploaded.current = d;
      const pos = positionsFor(front, 0.002, d);
      lines.geometry.dispose();
      lines.geometry = new LineSegmentsGeometry().setPositions(pos);
      glow.geometry.dispose();
      glow.geometry = new LineSegmentsGeometry().setPositions(pos);
      lines.computeLineDistances();
    }
    // Dash animation (marching) and width/opacity by zoom.
    lineMat.dashOffset -= dt * 0.02;
    const zoom = Math.max(0, Math.min(1, (3.2 - dist) / 1.6));
    lineMat.linewidth = (levels.war >= 2 ? 2.5 : 1.8) * (0.7 + 0.5 * zoom) * dpr;
    glowMat.linewidth = 5.5 * (0.7 + 0.6 * zoom) * dpr;
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 600);
    // From orbit the front is a thin ember line; the glow only grows as the camera comes down.
    const far = Math.max(0.15, Math.min(1, (3.6 - dist) / 1.4));
    lineMat.opacity = 0.95 * pulse * Math.max(0.4, far);
    glowMat.opacity = (levels.war >= 2 ? 0.32 : 0.2) * pulse * far;
    const scale = 1 + (dist - 1) * 1.5;
    lineMat.dashSize = 0.006 * scale;
    lineMat.gapSize = 0.004 * scale;
  });
  return (
    <>
      <primitive object={glow} />
      <primitive object={lines} />
    </>
  );
}

export { Vector2 };
