import type { Palette } from '../styles';

/** A painter can also read ordinary palette values, e.g. a width, a blend mode, or the
 * literal ink of a legacy pattern. Track those reads while recording. A replay only
 * compares the inputs the painter actually used. Colour slots bypass this object. */
class Reads {
  private readonly fields = new Map<PropertyKey, unknown>();
  private keys?: PropertyKey[];
  readonly view: object;
  constructor(private readonly source: object) {
    this.view = new Proxy(Array.isArray(source) ? [...source] : { ...source }, {
      get: (target, key) => {
        if (!this.fields.has(key)) {
          const value: unknown = Reflect.get(target, key);
          this.fields.set(key, value && typeof value === 'object' ? new Reads(value) : value);
        }
        const field = this.fields.get(key);
        return field instanceof Reads ? field.view : field;
      },
      ownKeys: target => (this.keys = Reflect.ownKeys(target)),
      has: (target, key) => {
        this.keys ??= Reflect.ownKeys(target);
        return Reflect.has(target, key);
      },
    });
  }
  matches(next: unknown): boolean {
    if (next === this.source) return true;
    if (!next || typeof next !== 'object' || Array.isArray(next) !== Array.isArray(this.source)) return false;
    if (this.keys) {
      const keys = Reflect.ownKeys(next);
      if (keys.length !== this.keys.length || keys.some((k, i) => k !== this.keys![i])) return false;
    }
    for (const [key, field] of this.fields) {
      const value: unknown = Reflect.get(next, key);
      if (field instanceof Reads ? !field.matches(value) : !Object.is(field, value)) return false;
    }
    return true;
  }
}

const originals = new WeakMap<Palette, Palette>();
export const literalPalette = (palette: Palette): Palette => originals.get(palette) ?? palette;

/** Only the cold recording borrows this palette. Across a style change, the same roads, polygons,
 * clip paths and instance buffers can be rebound if their literal drawing inputs still match. */
export class BandLook {
  private readonly reads: Reads;
  readonly palette: Palette;
  constructor(palette: Palette) {
    this.reads = new Reads(palette);
    this.palette = this.reads.view as Palette;
    originals.set(this.palette, palette);
  }
  readonly matches = (palette: Palette): boolean => this.reads.matches(palette);
}
