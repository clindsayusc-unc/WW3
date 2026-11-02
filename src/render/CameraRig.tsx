/**
 * Orbit camera with damped inertia, log zoom, smooth fly-to and a slight tilt at low altitude (D-036).
 * Also owns pointer picking: hover/select regions via the CPU region-ID map, right-click to order moves.
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

const world = loadWorld();

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
    flying: false,
    dragging: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    downX: 0,
    downY: 0,
    lastNonce: 0,
    hoverCooldown: 0,
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

  useEffect(() => {
    const el = gl.domElement;
    const s = state.current;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      s.dragging = true;
      s.moved = false;
      s.lastX = s.downX = e.clientX;
      s.lastY = s.downY = e.clientY;
      s.flying = false;
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
      } else {
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
      const factor = Math.exp(e.deltaY * 0.0012);
      s.tDist = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, s.tDist * factor));
      s.flying = false;
    };
    const onLeave = () => useUiStore.getState().setHover(null);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, idMap]);

  // Fly-to requests from the UI.
  const flyTo = useUiStore((s) => s.flyTo);
  useEffect(() => {
    if (!flyTo || flyTo.nonce === state.current.lastNonce) return;
    const s = state.current;
    s.lastNonce = flyTo.nonce;
    s.tLat = flyTo.lat;
    // shortest way around
    let dl = flyTo.lon - ((((s.lon + 180) % 360) + 360) % 360) + 180;
    dl = ((dl + 540) % 360) - 180;
    s.tLon = s.lon + dl;
    s.tDist = flyTo.distance;
    s.flying = true;
  }, [flyTo]);

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
    if (ui.screen === 'menu' && !s.dragging) s.tLon += dt * 1.2; // slow cinematic spin on the menu
    const k = s.flying ? 1 - Math.exp(-dt * 2.2) : 1 - Math.exp(-dt * 9);
    s.lat += (s.tLat - s.lat) * k;
    s.lon += (s.tLon - s.lon) * k;
    const zk = 1 - Math.exp(-dt * (s.flying ? 2.2 : 7));
    s.dist = Math.exp(Math.log(s.dist) + (Math.log(s.tDist) - Math.log(s.dist)) * zk);
    if (!s.dragging) {
      // inertia
      const damp = Math.exp(-dt * 4);
      s.vLat *= damp;
      s.vLon *= damp;
      if (!s.flying && (Math.abs(s.vLat) > 1e-4 || Math.abs(s.vLon) > 1e-4)) {
        s.tLon += s.vLon * dt * 8;
        s.tLat = Math.max(-85, Math.min(85, s.tLat + s.vLat * dt * 8));
      }
    }
    if (
      s.flying &&
      Math.abs(s.tLat - s.lat) < 0.05 &&
      Math.abs(s.tLon - s.lon) < 0.05 &&
      Math.abs(s.tDist - s.dist) < 0.002
    )
      s.flying = false;
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
    const w = gl.domElement.clientWidth;
    const h = gl.domElement.clientHeight;
    if (ui.screen === 'menu') (camera as PerspectiveCamera).setViewOffset(w, h, -w * 0.28, 0, w, h);
    else if ((camera as PerspectiveCamera).view?.enabled)
      (camera as PerspectiveCamera).clearViewOffset();
    camera.updateProjectionMatrix();
    ui.setCameraDistance(s.dist);
  });
  return null;
}
