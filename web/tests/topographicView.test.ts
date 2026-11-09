import './vectorWaterWasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRenderGeometry } from '../../rust/bridge/renderGeometry';
import { presetComposition } from '../src/render/composition';
import { resolveAppearance } from '../src/render/appearanceRecipe';
import { renderSvg } from '../src/render/svg';
import { appearanceDisplayOptions, svgOptionsForDisplay } from '../src/v2/appearance';
import { defaultSettings } from '../src/v2/settings';
import { fakeWorld } from '../scripts/fakeworld';

beforeAll(() => loadRenderGeometry());
describe('topographic line view', () => {
  it('keeps the networks and cities while turning off relief, cover and filled land use', () => {
    const composition = presetComposition('topographic');
    const r = resolveAppearance({style:'topographic',composition}, {mapStyle:'topographic'}, {nativeCities:true}, 'view2d');
    expect(r.ground).toMatchObject({ contours:true, layers:{relief:false,water:true} });
    expect(r.vegetation).toMatchObject({forest:{enabled:false}});
    expect(r.cartography).toMatchObject({landuse:false, roads:true, painted:false});
    expect(r.composition).toMatchObject({vegetation:{look:'none',cartographic:false,procedural:false}, landuse:{rural:'outlines',urban:'off',classes:{field:true,forest:false,meadow:false}},networks:{roads:{visible:true},water:{visible:true}}, buildings:{visible:true}});
    expect(r.city.layers).toMatchObject({blocks:false,domains:false,gardens:false,places:false});
    expect(r.city.visible).toBe(true);
  });
  it('exports field and strip boundaries without physical land-use paint or terrain raster', () => {
    const w=fakeWorld({mapSize:1600, buildings:12, streets:3, clusters:1, landAreas:0});
    const height=w.terrain.height;
    for(let y=0;y<height.h;y++)for(let x=0;x<height.w;x++)height.data[y*height.w+x]=x*4+y*2;
    w.terrain.slope.data.fill(.1);
    w.landuse!.areas.push({kind:'field',poly:[{x:100,y:100},{x:200,y:100},{x:200,y:200},{x:100,y:200}],strips:[[{x:110,y:110},{x:140,y:110},{x:140,y:190},{x:110,y:190}]]});
    w.landuse!.areas.push({kind:'forest',poly:[{x:300,y:300},{x:400,y:300},{x:400,y:400},{x:300,y:400}]});
    const settings=defaultSettings();settings.appearance={style:'topographic',composition:presetComposition('topographic')};
    const svg=renderSvg(w,svgOptionsForDisplay({width:1600,legend:false,cartouche:false},appearanceDisplayOptions(settings,w)));
    expect(svg).toContain('class="layer-field-outlines" fill="none"');
    expect(svg).toContain('M100 100L200 100L200 200L100 200Z');
    expect(svg).toContain('M110 110L140 110L140 190L110 190Z');
    expect(svg).not.toContain('M300 300L400 300L400 400L300 400Z');
    expect(svg).not.toContain('id="terrain-ground"');
    expect(svg).not.toContain('class="layer-landuse"');
    expect(svg).toContain('id="terrain-contour-ground"');
    expect(svg.match(/id="terrain-contour-ground"[^>]*>([\s\S]*?)<\/g>/)?.[1]).toContain('<path ');
    expect(svg).toContain('class="layer-rivers"');
    expect(svg).toContain('id="regional-road-ground"');
    expect(svg).toContain('layer-urban');
  });
});
