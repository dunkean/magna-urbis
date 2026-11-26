import { strToU8, zipSync } from 'fflate';
import type { MapMetadata } from './exportMetadata';
import type { UvttFrame } from './uvtt';
import { uvttImageData, type uvttDocument } from './uvtt';

export type VttExport = 'dd2vtt' | 'foundry' | 'owlbear' | 'roll20';
export const isVttExport = (format: string): format is VttExport => format === 'dd2vtt' || format === 'foundry' || format === 'owlbear' || format === 'roll20';

type MapData = ReturnType<typeof uvttDocument>;

export function foundryScene(map: MapData, frame: UvttFrame, name: string, path: string, metadata?: MapMetadata) {
  const { width, height, pixelsPerGrid: size } = frame;
  const edge = (segment: { x: number; y: number }[], door = 0) => ({ c: segment.flatMap(p => [Math.round(p.x * size), Math.round(p.y * size)]), door, ds: 0 });
  const walls = [...map.line_of_sight.flatMap(line => line.slice(1).map((b, i) => edge([line[i], b]))), ...map.portals.map(p => edge(p.bounds, 1))].filter(({ c: [x1, y1, x2, y2] }) => x1 !== x2 || y1 !== y2);
  return { name, width, height, padding: 0, tokenVision: true, grid: { type: 1, size, distance: Number(frame.metresPerGrid.toPrecision(8)), units: 'm' }, levels: [{ name: 'Ground', background: { src: path } }], environment: { globalLight: { enabled: true } }, walls };
}

const archive = (files: Record<string, Uint8Array>): Blob => new Blob([zipSync(files, { level: 1 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });

export async function encodeVttMap(format: VttExport, map: MapData, frame: UvttFrame, png: Blob, name: string, metadata?: MapMetadata): Promise<{ blob: Blob; extension: string }> {
  const companion: Record<string, Uint8Array> = metadata ? { 'map-metadata.json': strToU8(JSON.stringify(metadata)) } : {};
  if (format === 'foundry') {
    const imagePath = name + '.png';
    const scene = foundryScene(map, frame, name, imagePath, metadata);
    const readme = `Foundry VTT 14\n\n1. Unzip this archive. Upload ${imagePath} to the root of Foundry's User Data using the file picker, or edit the JSON background path to match your upload folder.\n2. Create an empty scene, right-click it in the Scenes directory and choose Import Data. Select ${name}.json.\n3. Open the imported scene and inspect the Wall and Door layers.\n`;
    return { blob: archive({ [imagePath]: new Uint8Array(await png.arrayBuffer()), [name + '.json']: strToU8(JSON.stringify(scene, null, 2)), 'README.txt': strToU8(readme), ...companion }), extension: 'foundry.zip' };
  }
  const uvtt = JSON.stringify({ ...map, image: await uvttImageData(png), ...(metadata ? { magna_urbis: metadata } : {}) });
  if (format === 'owlbear') {
    const readme = `Owlbear Rodeo 2\n\nUpload the UVTT file using the Smoke & Spectre! extension to import the image and vision barriers together. For a plain map, import the PNG directly from the Scenes tab.\nGrid size is ${frame.pixelsPerGrid} pixels and its measure is ${Number(frame.metresPerGrid.toPrecision(8))} metres per cell.\n`;
    return { blob: archive({ [name + '.png']: new Uint8Array(await png.arrayBuffer()), [name + '.uvtt']: strToU8(uvtt), 'README.txt': strToU8(readme), ...companion }), extension: 'owlbear.zip' };
  }
  return { blob: new Blob([uvtt], { type: 'application/json' }), extension: format === 'roll20' ? 'roll20.uvtt' : 'dd2vtt' };
}
