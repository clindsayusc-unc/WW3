/**
 * GLSL for the photoreal globe (D-035, D-054). Textures are equirectangular; UVs come from
 * SphereGeometry. Compile-time levels (`#define ATMO_LEVEL`, `OCEAN_LEVEL`, `CLOUD_LEVEL`,
 * `TERRAIN_LEVEL`, 0–2) come from the per-effect quality settings.
 */
import { ATMOSPHERE_GLSL } from './atmosphere';

export const MAX_STORMS = 8;

/** Spiralling storm systems added to the cloud density (D-054). */
const STORM_GLSL = /* glsl */ `
  uniform float uStormCount;
  uniform vec4 uStorms[${MAX_STORMS}];      // xyz = centre (unit vector), w = radius (radians)
  uniform vec4 uStormParams[${MAX_STORMS}]; // intensity, spin, seed, kind (1 cyclone, 0 low)
  float stormDensity(vec3 n, float t, float layerScale) {
    float dens = 0.0;
    for (int i = 0; i < ${MAX_STORMS}; i++) {
      if (float(i) >= uStormCount) break;
      vec3 c = uStorms[i].xyz;
      float R = uStorms[i].w;
      float cosd = dot(n, c);
      float d = acos(clamp(cosd, -1.0, 1.0));
      if (d > R) continue;
      vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), c));
      vec3 nn = cross(c, e);
      vec3 rel = n - c * cosd;
      float ang = atan(dot(rel, nn), dot(rel, e));
      float rr = d / R;
      float spin = uStormParams[i].y;
      float arms = sin(ang * 2.0 * spin + rr * (7.0 + 3.0 * layerScale) - t * 0.12 * spin + uStormParams[i].z);
      float band = smoothstep(-0.2, 0.9, arms);
      float eye = smoothstep(0.02, 0.1, rr) * uStormParams[i].w + (1.0 - uStormParams[i].w);
      float fall = (1.0 - rr) * (1.0 - rr);
      dens += uStormParams[i].x * fall * eye * (0.35 + 0.65 * band) * mix(0.6, 1.0, uStormParams[i].w);
    }
    return dens;
  }
`;

