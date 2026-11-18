/**
 * Constants of the 3D terrain view: field of view, scale limits, quadtree and cache budgets, transition times.
 */
/** Light display quality: illustrated stamps raised within this distance of the eye (m). */
export const BILLBOARD_LIGHT_RADIUS = 600;

export const TERRAIN_3D_FOV = Math.PI / 3.7;

export const TERRAIN_3D_MAX_SCALE = 8;

export const TERRAIN_GROUND_MAX_SCALE = 128;

export const FOV = TERRAIN_3D_FOV;

export const GRID = 64,
  TILE_PIXELS = 512,
  MAX_LEAVES = 64,
  MAX_CACHE = 192,
  CACHE_BYTES = 128 * 1024 * 1024,
  HEIGHT_GRIDS = 1024;

export const SPLIT_ERROR = 2.4,
  MERGE_ERROR = 1.7,
  MORPH_MS = 220,
  TEXTURE_FADE_MS = 200;

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
