import { isUnderdarkBiome } from '../../gen/biomes';
import { groundRoadLook } from '../composition';
import type { ColorSlot, DisplayList, DrawOp, LandTint } from '../gpu/contract';
import { mapLandSeasonRevision, mapSeasonKey, seasonInkOf, type SeasonInk } from '../seasonPalette';
import { nativeTileInks } from '../gpu/recorder';
import type { BandLook } from './bandRecording';
import { whiteWaterRevision } from '../whiteWater';
import type { CartographyContext } from './context';

/** A baked surface only needs this small set of pigment and image identities. In particular
 * its validity check must not retain a discarded list's paths or instance arrays. */
function paintInputs(c: CartographyContext, seasonal: boolean, lookInputs: BandLook | undefined, slots: Map<SeasonInk, Float32Array>, backdrop: LandTint | number | undefined, terrain: CartographyContext['terrainImg'], mask: CartographyContext['terrainImg']) {
  const look = c.lookId,
    date = lookInputs && mapSeasonKey();
  const sameSources = () => ((seasonal && c.lookId === look) || (lookInputs && date === mapSeasonKey() && lookInputs.matches(c.pal))) && c.getTerrain() === terrain && (c.deps.land?.() ?? terrain) === mask;
  const pixelsMatch = () => {
    if (!sameSources()) return false;
    if (typeof backdrop === 'number') {
      if (mapLandSeasonRevision() !== backdrop) return false;
    } else if (backdrop) {
      const now = c.landUniforms();
      if (!now || backdrop.heights !== now.heights || backdrop.maxHeight !== now.maxHeight || !backdrop.tint.every((v, i) => v === now.tint[i]) || !backdrop.snow.every((v, i) => v === now.snow[i])) return false;
    }
    for (const [name, rgba] of slots) {
      const ink = c.ink(name);
      if (!ink.valid || !rgba.every((v, i) => v === ink.rgba[i])) return false;
    }
    return true;
  };
  return { sameSources, pixelsMatch };
}

// Legacy water, town patterns and material roads/roofs can paint literal, dated pixels.
// V2 owns water and towns in separate passes on the Parchment map.
function seasonalOverlay(c: CartographyContext): boolean {
  return c.pal.name === 'parchment' && !isUnderdarkBiome(c.world.options.biome) && !c.world.urban && !c.world.terrain.caverns && !c.polyL('rivers') && !c.polyL('sea') && !c.polyL('lakes') && !whiteWaterRevision() && !groundRoadLook(c.deps.roadStyle?.().look ?? c.deps.roadLook);
}

/** Observe the normal Canvas paint once, including inks already composited in the pen layer. */
export function nativeTilePaint<T>(c: CartographyContext, ctx: CanvasRenderingContext2D, paint: () => T): { result: T; pixelsMatch?: () => boolean } {
  if ((!c.deps.palette && !c.deps.terrain) || c.brushes || !seasonalOverlay(c)) return { result: paint() };
  nativeTileInks.set(ctx, new Set());
  try {
    const result = paint(),
      used = nativeTileInks.get(ctx),
      terrain = c.terrainImg;
    if (!used || (terrain && !c.hasLandBackdrop)) return { result };
    const slots = new Map<SeasonInk, Float32Array>();
    for (const slot of used) {
      const name = seasonInkOf(slot);
      if (!name || !slot.valid) return { result };
      slots.set(name, slot.rgba.slice());
    }
    const land = terrain && c.hasLandBackdrop ? mapLandSeasonRevision() : undefined;
    return { result, pixelsMatch: paintInputs(c, true, undefined, slots, land, terrain, c.deps.land?.() ?? terrain).pixelsMatch };
  } finally {
    nativeTileInks.delete(ctx);
  }
}

/** A finished pixel surface can be kept if all its recorded pigments still match. A recording
 * with different pigments keeps its paths and instance arrays and binds the new date's slots.
 * Previously displayed suffixes keep their own bindings while new prefixes are baking. */
export function seasonRecording(c: CartographyContext, list: DisplayList, bandLook?: BandLook) {
  if ((!c.deps.palette && !c.hasLandBackdrop) || list.unsupported || list.bakedSeason) return;
  let seasonal = seasonalOverlay(c);
  if (!seasonal && !bandLook) return;
  const terrain = c.terrainImg,
    mask = c.deps.land?.() ?? terrain;
  const slots = new Map<SeasonInk, Float32Array>();
  const bindings: { at: number; bind: (land?: LandTint) => DrawOp }[] = [];
  let bytes = 256;
  let backdrop: LandTint | undefined;
  const nameOf = (slot: ColorSlot) => {
    const name = seasonInkOf(slot);
    if (name && !slots.has(name)) slots.set(name, slot.rgba.slice());
    return name;
  };
  for (let at = 0; at < list.ops.length; at++) {
    const op = list.ops[at];
    bytes += 256 + (op.type === 'sprites' ? op.instances.byteLength : op.type === 'clear' ? 0 : 32 * op.paths.length);
    if (op.type === 'sprites') {
      if (op.landTint) {
        backdrop = op.landTint;
        bindings.push({ at, bind: land => ({ ...op, landTint: land }) });
      } else if (op.tint) {
        const ink = nameOf(op.tint[0]),
          wash = nameOf(op.tint[1]);
        if (!ink || !wash) return;
        bindings.push({ at, bind: () => ({ ...op, tint: [c.ink(ink), c.ink(wash)] }) });
      } else if (op.contourTint) {
        bandLook = undefined;
        if (!seasonal) return;
      } else if (!(op.composite === 'destination-in' && op.source === mask) && op.composite !== 'destination-out') {
        if (op.source !== terrain || !bandLook) return;
        seasonal = false; // A legacy terrain provider can bake the date into the source.
      }
    } else if (op.type !== 'clear' && op.paint.kind === 'pattern') {
      // An existing Canvas pattern can bypass the brush painter (and its literal colour reads).
      bandLook = undefined;
      if (!seasonal) return;
    } else if (op.type !== 'clear' && op.paint.kind !== 'pattern' && op.paint.slot) {
      const paint = op.paint,
        name = nameOf(op.paint.slot);
      if (!name) return;
      bindings.push({
        at,
        bind: () => {
          const slot = c.ink(name);
          return { ...op, paint: { ...paint, slot, rgba: slot.rgba } };
        },
      });
    }
  }
  const { sameSources, pixelsMatch } = paintInputs(c, seasonal, bandLook, slots, backdrop, terrain, mask);
  const replay = (): { list: DisplayList; pixelsMatch: () => boolean } | undefined => {
    if (!sameSources()) return;
    const current = new Map<SeasonInk, Float32Array>();
    for (const name of slots.keys()) {
      const ink = c.ink(name);
      if (!ink.valid) return;
      current.set(name, ink.rgba.slice());
    }
    const land = backdrop && c.landUniforms();
    if (backdrop && !land) return;
    const evidence = paintInputs(c, seasonal && seasonalOverlay(c), bandLook, current, land, terrain, mask);
    if (!bindings.length) return { list, pixelsMatch: evidence.pixelsMatch };
    const ops = list.ops.slice();
    for (const { at, bind } of bindings) ops[at] = bind(land);
    return { list: { ...list, ops }, pixelsMatch: evidence.pixelsMatch };
  };
  return { replay, pixelsMatch, bytes };
}

export type SeasonRecording = NonNullable<ReturnType<typeof seasonRecording>>;
