/** Metric regional exchange: no Godot nodes or planetary projection assumptions. */
export interface MetricGeoreference {
  crs: string;
  origin: { longitudeDeg: number; latitudeDeg: number; altitudeM: number };
  /** Azimuth clockwise from true north of local +Z. X is +90 degrees from +Z. */
  zAzimuthDeg: number;
  verticalDatum: string;
}
export interface RegionalLayer {
  id: string; sourceKey: string; units: string;
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
  return JSON.stringify(value, (_key, v) => ArrayBuffer.isView(v)
    ? { arrayType: v.constructor.name, values: Array.from(v as unknown as ArrayLike<number>, x => Number.isNaN(x) ? 'NaN' : x) } : v);
}
export function deserializeRegionalPackage(json: string): NeuralEarthPackage {
  const value = JSON.parse(json, (_key, v) => {
    if (v && typeof v === 'object' && 'arrayType' in v) {
      const Ctor = constructors[v.arrayType as keyof typeof constructors];
      if (!Ctor || !Array.isArray(v.values)) throw new Error('Invalid regional layer array.');
      return new Ctor(v.values.map((x: unknown) => x === 'NaN' ? NaN : x));
    }
    return v;
  });
  validate(value); return value;
}
function validate(value: NeuralEarthPackage): void {
  if (value?.format !== 'surface-regional-exchange' || value.version !== 1) throw new Error('Unsupported regional package.');
  const g = value.georeference;
  if (!g?.crs || !g.verticalDatum || ![g.origin.longitudeDeg, g.origin.latitudeDeg, g.origin.altitudeM, g.zAzimuthDeg].every(Number.isFinite)
    || Math.abs(g.origin.latitudeDeg) > 90 || Math.abs(g.origin.longitudeDeg) > 180) throw new Error('Invalid metric georeference.');
  for (const [key, layer] of Object.entries(value.layers)) {
    if (!key || !layer.id || !layer.sourceKey || !layer.units || !Number.isInteger(layer.width) || !Number.isInteger(layer.height)
      || layer.width < 1 || layer.height < 1 || layer.width * layer.height !== layer.values.length
      || !(layer.spacingM > 0) || !(layer.nativeSpacingM > 0) || !Number.isInteger(layer.sourceLOD)) throw new Error(`Invalid regional layer: ${key}`);
  }
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
