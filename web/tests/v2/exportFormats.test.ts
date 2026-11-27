import { gunzipSync, strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { World } from '../../src/gen/types';
import { mapMesh, type MapMesh } from '../../src/v2/mapMesh';
import { encodeMapMesh, mapGlb, mapObj } from '../../src/v2/meshFormats';
import { uvttFrame, type uvttDocument } from '../../src/v2/uvtt';
import { encodeVttMap, foundryScene } from '../../src/v2/vttFormats';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
const world = { mapSize: 80, terrain: { height: { w: 2, h: 2, data: new Float32Array([4, 8, 4, 8]) } } } as World;

const model = (): Promise<MapMesh> => mapMesh(world, { x: 10, y: 20, width: 40, height: 20 }, 2, { city: false, roads: false }, false, false);

describe('3D map packages', () => {
  it('creates a metric terrain mesh and an aligned GLB with the texture embedded', async () => {
    const scene = await model();
    const [terrain] = scene.parts;
    expect(scene.origin).toEqual({ x: 10, y: 20 });
    expect(Array.from(terrain.positions.slice(0, 3))).toEqual([0, expect.any(Number), 0]);
    expect(Array.from(terrain.positions.slice(-3))).toEqual([40, expect.any(Number), 20]);
    expect(terrain.normals[1]).toBeGreaterThan(0);
    expect(Array.from(terrain.uvs!.slice(-2))).toEqual([1, 1]);
    const glb = mapGlb(scene, png);
    const header = new DataView(glb.buffer);
    const jsonLength = header.getUint32(12, true);
    const json = JSON.parse(strFromU8(glb.subarray(20, 20 + jsonLength)));
    expect(header.getUint32(0, true)).toBe(0x46546c67);
    expect(header.getUint32(8, true)).toBe(glb.length);
    expect(json.meshes[0].primitives[0]).toMatchObject({ indices: 3, attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 } });
    expect(json.accessors[0].max[0]).toBe(40);
    expect(json.accessors[0].max[2]).toBe(20);
    const image = json.bufferViews[json.images[0].bufferView];
    expect(glb.subarray(28 + jsonLength + image.byteOffset, 28 + jsonLength + image.byteOffset + image.byteLength)).toEqual(png);
  });

  it('binds the OBJ texture and produces a self-contained Godot project', async () => {
    const mesh = await model();
    const obj = mapObj(mesh, png);
    expect(strFromU8(obj['map.obj'])).toContain('f 1/1/1 4/4/4 2/2/2');
    expect(strFromU8(obj['map.obj'])).toContain('vt 1 0');
    expect(strFromU8(obj['map.mtl'])).toContain('map_Kd terrain.png');
    const godot = unzipSync((await encodeMapMesh(mesh, 'godot', 'town', png)).bytes);
    expect(strFromU8(godot['project.godot'])).toContain('run/main_scene="res://map.tscn"');
    expect(strFromU8(godot['map.tscn'])).toContain('path="res://map.glb"');
    expect(strFromU8(godot['map.tscn'])).toContain('rotation_degrees = Vector3(-40, 0, 0)');
    expect(strFromU8(godot['map.tscn'])).toContain('current = true');
    expect(godot['map.glb']).toEqual(mapGlb(mesh, png));
  });

  it('keeps Unity import IDs stable for assets at the same project path', async () => {
    const mesh = await model();
    const first = gunzipSync((await encodeMapMesh(mesh, 'unity', 'town', png)).bytes);
    const second = gunzipSync((await encodeMapMesh(mesh, 'unity', 'town', png)).bytes);
    expect(first).toEqual(second);
    const paths: string[] = [];
    for (let at = 0; first[at];) {
      const name = strFromU8(first.slice(at, at + 100)).split('\0')[0];
      const size = Number.parseInt(strFromU8(first.slice(at + 124, at + 135)), 8);
      if (name.endsWith('/pathname')) paths.push(strFromU8(first.slice(at + 512, at + 512 + size)));
      at += 512 + Math.ceil(size / 512) * 512;
    }
    expect(paths).toEqual(['map.obj', 'map.mtl', 'terrain.png'].map(name => 'Assets/Magna Urbis/town/' + name));
  });
});

describe('Foundry VTT scene archive', () => {
  it('translates UVTT coordinates into pixels and pairs the scene with its background', async () => {
    const frame = uvttFrame({ x: 0, y: 0, width: 100, height: 60 }, 1000, 5);
    const a = { x: 1.5, y: 2 },
      b = { x: 2, y: 2 };
    const map: ReturnType<typeof uvttDocument> = {
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 20, y: 12 }, pixels_per_grid: 50 },
      line_of_sight: [[{ x: 1, y: 2 }, a]],
      portals: [{ bounds: [a, b], position: { x: 1.75, y: 2 }, rotation: 0, closed: true, freestanding: false }],
      objects_line_of_sight: [],
      environment: { ambient_light: '#ffffff', baked_lighting: true },
      lights: [],
      image: '',
    };
    const scene = foundryScene(map, frame, 'town', 'town.png');
    expect(scene).toMatchObject({
      width: 1000,
      height: 600,
      grid: { size: 50, distance: 5, units: 'm' },
      walls: [
        { c: [50, 100, 75, 100], door: 0 },
        { c: [75, 100, 100, 100], door: 1 },
      ],
    });
    const archive = await encodeVttMap('foundry', map, frame, new Blob([png]), 'town');
    const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    expect(files['town.png']).toEqual(png);
    expect(JSON.parse(strFromU8(files['town.json']))).toEqual(scene);
  });
});
