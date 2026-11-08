import { describe, expect, it } from 'vitest';
import { pieceRoof, pieceShadows, pieceTop, volumeRoof, pieceVolumes, loftRidges, planRoof, buildingRoof, type MassingPiece, type RoofFace } from '../src/render/cityMassing';

type P = { x: number; y: number };
const area = (r: P[]) => r.reduce((s, p, i) => { const n = r[(i + 1) % r.length]; return s + p.x * n.y - n.x * p.y; }, 0) / 2;
const inside = (p: P, ring: P[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const piece = (over: Partial<MassingPiece>): MassingPiece => ({ floors: 2, eave_m: 6, rise_m: 3, roof: 'gable', ridges: [], cover: 'tile', wall: 'brick', ...over });

describe('terraced plan roofs', () => {
  const rect = (x: number, y: number, w: number, d: number) => ({ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }], holes: [] as P[][] });
  const lower = rect(6, 0, 8, 10), upper = rect(0, 0, 6, 6);
  const flat = (height: number) => piece({ roof: 'flat', eave_m: height, rise_m: 0 });
  it('orders overlapping slabs by height and lights each tier independently of input order', () => {
    const nested = rect(0, 0, 14, 14), crown = rect(2, 2, 6, 6);
    const faces = planRoof([crown, nested], [flat(9), flat(3)]);
    expect(faces.every(f => f.flat)).toBe(true);
    const high = faces.findIndex(f => f.piece === 0);
    expect(high).toBeGreaterThan(0);
    expect(faces.slice(high).every(f => f.piece === 0)).toBe(true);
    const fields = faces.filter(f => f.normal[2] === 1 && (f.light ?? 0) > -0.1);
    expect(fields.find(f => f.piece === 0)!.light).toBeGreaterThan(fields.find(f => f.piece === 1)!.light!);
    expect((1 + fields.find(f => f.piece === 0)!.light!) / (1 + fields.find(f => f.piece === 1)!.light!)).toBeCloseTo(1.1, 5);
    for (const id of [0, 1]) {
      const rims = faces.filter(f => f.piece === id && f.normal[2] < 0.999);
      expect(rims).toHaveLength(4);
      expect(rims.some(f => f.normal[0] + f.normal[1] < 0 && f.light! > 0)).toBe(true);
      expect(rims.some(f => f.normal[0] + f.normal[1] > 0 && f.light! < -0.4)).toBe(true);
      for (const f of rims) {
        const [a, b, , d] = f.points, length = Math.hypot(b.x - a.x, b.y - a.y);
        expect(Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / length * 1.4).toBeGreaterThan(1.5);
      }
    }
  });
  it('casts only inside a lower terrace, preserving courts and the real height difference', () => {
    const terrace = { ...lower, holes: [rect(7, 1, 1, 1).outer] };
    const shadows = (height: number) => planRoof([upper, terrace], [flat(height), flat(3)]).filter(f => f.piece === 1 && f.normal[2] === 1 && Math.abs(f.light! + 0.55) < 0.001);
    const short = shadows(6), long = shadows(9);
    expect(shadows(3.25).length).toBeGreaterThan(0);
    expect(short.length).toBeGreaterThan(0); expect(long.length).toBeGreaterThan(0);
    expect(Math.max(...short.flatMap(f => f.points.map(p => p.x)))).toBeCloseTo(7.65, 2);
    expect(Math.max(...long.flatMap(f => f.points.map(p => p.x)))).toBeCloseTo(9.3, 2);
    for (const f of long) for (const p of f.points) {
      expect(p.x).toBeGreaterThanOrEqual(6); expect(p.x).toBeLessThanOrEqual(14);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(10); expect(p.z).toBe(3);
    }
    expect(long.some(f => inside({ x: 7.5, y: 1.5 }, f.points) && !(f.holes ?? []).some(h => inside({ x: 7.5, y: 1.5 }, h)))).toBe(false);
  });
  it('treats a subdivided horizontal roof as slabs without changing pitched roofs or tent caps', () => {
    const court = { ...rect(0, 0, 14, 14), holes: [rect(4, 4, 6, 6).outer] };
    expect(planRoof([court], [piece({ roof: 'ring', rise_m: 0 })]).every(f => f.flat)).toBe(true);
    for (const roof of ['gable', 'hip', 'tent'] as const) {
      const m = piece({ roof, ridges: [[0, 3, 6, 3]] });
      expect(planRoof([upper], [m])).toEqual(buildingRoof([upper], [m]));
    }
    const single = planRoof([upper], [flat(6)]);
    expect(single).toHaveLength(5);
    expect(single.find(f => f.normal[2] === 1)!.light).toBe(-0.05);
  });
});

/** Random convex trapezoid / slanted quad with a ridge along its long axis, strictly inside. */
function quad() {
  const w = 8 + rnd() * 10, d = 6 + rnd() * 6, sk = (rnd() - 0.5) * 6, tp = rnd() * 0.5 * d;
  const ring = [{ x: 0, y: 0 }, { x: w, y: sk * 0.3 }, { x: w - tp * 0.5 + sk, y: d }, { x: tp * 0.5, y: d }];
  const cx = ring.reduce((s, p) => s + p.x, 0) / 4, cy = ring.reduce((s, p) => s + p.y, 0) / 4;
  const l = Math.hypot(ring[1].x - ring[0].x, ring[1].y - ring[0].y), ux = (ring[1].x - ring[0].x) / l, uy = (ring[1].y - ring[0].y) / l, h = w * (0.1 + rnd() * 0.25);
  return { ring, ridge: [cx - ux * h, cy - uy * h, cx + ux * h, cy + uy * h] as [number, number, number, number] };
}

