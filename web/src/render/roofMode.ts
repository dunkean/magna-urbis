export const ROOF_MODES = ['v1', 'v2', 'flat', 'minimal'] as const;
export type RoofMode = (typeof ROOF_MODES)[number];
export const DEFAULT_ROOF_MODE: RoofMode = 'v2';
