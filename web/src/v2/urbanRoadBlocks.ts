import type { Layout, Shape } from '../../../rust/bridge/urban';
import type { RoadChanges } from './urbanRoadEditing';
import { differenceS, intersectionS, mpArea } from '../gen/geo/bool';
import { ribbon } from '../gen/geo/offset';

const bounds = (s: Shape) => ({ x0: Math.min(...s.outer.map(p => p.x)), y0: Math.min(...s.outer.map(p => p.y)), x1: Math.max(...s.outer.map(p => p.x)), y1: Math.max(...s.outer.map(p => p.y)) });
const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
/** Keep block indexes and all untouched objects stable, including when a new street splits an island. */
export function roadBlockScope(layout: Layout, changes: RoadChanges): { layout: Layout; affected: Set<number> } {
  const width = Math.max(6, ...layout.streets.flatMap(s => s.widths));
  const corridors = [...changes.old, ...changes.next]
    .filter(p => p.length > 1)
    .map(p => ({
      outer: ribbon(
        p,
        p.map(() => width + 6),
      ),
      holes: [],
    }));
  const tests = corridors.map(shape => ({ shape, box: bounds(shape) })),
    affected = new Set<number>(),
    blocks = layout.blocks.slice();
  const streets = layout.streets
    .filter(s => s.path.length > 1)
    .map(s => ({
      outer: ribbon(
        s.path,
        s.widths.map(w => Math.max(0.5, w)),
      ),
      holes: [],
    }));
  const cuts = streets.map(shape => ({ shape, box: bounds(shape) }));
  for (const [index, block] of layout.blocks.entries()) {
    const box = bounds(block.shape);
    if (!tests.some(t => overlaps(box, t.box) && mpArea(intersectionS(block.shape, t.shape)) > 0.01)) continue;
    affected.add(index);
    const nearby = cuts.filter(c => overlaps(box, c.box)).map(c => c.shape);
    const pieces = nearby.length ? differenceS(block.shape, ...nearby) : [block.shape];
    // A fully occupied island keeps an empty shape at its old index, never reindexes its neighbours.
    blocks[index] = { ...block, shape: pieces[0] ?? { outer: [], holes: [] } };
    for (const shape of pieces.slice(1)) {
      affected.add(blocks.length);
      blocks.push({ ...block, shape });
    }
  }
  return { layout: affected.size ? { ...layout, blocks } : layout, affected };
}
