import { describe, expect, it } from 'vitest';
import type { Layout, Partition, Shape, Street } from '../../rust/bridge/urban';
import { CityGround } from '../src/render/cityGround';
import { buildCityScene, buildCityBuildings } from '../src/render/cityCanvas';
import { cityGlPlanMesh } from '../src/render/cityGl';
import { meshFeatureAt, buildStreetStrokes, STROKE_STRIDE } from '../src/render/cityGlBuild';
import { streetPaint, buildingColors, DEFAULT_LAYERS } from '../src/render/cityGlStyle';
import { city3dBoardwalks } from '../src/render/city3dBoardwalks';
import { silhouetteBuilding } from '../src/render/city3dMeshes';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';

const rect = (x: number, y: number, w: number, h = w): Shape => ({ outer: [{ x, y }, { x:x+w, y }, { x:x+w, y:y+h }, { x, y:y+h }], holes: [] });
const raster = { n: 4, width: 40, water: Uint8Array.from({ length:16 }, (_, i) => i % 4 >= 2 ? 1 : 0) };

describe('physical city ground', () => {
  it('retains dry land and exact cadastral picking but no wet ground in any mesh layer', () => {
    const shapes = [rect(0,0,10), rect(20,0,10), rect(10,10,20)], street: Street = { path:[{ x:10,y:20 },{ x:35,y:20 }], widths:[6,6], rank:4, role:'pier' };
    const layout = { key:'shore', culture:'arbitrary', center:{ x:20,y:20 }, quarters:[{ shape:rect(0,0,40), phase:0, zone:'core' }], streets:[street],
      blocks:shapes.map(shape => ({ shape, kind:'block', quarter:0, zone:'core', axis:{ x:1,y:0 } })), warnings:[] } as unknown as Layout;
    const partition = { key:'shore', parcels:shapes.map((shape,i) => ({ id:`p${i}`, shape, block:i, use:i===2?'garden':'plot', axis:{ x:1,y:0 }, rank:1 })), warnings:[] } as unknown as Partition;
    const scene = buildCityScene([layout],[partition],raster), mesh = cityGlPlanMesh(scene);
    for (const layer of ['footprint','blocks','parcels']) {
      expect(meshFeatureAt(mesh,layer,{ x:5,y:5 })).toBeDefined();
      expect(meshFeatureAt(mesh,layer,{ x:25,y:5 })).toBeUndefined();
      expect(meshFeatureAt(mesh,layer,{ x:15,y:15 })).toBeDefined();
      expect(meshFeatureAt(mesh,layer,{ x:25,y:15 })).toBeUndefined();
    }
    expect(scene.parcels[1].shape).toBe(shapes[1]); expect(scene.parcels[1].ground).toEqual([]);
    expect(scene.streets[0].width).toBe(3); expect(street.widths[0]).toBe(6);
    const strokes = buildStreetStrokes(scene,mesh.origin), values = new Float32Array(strokes.data);
    expect(values[4]).toBe(3); expect(values[5]).toBeCloseTo(0.8,6); expect(strokes.data.byteLength).toBe(STROKE_STRIDE*4);
  });
  it('keeps dry islands and rock while exposing lakes and rivers, including water holes', () => {
    const water = new Uint8Array(25).fill(2); water[12]=0; water[0]=4; water[1]=3;
    const ground = new CityGround({ n:5,width:50,water }), shape = rect(0,0,50), clipped = ground.clip(shape);
    expect(clipped).toHaveLength(2); expect(ground.clip(shape)).toBe(clipped);
    expect(ground.waterAt({ x:25,y:25 })).toBe(false); expect(ground.waterAt({ x:15,y:5 })).toBe(true);
    expect(ground.land()).toHaveLength(2);
    const lake = new CityGround({ n:3,width:30,water:Uint8Array.from([0,0,0,0,2,0,0,0,0]) }).clip(rect(0,0,30));
    expect(lake).toHaveLength(1); expect(lake[0].holes).toHaveLength(1);
  });
  it('uses timber for piers even in parchment and keeps bridge paving distinct', () => {
    for (const palette of ['parchment','growth','atlas','terrain'] as const) expect(streetPaint('pier',2,palette).fill).toBe('#b49a6d');
    expect(streetPaint('pier',2,'parchment').fill).not.toBe(streetPaint('bridge',2,'parchment').fill);
  });
  it('keeps a thin vector canal visible even when the entire coarse raster is dry', () => {
    const ground = new CityGround({ n:2,width:40,water:new Uint8Array(4),geometry:{ water:[[rect(19,0,2,40).outer]] } });
    const dry = ground.clip(rect(0,0,40));
    expect(dry).toHaveLength(2); expect(ground.waterAt({ x:20,y:20 })).toBe(true); expect(ground.land()).toHaveLength(2);
    expect(dry.flatMap(s=>s.outer).every(p=>p.x<=19 || p.x>=21)).toBe(true);
    const island = new CityGround({ n:1,width:40,water:new Uint8Array(1),geometry:{ water:[[rect(0,0,40).outer,rect(10,10,10).outer]] } });
    expect(island.clip(rect(0,0,40))).toHaveLength(1); expect(island.waterAt({ x:15,y:15 })).toBe(false); expect(island.waterAt({ x:25,y:25 })).toBe(true);
    const lake = new CityGround({ n:1,width:40,water:new Uint8Array(1),geometry:{ water:[[rect(10,10,10).outer]] } });
    expect(lake.land()[0].holes).toHaveLength(1);
  });
});

