/**
 * Orbit camera with damped inertia, log zoom, eased fly-to arcs, a slow idle orbit on the menu and
 * a skippable strike cam that follows a missile (D-036, D-056). Also owns pointer picking: hover
 * and select regions via the CPU region-ID map, right-click to order moves.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Ray, Sphere, Vector3, type PerspectiveCamera } from 'three';
import { latLonToVec3, vec3ToLatLon } from './geo';
import { regionAt, type RegionIdMap } from './regionIds';
import { useUiStore } from '../state/uiStore';
import { useGameStore } from '../state/gameStore';
import { dispatch, requestOdds } from '../state/simBridge';
import { loadWorld } from '../sim/world';
import { playSound } from '../ui/audio';

export const MIN_DISTANCE = 1.05; // ≈ 320 km altitude
export const MAX_DISTANCE = 4.2;

interface Props {
  idMap: RegionIdMap;
}

interface Flight {
  t0: number;
  duration: number;
  lat0: number;
  lon0: number;
  d0: number;
  lat1: number;
  lon1: number;
  d1: number;
  /** Extra zoom-out in the middle of long flights (fraction of distance). */
  bump: number;
}

interface StrikeCam {
  points: Vector3[];
  t0: number;
  duration: number;
  lat: number;
  lon: number;
}

