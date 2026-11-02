/** GLSL for the photoreal globe (D-035). Textures are equirectangular; UVs come from SphereGeometry. */

export const GLOBE_VERT = /* glsl */ `
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

export const GLOBE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D normalMap;
  uniform sampler2D cloudMap;
  uniform sampler2D bathyMap;
  uniform sampler2D idMap;
  uniform sampler2D palette;
  uniform sampler2D countryIndex;
  uniform vec2 idMapSize;
  uniform vec3 sunDir;
  uniform float cloudOffset;
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
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  float decodeId(vec4 texel) {
    return floor(texel.r * 255.0 + 0.5) + floor(texel.g * 255.0 + 0.5) * 256.0;
  }
  float decodeCountry(float id) {
    vec4 c = texture2D(countryIndex, vec2((id + 0.5) / 2048.0, 0.5));
    return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPos - vWorldPos);
    vec3 L = normalize(sunDir);

    // Tangent frame on the sphere (east, north).
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 east = normalize(cross(up, N));
    vec3 north = cross(N, east);
    vec3 nm = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    vec3 Np = normalize(N + (east * nm.x + north * nm.y) * normalStrength);

    vec4 idTexel = texture2D(idMap, vUv);
    float id = decodeId(idTexel);
    float land = idTexel.b;

    float ndl = dot(Np, L);
    float ndlFlat = dot(N, L);
    float day = smoothstep(-0.12, 0.25, ndlFlat);
    vec3 dayColor = texture2D(dayMap, vUv).rgb;
    vec3 bathy = texture2D(bathyMap, vUv).rgb;
    // Ocean: deep blue lifted by bathymetry (shallow shelves lighter), kept well above black.
    float depth = clamp(bathy.b * 1.2, 0.0, 1.0);
    vec3 deep = vec3(0.03, 0.10, 0.26);
    vec3 shelf = vec3(0.10, 0.36, 0.62);
    vec3 ocean = mix(deep, shelf, depth) + dayColor * 0.35;
    vec3 albedo = mix(ocean, dayColor, land);

    float diffuse = max(ndl, 0.0) * 0.9 + 0.1 * max(ndlFlat, 0.0);
    vec3 lit = albedo * (diffuse * 1.35 + 0.02);

    // Ocean specular glint.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(Np, H), 0.0), 120.0) * (1.0 - land) * day;
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    lit += vec3(1.0, 0.95, 0.85) * spec * 0.9 + vec3(0.2, 0.4, 0.7) * fresnel * 0.15 * (1.0 - land) * day;

    // Cloud shadows (clouds rotate; offset their lookup). Fade with zoom like the cloud layer.
    if (showClouds > 0.5) {
      vec2 cuv = vec2(fract(vUv.x - cloudOffset + 0.003), vUv.y - 0.003);
      float cloud = texture2D(cloudMap, cuv).r;
      lit *= 1.0 - cloud * 0.28 * day * cloudFade;
    }

    // Night lights with a warm tint, visible only on the dark side.
    vec3 night = texture2D(nightMap, vUv).rgb;
    float nightMask = 1.0 - smoothstep(-0.2, 0.1, ndlFlat);
    vec3 lights = night * vec3(1.0, 0.85, 0.6) * 1.6 * nightMask;
    vec3 color = lit * mix(0.15, 1.0, day) + lights + albedo * 0.035 * (1.0 - day);

    // Political overlay from the palette texture, modulated by terrain luminance so relief shows through.
    vec4 fill = texture2D(palette, vec2((id + 0.5) / 2048.0, 0.5));
    float overlayA = fill.a * overlayStrength;
    float lum = dot(lit, vec3(0.3, 0.59, 0.11));
    vec3 tinted = fill.rgb * (0.45 + 1.1 * clamp(lum, 0.0, 0.8)) * (0.6 + 0.4 * day);
    color = mix(color, tinted, overlayA);

    // Borders via id discontinuity (region = thin, country = thicker).
    vec2 texel = borderScale / idMapSize;
    float idR = decodeId(texture2D(idMap, vUv + vec2(texel.x, 0.0)));
    float idU = decodeId(texture2D(idMap, vUv + vec2(0.0, texel.y)));
    float idL = decodeId(texture2D(idMap, vUv - vec2(texel.x, 0.0)));
    float idD = decodeId(texture2D(idMap, vUv - vec2(0.0, texel.y)));
    float regionEdge = step(0.5, abs(id - idR) + abs(id - idU) + abs(id - idL) + abs(id - idD));
    float c0 = decodeCountry(id);
    vec2 texel2 = texel * 2.0;
    float cR = decodeCountry(decodeId(texture2D(idMap, vUv + vec2(texel2.x, 0.0))));
    float cU = decodeCountry(decodeId(texture2D(idMap, vUv + vec2(0.0, texel2.y))));
    float cL = decodeCountry(decodeId(texture2D(idMap, vUv - vec2(texel2.x, 0.0))));
    float cD = decodeCountry(decodeId(texture2D(idMap, vUv - vec2(0.0, texel2.y))));
    float countryEdge = step(0.5, abs(c0 - cR) + abs(c0 - cU) + abs(c0 - cL) + abs(c0 - cD));
    // Land-only: ignore coastlines against sea-zone ids (country index 0 for sea).
    float seaEdge = step(0.5, abs(land - texture2D(idMap, vUv + vec2(texel2.x, 0.0)).b) + abs(land - texture2D(idMap, vUv + vec2(0.0, texel2.y)).b) + abs(land - texture2D(idMap, vUv - vec2(texel2.x, 0.0)).b) + abs(land - texture2D(idMap, vUv - vec2(0.0, texel2.y)).b));
    // Raster borders are a soft underlay; crisp lines come from the vector border layer.
    float countryLine = countryEdge * (1.0 - seaEdge) * land;
    float regionLine = regionEdge * land * regionBorderAlpha;
    float seaLine = regionEdge * (1.0 - land) * regionBorderAlpha * 0.5 * overlayStrength;
    vec3 lineColor = vec3(0.04, 0.05, 0.08);
    color = mix(color, lineColor, clamp(countryLine * 0.35 + regionLine * 0.18 + seaLine * 0.25, 0.0, 1.0));

    // Hover and selection.
    float hovered = step(0.5, 1.0 - abs(id - hoverId)) * step(0.5, hoverId);
    float selected = step(0.5, 1.0 - abs(id - selectedId)) * step(0.5, selectedId);
    color += vec3(0.35, 0.4, 0.5) * hovered * 0.35;
    float pulse = 0.5 + 0.5 * sin(time * 3.0);
    color = mix(color, vec3(1.0, 0.85, 0.4), selected * (0.18 + 0.12 * pulse));

    // Atmospheric rim on the globe itself.
    float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    color += vec3(0.25, 0.5, 1.0) * rim * (0.25 + 0.55 * day);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export const ATMOSPHERE_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/** Rayleigh-style rim: blue scattering on the lit limb, fading to a thin orange band at the terminator. */
export const ATMOSPHERE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 sunDir;
  uniform vec3 cameraPos;
  uniform float intensity;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPos - vWorldPos);
    float ndv = dot(N, V);
    // Back faces: looking through the shell from outside; thin bright limb.
    float limb = pow(clamp(1.0 + ndv, 0.0, 1.0), 6.0);
    float sun = dot(N, normalize(sunDir));
    float lit = smoothstep(-0.35, 0.3, sun);
    vec3 rayleigh = vec3(0.3, 0.55, 1.0);
    vec3 sunset = vec3(1.0, 0.45, 0.2);
    vec3 col = mix(sunset, rayleigh, smoothstep(-0.2, 0.25, sun));
    float a = limb * (0.08 + 0.95 * lit) * intensity;
    gl_FragColor = vec4(col * a * 1.6, a);
  }
`;

export const CLOUD_VERT = GLOBE_VERT;
export const CLOUD_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float offset;
  uniform vec3 cameraPos;
  uniform float fade;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vec3 N = normalize(vNormal);
    float c = texture2D(cloudMap, vec2(fract(vUv.x - offset), vUv.y)).r;
    float ndl = dot(N, normalize(sunDir));
    float day = smoothstep(-0.15, 0.25, ndl);
    float a = smoothstep(0.08, 0.7, c) * 0.85;
    vec3 col = vec3(1.0) * (0.12 + 0.95 * max(ndl, 0.0)) * mix(0.25, 1.0, day);
    vec3 V = normalize(cameraPos - vWorldPos);
    float edge = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    gl_FragColor = vec4(col, a * (1.0 - edge * 0.5) * fade);
  }
`;
