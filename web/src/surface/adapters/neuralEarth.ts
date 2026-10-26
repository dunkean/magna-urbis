/** Metric regional exchange: no Godot nodes or planetary projection assumptions. */
export interface MetricGeoreference {
  crs: string;
  origin: { longitudeDeg: number; latitudeDeg: number; altitudeM: number };
  /** Azimuth clockwise from true north of local +Z. +X azimuth is +Z minus 90
   * degrees. Magna's east/up/south right-handed frame uses 180 degrees. */
  zAzimuthDeg: number;
  verticalDatum: string;
}
export interface RegionalLayer {
  id: string; sourceKey: string; units: string;
  /** World coordinates of the first sample CENTRE, not the outer cell corner. */
  originX: number; originZ: number; spacingM: number; width: number; height: number;
  values: Float32Array | Uint8Array | Uint16Array | Int32Array;
  sourceLOD: number; nativeSpacingM: number; provenance: string;
  season?: { dayOfYear: number; elevationCorrected: boolean };
}
export interface NeuralEarthPackage {
  format: 'surface-regional-exchange'; version: 1; id: string; seed: string;
  georeference: MetricGeoreference;
  layers: Record<string, RegionalLayer>;
  /** Stable external geometry ids remain opaque to the consumer. */
  features: Record<string, unknown>;
}
const constructors = { Float32Array, Uint8Array, Uint16Array, Int32Array };
export function serializeRegionalPackage(value: NeuralEarthPackage): string {
  validate(value);
  const layers = Object.fromEntries(Object.entries(value.layers).map(([key, layer]) => [key, { ...layer,
    values: { arrayType: layer.values.constructor.name, values: Array.from(layer.values, x => Number.isNaN(x) ? 'NaN' : x === Infinity ? '+Infinity' : x === -Infinity ? '-Infinity' : x) } }]));
  return JSON.stringify({ ...value, layers });
}
export function deserializeRegionalPackage(json: string): NeuralEarthPackage {
  const value = JSON.parse(json);
  if (!record(value) || !record(value.layers)) throw new Error('Invalid regional package layers.');
  for (const layer of Object.values(value.layers) as any[]) {
    const array = layer?.values;
    if (!record(array) || typeof array.arrayType !== 'string' || !Object.hasOwn(constructors, array.arrayType) || !Array.isArray(array.values)) throw new Error('Invalid regional layer array.');
    const name = array.arrayType as keyof typeof constructors, Ctor = constructors[name];
    const range = name === 'Uint8Array' ? [0, 255] : name === 'Uint16Array' ? [0, 65535] : [-2147483648, 2147483647];
    const numbers = array.values.map((x: unknown) => {
      if (name === 'Float32Array') {
        if (x === 'NaN') return NaN;
        if (x === '+Infinity') return Infinity;
        if (x === '-Infinity') return -Infinity;
        if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 3.4028234663852886e38) throw new Error('Invalid float regional layer value.');
      } else if (typeof x !== 'number' || !Number.isInteger(x) || x < range[0] || x > range[1]) throw new Error('Invalid integer regional layer value.');
      return x as number;
    });
    layer.values = new Ctor(numbers);
  }
  validate(value); return value;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return record(value) && Object.values(value).every(jsonValue);
}
function validate(value: unknown): asserts value is NeuralEarthPackage {
  const packet = value as NeuralEarthPackage;
  if (packet?.format !== 'surface-regional-exchange' || packet.version !== 1) throw new Error('Unsupported regional package.');
  if (!nonempty(packet.id) || !nonempty(packet.seed) || !record(packet.layers) || !record(packet.features) || !jsonValue(packet.features)) throw new Error('Invalid regional identity, layers or features.');
  const g = packet.georeference;
  if (!g || !record(g.origin) || !nonempty(g.crs) || !nonempty(g.verticalDatum) || ![g.origin.longitudeDeg, g.origin.latitudeDeg, g.origin.altitudeM, g.zAzimuthDeg].every(Number.isFinite)
    || Math.abs(g.origin.latitudeDeg) > 90 || Math.abs(g.origin.longitudeDeg) > 180) throw new Error('Invalid metric georeference.');
  for (const [key, layer] of Object.entries(packet.layers)) {
    if (!record(layer)) throw new Error(`Invalid regional layer: ${key}`);
    const typed = layer.values instanceof Float32Array || layer.values instanceof Uint8Array || layer.values instanceof Uint16Array || layer.values instanceof Int32Array;
    if (!nonempty(key) || !nonempty(layer.id) || !nonempty(layer.sourceKey) || !nonempty(layer.units) || !nonempty(layer.provenance) || !typed || !Number.isInteger(layer.width) || !Number.isInteger(layer.height)
      || layer.width < 1 || layer.height < 1 || layer.width * layer.height !== layer.values.length
      || ![layer.originX, layer.originZ, layer.spacingM, layer.nativeSpacingM, layer.sourceLOD].every(Number.isFinite)
      || !(layer.spacingM > 0) || !(layer.nativeSpacingM > 0)) throw new Error(`Invalid regional layer: ${key}`);
    if (layer.season !== undefined && (!record(layer.season) || !Number.isFinite(layer.season.dayOfYear) || layer.season.dayOfYear < 1 || layer.season.dayOfYear > 366 || typeof layer.season.elevationCorrected !== 'boolean')) throw new Error(`Invalid regional season: ${key}`);
  }
}
/** Binary consumers validate existing typed arrays without a decimal JSON round trip. */
export { validate as validateRegionalPackage };
/** Rotation only: planetary projection/geographic origin remain the consumer's job. */
export function metricHorizontalToEastNorth(x: number, z: number, georeference: MetricGeoreference): [number, number] {
  const az = georeference.zAzimuthDeg * Math.PI / 180;
  return [-Math.cos(az) * x + Math.sin(az) * z, Math.sin(az) * x + Math.cos(az) * z];
}
export function eastNorthToMetricHorizontal(east: number, north: number, georeference: MetricGeoreference): [number, number] {
  const az = georeference.zAzimuthDeg * Math.PI / 180;
  return [-Math.cos(az) * east + Math.sin(az) * north, Math.sin(az) * east + Math.cos(az) * north];
}
/** Convert imported units once; identity, source resolution and season survive. */
export function convertSeasonalLayer(layer: RegionalLayer, target: 'degC' | 'mm/year' | 'm'): RegionalLayer {
  const conversions: Record<string, [number, number]> = {
    'K>degC': [1, -273.15], 'degC>degC': [1, 0], 'm/year>mm/year': [1000, 0], 'mm/year>mm/year': [1, 0],
    'mm/day>mm/year': [365.25, 0], 'mm>m': [0.001, 0], 'm>m': [1, 0],
  };
  const conversion = conversions[`${layer.units}>${target}`];
  if (!conversion) throw new Error(`Unsupported unit conversion ${layer.units} to ${target}`);
  return { ...structuredClone(layer), units: target, values: Float32Array.from(layer.values, x => x * conversion[0] + conversion[1]) };
}