const world = loadWorld();
const smootherstep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function CameraRig({ idMap }: Props) {
  const { camera, gl } = useThree();
  const state = useRef({
    lat: 22,
    lon: 10,
    dist: 2.9,
    vLat: 0,
    vLon: 0,
    tLat: 22,
    tLon: 10,
    tDist: 2.9,
    flight: null as Flight | null,
    strike: null as StrikeCam | null,
    dragging: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    downX: 0,
    downY: 0,
    lastNonce: 0,
    lastStrikeNonce: 0,
    idle: 0,
  });
  const unitSphere = useRef(new Sphere(new Vector3(0, 0, 0), 1)).current;
  const ray = useRef(new Ray()).current;
  const tmp = useRef(new Vector3()).current;

  /** Region under a client-space pointer position, or null when pointing at space. */
  const pick = (clientX: number, clientY: number): number | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    tmp.set(x, y, 0.5).unproject(camera);
    ray.origin.copy(camera.position);
    ray.direction.copy(tmp.sub(camera.position).normalize());
    const hit = ray.intersectSphere(unitSphere, new Vector3());
    if (!hit) return null;
    const { lat, lon } = vec3ToLatLon(hit);
    const id = regionAt(idMap, lat, lon);
    return id > 0 ? id : null;
  };

  /** Start an eased flight from the current view to a target. */
  const startFlight = (lat: number, lon: number, dist: number, now = performance.now()) => {
    const s = state.current;
    let dl = lon - ((((s.lon + 180) % 360) + 360) % 360) + 180;
    dl = ((dl + 540) % 360) - 180;
    const lon1 = s.lon + dl;
    const theta = Math.hypot(lat - s.lat, dl);
    const duration = Math.min(2800, 700 + theta * 14 + Math.abs(Math.log(dist / s.dist)) * 500);
    s.flight = {
      t0: now,
      duration,
      lat0: s.lat,
      lon0: s.lon,
      d0: s.dist,
      lat1: lat,
      lon1,
      d1: dist,
      bump: theta > 25 ? Math.min(0.9, (theta / 90) * 0.7) : 0,
    };
    s.tLat = lat;
    s.tLon = lon1;
    s.tDist = dist;
    s.vLat = s.vLon = 0;
  };

  const endStrikeCam = () => {
    const s = state.current;
    if (!s.strike) return;
    const target = s.strike;
    s.strike = null;
    // Resume from where the camera is, then settle on the impact.
    const { lat, lon } = vec3ToLatLon(camera.position);
    s.lat = s.tLat = lat;
    s.lon = s.tLon = lon;
    s.dist = s.tDist = camera.position.length();
    startFlight(target.lat, target.lon, 1.35);
    useUiStore.getState().requestStrikeCam(null);
  };

  useEffect(() => {
    const el = gl.domElement;
    const s = state.current;
    const onDown = (e: PointerEvent) => {
      if (s.strike) endStrikeCam();
      if (e.button !== 0) return;
      s.dragging = true;
      s.moved = false;
      s.lastX = s.downX = e.clientX;
      s.lastY = s.downY = e.clientY;
      s.flight = null;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (s.dragging) {
        const dx = e.clientX - s.lastX;
        const dy = e.clientY - s.lastY;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        if (Math.abs(e.clientX - s.downX) + Math.abs(e.clientY - s.downY) > 4) s.moved = true;
        const speed = 0.12 * Math.max(0.02, s.dist - 1);
        s.vLon = -dx * speed;
        s.vLat = dy * speed;
        s.tLon -= dx * speed;
        s.tLat = Math.max(-85, Math.min(85, s.tLat + dy * speed));
      } else if (!s.strike) {
        const id = pick(e.clientX, e.clientY);
        useUiStore.getState().setHover(id);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 0 && s.dragging) {
        s.dragging = false;
        if (!s.moved) {
          const id = pick(e.clientX, e.clientY);
          const ui = useUiStore.getState();
          ui.select(id);
          if (id) playSound('click');
        }
      }
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const id = pick(e.clientX, e.clientY);
      const ui = useUiStore.getState();
      if (!id || ui.selectedUnitIds.length === 0) return;
      dispatch({ type: 'moveUnits', unitIds: ui.selectedUnitIds, target: id });
      requestOdds(ui.selectedUnitIds, id, () => undefined);
      playSound('order');
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (s.strike) endStrikeCam();
      const factor = Math.exp(e.deltaY * 0.0012);
      s.tDist = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, s.tDist * factor));
      s.flight = null;
    };
    const onKey = () => {
      if (s.strike) endStrikeCam();
    };
    const onLeave = () => useUiStore.getState().setHover(null);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, idMap]);

  // Dev/e2e hook: client-space position of a region centroid, and world lookups.
  useEffect(() => {
    const w = window as unknown as { ww3?: Record<string, unknown> };
    w.ww3 = w.ww3 ?? {};
    w.ww3.screenPos = (regionId: number) => {
      const meta = world.regions.get(regionId);
      if (!meta) return null;
      const p = latLonToVec3(meta.lat, meta.lon, 1.004).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
        z: p.z,
      };
    };
    w.ww3.neighbours = (regionId: number) => [...(world.regions.get(regionId)?.neighbours ?? [])];
    w.ww3.capital = (iso3: string) => world.capitalRegion.get(iso3) ?? null;
    w.ww3.isLand = (regionId: number) => !(world.regions.get(regionId)?.sea ?? true);
    w.ww3.regionLatLon = (regionId: number) => {
      const m = world.regions.get(regionId);
      return m ? { lat: m.lat, lon: m.lon } : null;
    };
    w.ww3.camera = () => ({
      lat: state.current.lat,
      lon: state.current.lon,
      dist: state.current.dist,
      flying: !!state.current.flight,
      strikeCam: !!state.current.strike,
    });
  }, [camera, gl]);

  // Fly-to requests from the UI.
  const flyTo = useUiStore((s) => s.flyTo);
  useEffect(() => {
    if (!flyTo || flyTo.nonce === state.current.lastNonce) return;
    state.current.lastNonce = flyTo.nonce;
    if (state.current.strike) return;
    startFlight(flyTo.lat, flyTo.lon, flyTo.distance);
  }, [flyTo]);

  // Strike cam requests (D-056).
  const strikeReq = useUiStore((s) => s.strikeCamRequest);
  useEffect(() => {
    if (!strikeReq || strikeReq.nonce === state.current.lastStrikeNonce) return;
    state.current.lastStrikeNonce = strikeReq.nonce;
    if (!useUiStore.getState().strikeCam) return;
    state.current.strike = {
      points: strikeReq.points.map((p) => new Vector3(p.x, p.y, p.z)),
      t0: performance.now(),
      duration: strikeReq.duration,
      lat: strikeReq.lat,
      lon: strikeReq.lon,
    };
    state.current.flight = null;
    state.current.dragging = false;
  }, [strikeReq]);

  // Start on the player's capital when a game begins.
  const player = useGameStore((s) => s.game?.player);
  useEffect(() => {
    if (!player) return;
    const cap = world.capitalRegion.get(player);
    const meta = cap !== undefined ? world.regions.get(cap) : undefined;
    if (meta) useUiStore.getState().fly(meta.lat, meta.lon, 2.4);
  }, [player]);

  useFrame((_, dt) => {
    const s = state.current;
    const ui = useUiStore.getState();
    const now = performance.now();
    const w = gl.domElement.clientWidth;
    const h = gl.domElement.clientHeight;

    // --- strike cam: chase the missile head, then linger on the impact
    if (s.strike) {
      const sc = s.strike;
      const p = (now - sc.t0) / sc.duration;
      if (p > 1.9) {
        endStrikeCam();
      } else {
        const pts = sc.points;
        const fi = Math.min(1, p) * (pts.length - 1);
        const i0 = Math.floor(fi);
        const i1 = Math.min(pts.length - 1, i0 + 1);
        const head = pts[i0]!.clone().lerp(pts[i1]!, fi - i0);
        const tangent = pts[i1]!.clone()
          .sub(pts[Math.max(0, i0 - 1)]!)
          .normalize();
        const up = head.clone().normalize();
        // Behind and above the missile; after impact pull back and up.
        const after = Math.max(0, p - 1);
        const back = 0.08 + after * 0.12;
        const lift = 0.05 + after * 0.1;
        const target = head.clone().sub(tangent.multiplyScalar(back)).add(up.multiplyScalar(lift));
        const k = 1 - Math.exp(-dt * 6);
        camera.position.lerp(target, p < 0.02 ? 1 : k);
        camera.up.set(0, 1, 0);
        camera.lookAt(head);
        camera.near = 0.003;
        camera.far = 50;
        if ((camera as PerspectiveCamera).view?.enabled)
          (camera as PerspectiveCamera).clearViewOffset();
        camera.updateProjectionMatrix();
        ui.setCameraDistance(camera.position.length());
        return;
      }
    }

    // --- menu: slow idle orbit with a gentle drift in latitude and a breathing zoom
    if (ui.screen === 'menu' && !s.dragging) {
      s.idle += dt;
      s.tLon += dt * 1.2;
      s.tLat = 14 + Math.sin(s.idle * 0.07) * 14;
      s.tDist = 2.9 + Math.sin(s.idle * 0.11) * 0.12;
    }

    if (s.flight) {
      const f = s.flight;
      const x = (now - f.t0) / f.duration;
      const e = smootherstep(x);
      s.lat = f.lat0 + (f.lat1 - f.lat0) * e;
      s.lon = f.lon0 + (f.lon1 - f.lon0) * e;
      const logD = Math.log(f.d0) + (Math.log(f.d1) - Math.log(f.d0)) * e;
      s.dist = Math.exp(logD) * (1 + f.bump * Math.sin(Math.PI * Math.min(1, x)));
      if (x >= 1) {
        s.flight = null;
        s.lat = f.lat1;
        s.lon = f.lon1;
        s.dist = f.d1;
      }
    } else {
      const k = 1 - Math.exp(-dt * 9);
      s.lat += (s.tLat - s.lat) * k;
      s.lon += (s.tLon - s.lon) * k;
      const zk = 1 - Math.exp(-dt * 7);
      s.dist = Math.exp(Math.log(s.dist) + (Math.log(s.tDist) - Math.log(s.dist)) * zk);
      if (!s.dragging) {
        // inertia
        const damp = Math.exp(-dt * 4);
        s.vLat *= damp;
        s.vLon *= damp;
        if (Math.abs(s.vLat) > 1e-4 || Math.abs(s.vLon) > 1e-4) {
          s.tLon += s.vLon * dt * 8;
          s.tLat = Math.max(-85, Math.min(85, s.tLat + s.vLat * dt * 8));
        }
      }
    }
    // Slight tilt toward the horizon at low altitude: swing the camera south of the target while
    // keeping the target centred, so the view becomes oblique without drifting.
    const tilt = Math.max(0, Math.min(1, (1.6 - s.dist) / 0.55));
    const surface = latLonToVec3(s.lat, s.lon, 1);
    const east = new Vector3(0, 1, 0).cross(surface).normalize();
    const offset = surface.clone().multiplyScalar(s.dist - 1);
    if (tilt > 0 && east.lengthSq() > 0) offset.applyAxisAngle(east, tilt * 0.55);
    camera.position.copy(surface).add(offset);
    camera.up.set(0, 1, 0);
    camera.lookAt(tilt > 0 ? surface : new Vector3(0, 0, 0));
    camera.near = Math.max(0.002, (s.dist - 1) * 0.3);
    camera.far = 50;
    // On the menu, push the globe to the right half of the screen.
    if (ui.screen === 'menu') (camera as PerspectiveCamera).setViewOffset(w, h, -w * 0.28, 0, w, h);
    else if ((camera as PerspectiveCamera).view?.enabled)
      (camera as PerspectiveCamera).clearViewOffset();
    camera.updateProjectionMatrix();
    ui.setCameraDistance(s.dist);
  });
  return null;
}
