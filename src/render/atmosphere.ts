/**
 * Physically based atmosphere (D-054): precomputed transmittance and single-scattering tables in the
 * style of Bruneton & Neyret (2008/2017), simplified for a camera that is always in space.
 *
 * Units: globe radius Rg = 1. Heights are scaled ×ATMOSPHERE_SCALE so the limb reads from orbit;
 * scattering coefficients are divided by the same factor, so vertical optical depths stay physical.
 *
 * Tables (RGBA16F, linear filtering):
 *   transmittance  256 × 64   T(r, mu) to the top of the atmosphere (Bruneton 2017 parametrisation)
 *   scattering     512 × 128  single scattering for rays entering at the top: rows = view cosine mu
 *                             (impact parameter, ground-hitting half then limb half), columns =
 *                             sun cosine mu_s (exponential mapping over [-1, 1]) × 16 slices of
 *                             nu = cos(view, sun). RGB = Rayleigh,
 *                             A = Mie (grey), both without the phase function (applied at runtime).
 */
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat } from 'three';
import { noteTexture } from './perf';

export const ATMOSPHERE_SCALE = 2.5;
const KM = 1 / 6371; // globe units per km
const TOP_KM = 60 * ATMOSPHERE_SCALE;
export const RG = 1;
export const RT = 1 + TOP_KM * KM;
const H_R = 8 * ATMOSPHERE_SCALE * KM;
const H_M = 1.2 * ATMOSPHERE_SCALE * KM;
// Scattering coefficients per globe unit (per km × km per unit ÷ scale).
const BETA_R = [5.8e-3, 13.5e-3, 33.1e-3].map((b) => b / KM / ATMOSPHERE_SCALE) as [
  number,
  number,
  number,
];
const BETA_M_S = 4e-3 / KM / ATMOSPHERE_SCALE;
const BETA_M_E = BETA_M_S / 0.9;
export const MIE_G = 0.76;

export const TRANS_W = 256;
export const TRANS_H = 64;
export const SCAT_MU = 128;
export const SCAT_MUS = 32;
export const SCAT_NU = 16;

const H_ATM = Math.sqrt(RT * RT - RG * RG);

function distanceToTop(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + RT * RT;
  return Math.max(-r * mu + Math.sqrt(Math.max(d, 0)), 0);
}
function distanceToBottom(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + RG * RG;
  return Math.max(-r * mu - Math.sqrt(Math.max(d, 0)), 0);
}
function intersectsGround(r: number, mu: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + RG * RG >= 0;
}

/** Bruneton 2017 transmittance texture mapping (u = view cosine, v = radius). */
function transmittanceUv(r: number, mu: number): [number, number] {
  const rho = Math.sqrt(Math.max(r * r - RG * RG, 0));
  const d = distanceToTop(r, mu);
  const dMin = RT - r;
  const dMax = rho + H_ATM;
  const xMu = (d - dMin) / (dMax - dMin);
  const xR = rho / H_ATM;
  return [xMu, xR];
}
function rMuFromUv(xMu: number, xR: number): [number, number] {
  const rho = H_ATM * xR;
  const r = Math.sqrt(rho * rho + RG * RG);
  const dMin = RT - r;
  const dMax = rho + H_ATM;
  const d = dMin + xMu * (dMax - dMin);
  const mu = d === 0 ? 1 : (H_ATM * H_ATM - rho * rho - d * d) / (2 * r * d);
  return [r, Math.max(-1, Math.min(1, mu))];
}

/** Optical depths (Rayleigh, Mie) along a ray to the top boundary. */
function opticalDepth(r: number, mu: number, samples = 64): [number, number] {
  const len = distanceToTop(r, mu);
  const dx = len / samples;
  let odR = 0;
  let odM = 0;
  for (let i = 0; i <= samples; i++) {
    const d = i * dx;
    const ri = Math.sqrt(d * d + 2 * r * mu * d + r * r);
    const h = Math.max(ri - RG, 0);
    const w = i === 0 || i === samples ? 0.5 : 1;
    odR += Math.exp(-h / H_R) * w;
    odM += Math.exp(-h / H_M) * w;
  }
  return [odR * dx, odM * dx];
}

