// One diffuse daylight for walls and roofs, independent of culture, cover and
// pitch. Strong sky light keeps a dome's shaded skirt close to the walls below.
const AMBIENT = 0.78,
  SUN = 0.22,
  FILL = 0.1;
const FLAT_LIGHT = AMBIENT + SUN * 0.62 + (FILL * 0.76) / 1.0026;
/** Shared building daylight, normalised to a horizontal surface. World y grows
 * southwards, z upwards. The NW sun and weak SE fill retain distinct hip pans
 * without an azimuth boost or a discontinuity at vertical/near-flat faces. */
export function roofPlaneLight([nx, ny, nz]: readonly number[]): number {
  const length = Math.hypot(nx, ny, nz) || 1,
    x = nx / length,
    y = ny / length,
    z = nz / length;
  // NW sun + a weak south-east fill, so pans facing away from the sun keep distinct tones.
  const sun = Math.max(0, -0.7 * x - 0.36 * y + 0.62 * z),
    fill = Math.max(0, (0.35 * x + 0.55 * y + 0.76 * z) / 1.0026);
  return (AMBIENT + SUN * sun + FILL * fill) / FLAT_LIGHT;
}

/** Light of a pitched pan as a natural ground shows it (`light`: the plan light of the pan, around 0, as cityMassing's
 * `roofLight`), capped by what its cover can reflect, with a smooth knee: unchanged near 0, never past the cap.
 * Matte covers (thatch, reed, palm, turf, shingle, bark, bamboo, earth, plaster, felt, hide and any unlisted one)
 * lighten by 9 % at most and darken by 14 %: a four-pan thatch roof has no shining pan. Tiles, slates and stone keep
 * a little more (+14 %, -20 %); metal, lead, zinc and glass keep the full range. */
export function planPanLight(light: number, cover: string): number {
  if (cover === 'metal' || cover === 'lead' || cover === 'zinc' || cover === 'glass') return light;
  const hard = cover === 'tile' || cover === 'slate' || cover === 'stone',
    cap = light > 0 ? (hard ? 0.14 : 0.09) : hard ? 0.2 : 0.14;
  return Math.sign(light) * cap * (1 - Math.exp(-Math.abs(light) / cap));
}

/** Same daylight in 3D's x/up/z frame, including normal-map relief. Both 3D
 * programs use it directly: no separate wall sun, absolute dot or roof-only gain. */
export const ROOF_PLANE_LIGHT_GLSL = `
float buildingLight(vec3 normal){
  vec3 p=normalize(normal);
  float sun=max(0.,dot(p,vec3(-.70,.62,-.36)));
  float fill=max(0.,dot(p,vec3(.35,.76,.55))/1.0026);
  return (${AMBIENT}+${SUN}*sun+${FILL}*fill)/${FLAT_LIGHT};
}
`;
