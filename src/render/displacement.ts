/** Terrain height exaggeration (D-054): grows as the camera comes closer; scaled by the terrain level. */
export const MAX_DISPLACEMENT = 0.0035; // ≈ 22 km at the brightest height texel (Everest ×2.5)

export function terrainDisplacement(cameraDistance: number, terrainLevel: number): number {
  if (terrainLevel <= 0) return 0;
  const zoom = Math.max(0, Math.min(1, (3.2 - cameraDistance) / 1.4));
  return MAX_DISPLACEMENT * zoom * (terrainLevel >= 2 ? 1 : 0.5);
}
