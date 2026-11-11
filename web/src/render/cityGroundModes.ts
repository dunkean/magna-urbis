/** Ground modes accepted by the shared 3D host, appearance controls and persisted recipes. */
export const CITY_3D_MATERIAL_GROUNDS = ['parchment-render', 'render3d', 'render3d-brush', 'render-v2', 'render-v2-substrate', 'render-v2-moisture', 'render-v2-vegetation', 'render-v2-snow'] as const;
export const CITY_GROUND_STYLES = ['map', 'render', ...CITY_3D_MATERIAL_GROUNDS] as const;
export type CityGround = typeof CITY_GROUND_STYLES[number];
