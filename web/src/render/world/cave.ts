/**
 * The Underdark of the world view (contract.ts): what a tilted frame needs to show a map as a cave. The relief of
 * such a map is already the cave's section model (rock cut at the roof of its chamber: render/underdarkCavern.ts
 * cavernSectionHeights); this file holds what the layers share to light it as one: the darkness the far cave dissolves
 * into, the town lanterns, and the cutaway of the roof around the orbit target.
 *
 *   drapedGround.ts    dark sky, cave fog instead of the haze, rock walls, lantern light on the ground
 *   buildingsLayer.ts  the town lit by its lanterns, dissolving into the same darkness
 *   caveLayer.ts       the roof (cut away around the orbit target, whole overhead for a walking or flying eye) and the
 *                      modelled mushrooms
 *
 * The page gives one `WorldCave` per map and appearance (v2/display/worldVolumes.ts), compared by identity; undefined
 * outside the Underdark and on paper looks, which keep the section relief alone.
 */
import { cavernFog, cavernReveal, cavernRoofAt, type CavernField, type UnderdarkCavern3d } from '../underdarkCavern';
import type { ForestOccupation } from '../../../../rust/bridge/terrainForest';
import type { FrameCamera } from './contract';

export interface WorldCave {
  /** The section cut of the map: roof, walls, openness. */
  readonly field: CavernField;
  /** Roof clearance, darkness and mushroom abundance of the appearance. */
  readonly settings: UnderdarkCavern3d;
  /** Town lanterns (x, y, radius in metres), at most 16 are lit. */
  readonly lamps: Float32Array;
  /** Lights of the isolated buildings (farmsteads): x, y, radius in metres. The ground shows the nearest ones. */
  readonly sparks: Float32Array;
  /** False: the lanterns are out (the appearance's "lights off"). */
  readonly lightsOn: boolean;
  /** Fungal farm lots (x, y, half-size, angle), where no wild mushroom grows. */
  readonly farms?: Float32Array;
  readonly craftedBeds?: boolean;
  readonly occupation?: ForestOccupation;
  readonly seed: number;
  /** Height of the layer before the cut, in metres. */
  raw(x: number, y: number): number;
  /** Displayed water cover, 0..1. */
  water(x: number, y: number): number;
}

/** The darkness the far cave dissolves into (the 3D ground's cavernFog). */
export const CAVE_DUSK: readonly [number, number, number] = [0.005, 0.005, 0.007];
const LAMPS = 16;
/** Lights the ground of a frame takes: every town, then the isolated buildings nearest to the target. */
export const GROUND_LAMPS = 32;

/** Where the cave dissolves into darkness, in metres as drawn from the eye: start and end. A walking or flying eye
 * looks as far as an orbit that would frame what lies under it. */
export function caveFogRange(cave: WorldCave, camera: FrameCamera, exaggeration: number, out: [number, number]): [number, number] {
  const reach = camera.free ? 2 * Math.max(0, camera.eye[2] - camera.target[2]) : camera.distance,
    [start, end] = cavernFog(reach, exaggeration, cave.settings.darkness);
  // A cave is dim, not blind: the darkness starts well behind what the view frames.
  out[0] = start * 1.5;
  out[1] = end * 2;
  return out;
}

/** The lanterns as `uniform vec4 [16]` (x, y, radius, 0) relative to (`ox`, `oy`), and how many are lit. */
export function caveLamps(cave: WorldCave, ox: number, oy: number, out: Float32Array): number {
  const count = cave.lightsOn ? Math.min(LAMPS, Math.floor(cave.lamps.length / 3)) : 0;
  for (let k = 0; k < count; k++) {
    out[k * 4] = cave.lamps[k * 3] - ox;
    out[k * 4 + 1] = cave.lamps[k * 3 + 1] - oy;
    out[k * 4 + 2] = cave.lamps[k * 3 + 2];
    out[k * 4 + 3] = 0;
  }
  return count;
}

/** The lights of the ground as `uniform vec4 [GROUND_LAMPS]` (map x, y, radius, 0): the towns, then the isolated
 * buildings nearest to the camera's target. Returns how many are lit. */
export function caveGroundLamps(cave: WorldCave, camera: FrameCamera, out: Float32Array): number {
  let count = caveLamps(cave, 0, 0, out);
  if (!cave.lightsOn) return count;
  const sparks = cave.sparks,
    tx = camera.target[0],
    ty = camera.target[1],
    first = count;
  // Insertion among the nearest so far: a few hundred farms at most, a handful of slots.
  for (let k = 0; k + 2 < sparks.length; k += 3) {
    const d = (sparks[k] - tx) ** 2 + (sparks[k + 1] - ty) ** 2;
    let at = count;
    while (at > first && out[(at - 1) * 4 + 3] > d) at--;
    if (at >= GROUND_LAMPS) continue;
    const last = Math.min(count, GROUND_LAMPS - 1);
    for (let m = last; m > at; m--) for (let c = 0; c < 4; c++) out[m * 4 + c] = out[(m - 1) * 4 + c];
    out[at * 4] = sparks[k];
    out[at * 4 + 1] = sparks[k + 1];
    out[at * 4 + 2] = sparks[k + 2];
    out[at * 4 + 3] = d;
    if (count < GROUND_LAMPS) count++;
  }
  return count;
}

/** The cutaway of the roof (focus x, y, radius, width of the section band, in map metres): around the target of the
 * orbit camera and under a flyer who is above the roof, none for an eye inside the cave (the vault stays overhead). The roof lies on the flat map of the top
 * view, so the cutaway opens to the whole map as the relief comes down. */
export function caveReveal(cave: WorldCave, camera: FrameCamera, exaggeration: number, out: [number, number, number, number]): [number, number, number, number] {
  // A flyer above the roof looks down into the cave as the orbit does: the cutaway opens under him, as wide as he is
  // high above the roof. Below it the vault is whole overhead.
  const above = camera.free ? camera.eye[2] - cavernRoofAt(cave.field, camera.target[0], camera.target[1]) * exaggeration * camera.rise : 0;
  if (camera.free && above > 0) {
    const reveal = cavernReveal(camera.target[0], camera.target[1], 2 * above, exaggeration);
    out[0] = reveal[0];
    out[1] = reveal[1];
    out[2] = reveal[2];
    out[3] = reveal[3];
    return out;
  }
  if (camera.free) {
    out[0] = camera.target[0];
    out[1] = camera.target[1];
    out[2] = 0;
    out[3] = 1;
    return out;
  }
  const reveal = cavernReveal(camera.target[0], camera.target[1], camera.distance, exaggeration),
    open = 1 / Math.max(camera.rise * camera.rise, 1e-4);
  out[0] = reveal[0];
  out[1] = reveal[1];
  out[2] = reveal[2] * open;
  out[3] = reveal[3];
  return out;
}
