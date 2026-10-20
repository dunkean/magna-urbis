/** Display preferences, independent of terrain generation. Azimuth is clockwise from north. */
export interface TerrainLighting {
  enabled: boolean;
  azimuth: number;
  elevation: number;
  strength: number;
  exaggeration: number;
}

export const DEFAULT_TERRAIN_LIGHTING: TerrainLighting = {
  enabled: true, azimuth: 315, elevation: 45, strength: 1, exaggeration: 2,
};

/** Rotate the existing two-light setup; preserve its original look at the defaults. */
export function terrainLights(lighting: TerrainLighting): { primary: number[]; secondary: number[]; flat: number } {
  const angle = (lighting.azimuth - 315) * Math.PI / 180;
  const elevation = lighting.elevation * Math.PI / 180;
  const horizontal = Math.cos(elevation) / Math.SQRT1_2;
  const vertical = Math.sin(elevation) / Math.SQRT1_2;
  const rotate = (x: number, y: number, z: number): number[] => [
    (x * Math.cos(angle) - y * Math.sin(angle)) * horizontal,
    (x * Math.sin(angle) + y * Math.cos(angle)) * horizontal,
    z * vertical,
  ];
  const primary = rotate(-0.5, -0.5, 0.7071), secondary = rotate(0.2, -0.75, 0.63);
  return { primary, secondary, flat: 0.7071 * vertical };
}

export interface TerrainLayers { relief: boolean; hypsometry: boolean; frame: boolean; water?: boolean }
export const DEFAULT_TERRAIN_LAYERS: TerrainLayers = { relief: true, hypsometry: true, frame: true, water: true };