export interface AtmosphereTables {
  transmittance: DataTexture;
  scattering: DataTexture;
}

let tables: AtmosphereTables | null = null;

/** Builds (once) the transmittance and scattering tables. ≈ 100 ms on an M3. */
export function atmosphereTables(): AtmosphereTables {
  if (tables) return tables;
  // --- transmittance -------------------------------------------------------------------------
  const trans = new Float32Array(TRANS_W * TRANS_H * 4);
  for (let j = 0; j < TRANS_H; j++) {
    for (let i = 0; i < TRANS_W; i++) {
      const [r, mu] = rMuFromUv(i / (TRANS_W - 1), j / (TRANS_H - 1));
      const [odR, odM] = opticalDepth(r, mu);
      const k = (j * TRANS_W + i) * 4;
      trans[k] = Math.exp(-(BETA_R[0] * odR + BETA_M_E * odM));
      trans[k + 1] = Math.exp(-(BETA_R[1] * odR + BETA_M_E * odM));
      trans[k + 2] = Math.exp(-(BETA_R[2] * odR + BETA_M_E * odM));
      trans[k + 3] = 1;
    }
  }
  const transAt = (r: number, mu: number, out: [number, number, number]) => {
    const [xMu, xR] = transmittanceUv(r, mu);
    const fx = Math.min(TRANS_W - 1, Math.max(0, xMu * (TRANS_W - 1)));
    const fy = Math.min(TRANS_H - 1, Math.max(0, xR * (TRANS_H - 1)));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(TRANS_W - 1, x0 + 1);
    const y1 = Math.min(TRANS_H - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    for (let c = 0; c < 3; c++) {
      const a =
        trans[(y0 * TRANS_W + x0) * 4 + c]! * (1 - tx) + trans[(y0 * TRANS_W + x1) * 4 + c]! * tx;
      const b =
        trans[(y1 * TRANS_W + x0) * 4 + c]! * (1 - tx) + trans[(y1 * TRANS_W + x1) * 4 + c]! * tx;
      out[c] = a * (1 - ty) + b * ty;
    }
  };
  const sunT: [number, number, number] = [0, 0, 0];
  const transmittanceToSun = (r: number, muS: number, out: [number, number, number]) => {
    const sinH = RG / r;
    const cosH = -Math.sqrt(Math.max(1 - sinH * sinH, 0));
    const edge = sinH * 0.0047;
    const t = Math.min(1, Math.max(0, (muS - cosH + edge) / (2 * edge)));
    const s = t * t * (3 - 2 * t);
    if (s <= 0) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    transAt(r, muS, out);
    out[0] *= s;
    out[1] *= s;
    out[2] *= s;
  };

  // --- single scattering for rays entering the atmosphere at r = RT --------------------------
  const W = SCAT_MUS * SCAT_NU;
  const scat = new Float32Array(W * SCAT_MU * 4);
  const SAMPLES = 40;
  for (let row = 0; row < SCAT_MU; row++) {
    // impact parameter b: ground-hitting rays in rows 0..63 (dense near b = RG), limb rays after.
    let b: number;
    if (row < 64) {
      const s = row / 63;
      b = RG * (1 - (1 - s) * (1 - s));
    } else {
      const s = (row - 64) / 63;
      b = RG + (RT - RG) * s * s;
    }
    const mu = -Math.sqrt(Math.max(1 - (b / RT) * (b / RT), 0));
    const ground = intersectsGround(RT, mu) || row < 64;
    const len = ground ? distanceToBottom(RT, mu) : distanceToTop(RT, mu);
    const dx = len / SAMPLES;
    for (let nuI = 0; nuI < SCAT_NU; nuI++) {
      const nu = (nuI / (SCAT_NU - 1)) * 2 - 1;
      for (let musI = 0; musI < SCAT_MUS; musI++) {
        const x = musI / (SCAT_MUS - 1);
        const muS = -Math.log(1 - x * (1 - Math.exp(-6))) / 3 - 1;
        let odR = 0;
        let odM = 0;
        let prevR = 1; // density at previous sample (top of atmosphere: h = TOP → ~0)
        let prevM = 1;
        let accR = 0;
        let accG = 0;
        let accB = 0;
        let accM = 0;
        for (let i = 0; i <= SAMPLES; i++) {
          const d = i * dx;
          const ri = Math.min(RT, Math.max(RG, Math.sqrt(d * d + 2 * RT * mu * d + RT * RT)));
          const h = ri - RG;
          const dR = Math.exp(-h / H_R);
          const dM = Math.exp(-h / H_M);
          if (i > 0) {
            odR += 0.5 * (prevR + dR) * dx;
            odM += 0.5 * (prevM + dM) * dx;
          }
          prevR = dR;
          prevM = dM;
          const muSd = Math.max(-1, Math.min(1, (RT * muS + d * nu) / ri));
          transmittanceToSun(ri, muSd, sunT);
          const w = i === 0 || i === SAMPLES ? 0.5 : 1;
          const tR = Math.exp(-(BETA_R[0] * odR + BETA_M_E * odM)) * sunT[0] * w;
          const tG = Math.exp(-(BETA_R[1] * odR + BETA_M_E * odM)) * sunT[1] * w;
          const tB = Math.exp(-(BETA_R[2] * odR + BETA_M_E * odM)) * sunT[2] * w;
          accR += tR * dR;
          accG += tG * dR;
          accB += tB * dR;
          accM += ((tR + tG + tB) / 3) * dM;
        }
        const k = (row * W + nuI * SCAT_MUS + musI) * 4;
        scat[k] = accR * dx * BETA_R[0];
        scat[k + 1] = accG * dx * BETA_R[1];
        scat[k + 2] = accB * dx * BETA_R[2];
        scat[k + 3] = accM * dx * BETA_M_S;
      }
    }
  }
  const toHalf = (src: Float32Array): Uint16Array => {
    const out = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = DataUtils.toHalfFloat(src[i]!);
    return out;
  };
  const makeTex = (data: Uint16Array, w: number, h: number): DataTexture => {
    const t = new DataTexture(data, w, h, RGBAFormat, HalfFloatType);
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    noteTexture(w, h, false, 8, `atmosphere-${w}x${h}`);
    return t;
  };
  tables = {
    transmittance: makeTex(toHalf(trans), TRANS_W, TRANS_H),
    scattering: makeTex(toHalf(scat), W, SCAT_MU),
  };
  return tables;
}

/** Uniforms shared by every material that uses the atmosphere chunk. */
export function atmosphereUniforms(t: AtmosphereTables): Record<string, { value: unknown }> {
  return {
    uTransLut: { value: t.transmittance },
    uScatterLut: { value: t.scattering },
    uRt: { value: RT },
    uMieG: { value: MIE_G },
    uSunIntensity: { value: 22 },
  };
}

/** GLSL: transmittance and in-scattering lookups. Requires the uniforms above. */
export const ATMOSPHERE_GLSL = /* glsl */ `
  uniform sampler2D uTransLut;
  uniform sampler2D uScatterLut;
  uniform float uRt;
  uniform float uMieG;
  uniform float uSunIntensity;
  #define ATMO_RG 1.0
  #define ATMO_PI 3.14159265
  #define TRANS_W ${TRANS_W}.0
  #define TRANS_H ${TRANS_H}.0
  #define SCAT_MU ${SCAT_MU}.0
  #define SCAT_MUS ${SCAT_MUS}.0
  #define SCAT_NU ${SCAT_NU}.0

  float atmoDistToTop(float r, float mu) {
    float d = r * r * (mu * mu - 1.0) + uRt * uRt;
    return max(-r * mu + sqrt(max(d, 0.0)), 0.0);
  }
  vec3 atmoTransmittanceToTop(float r, float mu) {
    float H = sqrt(uRt * uRt - ATMO_RG * ATMO_RG);
    float rho = sqrt(max(r * r - ATMO_RG * ATMO_RG, 0.0));
    float d = atmoDistToTop(r, mu);
    float dmin = uRt - r;
    float dmax = rho + H;
    float xmu = clamp((d - dmin) / max(dmax - dmin, 1e-6), 0.0, 1.0);
    float xr = clamp(rho / H, 0.0, 1.0);
    vec2 uv = vec2(0.5 / TRANS_W + xmu * (1.0 - 1.0 / TRANS_W), 0.5 / TRANS_H + xr * (1.0 - 1.0 / TRANS_H));
    return texture2D(uTransLut, uv).rgb;
  }
  /** Sunlight reaching a point at radius r with sun cosine mu_s (zero below the horizon). */
  vec3 atmoSunTransmittance(float r, float mu_s) {
    float sinH = ATMO_RG / r;
    float cosH = -sqrt(max(1.0 - sinH * sinH, 0.0));
    return atmoTransmittanceToTop(r, max(mu_s, cosH + 0.001)) * smoothstep(-sinH * 0.0047, sinH * 0.0047, mu_s - cosH);
  }
  /** Transmittance from the entry point (view cosine mu, r = Rt) down to a ground point with view cosine muP. */
  vec3 atmoTransmittanceToGround(float mu, float muP) {
    vec3 a = atmoTransmittanceToTop(ATMO_RG, -muP);
    vec3 b = atmoTransmittanceToTop(uRt, -mu);
    return clamp(a / max(b, vec3(1e-4)), 0.0, 1.0);
  }
  vec4 atmoScatterLookup(float mu, float mu_s, float nu) {
    float b = uRt * sqrt(max(1.0 - mu * mu, 0.0));
    float v;
    if (b < ATMO_RG) {
      float s = 1.0 - sqrt(max(1.0 - b / ATMO_RG, 0.0));
      v = (0.5 + s * 63.0) / SCAT_MU;
    } else {
      float s = sqrt(clamp((b - ATMO_RG) / (uRt - ATMO_RG), 0.0, 1.0));
      v = (64.5 + s * 63.0) / SCAT_MU;
    }
    float xs = clamp((1.0 - exp(-3.0 * (mu_s + 1.0))) / (1.0 - exp(-6.0)), 0.0, 1.0);
    float xn = clamp((nu + 1.0) * 0.5, 0.0, 1.0) * (SCAT_NU - 1.0);
    float n0 = floor(xn);
    float fn = xn - n0;
    float n1 = min(n0 + 1.0, SCAT_NU - 1.0);
    float ub = 0.5 + xs * (SCAT_MUS - 1.0);
    float W = SCAT_MUS * SCAT_NU;
    vec4 a = texture2D(uScatterLut, vec2((n0 * SCAT_MUS + ub) / W, v));
    vec4 c = texture2D(uScatterLut, vec2((n1 * SCAT_MUS + ub) / W, v));
    return mix(a, c, fn);
  }
  float atmoPhaseR(float nu) { return 3.0 / (16.0 * ATMO_PI) * (1.0 + nu * nu); }
  float atmoPhaseM(float nu) {
    float g = uMieG;
    float k = 3.0 / (8.0 * ATMO_PI) * (1.0 - g * g) / (2.0 + g * g);
    return k * (1.0 + nu * nu) / pow(1.0 + g * g - 2.0 * g * nu, 1.5);
  }
  /** Nearest intersection of a ray from outside with the sphere of radius R (negative when it misses). */
  float atmoRaySphere(vec3 o, vec3 d, float R) {
    float b = dot(o, d);
    float c = dot(o, o) - R * R;
    float disc = b * b - c;
    if (disc < 0.0) return -1.0;
    return -b - sqrt(disc);
  }
  /** In-scattered light along a ray that enters the atmosphere at unit normal nA with direction v. */
  vec3 atmoInscatter(vec3 nA, vec3 v, vec3 s) {
    float mu = dot(nA, v);
    float mu_s = dot(nA, s);
    float nu = dot(v, s);
    vec4 S = atmoScatterLookup(mu, mu_s, nu);
    return (S.rgb * atmoPhaseR(nu) + vec3(S.a) * atmoPhaseM(nu)) * uSunIntensity;
  }
`;
