import { gzipSync, strToU8, zipSync } from 'fflate';
import type { MapMesh } from './mapMesh';

export type MeshExport = 'obj' | 'glb' | 'godot' | 'unity';
export const isMeshExport = (format: string): format is MeshExport => format === 'obj' || format === 'glb' || format === 'godot' || format === 'unity';

const rgb = (hex: string): number[] => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (x: number): number => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const padded = (size: number): number => Math.ceil(size / 4) * 4;

export function mapGlb(scene: MapMesh, texture?: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunks: { data: Uint8Array; start: number }[] = [];
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  let byteLength = 0;
  const store = (data: Uint8Array, target?: number): number => {
    const byteOffset = byteLength;
    chunks.push({ data, start: byteOffset });
    bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, target });
    byteLength += padded(data.byteLength);
    return bufferViews.length - 1;
  };
  const accessor = (array: Float32Array | Uint32Array, type: 'VEC3' | 'VEC2' | 'SCALAR', bounds = false): number => {
    const size = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
    const indices = array instanceof Uint32Array;
    const min = Array<number>(size).fill(Infinity),
      max = Array<number>(size).fill(-Infinity);
    if (bounds)
      for (let i = 0; i < array.length; i++) {
        const k = i % size;
        min[k] = Math.min(min[k], array[i]);
        max[k] = Math.max(max[k], array[i]);
      }
    accessors.push({ bufferView: store(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), indices ? 34963 : 34962), componentType: indices ? 5125 : 5126, count: array.length / size, type, ...(bounds ? { min, max } : {}) });
    return accessors.length - 1;
  };
  const meshes = new Map<string, { name: string; primitives: object[] }>();
  const materials = new Map<string, { index: number; data: object }>();
  for (const part of scene.parts) {
    const textured = !!texture && !!part.uvs;
    const key = textured ? 'terrain' : part.color;
    let material = materials.get(key);
    if (!material) {
      material = { index: materials.size, data: { name: textured ? 'Terrain' : part.color, pbrMetallicRoughness: { baseColorFactor: [...rgb(part.color).map(linear), 1], metallicFactor: 0, roughnessFactor: 0.9, ...(textured ? { baseColorTexture: { index: 0 } } : {}) } } };
      materials.set(key, material);
    }
    const attributes = { POSITION: accessor(part.positions, 'VEC3', true), NORMAL: accessor(part.normals, 'VEC3'), ...(part.uvs ? { TEXCOORD_0: accessor(part.uvs, 'VEC2') } : {}) };
    const primitive = { attributes, material: material.index, ...(part.indices ? { indices: accessor(part.indices, 'SCALAR') } : {}), ...(part.featureRanges ? { extras: { features: part.featureRanges } } : {}) };
    let mesh = meshes.get(part.name);
    if (!mesh) meshes.set(part.name, (mesh = { name: part.name, primitives: [] }));
    mesh.primitives.push(primitive);
  }
  const image = texture ? { images: [{ bufferView: store(texture), mimeType: 'image/png' }], textures: [{ source: 0 }] } : {};
  const nodes = [...meshes.keys()].map((name, mesh) => ({ name, mesh }));
  const json = strToU8(
    JSON.stringify({
      asset: { version: '2.0', generator: 'Magna Urbis' },
      scene: 0,
      scenes: [{ name: 'Magna Urbis', nodes: nodes.map((_, i) => i), extras: { originMetres: scene.origin, widthMetres: scene.width, depthMetres: scene.depth, ...(scene.metadata ? { map: scene.metadata } : {}) } }],
      nodes,
      meshes: [...meshes.values()],
      materials: [...materials.values()].map(entry => entry.data),
      buffers: [{ byteLength }],
      bufferViews,
      accessors,
      ...image,
    }),
  );
  const jsonSize = padded(json.length);
  const result = new Uint8Array(28 + jsonSize + byteLength);
  const header = new DataView(result.buffer);
  for (const [offset, data] of [
    [0, 0x46546c67],
    [4, 2],
    [8, result.length],
    [12, jsonSize],
    [16, 0x4e4f534a],
    [20 + jsonSize, byteLength],
    [24 + jsonSize, 0x004e4942],
  ])
    header.setUint32(offset, data, true);
  result.fill(32, 20, 20 + jsonSize);
  result.set(json, 20);
  for (const { data, start } of chunks) result.set(data, 28 + jsonSize + start);
  return result;
}

