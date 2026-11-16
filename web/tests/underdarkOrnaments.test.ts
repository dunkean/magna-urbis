import { describe, expect, it } from 'vitest';
import type { Layout, Point } from '../../rust/bridge/urban';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { city3dUnderdarkOrnaments, drawUnderdarkOrnaments, ornamentTriangles, underdarkOrnaments } from '../src/render/underdarkOrnaments';

const rect = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function town(culture: string, key: string): { layout: Layout; buildings: PlacedBuilding[] } {
  const buildings: PlacedBuilding[] = [];
  const roles = culture === 'duergar-hold' ? ['dwelling', 'craft.smithy', 'dwelling', 'defence.barracks', 'craft.workshop'] : ['dwelling', 'dwelling', 'worship.temple', 'dwelling'];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    const k = i * 16 + j, tall = culture === 'drow-enclave' && k % 37 === 0;
    buildings.push({ id: `${key}-b${k}`, function: 'domestic', footprint: [{ outer: rect(i * 18, j * 18, 12, 10), holes: [] }], ground_z_m: 0,
      programme: { role: roles[k % roles.length], landmark: tall }, volumes: [{ z_m: 0, wall_height_m: tall ? 24 : 7, roof_height_m: 0 }] } as unknown as PlacedBuilding);
  }
  const streets = [{ path: [{ x: -40, y: 140 }, { x: 330, y: 140 }], widths: [6, 6], rank: 0, role: 'main' }, { path: [{ x: 140, y: 140 }, { x: 140, y: -40 }], widths: [5, 5], rank: 1, role: 'street' }];
  const layout = { key, culture, center: { x: 144, y: 144 }, quarters: [{ shape: { outer: rect(-10, -10, 310, 310), holes: [] }, phase: 0 }], streets,
    blocks: [{ shape: { outer: rect(60, 60, 30, 26), holes: [] }, quarter: 0, kind: 'place', axis: { x: 1, y: 0 } }], warnings: [] } as unknown as Layout;
  return { layout, buildings };
}

describe('Underdark ornaments', () => {
  it('derives deterministic drow webs within the triangle budget', () => {
    const a = town('drow-enclave', 'd'), b = town('drow-enclave', 'd');
    const plan = underdarkOrnaments([a.layout], a.buildings);
    expect(JSON.stringify(plan.webs)).toBe(JSON.stringify(underdarkOrnaments([b.layout], b.buildings).webs));
    expect(plan.webs.some(w => w.kind === 'span')).toBe(true);
    expect(plan.webs.some(w => w.kind === 'canopy')).toBe(true);
    const meshes = city3dUnderdarkOrnaments(plan, () => 0, a.buildings);
    for (const m of meshes) expect(ornamentTriangles([m])).toBeLessThanOrEqual(200);
    expect(ornamentTriangles(meshes)).toBeLessThanOrEqual(3000);
    expect(meshes.every(m => m.volumes[0].role === 'minor')).toBe(true);
  });

  it('puts forges, roof spikes and guard towers on duergar holds only, with ember faces', () => {
    const d = town('duergar-hold', 'g'), plan = underdarkOrnaments([d.layout], d.buildings);
    expect(plan.forges.length).toBeGreaterThanOrEqual(2);
    expect(plan.spikes.length).toBeGreaterThan(0);
    expect(plan.guards.length).toBeGreaterThan(0);
    expect(plan.webs).toHaveLength(0);
    const meshes = city3dUnderdarkOrnaments(plan, () => 0, d.buildings);
    expect(meshes.some(m => m.volumes[0].roof_mesh.faces.some(f => f.material?.startsWith('city3d:wall:lit@')))).toBe(true);
    expect(ornamentTriangles(meshes)).toBeLessThanOrEqual(3000);
    const surface = town('medieval', 'm');
    expect(underdarkOrnaments([surface.layout], surface.buildings).forges).toHaveLength(0);
  });

  it('draws the embers only when the lamps are on', () => {
    const d = town('duergar-hold', 'g2'), plan = underdarkOrnaments([d.layout], d.buildings), fills: string[] = [];
    class FakePath { moveTo(): void {} lineTo(): void {} closePath(): void {} rect(): void {} }
    const previous = (globalThis as { Path2D?: unknown }).Path2D; (globalThis as { Path2D?: unknown }).Path2D = FakePath;
    try {
      const ctx: Record<string, unknown> = { save() {}, restore() {}, fill() { fills.push(String(ctx.fillStyle)); }, stroke() {}, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineJoin: '', lineCap: '' };
      const o = { viewport: { minX: -50, minY: -50, maxX: 350, maxY: 350 }, mpp: 0.4, palette: 'terrain' };
      drawUnderdarkOrnaments(ctx as unknown as CanvasRenderingContext2D, plan, { ...o, lit: false }); expect(fills).not.toContain('#ff7a2e');
      drawUnderdarkOrnaments(ctx as unknown as CanvasRenderingContext2D, plan, { ...o, lit: true }); expect(fills).toContain('#ff7a2e');
    } finally { (globalThis as { Path2D?: unknown }).Path2D = previous; }
  });
});
