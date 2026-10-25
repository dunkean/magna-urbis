import { describe, expect, it } from 'vitest';
import { pieceRoof, pieceShadows, pieceTop, volumeRoof, pieceVolumes, loftRidges, type MassingPiece, type RoofFace } from '../src/render/cityMassing';

type P = { x: number; y: number };
const area = (r: P[]) => r.reduce((s, p, i) => { const n = r[(i + 1) % r.length]; return s + p.x * n.y - n.x * p.y; }, 0) / 2;
const inside = (p: P, ring: P[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const piece = (over: Partial<MassingPiece>): MassingPiece => ({ floors: 2, eave_m: 6, rise_m: 3, roof: 'gable', ridges: [], cover: 'tile', wall: 'brick', ...over });

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