const number = (value: number): string => String(Math.round(value * 100000) / 100000);

export function mapObj(scene: MapMesh, texture?: Uint8Array): Record<string, Uint8Array> {
  const materials = new Map<string, string>();
  const obj: string[] = [`# Magna Urbis, metres, X east, Y up, Z south. Map origin (${scene.origin.x}, ${scene.origin.y}).\nmtllib map.mtl\n`];
  let start = 1,
    firstUv = 1,
    name = '';
  for (const part of scene.parts) {
    if (name !== part.name) {
      name = part.name;
      obj.push(`o ${name}\n`);
    }
    const textured = !!texture && !!part.uvs;
    const key = textured ? 'Terrain' : part.color;
    let material = materials.get(key);
    if (!material) {
      material = textured ? 'Terrain' : `Color_${part.color.slice(1)}`;
      materials.set(key, material);
    }
    const lines: string[] = [];
    for (let i = 0; i < part.positions.length; i += 3) lines.push(`v ${number(part.positions[i])} ${number(part.positions[i + 1])} ${number(part.positions[i + 2])}`, `vn ${number(part.normals[i])} ${number(part.normals[i + 1])} ${number(part.normals[i + 2])}`);
    if (part.uvs) for (let i = 0; i < part.uvs.length; i += 2) lines.push(`vt ${number(part.uvs[i])} ${number(1 - part.uvs[i + 1])}`);
    lines.push(`usemtl ${material}`);
    const vertex = (i: number): string => `${start + i}/${part.uvs ? firstUv + i : ''}/${start + i}`;
    const count = part.positions.length / 3;
    const pick = (i: number): number => part.indices?.[i] ?? i;
    for (let i = 0; i < (part.indices?.length ?? count); i += 3) lines.push(`f ${vertex(pick(i))} ${vertex(pick(i + 1))} ${vertex(pick(i + 2))}`);
    obj.push(lines.join('\n'), '\n');
    start += count;
    if (part.uvs) firstUv += count;
  }
  const mtl = [...materials].map(([color, name]) => `newmtl ${name}\nKd ${(color === 'Terrain' ? [1, 1, 1] : rgb(color)).map(number).join(' ')}\nKs 0 0 0\nillum 1\n${color === 'Terrain' ? 'map_Kd terrain.png\n' : ''}`).join('\n');
  return { 'map.obj': strToU8(obj.join('')), 'map.mtl': strToU8(mtl), ...(texture ? { 'terrain.png': texture } : {}) };
}

function metadataFiles(scene: MapMesh): Record<string, Uint8Array> {
  if (!scene.metadata) return {};
  const objects = scene.parts.map(part => ({ name: part.name, material: part.color, triangleCount: (part.indices?.length ?? part.positions.length / 3) / 3, features: part.featureRanges }));
  return { 'map-metadata.json': strToU8(JSON.stringify({ ...scene.metadata, objects })) };
}

