import { describe, expect, it } from 'vitest';
import { buildingRayDistance, surfaceTriangles, eachBuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { buildingExterior, urbanBuildingsSvg } from '../src/render/urbanBuildings';
import { renderHouseExteriorSvg, houseMaterialColor } from '../../rust/bridge/houseRender';
import { buildingPaint } from '../src/render/urbanBuildingStyle';
import type { Surface } from '../../rust/bridge/housesContract';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { ForestOccupation } from '../../rust/bridge/terrainForest';
import { withBuildingOccupation } from '../src/ui/forestOccupation';
import { UrbanBuildingGround } from '../src/ui/urbanBuildingGround';

describe('applied building display geometry', () => {
  it('shares Houses exterior facets, material patterns and ridge edges without a detailed HouseUnit', () => {
    const materials={frame:'wood',infill:'earth',coating:'',cladding:'tile',base:'stone',roof_frame:'wood'};
    const polygon=[{outer:[{x:0,y:0},{x:8,y:0},{x:8,y:6},{x:0,y:6}],holes:[]}];
    const building={id:'real-house',parcel_id:'lot',function:'domestic',culture:{culture:'test'},recipe_id:'recipe',ground_z_m:100,courtyards:[],circulation:[],roof_footprint:polygon,structural_features:[],volumes:[{id:'body',footprint:polygon,levels:[{index:0,footprint:polygon,z_m:100,height_m:3,materials}],z_m:100,wall_height_m:3,roof_height_m:2,roof_system:'RF-GABLE',materials,envelope:'closed',roof_mesh:{vertices:[{x:0,y:0,z:103},{x:8,y:0,z:103},{x:8,y:3,z:105},{x:0,y:3,z:105},{x:8,y:6,z:103},{x:0,y:6,z:103}],faces:[{vertices:[0,1,2,3],normal:[0,-.55,.83],material:'tile',kind:'pan',roof_group:'roof'},{vertices:[3,2,4,5],normal:[0,.55,.83],material:'thatch',kind:'pan',roof_group:'roof'}],groups:[{id:'roof',rf:'RF-GABLE',body_id:'body',level:0,domain:polygon}],edges:[{kind:'ridge',vertices:[3,2],faces:[0,1]}]}}]} as unknown as PlacedBuilding;
    const catalogue={materials:[{id:'tile',pattern:'tile'},{id:'thatch',pattern:'thatch'}]} as Parameters<typeof houseMaterialColor>[0];
    const exterior=buildingExterior(building);
    const common=renderHouseExteriorSvg(exterior,catalogue,'urban-houses',0,100);
    const svg=urbanBuildingsSvg({buildings:[building],materials:catalogue.materials} as PlacementBatch,{style:'cartographic',diagnostic:'none'});
    expect(svg).toContain(common);
    expect(svg).toContain('url(#urban-houses-mat-tile)');expect(svg).toContain('url(#urban-houses-mat-thatch)');
    expect(svg).toContain('stroke-width="1.05"');
    const faceMaterials:string[]=[];eachBuildingTriangle(building,t=>{if(t.surface==='roof')faceMaterials.push(t.material!);});
    expect(new Set(faceMaterials)).toEqual(new Set(['tile','thatch']));
    expect(houseMaterialColor(catalogue,'tile')).toBe('#ad7f62');
    const rotated=structuredClone(building);
    rotated.transform={origin:{x:20,y:10},orientation_deg:90};
    for (const v of rotated.volumes) {
      v.roof_mesh.vertices=v.roof_mesh.vertices.map(p=>({...p,x:20-p.y,y:10+p.x}));
      for (const f of v.roof_mesh.faces) f.normal=[-f.normal[1],f.normal[0],f.normal[2]];
      for (const g of v.roof_mesh.groups??[]) g.domain=g.domain.map(p=>({...p,outer:p.outer.map(p=>({x:20-p.y,y:10+p.x})),holes:[]}));
    }
    const local=buildingExterior(rotated);
    expect(local.roofs.vertices[1].x).toBeCloseTo(8,9);
    expect(local.roofs.vertices[1].y).toBeCloseTo(0,9);
    expect(urbanBuildingsSvg({buildings:[rotated],materials:catalogue.materials} as PlacementBatch,{style:'cartographic',diagnostic:'none'})).toContain('translate(20 10) rotate(90)');
  });

  it('keeps a courtyard open inside a concave outer boundary, in either ring winding', () => {
    const surface: Surface = [{ outer: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 10 }, { x: 0, y: 10 }], holes: [[{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 5 }, { x: 2, y: 5 }]] }];
    for (const reverse of [false, true]) {
      const shape = reverse ? surface.map(p => ({ outer: [...p.outer].reverse(), holes: p.holes.map(h => [...h].reverse()) })) : surface;
      const triangles = surfaceTriangles(shape);
      const area = triangles.reduce((sum, [a, b, c]) => sum + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0);
      expect(area).toBeCloseTo(92, 8); // 12*10 - 4*4 notch - 4*3 courtyard.
      const hits = triangles.map(t => buildingRayDistance([4, 3, 20], [0, 0, -1], t.map(p => [p.x, p.y, 5]) as [[number, number, number], [number, number, number], [number, number, number]]));
      expect(hits.every(hit => hit === null)).toBe(true);
    }
  });
  it('selects metric heights without baking display exaggeration into the scene', () => {
    const face: [[number, number, number], [number, number, number], [number, number, number]] = [[0, 0, 17], [10, 0, 17], [0, 10, 17]];
    expect(buildingRayDistance([2, 2, 30], [0, 0, -1], face)).toBeCloseTo(13, 9);
    expect(buildingRayDistance([12, 12, 30], [0, 0, -1], face)).toBeNull();
    expect(face[0][2]).toBe(17);
  });
  it('keeps courtyard holes and physical roof height in the shared distant display and picking', () => {
    const shape: Surface = [{ outer: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }], holes: [[{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }, { x: 4, y: 8 }]] }];
    const materials = { frame: '', infill: '', coating: '', cladding: '', base: '', roof_frame: '' };
    const building = { ground_z_m: 100, structural_features: [], volumes: [{ footprint: shape, z_m: 100, wall_height_m: 6, roof_height_m: 3, envelope: 'walled', materials, levels: [{ footprint: shape, z_m: 100, height_m: 6 }], roof_mesh: { vertices: [], faces: [] } }] } as unknown as PlacedBuilding;
    const roof: number[] = [], court: number[] = [];
    eachBuildingTriangle(building, face => {
      const hit = buildingRayDistance([2, 2, 120], [0, 0, -1], face.points); if (hit !== null) roof.push(hit);
      const hole = buildingRayDistance([6, 6, 120], [0, 0, -1], face.points); if (hole !== null) court.push(hole);
    }, true);
    expect(Math.min(...roof)).toBe(11);
    expect(court).toEqual([]);
    expect(building.volumes[0].roof_height_m).toBe(3);
  });
  it('resolves appearance from neutral data without changing materials or physical height', () => {
    const materials = { frame: 'wood', infill: 'clay', coating: 'none', cladding: 'none', base: 'stone', roof_frame: 'wood' };
    const applied = JSON.stringify(materials);
    const geometric = buildingPaint(materials, 'workshop', 8.25, { style: 'geometric', diagnostic: 'uses' });
    const cartographic = buildingPaint(materials, 'workshop', 8.25, { style: 'cartographic', diagnostic: 'none' });
    expect(geometric.roof).not.toBe(cartographic.roof);
    expect(JSON.stringify(materials)).toBe(applied);
  });
  it('excludes accepted buildings and circulation while preserving courtyard forest and physical foundations', () => {
    const rectangle = (x: number, y: number, w: number, h = w) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    const scene = { buildings: [{ ground_z_m: 12, footprint: [{ outer: rectangle(10, 10, 20), holes: [rectangle(18, 18, 4)] }], circulation: [{ outer: rectangle(30, 18, 5, 4), holes: [] }], structural_features: [{ surface: [{ outer: rectangle(36, 12, .15, 16), holes: [] }] }] }] } as unknown as PlacementBatch;
    const rgba = new Uint8Array(20 * 20 * 4);
    for (let i = 0; i < 400; i++) { rgba[i * 4 + 1] = 255; rgba[i * 4 + 3] = 255; }
    const source: ForestOccupation = { x: 0, y: 0, width: 40, n: 20, rgba, key: 'retained-forest' };
    const before = rgba.slice(), merged = withBuildingOccupation(source, scene)!;
    const at = (x: number, y: number) => {
      const i = (Math.floor((y - merged.y) / merged.width * merged.n) * merged.n + Math.floor((x - merged.x) / merged.width * merged.n)) * 4;
      return merged.rgba.slice(i, i + 4);
    };
    for (const [x, y] of [[14, 14], [32, 20], [36.1, 20]]) { expect(at(x, y)[2]).toBe(8); expect(at(x, y)[0]).toBeGreaterThan(128); }
    for (const [x, y] of [[20, 20], [4, 4]]) expect(at(x, y)[1]).toBeGreaterThan(128);
    expect(rgba).toEqual(before);
    scene.buildings[0].structural_foundations = [{ footprint: [{ outer: rectangle(36, 12, .15, 16), holes: [] }], z_min_m: 9, z_max_m: 12 }];
    const ground = new UrbanBuildingGround(scene);
    expect(ground.constrain(14, 14, 20)).toBe(12);
    expect(ground.constrain(20, 20, 20)).toBe(20);
    expect(ground.constrain(36.1, 20, 20)).toBe(12);
    expect(scene.buildings[0].ground_z_m).toBe(12);
  });
});
