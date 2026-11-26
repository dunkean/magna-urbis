/**
 * Retain the previous composition's meshes by their ordered producer inputs and the ground actually sampled.
 * The world compositor publishes immutable ground tiles. Other hosts can supply arbitrary height callbacks,
 * including closures whose answer changes in place, so their samples are checked by value.
 */
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { SHAPE_BLOCK } from '../world/groundShape';
import type { TerrainHeights } from '../world/heights';
import type { City3dHeight } from './types';

const WORLD_GROUND = Symbol('world ground');
type Height = City3dHeight & { [WORLD_GROUND]?: TerrainHeights };
/** Real metres from the world's immutable natural relief plus its current levelled ground. */
export function city3dWorldHeight(terrain: TerrainHeights): Height {
  const scale = terrain.exaggeration > 0 ? 1 / terrain.exaggeration : 1;
  return Object.assign((x: number, y: number) => terrain.groundAt(x, y) * scale, { [WORLD_GROUND]: terrain });
}

type Build = (heightAt?: City3dHeight) => PlacedBuilding[];
type Batch = (key: string, inputs: readonly unknown[], heightAt: Height | undefined, build: Build) => PlacedBuilding[];
type Tile = Float32Array | undefined;
interface WorldGround {
  terrain: TerrainHeights;
  side: number;
  tiles: Map<number, Tile>;
}
interface Entry {
  inputs: readonly unknown[];
  hasHeight: boolean;
  samples: number[];
  world?: WorldGround;
  buildings: PlacedBuilding[];
}
const sideOf = (terrain: TerrainHeights): number => terrain.shape?.side ?? Math.max(1, Math.ceil(terrain.width / SHAPE_BLOCK));
const tileOf = (terrain: TerrainHeights, key: number): Tile => terrain.shape?.ground[terrain.shape.index[key]];

function sameGround(entry: Entry, at: Height | undefined, equalTiles: WeakMap<Float32Array, Float32Array>): boolean {
  const terrain = at?.[WORLD_GROUND];
  if (entry.hasHeight !== !!at || entry.world?.terrain !== terrain) return false;
  if (entry.world && terrain) {
    if (entry.world.side !== sideOf(terrain)) return false;
    for (const [key, previous] of entry.world.tiles) {
      const tile = tileOf(terrain, key);
      if (tile === previous || (previous && tile && equalTiles.get(previous) === tile)) continue;
      if (!previous || !tile || tile.length !== previous.length || !tile.every((z, i) => Object.is(z, previous[i]))) return false;
      equalTiles.set(previous, tile);
    }
  } else if (at) {
    for (let i = 0; i < entry.samples.length; i += 3) if (!Object.is(entry.samples[i + 2], at(entry.samples[i], entry.samples[i + 1]))) return false;
  }
  return true;
}

function buildEntry(inputs: readonly unknown[], at: Height | undefined, build: Build): Entry {
  const terrain = at?.[WORLD_GROUND],
    samples: number[] = [];
  const world = terrain && { terrain, side: sideOf(terrain), tiles: new Map<number, Tile>() };
  const sample =
    at &&
    ((x: number, y: number) => {
      const z = at(x, y);
      if (world) {
        // GroundShape interpolates four nodes in this one tile, including at its shared edges.
        const bx = Math.floor(x / SHAPE_BLOCK),
          by = Math.floor(y / SHAPE_BLOCK);
        if (bx >= 0 && by >= 0 && bx < world.side && by < world.side) {
          const key = by * world.side + bx;
          if (!world.tiles.has(key)) world.tiles.set(key, tileOf(world.terrain, key));
        }
      } else samples.push(x, y, z);
      return z;
    });
  return { inputs, hasHeight: !!at, world, samples, buildings: build(sample) };
}

export class SeatedMeshes {
  private entries = new Map<string, Entry>();

  clear(): void {
    this.entries.clear();
  }

  /** Only install a complete set. Removed batches disappear and an interrupted producer leaves the previous set usable. */
  static compose(reuse: SeatedMeshes | undefined, compose: (batch: Batch) => PlacedBuilding[]): PlacedBuilding[] {
    if (!reuse) return compose((_key, _inputs, at, build) => build(at));
    const next = new Map<string, Entry>(),
      equalTiles = new WeakMap<Float32Array, Float32Array>();
    const result = compose((key, inputs, at, build) => {
      let entry = reuse.entries.get(key);
      if (!entry || inputs.length !== entry.inputs.length || !entry.inputs.every((previous, i) => Object.is(previous, inputs[i])) || !sameGround(entry, at, equalTiles)) entry = buildEntry(inputs, at, build);
      next.set(key, entry);
      return entry.buildings;
    });
    reuse.entries = next;
    return result;
  }
}