function godotProject(scene: MapMesh, mesh: Uint8Array): Uint8Array {
  const relief = scene.highestPoint - scene.lowestPoint;
  const centre = (scene.lowestPoint + scene.highestPoint) / 2;
  const extent = Math.max(scene.width, scene.depth, relief);
  const pitch = 40;
  const radians = (pitch * Math.PI) / 180;
  const distance = 1.8 * extent;
  // At this angle the vertical span on screen combines the north–south extent and altitude.
  const verticalSpan = scene.depth * Math.sin(radians) + relief * Math.cos(radians);
  const size = 1.16 * Math.max(verticalSpan, scene.width / 1.5);
  const root = `[gd_scene load_steps=3 format=3]

[ext_resource type="PackedScene" path="res://map.glb" id="1"]

[sub_resource type="Environment" id="OverviewEnvironment"]
background_mode = 1
background_color = Color(0.69, 0.77, 0.81, 1)
ambient_light_source = 2
ambient_light_color = Color(0.88, 0.92, 1, 1)
ambient_light_energy = 0.45

[node name="MagnaUrbis" type="Node3D"]

[node name="Map" parent="." instance=ExtResource("1")]

[node name="Environment" type="WorldEnvironment" parent="."]
environment = SubResource("OverviewEnvironment")

[node name="Sun" type="DirectionalLight3D" parent="."]
rotation_degrees = Vector3(-56, -28, 0)
shadow_enabled = true

[node name="Overview" type="Camera3D" parent="."]
position = Vector3(${scene.width / 2}, ${centre + distance * Math.sin(radians)}, ${scene.depth / 2 + distance * Math.cos(radians)})
rotation_degrees = Vector3(${-pitch}, 0, 0)
projection = 1
size = ${size}
near = ${Math.max(0.01, extent / 2000)}
far = ${distance + 2 * extent}
current = true
`;
  const config = 'config_version=5\n\n[application]\nconfig/name="Magna Urbis"\nrun/main_scene="res://map.tscn"\n\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=800\nwindow/stretch/mode="canvas_items"\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n';
  return zipSync({ 'project.godot': strToU8(config), 'map.tscn': strToU8(root), 'map.glb': mesh, ...metadataFiles(scene) }, { level: 1 });
}

/** Unity's local import package is a gzip tar of per-asset payload, .meta and pathname entries. */
async function unityPackage(obj: Record<string, Uint8Array>, name: string): Promise<Uint8Array> {
  const files: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const [file, bytes] of Object.entries(obj)) {
    const path = `Assets/Magna Urbis/${name}/${file}`;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path)));
    const guid = Array.from(hash.subarray(0, 16), value => value.toString(16).padStart(2, '0')).join('');
    files.push({ filename: `${guid}/asset`, bytes }, { filename: `${guid}/asset.meta`, bytes: strToU8(`fileFormatVersion: 2\nguid: ${guid}\n`) }, { filename: `${guid}/pathname`, bytes: strToU8(path) });
  }
  const block = (length: number): number => Math.ceil(length / 512) * 512;
  const tar = new Uint8Array(files.reduce((size, { bytes }) => size + 512 + block(bytes.length), 1024));
  let offset = 0;
  for (const { filename, bytes } of files) {
    const header = tar.subarray(offset, offset + 512);
    const put = (start: number, value: string): void => header.set(strToU8(value), start);
    put(0, filename);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, bytes.length.toString(8).padStart(11, '0') + '\0');
    put(136, '00000000000\0');
    put(148, '        ');
    put(156, '0');
    put(257, 'ustar\0' + '00');
    put(
      148,
      header
        .reduce((sum, value) => sum + value, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
    );
    tar.set(bytes, offset + 512);
    offset += 512 + block(bytes.length);
  }
  return gzipSync(tar, { level: 1 });
}

export async function encodeMapMesh(scene: MapMesh, format: MeshExport, name: string, texture?: Uint8Array): Promise<{ extension: string; bytes: Uint8Array; type: string }> {
  if (format === 'obj') return { extension: 'obj.zip', bytes: zipSync({ ...mapObj(scene, texture), ...metadataFiles(scene) }, { level: 1 }), type: 'application/zip' };
  if (format === 'unity') return { extension: 'unitypackage', bytes: await unityPackage({ ...mapObj(scene, texture), ...metadataFiles(scene) }, name), type: 'application/gzip' };
  const glb = mapGlb(scene, texture);
  if (format === 'godot') return { extension: 'godot.zip', bytes: godotProject(scene, glb), type: 'application/zip' };
  return { extension: 'glb', bytes: glb, type: 'model/gltf-binary' };
}