describe('raised timber display', () => {
  it('batches deck sides and slender posts without any broad ground foundation', () => {
    const street: Street = { path:[{ x:0,y:0 },{ x:30,y:0 }], widths:[6,6], rank:3, role:'pier' };
    const walks = city3dBoardwalks([street],()=>-2,()=>4);
    expect(walks).toHaveLength(1); const volume = walks[0].volumes[0];
    expect(volume.envelope).toBe('open'); expect(volume.foundation.footprint).toEqual([]); expect(volume.levels).toEqual([]);
    const deck = volume.roof_mesh.faces.find(f => f.material==='city3d:road:bridge_timber')!;
    expect(deck.vertices.map(i => volume.roof_mesh.vertices[i].z)).toEqual([5.3,5.3,5.3,5.3]);
    expect(walks[0].footprint[0].outer.map(p=>Math.abs(p.y))).toEqual([1.5,1.5,1.5,1.5]);
    expect(volume.roof_mesh.vertices.length).toBe((1+2*6)*8);
    expect(city3dBoardwalks([{ ...street,role:'road' }])).toEqual([]);
  });
  it('keeps stilt house foundations empty in height and gives the plan a dark edge', () => {
    const shape = rect(0,0,10), building = { id:'h', parcel_id:'p', function:'domestic', culture:{ culture:'any' }, ground_z_m:4,
      footprint:[shape], roof_footprint:[shape], programme:{ massing:[{ eave_m:3,rise_m:2,roof:'hip',cover:'thatch',wall:'timber',tone:0.5,
        volumes:[{ ring:shape.outer.map(p=>[p.x,p.y]), eave_m:3,rise_m:2,roof:'hip',cover:'thatch',wall:'timber',tone:0.5,stilts_m:2.7 }] }] } } as unknown as PlacedBuilding;
    const house = silhouetteBuilding(building,()=>4), v = house.volumes[0];
    expect(v.z_m).toBeCloseTo(6.7); expect(v.foundation.z_min_m).toBe(v.foundation.z_max_m);
    expect(v.roof_mesh.vertices.some(p=>p.z < v.z_m)).toBe(true);
    const buildings = buildCityBuildings({ buildings:[building] }); expect(buildings.items[0].stilts).toBe(true);
    const colors = buildingColors(buildings,{ view:'buildings',lod:'close',palette:'parchment',layers:DEFAULT_LAYERS,buildingsVisible:true,diagnostic:'none' });
    expect(Array.from(colors.line.slice(0,4))).toEqual([81,68,49,255]);
    const flooded = silhouetteBuilding(building,()=>2,()=>7), raised = flooded.volumes[0];
    expect(raised.z_m).toBeCloseTo(9.7); expect(raised.foundation.z_min_m).toBe(raised.foundation.z_max_m);
    expect(raised.roof_mesh.vertices.some(p=>p.z>=7 && p.z<raised.z_m)).toBe(true);
  });
});
