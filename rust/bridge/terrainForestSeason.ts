/** Autumn crown palette and its population mean. The ground shader uses the same 256 hash tints for resolved
 * crowns and unresolved stands; integrating the palette here keeps tile baking to a few scalar operations. */
type Rgb = readonly [number, number, number];
const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
const HUES: readonly { end: number; color: Rgb; lift: number; turn: number }[] = [
  { end: 0.38, color: [0.86, 0.46, 0.07], lift: 1.35, turn: 0.92 },
  { end: 0.56, color: [0.64, 0.18, 0.07], lift: 1.08, turn: 0.92 },
  { end: 0.86, color: [0.86, 0.66, 0.1], lift: 1.4, turn: 0.92 },
  { end: 1, color: [0.3, 0.4, 0.12], lift: 1, turn: 0.4 },
];
const fract = (v: number): number => v - Math.floor(v);
const luminance = (v: Rgb): number => v.reduce((sum, c, i) => sum + c * LUMA[i], 0);
const channels = (value: (channel: number) => number): Rgb => [value(0), value(1), value(2)];
export function autumnCrownTint(tint: number): { weight: number; hue: Rgb } {
  const row = HUES.find(row => fract(tint * 5.31) < row.end)!;
  return { weight: row.turn * (0.75 + 0.25 * fract(tint * 3.77)), hue: channels(i => (row.color[i] * row.lift) / luminance(row.color)) };
}
const moments = Array.from({ length: 256 }, (_, i) => autumnCrownTint((i + 0.5) / 256));
export const AUTUMN_CROWN_MEAN = { weight: moments.reduce((sum, t) => sum + t.weight / 256, 0), hue: channels(i => moments.reduce((sum, t) => sum + (t.hue[i] * t.weight) / 256, 0)) };
const scalar = (v: number): string => v.toFixed(9);
const vec3 = (v: Rgb): string => `vec3(${v.map(scalar).join(',')})`;
const select = (value: (row: (typeof HUES)[number]) => string): string => HUES.map((row, i) => (i < HUES.length - 1 ? `pick<${row.end}?${value(row)}:` : value(row))).join('');
export const FOREST_AUTUMN_GLSL = `
// Absolute hue, preserving the crown's exposure. A minority of the population stays green.
vec3 forestAutumnCrown(vec3 crown,float tint,float fall){
  float pick=fract(tint*5.31),late=fract(tint*3.77);
  vec3 hue=${select(row => vec3(row.color))};
  float lift=${select(row => scalar(row.lift))};
  float turn=${select(row => scalar(row.turn))};
  return mix(crown,hue*dot(crown,${vec3(LUMA)})*lift/dot(hue,${vec3(LUMA)}),fall*turn*(.75+.25*late));
}
// Exact population mean of that hue transform for the forestU8 distribution, before bare limbs and snow.
vec3 forestAutumnMean(vec3 crown,float fall){
  return crown*(1.-fall*${scalar(AUTUMN_CROWN_MEAN.weight)})+dot(crown,${vec3(LUMA)})*${vec3(AUTUMN_CROWN_MEAN.hue)}*fall;
}
`;
