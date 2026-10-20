/** Water is a style material, independent of the body of water and renderer.
 * Positions are distance from shore / (reference map width × bandFraction).
 * The reference width belongs to the source map, never the camera or a crop.
 */
export interface WaterStyle {
  stops: readonly (readonly [number, string])[];
  bandFraction: number;
}

export function waterRamp(shore: string, offshore: string): WaterStyle {
  return { stops: [[0, shore], [1, offshore]], bandFraction: .016 };
}

const rgb = (hex: string): number[] => {
  const v = parseInt(hex.slice(1), 16);
  return [v >> 16 & 255, v >> 8 & 255, v & 255];
};

/** Compile once per material, outside pixel loops. Smooth interpolation matches GLSL. */
export function waterSampler(style: WaterStyle): (position: number) => number[] {
  validateWaterStyle(style);
  const stops = style.stops.map(([t, color]) => ({ t, color: rgb(color) }));
  return position => {
    if (position <= stops[0].t) return stops[0].color;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (position <= b.t) {
        const t = Math.max(0, Math.min(1, (position - a.t) / Math.max(1e-9, b.t - a.t))), u = t * t * (3 - 2 * t);
        return a.color.map((c, channel) => c + (b.color[channel] - c) * u);
      }
    }
    return stops[stops.length - 1].color;
  };
}

/** The same evaluator for sea and lake fragments. Up to eight reusable stops. */
export const WATER_STYLE_GLSL = `
uniform vec3 uWaterStops[8]; uniform float uWaterStopT[8]; uniform int uWaterStopCount;
vec3 styledWater(float position) {
  vec3 color = uWaterStops[0];
  for (int i = 1; i < 8; i++) {
    if (i >= uWaterStopCount) break;
    float t = smoothstep(uWaterStopT[i-1], uWaterStopT[i], position);
    color = mix(color, uWaterStops[i], t);
  }
  return color;
}`;

/** Inline variant for material compositors that cannot bind the display uniforms. */
export function waterFunctionGlsl(name: string, style: WaterStyle): string {
  const vec = (hex: string): string => `vec3(${rgb(hex).map(c => `${c.toFixed(1)}`).join(',')})/255.`;
  let body = `vec3 color=${vec(style.stops[0][1])};`;
  for (let i = 1; i < style.stops.length; i++) body += `color=mix(color,${vec(style.stops[i][1])},smoothstep(${style.stops[i - 1][0].toFixed(8)},${style.stops[i][0].toFixed(8)},position));`;
  return `vec3 ${name}(float position){${body}return color;}`;
}

const uniforms = new WeakMap<WaterStyle, { colors: Float32Array; positions: Float32Array }>();
/** Prepared once per material; panning allocates no water palettes. */
export function waterUniforms(style: WaterStyle): { colors: Float32Array; positions: Float32Array } {
  validateWaterStyle(style);
  let value = uniforms.get(style);
  if (!value) {
    value = {
      colors: new Float32Array(Array.from({ length: 8 }, (_, i) => rgb(style.stops[Math.min(i, style.stops.length - 1)][1]).map(c => c / 255)).flat()),
      positions: new Float32Array(Array.from({ length: 8 }, (_, i) => style.stops[Math.min(i, style.stops.length - 1)][0])),
    };
    uniforms.set(style, value);
  }
  return value;
}

function validateWaterStyle(style: WaterStyle): void {
  if (style.stops.length < 2 || style.stops.length > 8 || !Number.isFinite(style.bandFraction) || style.bandFraction <= 0
    || style.stops.some(([position, color], i) => !Number.isFinite(position) || (i > 0 && position <= style.stops[i - 1][0]) || !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('Water material requires 2–8 ordered color stops and a positive finite band fraction.');
  }
}