describe('pitched roof faces on irregular convex pieces', () => {
  it('never overlap in plan, tile the ring, and stay inside it', () => {
    for (let n = 0; n < 60; n++) {
      const { ring, ridge } = quad(), ccw = area(ring) > 0 ? ring : [...ring].reverse();
      const faces: RoofFace[] = pieceRoof({ outer: ccw, holes: [] }, piece({ roof: n % 2 ? 'hip' : 'gable', ridges: [ridge] }), 0);
      expect(faces.length).toBeGreaterThan(2);
      const plan = faces.map(f => f.points.map(p => ({ x: p.x, y: p.y })));
      for (const f of plan) for (const p of f) expect(inside(p, ccw) || ccw.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.05) || nearEdge(p, ccw)).toBe(true);
      expect(plan.reduce((s, f) => s + Math.abs(area(f)), 0)).toBeCloseTo(Math.abs(area(ccw)), 0);
      for (let k = 0; k < 80; k++) {
        const p = { x: rnd() * 22, y: rnd() * 12 };
        if (!inside(p, ccw)) continue;
        const hits = plan.filter(f => f.length > 2 && Math.abs(area(f)) > 1e-6 && inside(p, f)).length;
        expect(hits).toBeLessThanOrEqual(1);
      }
    }
  });
  it('a point ridge is a pyramid; nonsense ridges still give valid faces', () => {
    const ring = [{ x: 0, y: 0 }, { x: 8, y: 1 }, { x: 7, y: 7 }, { x: 1, y: 6 }];
    const f = loftRidges(ring, [[{ x: 4, y: 4 }, { x: 4, y: 4 }]], 3, 6)!;
    expect(f).toHaveLength(4);
    const faces = pieceRoof({ outer: ring, holes: [] }, piece({ ridges: [[-30, -30, -20, 40]] }), 0);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) for (const p of face.points) expect(Number.isFinite(p.z)).toBe(true);
  });
});
const nearEdge = (p: P, ring: P[]) => ring.some((a, i) => { const b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) < 0.05; });

describe('volumes, tent, materials', () => {
  const shape = { outer: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 }, { x: 0, y: 6 }], holes: [] };
  it('draws one face set per volume with its own heights and materials', () => {
    const m = piece({ ridges: [[0, 3, 12, 3]], tone: 0.2, volumes: [
      { ring: [[0, 0], [6, 0], [6, 6], [0, 6]], eave_m: 5, rise_m: 2, roof: 'gable', ridges: [[0, 3, 6, 3]], cover: 'thatch', tone: 0.9 },
      { ring: [[6, 0], [12, 0], [12, 6], [6, 6]], eave_m: 8, rise_m: 0, roof: 'flat', ridges: [], wall: 'stone' },
    ] });
    expect(pieceVolumes(shape, m)).toHaveLength(2);
    const faces = pieceRoof(shape, m, 3);
    const v0 = faces.filter(f => f.vol === 0), v1 = faces.filter(f => f.vol === 1);
    expect(v0.length).toBe(4); expect(v1.length).toBe(1);
    expect(v0[0].cover).toBe('thatch'); expect(v0[0].tone).toBeCloseTo(0.9);
    expect(v1[0].cover).toBe('tile'); expect(v1[0].wall).toBe('stone'); expect(v1[0].tone).toBeCloseTo(0.2);
    expect(Math.max(...v0.flatMap(f => f.points.map(p => p.z)))).toBeCloseTo(7);
    expect(pieceTop(m)).toBeCloseTo(8);
    expect(pieceShadows(shape, m)).toHaveLength(2);
    expect(faces.every(f => f.piece === 3)).toBe(true);
  });
  it('old data without volumes renders as one set; bad volumes are ignored', () => {
    const faces = pieceRoof(shape, piece({ ridges: [[0, 3, 12, 3]], volumes: [{ ring: [[0, 0]] } as never] }), 0);
    expect(faces.filter(f => f.vol === 0)).toHaveLength(faces.length);
    expect(faces.filter(f => f.normal[2] > 0.08)).toHaveLength(2);
  });
  it('a tent has sagging faces up to a crown', () => {
    const round = { outer: Array.from({ length: 8 }, (_, i) => ({ x: 4 * Math.cos(i * Math.PI / 4), y: 4 * Math.sin(i * Math.PI / 4) })), holes: [] };
    const faces = volumeRoof(pieceVolumes(round, piece({ roof: 'tent', rise_m: 2.5, ridges: [] }))[0], 0, 0);
    expect(faces.length).toBeGreaterThanOrEqual(8 * 3);
    const top = Math.max(...faces.flatMap(f => f.points.map(p => p.z)));
    expect(top).toBeCloseTo(8.5);
    // Concave: mid-course sits below the straight cone line (half way up the slope).
    const mid = faces.flatMap(f => f.points).filter(p => Math.hypot(p.x, p.y) > 2.1 && Math.hypot(p.x, p.y) < 2.3);
    expect(mid.length).toBeGreaterThan(0);
    for (const p of mid) expect(p.z - 6).toBeLessThan(2.5 * 0.5);
  });
});
