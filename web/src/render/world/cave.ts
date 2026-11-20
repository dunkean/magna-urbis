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
import { cavernFog, cavernReveal, type CavernField, type UnderdarkCavern3d } from '../underdarkCavern';
import type { ForestOccupation } from '../../../../rust/bridge/terrainForest';
import type { FrameCamera } from './contract';

export interface WorldCave {
  /** The section cut of the map: roof, walls, openness. */
  readonly field: CavernField;
  /** Roof clearance, darkness and mushroom abundance of the appearance. */
  readonly settings: UnderdarkCavern3d;
  /** Town lanterns (x, y, radius in metres), at most 16 are lit. */
  readonly lamps: Float32Array;
  /** False: the lanterns are out (the appearance's "lights off"). */
  readonly lightsOn: boolean;
  /** Fungal farm lots (x, y, half-size, angle), where no wild mushroom grows. */
  readonly farms?: Float32Array;
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

/** Where the cave dissolves into darkness, in metres as drawn from the eye: start and end. A walking or flying eye
 * looks as far as an orbit that would frame what lies under it. */
export function caveFogRange(cave: WorldCave, camera: FrameCamera, exaggeration: number, out: [number, number]): [number, number] {
  const reach = camera.free ? 2 * Math.max(0, camera.eye[2] - camera.target[2]) : camera.distance,
    [start, end] = cavernFog(reach, exaggeration, cave.settings.darkness);
  out[0] = start;
  out[1] = end;
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

/** The cutaway of the roof (focus x, y, radius, width of the section band, in map metres): around the target of the
 * orbit camera, none for a walking or flying eye (the vault stays overhead). The roof lies on the flat map of the top
 * view, so the cutaway opens to the whole map as the relief comes down. */
export function caveReveal(camera: FrameCamera, exaggeration: number, out: [number, number, number, number]): [number, number, number, number] {
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
