import { describe, expect, it } from 'vitest';
import { cleanRing, insertVertex, nearestEdge, removeVertex, ringProblem, selfIntersects, simplifyLotRing, simplifyRing } from '../src/ui/cityShapeEditor';
import { emptyEdits, layoutWithEdits, normalizeEdits, packEdits, packShape, parcelWithEdits, setEdit, unpackShape } from '../src/ui/cityEdits';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urbanConfig';

/** City Bench shape editor: pure vertex operations and the polygon validity gate of « Valider ». */
describe('city shape editor', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('inserts on the nearest edge, removes down to 3 vertices, and rejects self-intersections', () => {
    const hit = nearestEdge(square, { x: 10.4, y: 5 });
    expect(hit.edge).toBe(1);
    const five = insertVertex(square, hit.edge, hit.point);
    expect(five).toHaveLength(5);
    expect(five[2]).toEqual({ x: 10, y: 5 });
    expect(ringProblem(five)).toBeUndefined();
    // A triangle keeps its 3 vertices.
    const tri = removeVertex(removeVertex(five, 2), 0);
    expect(tri).toHaveLength(3);
    expect(removeVertex(tri, 0)).toBe(tri);
    // Dragging a vertex across the opposite edge makes a bow tie: invalid, « Valider » disabled.
    const bow = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    expect(selfIntersects(bow)).toBe(true);
    expect(ringProblem(bow)).toMatch(/auto-intersection/);
    expect(ringProblem([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeDefined();
    // Commit cleaning: 0.1 m rounding, duplicate, closing copy and collinear vertices dropped.
    expect(cleanRing([{ x: 0.04, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0.01 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }])).toEqual(square);
    // Quarter rings are simplified to at most 200 vertices.
    const circle = Array.from({ length: 1000 }, (_, i) => ({ x: 100 * Math.cos(i / 1000 * 2 * Math.PI), y: 100 * Math.sin(i / 1000 * 2 * Math.PI) }));
    const simple = simplifyRing(circle);
    expect(simple.length).toBeLessThanOrEqual(200);
    expect(ringProblem(simple)).toBeUndefined();
  });
  it('cleans structural edit fields and injects them through the usual overrides', () => {
    const raw = { quarters: { 2: { role: 'market', salt: 3, shape: { outer: [{ x: 0.04, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] } }, 3: { deleted: true }, 4: { salt: 0, deleted: 'yes', shape: { outer: [{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 1, y: 1 }] } } },
      parcels: { a: { deleted: 'garden', salt: 1.5 }, b: { deleted: 'merge' }, c: { deleted: 'burn' } } };
    const edits = normalizeEdits(raw);
    expect(edits.quarters['2']).toEqual({ role: 'market', salt: 3, shape: { outer: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], holes: [] } });
    expect(edits.quarters['3']).toEqual({ deleted: true });
    expect(edits.quarters['4']).toBeUndefined();
    expect(edits.parcels).toEqual({ a: { deleted: 'garden' }, b: { deleted: 'merge' } });
    // Removing one field keeps the others; salt stepping back to 0 removes it.
    const noShape = setEdit(edits, 'quarters', '2', { shape: undefined });
    expect(noShape.quarters['2']).toEqual({ role: 'market', salt: 3 });
    expect(setEdit(noShape, 'quarters', '2', { salt: undefined, role: undefined }).quarters['2']).toBeUndefined();
    expect((layoutWithEdits(defaultLayoutConfig(), edits) as unknown as { overrides: { quarters: unknown } }).overrides.quarters).toEqual(edits.quarters);
    expect((parcelWithEdits(defaultParcelConfig(), edits) as unknown as { overrides: { parcels: unknown } }).overrides.parcels).toEqual(edits.parcels);
    expect(normalizeEdits(JSON.parse(JSON.stringify(edits)))).toEqual(edits);
    expect(emptyEdits()).toEqual({ quarters: {}, parcels: {}, buildings: {} });
  });
  it('opens lot outlines without slivers or slits, and packs outlines compactly for links', () => {
    // A lot with a 2 cm edge and a zero-width slit: the editor gets a valid simple ring.
    const lot = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.02, y: 0 }, { x: 10.02, y: 6 }, { x: 14, y: 6 }, { x: 10.02, y: 6 }, { x: 10.02, y: 10 }, { x: 0, y: 10 }];
    expect(ringProblem(cleanRing(lot))).toBeDefined();
    const open = simplifyLotRing(lot);
    expect(ringProblem(cleanRing(open))).toBeUndefined();
    expect(open.length).toBeLessThanOrEqual(5);
    // Packed outlines round-trip at 0.1 m and are several times shorter than JSON in a URL.
    const ring = Array.from({ length: 200 }, (_, i) => ({ x: Math.round((5000 + 120 * Math.cos(i / 32)) * 10) / 10, y: Math.round((-3000 + 90 * Math.sin(i / 32)) * 10) / 10 }));
    const shape = { outer: ring, holes: [square] };
    expect(unpackShape(packShape(shape))).toEqual(shape);
    const edits = normalizeEdits({ quarters: { 2: { shape, salt: 2 } }, parcels: { a: { shape: { outer: square } } } });
    const packed = JSON.stringify(packEdits(edits));
    expect(normalizeEdits(JSON.parse(packed))).toEqual(edits);
    expect(encodeURIComponent(packed).length * 4).toBeLessThan(encodeURIComponent(JSON.stringify(edits)).length);
    expect(unpackShape('~1.2.3')).toBeUndefined();
  });
});
