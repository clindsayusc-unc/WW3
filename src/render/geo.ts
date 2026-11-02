import { Vector3 } from 'three';

export const EARTH_RADIUS_KM = 6371;
const D2R = Math.PI / 180;

/**
 * Lat/lon → unit-sphere position matching three's SphereGeometry UV layout, so equirectangular
 * textures line up: u = (lon + 180) / 360, v = (lat + 90) / 180.
 */
export function latLonToVec3(lat: number, lon: number, radius = 1, out = new Vector3()): Vector3 {
  const la = lat * D2R;
  const lo = lon * D2R;
  const c = Math.cos(la);
  return out.set(c * Math.cos(lo) * radius, Math.sin(la) * radius, -c * Math.sin(lo) * radius);
}

export function vec3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R;
  const lon = Math.atan2(-n.z, n.x) / D2R;
  return { lat, lon };
}

/** Points along the great circle between two lat/lon pairs, lifted to `radius` (+ optional arc height). */
export function greatCirclePoints(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  segments: number,
  radius = 1,
  arcHeight = 0,
): Vector3[] {
  const a = latLonToVec3(aLat, aLon);
  const b = latLonToVec3(bLat, bLon);
  const omega = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let p: Vector3;
    if (omega < 1e-6) p = a.clone();
    else {
      const sa = Math.sin((1 - t) * omega) / Math.sin(omega);
      const sb = Math.sin(t * omega) / Math.sin(omega);
      p = a.clone().multiplyScalar(sa).add(b.clone().multiplyScalar(sb)).normalize();
    }
    const lift = radius + arcHeight * Math.sin(Math.PI * t);
    pts.push(p.multiplyScalar(lift));
  }
  return pts;
}

/** Camera distance (from globe centre, globe radius 1) for an altitude in km. */
export const altitudeToDistance = (km: number): number => 1 + km / EARTH_RADIUS_KM;
export const distanceToAltitude = (d: number): number => (d - 1) * EARTH_RADIUS_KM;

/**
 * Sub-solar point: declination from the in-game month; longitude follows the camera at a fixed
 * "mid-afternoon" offset so the viewed hemisphere is always lit with the terminator in view (D-045),
 * plus a slow real-time drift so the light visibly moves.
 */
export function sunDirection(
  month: number,
  seconds: number,
  cameraLon: number,
  out = new Vector3(),
): Vector3 {
  // Mid-month declination (degrees), January first.
  const decl = -23.44 * Math.cos(((month - 1 + 0.5) / 12) * Math.PI * 2);
  const lon = cameraLon + 38 + Math.sin(seconds / 60) * 12;
  return latLonToVec3(decl, lon, 1, out);
}
