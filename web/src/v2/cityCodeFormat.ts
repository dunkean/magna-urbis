/** The switchable encoding choices of the short city code, in one place: digit alphabet, integer writing,
 * parameter ID writing and the per-parameter value quantiser shared by the code and the UI sliders. */

/** Lowercase Crockford-style base32: digits and letters without i, l, o, u (those four stay free as edit actions). */
export const CODE_DIGITS = '0123456789abcdefghjkmnpqrstvwxyz';
export const CODE_BASE = CODE_DIGITS.length;
export const isCodeDigit = (char: string | undefined): char is string => char !== undefined && char.length === 1 && CODE_DIGITS.includes(char);

export function digit(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= CODE_BASE) throw new Error(`Digit out of range: ${value}`);
  return CODE_DIGITS[value];
}
export function digitValue(char: string): number {
  const value = char.length === 1 ? CODE_DIGITS.indexOf(char) : -1;
  if (value < 0) throw new Error(`Not a code digit: ${char}`);
  return value;
}
/** A non-negative integer; `width` pads with zeros and rejects larger values. */
export function writeInt(value: number, width = 0): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Integer out of range: ${value}`);
  let text = '';
  do {
    text = CODE_DIGITS[value % CODE_BASE] + text;
    value = Math.floor(value / CODE_BASE);
  } while (value > 0);
  if (width && text.length > width) throw new Error(`Integer does not fit ${width} digits`);
  return text.padStart(width, CODE_DIGITS[0]);
}
export function readInt(text: string): number {
  if (!text) throw new Error('Empty number');
  let value = 0;
  for (const char of text) value = value * CODE_BASE + digitValue(char);
  if (!Number.isSafeInteger(value)) throw new Error('Number too large');
  return value;
}
/** Digits needed to write any value up to `max`. */
export const intWidth = (max: number): number => writeInt(Math.max(0, Math.ceil(max))).length;

/** Parameter IDs: the first CODE_BASE - 1 (the most changed) take one digit, the last digit escapes a 2-digit ID. */
export const SHORT_IDS = CODE_BASE - 1;
export const ID_ESCAPE = CODE_DIGITS[CODE_BASE - 1];
export const MAX_PARAMETERS = SHORT_IDS + CODE_BASE * CODE_BASE;
export function writeParamId(id: number): string {
  if (id < SHORT_IDS) return digit(id);
  return ID_ESCAPE + writeInt(id - SHORT_IDS, 2);
}
/** Reads an ID at `text[at]`; returns the ID and the characters used. */
export function readParamId(text: string, at: number): [number, number] {
  if (text[at] !== ID_ESCAPE) return [digitValue(text[at]), 1];
  const body = text.slice(at + 1, at + 3);
  if (body.length !== 2) throw new Error('Truncated parameter ID');
  return [SHORT_IDS + readInt(body), 3];
}
/** Values: one digit for domains up to CODE_BASE values, two digits up to CODE_BASE². */
export const MAX_LEVELS = CODE_BASE * CODE_BASE;
export const valueWidth = (levels: number): number => (levels <= CODE_BASE ? 1 : 2);

/** Number domain: a bounded slider of `levels` steps. A numeric step gives span/step + 1 steps (capped);
 * a free step ('any') gives CODE_BASE steps. */
export interface QuantisedRange {
  min?: number;
  max?: number;
  step?: number | 'any';
}
const bounded = (field: QuantisedRange): field is { min: number; max: number; step?: number | 'any' } => Number.isFinite(field.min) && Number.isFinite(field.max) && field.max! > field.min!;
const clean = (value: number): number => Number(value.toPrecision(12));
export function parameterLevels(field: QuantisedRange): number {
  if (!bounded(field)) return 0;
  const span = field.max - field.min;
  const steps = typeof field.step === 'number' && field.step > 0 ? Math.floor(span / field.step + 1e-9) + 1 : CODE_BASE;
  return Math.max(2, Math.min(MAX_LEVELS, steps));
}
export function levelValue(field: QuantisedRange, level: number): number {
  if (!bounded(field)) throw new Error('Unbounded parameter');
  const levels = parameterLevels(field),
    span = field.max - field.min;
  const clamped = Math.max(0, Math.min(levels - 1, Math.round(level)));
  let value = field.min + (clamped * span) / (levels - 1);
  if (typeof field.step === 'number' && field.step > 0) value = field.min + Math.round((value - field.min) / field.step) * field.step;
  return clean(Math.max(field.min, Math.min(field.max, value)));
}
export function valueLevel(field: QuantisedRange, value: number): number {
  if (!bounded(field)) throw new Error('Unbounded parameter');
  const levels = parameterLevels(field);
  return Math.max(0, Math.min(levels - 1, Math.round(((value - field.min) / (field.max - field.min)) * (levels - 1))));
}
/** What the code stores for a slider value: the UI snaps to it so the displayed value is the shared one. */
export function snapParameter(field: QuantisedRange, value: number): number {
  return bounded(field) ? levelValue(field, valueLevel(field, value)) : value;
}
/** Slider step that lands exactly on the levels. */
export function levelStep(field: QuantisedRange): number | undefined {
  return bounded(field) ? clean((field.max - field.min) / (parameterLevels(field) - 1)) : undefined;
}

/** Custom-place populations: a logarithmic scale of 2 digits from 1 to POPULATION_MAX (about 1.5 % per level). */
export const POPULATION_MAX = 5000000;
const POPULATION_LEVELS = CODE_BASE * CODE_BASE;
export function populationLevel(population: number): number {
  const p = Math.max(1, Math.min(POPULATION_MAX, population));
  return Math.round((Math.log(p) / Math.log(POPULATION_MAX)) * (POPULATION_LEVELS - 1));
}
export function levelPopulation(level: number): number {
  return Math.max(1, Math.round(Math.exp((level / (POPULATION_LEVELS - 1)) * Math.log(POPULATION_MAX))));
}
export const POPULATION_WIDTH = 2;