export const GLOBE_VERT = /* glsl */ `
  uniform sampler2D heightMap;
  uniform float uDisplace;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vHeight;
  void main() {
    vUv = uv;
    float h = texture2D(heightMap, uv).r;
    vHeight = h;
    vec3 p = position * (1.0 + h * uDisplace);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const GLOBE_FRAG = /* glsl */ `
  precision highp float;
  ${ATMOSPHERE_GLSL}
  ${STORM_GLSL}
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D normalMap;
  uniform sampler2D cloudMap;
  uniform sampler2D bathyMap;
  uniform sampler2D waveMap;
  uniform sampler2D idMap;
  uniform sampler2D palette;
  uniform sampler2D countryIndex;
  uniform sampler2D regionAttr;
  uniform vec2 idMapSize;
  uniform vec3 sunDir;
  uniform float cloudOffset;
  uniform float cloudOffset2;
  uniform float overlayStrength;
  uniform float borderScale;      // texels per border pixel, grows when zoomed out
  uniform float regionBorderAlpha;
  uniform float hoverId;
  uniform float selectedId;
  uniform float time;
  uniform float normalStrength;
  uniform vec3 cameraPos;
  uniform float showClouds;
  uniform float cloudFade;
  uniform float uMonth;
  uniform float uWaveStrength;
  uniform float uDisplace;
  uniform float uGroundLight;
  uniform float uAerial;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vHeight;

  float decodeId(vec4 texel) {
    return floor(texel.r * 255.0 + 0.5) + floor(texel.g * 255.0 + 0.5) * 256.0;
  }
  float decodeCountry(float id) {
    vec4 c = texture2D(countryIndex, vec2((id + 0.5) / 2048.0, 0.5));
    return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0;
  }
  float cloudAt(vec2 uv) { return texture2D(cloudMap, uv).r; }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPos - vWorldPos);
    vec3 L = normalize(sunDir);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 east = normalize(cross(up, N));
    vec3 north = cross(N, east);

    vec4 idTexel = texture2D(idMap, vUv);
    float id = decodeId(idTexel);
    float land = idTexel.b;
    vec4 attr = texture2D(regionAttr, vec2((id + 0.5) / 2048.0, 0.5));
    float devast = attr.r;
    float burning = attr.g;

    float ndlFlat = dot(N, L);
    float day = smoothstep(-0.1, 0.2, ndlFlat);
    float lat = (vUv.y - 0.5) * 180.0;
    float absLat = abs(lat);
    float h = vHeight;

    // --- season: snow line and sea ice (northern-hemisphere winter severity, mirrored south)
    float wN = 0.5 + 0.5 * cos((uMonth - 1.5) / 12.0 * 6.2831853);
    float hw = lat >= 0.0 ? wN : 1.0 - wN;
    float snowLat = 72.0 - 26.0 * hw;
    float latSnow = smoothstep(snowLat - 8.0, snowLat + 4.0, absLat);
    float snowElev = 0.52 - 0.0045 * absLat - 0.15 * hw;
    float elevSnow = smoothstep(snowElev - 0.06, snowElev + 0.06, h);
    float snow = max(latSnow, elevSnow) * land;
    float iceNoise = cloudAt(vUv * vec2(2.0, 2.0) + vec2(0.37, 0.11));
    float iceLat = 73.0 - 12.0 * hw + (iceNoise - 0.5) * 7.0;
    float ice = smoothstep(iceLat - 2.5, iceLat + 2.5, absLat) * (1.0 - land);

    // --- normals: relief on land, animated waves at sea
    vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    float reliefBoost = 1.0 + 0.5 * float(TERRAIN_LEVEL);
    vec3 Nland = normalize(N + (east * nm.x + north * nm.y) * normalStrength * reliefBoost);
    vec3 Nocean = N;
    #if OCEAN_LEVEL >= 1
      vec2 wuv1 = vUv * vec2(520.0, 260.0) + time * vec2(0.012, 0.006);
      vec3 w1 = texture2D(waveMap, wuv1).xyz * 2.0 - 1.0;
      vec2 wxy = w1.xy;
      #if OCEAN_LEVEL >= 2
        vec2 wuv2 = vUv * vec2(1230.0, 615.0) - time * vec2(0.02, 0.009);
        vec3 w2 = texture2D(waveMap, wuv2).xyz * 2.0 - 1.0;
        wxy += w2.xy * 0.7;
      #endif
      Nocean = normalize(N + (east * wxy.x + north * wxy.y) * uWaveStrength * (1.0 - ice));
    #endif
    vec3 Np = mix(Nocean, Nland, land);

    // --- albedo
    vec3 dayColor = texture2D(dayMap, vUv).rgb;
    vec3 bathy = texture2D(bathyMap, vUv).rgb;
    float shallowness = clamp(bathy.b * 1.25, 0.0, 1.0);
    vec3 deep = vec3(0.012, 0.045, 0.14);
    vec3 shelf = vec3(0.06, 0.26, 0.42);
    vec3 shallow = vec3(0.14, 0.52, 0.58);
    vec3 ocean = mix(deep, shelf, shallowness);
    ocean = mix(ocean, shallow, smoothstep(0.7, 1.0, shallowness));
    ocean += dayColor * 0.22;
    ocean = mix(ocean, vec3(0.80, 0.86, 0.92), ice);
    vec3 landAlbedo = dayColor;
    landAlbedo = mix(landAlbedo, vec3(0.86, 0.90, 0.96), snow * 0.85);
    landAlbedo = mix(landAlbedo, landAlbedo * vec3(0.55, 0.45, 0.40), devast * 0.6);
    vec3 albedo = mix(ocean, landAlbedo, land);

    // --- direct sun (tinted by the atmosphere) and sky ambient
    vec3 sunT = atmoSunTransmittance(ATMO_RG, ndlFlat);
    vec3 sunLight = sunT * uGroundLight;
    float ndl = dot(Np, L);
    vec3 ambient = vec3(0.30, 0.45, 0.75) * (0.16 * smoothstep(-0.3, 0.3, ndlFlat) + 0.006);
    // Twilight: a warm band of sky light along the terminator (multiple scattering the table lacks).
    float twilight = exp(-ndlFlat * ndlFlat * 24.0) * (1.0 - smoothstep(0.0, 0.3, ndlFlat) * 0.6);
    ambient += vec3(0.95, 0.5, 0.22) * 0.5 * twilight;
    vec3 lit = albedo * (sunLight * max(ndl, 0.0) + ambient);

    // --- cloud shadows, projected along the sun
    float cloud = 0.0;
    #if CLOUD_LEVEL >= 1
    if (showClouds > 0.5) {
      vec2 sunTan = vec2(dot(L, east), dot(L, north));
      vec2 shOff = sunTan * (0.004 / max(ndlFlat, 0.25)) * vec2(0.5, 1.0);
      float c1 = cloudAt(vec2(fract(vUv.x + shOff.x - cloudOffset), vUv.y + shOff.y));
      cloud = smoothstep(0.12, 0.7, c1);
      #if CLOUD_LEVEL >= 2
        float c2 = cloudAt(vec2(fract(0.41 - vUv.x + shOff.x * 2.2 - cloudOffset2), vUv.y + shOff.y * 2.2));
        cloud = max(cloud, smoothstep(0.12, 0.7, c2) * 0.6);
        cloud = min(1.0, cloud + stormDensity(N, time, 1.0) * 0.8);
      #endif
      lit *= 1.0 - cloud * 0.42 * day * cloudFade;
    }
    #endif

    // --- ocean: Fresnel sky reflection and sun glint (GGX)
    #if OCEAN_LEVEL >= 1
    {
      vec3 Hv = normalize(L + V);
      float ndh = max(dot(Nocean, Hv), 0.0);
      float ndv = max(dot(Nocean, V), 0.0);
      float rough = 0.05 + 0.12 * uWaveStrength;
      float a2 = rough * rough;
      float dd = ndh * ndh * (a2 - 1.0) + 1.0;
      float D = a2 / (ATMO_PI * dd * dd);
      float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
      vec3 glint = sunT * D * F / (4.0 * max(ndv, 0.08)) * step(0.0, ndlFlat) * uGroundLight * 2.2;
      vec3 skyRefl = vec3(0.30, 0.50, 0.85) * 0.4 * day * F;
      lit += (glint + skyRefl) * (1.0 - land) * (1.0 - ice * 0.8) * (1.0 - cloud * 0.8);
    }
    #else
    {
      vec3 Hv = normalize(L + V);
      float spec = pow(max(dot(N, Hv), 0.0), 160.0) * (1.0 - land) * day;
      lit += sunT * spec * 1.2;
    }
    #endif

    // --- night lights, dimmed where cities are damaged; embers where regions burn
    vec3 night = texture2D(nightMap, vUv).rgb;
    float nightMask = 1.0 - smoothstep(-0.25, 0.05, ndlFlat);
    vec3 lights = night * vec3(1.0, 0.82, 0.55) * 1.9 * nightMask * (1.0 - 0.85 * devast);
    float flicker = 0.75 + 0.25 * sin(time * 7.0 + id * 3.1) * sin(time * 3.3 + id);
    vec3 embers = vec3(1.0, 0.32, 0.06) * burning * (0.2 + 0.8 * nightMask) * flicker * 0.35 * land;
    vec3 color = lit + lights + embers + albedo * 0.015 * (1.0 - day);

    // --- political overlay from the palette texture, modulated by terrain luminance
    vec4 fill = texture2D(palette, vec2((id + 0.5) / 2048.0, 0.5));
    float overlayA = fill.a * overlayStrength;
    float lum = dot(lit, vec3(0.3, 0.59, 0.11)) * 0.8;
    vec3 tinted = fill.rgb * (0.5 + 1.15 * clamp(lum, 0.0, 0.85)) * (0.42 + 0.58 * day + 0.3 * twilight);
    color = mix(color, tinted, overlayA);

    // --- borders via id discontinuity (region = thin, country = thicker)
    vec2 texel = borderScale / idMapSize;
    float idR = decodeId(texture2D(idMap, vUv + vec2(texel.x, 0.0)));
    float idU = decodeId(texture2D(idMap, vUv + vec2(0.0, texel.y)));
    float idL = decodeId(texture2D(idMap, vUv - vec2(texel.x, 0.0)));
    float idD = decodeId(texture2D(idMap, vUv - vec2(0.0, texel.y)));
    float regionEdge = step(0.5, abs(id - idR) + abs(id - idU) + abs(id - idL) + abs(id - idD));
    float c0 = decodeCountry(id);
    vec2 texel2 = texel * 2.0;
    vec4 tR = texture2D(idMap, vUv + vec2(texel2.x, 0.0));
    vec4 tU = texture2D(idMap, vUv + vec2(0.0, texel2.y));
    vec4 tL = texture2D(idMap, vUv - vec2(texel2.x, 0.0));
    vec4 tD = texture2D(idMap, vUv - vec2(0.0, texel2.y));
    float cR = decodeCountry(decodeId(tR));
    float cU = decodeCountry(decodeId(tU));
    float cL = decodeCountry(decodeId(tL));
    float cD = decodeCountry(decodeId(tD));
    float countryEdge = step(0.5, abs(c0 - cR) + abs(c0 - cU) + abs(c0 - cL) + abs(c0 - cD));
    float seaEdge = step(0.5, abs(land - tR.b) + abs(land - tU.b) + abs(land - tL.b) + abs(land - tD.b));
    float countryLine = countryEdge * (1.0 - seaEdge) * land;
    float regionLine = regionEdge * land * regionBorderAlpha;
    float seaLine = regionEdge * (1.0 - land) * regionBorderAlpha * 0.5 * overlayStrength;
    vec3 lineColor = vec3(0.04, 0.05, 0.08);
    color = mix(color, lineColor, clamp(countryLine * 0.35 + regionLine * 0.18 + seaLine * 0.25, 0.0, 1.0));

    // --- hover and selection
    float hovered = step(0.5, 1.0 - abs(id - hoverId)) * step(0.5, hoverId);
    float selected = step(0.5, 1.0 - abs(id - selectedId)) * step(0.5, selectedId);
    color += vec3(0.35, 0.4, 0.5) * hovered * 0.35;
    float pulse = 0.5 + 0.5 * sin(time * 3.0);
    color = mix(color, vec3(1.0, 0.85, 0.4), selected * (0.18 + 0.12 * pulse));

    // --- aerial perspective: attenuate by the air in between and add in-scattered sky light
    #if ATMO_LEVEL >= 1
    {
      vec3 v = -V;
      float tA = atmoRaySphere(cameraPos, v, uRt);
      vec3 nA = normalize(cameraPos + v * max(tA, 0.0));
      vec3 T = atmoTransmittanceToGround(dot(nA, v), dot(N, v));
      vec3 ins = atmoInscatter(nA, v, L);
      color = color * mix(vec3(1.0), T, uAerial) + ins * uAerial;
    }
    #else
    {
      float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      color += vec3(0.25, 0.5, 1.0) * rim * (0.25 + 0.55 * day) * 0.8;
    }
    #endif

    gl_FragColor = vec4(color, 1.0);
  }
