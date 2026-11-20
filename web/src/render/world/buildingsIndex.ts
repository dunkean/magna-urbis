import { BUILDING_STRIDE } from './buildingsMesh';

/** A work slice owns its vertex storage. Unique vertices occupy its prefix. Indices refer to the whole level. */
export interface BuildingPart {
  data: Float32Array;
  indices: Uint16Array | Uint32Array;
  base: number;
  unique: number;
  low: number;
  high: number;
}

// One small direct-mapped cache is enough for adjacent triangles of roofs and walls. A collision can only miss a
// sharing opportunity. Comparing the entire record preserves hard normals, material seams, paint and terrain seats.
const recent = new Int32Array(512);
export function indexBuildingPart(data: Float32Array, base: number): BuildingPart {
  const bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
  const count = data.length / BUILDING_STRIDE;
  const indices = base + count <= 65535 ? new Uint16Array(count) : new Uint32Array(count);
  recent.fill(-1);
  let unique = 0;
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < count; i++) {
    const src = i * BUILDING_STRIDE;
    const xyz = Math.imul(bits[src], 31) ^ Math.imul(bits[src + 1], 131) ^ bits[src + 2];
    const mixed = Math.imul(xyz ^ (xyz >>> 16), 0x45d9f3b);
    const slot = (mixed ^ (mixed >>> 16)) & (recent.length - 1);
    let index = recent[slot];
    if (index >= 0) {
      const dst = index * BUILDING_STRIDE;
      for (let j = 0; j < BUILDING_STRIDE; j++) {
        if (bits[src + j] === bits[dst + j]) continue;
        index = -1;
        break;
      }
    }
    if (index < 0) {
      const z = data[src + 9] + data[src + 1];
      if (z < low) low = z;
      if (z > high) high = z;
      index = unique++;
      recent[slot] = index;
      if (index !== i) bits.copyWithin(index * BUILDING_STRIDE, src, src + BUILDING_STRIDE);
    }
    indices[i] = base + index;
  }
  return { data, indices, base, unique, low, high };
}

/** A level for which indices cost more than they save keeps its original drawArrays representation. Restore a part
 * in place: a vertex's compact index never exceeds its original position, so later writes cannot corrupt a source. */
export function expandBuildingPart(part: BuildingPart): Float32Array {
  if (part.unique !== part.indices.length) {
    const bits = new Uint32Array(part.data.buffer, part.data.byteOffset, part.data.length);
    for (let i = part.indices.length - 1; i >= 0; i--) {
      const index = part.indices[i] - part.base;
      if (index !== i) bits.copyWithin(i * BUILDING_STRIDE, index * BUILDING_STRIDE, (index + 1) * BUILDING_STRIDE);
    }
  }
  return part.data;
}
