import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY_LAYERS, resolveAppearance } from '../src/render/appearanceRecipe';
import { presetComposition } from '../src/render/composition';
import { city3dPlanOptions } from '../src/render/cityDrawOptions';
import { planFrame, footprintOps, blockOps, parcelOps } from '../src/render/city/look';
import { ContourInk } from '../src/v2/display/contours';

describe('Atlas display', () => {
  it('keeps the first terrain colours without requesting contour paths, including retained recipes', () => {
    const composition = presetComposition('atlas');
    expect(composition.ground.contours).toBe(false);
    composition.ground.contours = true;
    for (const target of ['view2d', 'view3d', 'export'] as const) {
      const appearance = resolveAppearance({ style: 'atlas', composition, contours: true }, { mapStyle: 'atlas', contours: true }, { nativeCities: true }, target);
      expect(appearance.ground.contours).toBe(false);
      const map = { resolved: appearance, native: {}, world: {}, exportLayers: {} };
      const contours = new ContourInk(map as never, () => {
        throw new Error('Atlas must not prepare contours');
      });
      expect(contours.contourLook()).toBeUndefined();
      expect(contours.paintContours({} as never, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1)).toBe(false);
      contours.dispose();
    }
  });

  it('shares houses-and-roads-only town layers with 2D, 3D and exports', () => {
    const composition = presetComposition('atlas');
    // An existing recipe cannot reintroduce an urban tint or block fill over Atlas.
    composition.landuse.urban = 'categorical';
    composition.buildings.blocks = true;
    composition.buildings.parcels = true;
    const shape = {
      outer: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      holes: [],
    };
    for (const target of ['view2d', 'view3d', 'export'] as const) {
      const appearance = resolveAppearance({ style: 'atlas', composition, city: { layers: { ...DEFAULT_CITY_LAYERS } } }, { mapStyle: 'atlas' }, { nativeCities: true }, target);
      expect(appearance.composition.landuse.urban).toBe('off');
      expect(appearance.city.visible).toBe(true);
      expect(appearance.city.layers.streets).toBe(true);
      for (const [name, shown] of Object.entries(appearance.city.layers)) if (name !== 'streets') expect(shown, name).toBe(false);
      expect(city3dPlanOptions(appearance).layers).toMatchObject(appearance.city.layers);
      const frame = planFrame({ view: 'buildings', lod: 'near', palette: appearance.city.palette, layers: appearance.city.layers, width: appearance.city.width });
      expect(footprintOps(frame, shape)).toEqual([]);
      expect(blockOps(frame, { shape, kind: 'block' } as never, false)).toBeUndefined();
      for (const use of ['plot', 'garden', 'common', 'place', 'market', 'reserve']) expect(parcelOps(frame, { shape, use } as never, false)).toBeUndefined();
    }
  });
});
