import { afterEach, describe, expect, it } from 'vitest';
import { CLIMATE_ZONES } from '../../rust/bridge/terrainClimate';
import { hydrologyWaterColour } from '../../rust/bridge/hydrologyRender';
import { setMapSeason, setMapClimateZone } from '../src/render/seasonPalette';
import { waterShoreColor } from '../src/render/terrainStyle';
import { dryDitchColour, freshWater, waterBed } from '../src/render/waterPalette';

afterEach(() => {
  setMapClimateZone(undefined);
  setMapSeason(0.5);
});

describe('fresh water by climate and season', () => {
  it('turns ochre in the rains of the savanna and milky turquoise over glacier melt', () => {
    const dry = freshWater({ zone: 'savanna', season: 0 }),
      rains = freshWater({ zone: 'savanna', season: 0.5 }),
      melt = freshWater({ zone: 'alpine', season: 0.5 });
    expect(rains[0] - rains[2]).toBeGreaterThan(dry[0] - dry[2] + 0.1);
    expect(melt[1]).toBeGreaterThan(melt[0]);
    expect(melt[2]).toBeGreaterThan(melt[0]);
    expect(freshWater({})[3]).toBe(0);
  });
  it('keeps every bed on the ground side of the painted water layer, edge included', () => {
    for (const zone of [undefined, ...CLIMATE_ZONES]) {
      const [r, , b] = waterBed(zone);
      expect(0.88 * (r - b)).toBeGreaterThan(0.14);
    }
  });
  it('tones vector water in the medium of its style, and leaves monochrome, custom and zoneless water alone', () => {
    expect(hydrologyWaterColour('parchment')).toBe(waterShoreColor('parchment'));
    setMapSeason(0.5, 'savanna');
    expect(hydrologyWaterColour('parchment')).not.toBe(waterShoreColor('parchment'));
    expect(hydrologyWaterColour('blueprint')).toBe(waterShoreColor('blueprint'));
    expect(hydrologyWaterColour('atlas', { river: '#010203' })).toBe('#010203');
  });
  it('greens the dry moats of humid zones only', () => {
    const green = (c: string): number => parseInt(c.slice(3, 5), 16) - parseInt(c.slice(1, 3), 16);
    setMapSeason(0.5, 'temperate');
    const humid = green(dryDitchColour());
    setMapSeason(0.5, 'desert');
    expect(humid).toBeGreaterThan(green(dryDitchColour()));
  });
});
