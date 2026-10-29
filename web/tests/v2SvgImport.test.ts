import { it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { defaultSettings } from '../src/v2/settings';
import { generateTerrain } from '../src/v2/engine';
import { renderSvg } from '../src/render/svg';

it('keeps imported seed text inside SVG metadata and produces valid XML',async()=>{
  const settings=defaultSettings();settings.extent=600;settings.options.coast='none';settings.options.river='none';
  settings.runtime={backend:'typescript',compute:'cpu',source:'procedural'};
  settings.options.seed='" onload="alert(1)" <terrain> & un monde';
  const world=await generateTerrain(settings);
  const svg=renderSvg(world,{width:64,raster:false,contours:false,landuse:false,cartouche:false,legend:false,labels:false});
  const root=svg.slice(0,svg.indexOf('>')+1);
  expect(root).toContain('data-seed="&quot; onload=&quot;alert(1)&quot; &lt;terrain&gt; &amp; un monde"');
  expect(()=>new Resvg(svg).render()).not.toThrow();
});
