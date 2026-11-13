import type { ForestOccupation } from '../../../rust/bridge/terrainForest';
import type { ForestCorridor } from '../render/forestRoom';
import type { LandUseLayer } from '../gen/types';
import { forestOccupation, unpackOccupationShapes, withOccupationShapes } from './forestOccupation';
import { landDetail, type LandCultures } from './landDetail';
import { unpackOccupationLanduse, type PackedOccupationLanduse } from './occupationLanduse';

/** Owned by the persistent worker. Main-thread revisions address these immutable inputs/planes. */
export class OccupationPreparation {
  private inputs = new Map<number, { landuse: LandUseLayer; occupations: Map<number, ForestOccupation | undefined> }>();
  register(revision: number, packed: PackedOccupationLanduse): void {
    if (!this.inputs.has(revision)) this.inputs.set(revision, { landuse: unpackOccupationLanduse(packed), occupations: new Map() });
  }
  release(revision: number): void { this.inputs.delete(revision); }
  private input(revision: number) {
    const source = this.inputs.get(revision);
    if (!source) throw new Error(`Land-use revision ${revision} is not registered.`);
    return source;
  }
  occupation(landuseRevision: number, revision: number, corridors: ForestCorridor[]): ForestOccupation | undefined {
    const source = this.input(landuseRevision);
    if (!source.occupations.has(revision)) {
      source.occupations.set(revision, forestOccupation(source.landuse, undefined, undefined, corridors));
      if (source.occupations.size > 4) source.occupations.delete(source.occupations.keys().next().value!);
    }
    const result = source.occupations.get(revision);
    // Keep the source plane for the merge; transfer a reply copy, never detach retained caches.
    return result && { ...result, rgba: result.rgba.slice() };
  }
  detail(landuseRevision: number, cultures?: LandCultures) {
    const result = landDetail(this.input(landuseRevision).landuse, cultures);
    return result && { ...result, rgba: result.rgba.slice() };
  }
  merge(shapes: Float64Array, source?: ForestOccupation, retained?: { landuseRevision: number; revision: number }): ForestOccupation {
    if (retained) {
      const inputs = this.input(retained.landuseRevision);
      if (!inputs.occupations.has(retained.revision)) throw new Error(`Occupation revision ${retained.revision} is not retained.`);
      source = inputs.occupations.get(retained.revision);
    }
    return withOccupationShapes(source, unpackOccupationShapes(shapes));
  }
}
