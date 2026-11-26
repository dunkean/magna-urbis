import type { EditShape } from '../../../rust/bridge/urbanConfig';
import { digit, digitValue } from './cityCodeFormat';

/** Each digit carries four bits and a continuation bit. Small counts and deltas take one digit. */
function writeVar(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid geometry integer');
  let code = '';
  while (value >= 16) {
    code += digit(16 + (value % 16));
    value = Math.floor(value / 16);
  }
  return code + digit(value);
}

const halfMetres = (metres: number) => Math.round(metres * 2) + 0;
const zigzag = (delta: number) => (delta < 0 ? -2 * delta - 1 : 2 * delta);
const unzigzag = (value: number) => (value % 2 ? -(value + 1) / 2 : value / 2);

interface Geometry {
  shape: EditShape;
  parts: EditShape[];
  deletedParts: number[];
}
export const GEOMETRY_KEYS = ['shape', 'parts', 'deletedParts'] as const;
type GeometryKey = keyof Geometry;

/** Paths share a cursor from the first ring of a record. Zero encodes absent holes, one an empty holes array. */
export function writeGeometry(key: GeometryKey, value: Geometry[GeometryKey], exact = false): string {
  let x = 0,
    y = 0;
  // A regenerated block seeds its lot cuts from the exact outline. For edits addressed inside it,
  // keep the differing IEEE-754 bits next to the ordinary half-metre delta.
  const bits = exact ? new DataView(new ArrayBuffer(16)) : undefined;
  const correction = (coordinate: number, grid: number) => {
    if (!bits || coordinate === grid / 2) return '';
    if (!Number.isFinite(coordinate)) throw new Error('Invalid geometry point');
    bits.setFloat64(0, grid / 2);
    bits.setFloat64(8, coordinate);
    return 'X' + writeVar((bits.getUint32(0) ^ bits.getUint32(8)) >>> 0) + writeVar((bits.getUint32(4) ^ bits.getUint32(12)) >>> 0);
  };
  const ring = (points: EditShape['outer']) => {
    let code = writeVar(points.length);
    for (const point of points) {
      const nextX = halfMetres(point.x),
        nextY = halfMetres(point.y);
      code += writeVar(zigzag(nextX - x)) + correction(point.x, nextX) + writeVar(zigzag(nextY - y)) + correction(point.y, nextY);
      x = nextX;
      y = nextY;
    }
    return code;
  };
  const shape = ({ outer, holes }: EditShape) => ring(outer) + (holes ? writeVar(holes.length + 1) + holes.map(ring).join('') : '0');
  if (key === 'shape') return shape(value as EditShape);
  if (key === 'parts') return writeVar((value as EditShape[]).length) + (value as EditShape[]).map(shape).join('');
  return writeVar((value as number[]).length) + (value as number[]).map(writeVar).join('');
}

export function readGeometry(key: GeometryKey, code: string, at: number): [Geometry[GeometryKey], number] {
  let x = 0,
    y = 0;
  const integer = (): number => {
    let value = 0;
    for (let place = 1; Number.isSafeInteger(place); place *= 16) {
      const n = digitValue(code.charAt(at++));
      value += (n % 16) * place;
      if (n < 16 && Number.isSafeInteger(value)) return value;
    }
    throw new Error('Invalid geometry integer');
  };
  const list = <T>(count: number, minDigits: number, read: () => T): T[] => {
    if (count > (code.length - at) / minDigits) throw new Error('Truncated geometry');
    return Array.from({ length: count }, read);
  };
  let bits: DataView | undefined;
  const coordinate = (grid: number): number => {
    if (!Number.isSafeInteger(grid)) throw new Error('Invalid geometry point');
    if (code[at] !== 'X') return grid / 2;
    at++;
    const hi = integer(),
      lo = integer();
    if (hi > 0xffffffff || lo > 0xffffffff) throw new Error('Invalid geometry correction');
    bits ??= new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, grid / 2);
    bits.setUint32(0, bits.getUint32(0) ^ hi);
    bits.setUint32(4, bits.getUint32(4) ^ lo);
    const result = bits.getFloat64(0);
    if (!Number.isFinite(result) || halfMetres(result) !== grid) throw new Error('Invalid geometry correction');
    return result;
  };
  const ring = () =>
    list(integer(), 2, () => {
      x += unzigzag(integer());
      const pointX = coordinate(x);
      y += unzigzag(integer());
      return { x: pointX, y: coordinate(y) };
    });
  const shape = (): EditShape => {
    const outer = ring(),
      holes = integer();
    return holes ? { outer, holes: list(holes - 1, 1, ring) } : { outer };
  };
  const value = key === 'shape' ? shape() : key === 'parts' ? list(integer(), 2, shape) : list(integer(), 1, integer);
  return [value, at];
}
