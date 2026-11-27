import { sampleGrid } from '../../gen/core/grid';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import { channelArea, type RiverLine } from '../../ui/riverVectors';
import type { ImportedRiver } from './fmgNetworkRecipe';

/** Put the imported channel in the native water product before projection, so roads, bridges and town sites
 * see the same river as the renderer. The generated relief, lakes and ocean remain the source of their own layers. */
export function withImportedRiver(data: TerrainData, trace: ImportedRiver): TerrainData {
  const water = data.water;
  if (!water) throw new Error('The imported river needs vector hydrology.');
  const width = data.width, cell = width / data.resolution;
  const ground = { w: data.resolution, h: data.resolution, cell, data: data.height };
  const points: number[] = [], level: number[] = [];
  let length = 0;
  const add = (x: number, y: number) => {
    points.push(x, y);
    level.push(Math.max(0, sampleGrid(ground, x, y) + 0.02));
  };
  const [sx, sy] = trace.points[0];
  add(sx * width, sy * width);
  for (let i = 1; i < trace.points.length; i++) {
    const a = trace.points[i - 1], b = trace.points[i], dx = (b[0] - a[0]) * width, dy = (b[1] - a[1]) * width;
    const metres = Math.hypot(dx, dy);
    if (!metres) continue;
    length += metres;
    const count = Math.max(1, Math.ceil(metres / Math.min(cell, 25)));
    for (let j = 1; j <= count; j++) add(a[0] * width + dx * j / count, a[1] * width + dy * j / count);
  }
  const area = channelArea(trace.width, water.widthScale ?? 1);
  const line: RiverLine = { id: 1, joins: -1, points, level, area: level.map(() => area), kind: level.map(() => 0) };
  return { ...data, water: { ...water, editedNetwork: true, rivers: {
    rivers: [line], widthScale: water.widthScale, oxbows: [], braids: [], distributaries: [],
    lengthKm: length / 1000, meanderRuns: 0, meanderKm: 0, braidedKm: 0, avulsions: 0, deltas: 0, ms: 0,
  } } };
}
