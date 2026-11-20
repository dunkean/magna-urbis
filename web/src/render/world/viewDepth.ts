/** View-only depth policy shared by the tilted terrain and its volumes. The page restores the browser preference;
 * renderers read it per frame, without rebuilding the town or changing its appearance recipe. */
export const VIEW_DEPTH_DEFAULT = 1;
export const VIEW_DEPTH_MAX = 8;
let depth = VIEW_DEPTH_DEFAULT;

export function clampViewDepth(value: number): number {
  return Number.isFinite(value) ? Math.max(VIEW_DEPTH_DEFAULT, Math.min(VIEW_DEPTH_MAX, value)) : VIEW_DEPTH_DEFAULT;
}

export const getViewDepth = (): number => depth;
export const setViewDepth = (value: number): void => {
  depth = clampViewDepth(value);
};

/** The default is the existing 300k cap; higher depth spends up to 3M triangles. Protected near buildings may exceed it. */
export const buildingTriangleBudget = (value: number): number => Math.min(3000000, 300000 * value * value);