`;

export const ATMOSPHERE_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/** The limb: single scattering along rays that miss the ground, from the precomputed table. */
export const ATMOSPHERE_FRAG = /* glsl */ `
  precision highp float;
  ${ATMOSPHERE_GLSL}
  uniform vec3 sunDir;
  uniform vec3 cameraPos;
  uniform float intensity;
  varying vec3 vWorldPos;
  void main() {
    vec3 v = normalize(vWorldPos - cameraPos);
    float tA = atmoRaySphere(cameraPos, v, uRt);
    if (tA < 0.0) discard;
    vec3 nA = normalize(cameraPos + v * tA);
    vec3 ins = atmoInscatter(nA, v, normalize(sunDir)) * intensity;
    gl_FragColor = vec4(ins, 1.0);
  }
`;

export const CLOUD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const CLOUD_FRAG = /* glsl */ `
  precision highp float;
  ${ATMOSPHERE_GLSL}
  ${STORM_GLSL}
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float offset;
  uniform vec3 cameraPos;
  uniform float fade;
  uniform float uLayer;   // 0 = lower layer, 1 = upper (mirrored, thinner)
  uniform float uAlpha;
  uniform float time;
  uniform float uGroundLight;
  uniform float uAerial;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPos - vWorldPos);
    vec3 L = normalize(sunDir);
    // slow weather drift: the pattern scrolls and wobbles a little over minutes
    float warp = 0.0025 * sin(vUv.y * 24.0 + time * 0.04) * (1.0 + uLayer);
    vec2 cuv = uLayer < 0.5
      ? vec2(fract(vUv.x - offset + warp), vUv.y)
      : vec2(fract(0.41 - vUv.x - offset + warp), vUv.y);
    float c = texture2D(cloudMap, cuv).r;
    #if CLOUD_LEVEL >= 2
      c += stormDensity(N, time, 1.0 + uLayer * 0.6) * (1.0 - 0.3 * uLayer);
    #endif
    float ndl = dot(N, L);
    vec3 sunT = atmoSunTransmittance(ATMO_RG + 0.003, ndl);
    float a = smoothstep(0.08, 0.75, c) * uAlpha;
    float wrap = clamp(ndl * 0.85 + 0.15, 0.0, 1.0);
    float dense = smoothstep(0.35, 1.0, c);
    vec3 col = sunT * uGroundLight * wrap * (1.0 - 0.3 * dense) + vec3(0.30, 0.45, 0.75) * 0.1 * smoothstep(-0.3, 0.3, ndl);
    col += vec3(0.012, 0.015, 0.025);
    float edge = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    #if ATMO_LEVEL >= 1
    {
      vec3 v = -V;
      float tA = atmoRaySphere(cameraPos, v, uRt);
      vec3 nA = normalize(cameraPos + v * max(tA, 0.0));
      vec3 T = atmoTransmittanceToGround(dot(nA, v), dot(N, v));
      vec3 ins = atmoInscatter(nA, v, L);
      col = col * mix(vec3(1.0), T, uAerial * 0.8) + ins * uAerial * 0.8;
    }
    #endif
    gl_FragColor = vec4(col, a * (1.0 - edge * 0.5) * fade);
  }
`;
