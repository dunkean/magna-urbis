/**
 * Fortification curtains, towers, gatehouses, works and moats. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads enclosures and terrain/water inputs; owns a per-call sampled-height cache and local display meshes.
 */
import type { BoundaryLine } from '../craftedBoundaries';
import { moatBridges, moatFaces } from '../city3dMoat';
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { MaterialPattern, MaterialSlots, Point } from '../../../../rust/bridge/housesContract';
import type { Enclosure } from '../../../../rust/bridge/urban';
import { buildingTint } from '../buildingPalette';
import { City3dHeight } from './types';
import { tinted, hex6, mat, roofMat } from './materials';
import { Curtain, WALL_CHUNK, WallMesh, wallPiece, WallShape, centroid } from './wallGeometry';

const WALL_PATTERN: Record<string, MaterialPattern> = { timber: 'wood', 'timber-earth': 'wood', thorn: 'thatch', stone: 'stone', brick: 'earth', 'rammed-earth': 'earth', 'earth-stone': 'stone' };

const ROUND_ROOFED = new Set(['curtain', 'flanked', 'concentric']);

/** Curtains, towers, gatehouses, bastions, outworks and lean-tos of every
 * enclosure. Stone curtains carry a wall walk and merlons; palisades are a
 * timber line (on an earth bank for `gord`); thorn enclosures follow the same gate cuts. */
export function city3dWalls(enclosures: readonly Enclosure[], heightAt?: City3dHeight, key = 'w', culture = '', waterColor?: string): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  // The ground under a point is read once per call: the water sheet of a moat and the prisms of a curtain ask for the
  // same corners again and again (each triangle its three, each piece its neighbour's).
  const seated = new Map<number, Map<number, number>>();
  const g = (p: Point): number => {
    if (!heightAt) return 0;
    let row = seated.get(p.y);
    if (!row) seated.set(p.y, (row = new Map()));
    let h = row.get(p.x);
    if (h === undefined) row.set(p.x, (h = heightAt(p.x, p.y) || 0));
    return h;
  };
  const push = (b: PlacedBuilding | undefined, lines?: BoundaryLine[]): void => {
    if (!b) return;
    const paint = (id: string): string => {
      const m = /^city3d:(wall|cover):(.+)$/.exec(id);
      if (!m || !culture || m[2].includes('@')) return id;
      const p = buildingTint(culture, m[2], m[2], 0.5, m[2] === 'stone' || m[2] === 'earth' ? 'defence' : 'dwelling');
      return tinted(id, hex6(m[1] === 'cover' ? p.roof : p.wall));
    };
    out.push({
      ...b,
      ...(lines?.length ? { boundary: { replace: lines.every(l => l.kind === 'thorn'), lines: lines.map(l => ({ ...l, side: paint(l.side), cap: paint(l.cap) })) } } : {}),
      culture: { ...b.culture, culture },
      volumes: b.volumes.map(v => ({ ...v, materials: Object.fromEntries(Object.entries(v.materials).map(([k, id]) => [k, paint(id)])) as unknown as MaterialSlots, roof_mesh: { ...v.roof_mesh, faces: v.roof_mesh.faces.map(f => ({ ...f, material: paint(f.material) })) } })),
    });
  };
  enclosures.forEach((e, ei) => {
    if (e.path.length < 3) return;
    const hedge = e.kind === 'hedge';
    const id = `city3d-wall:${key}:${ei}`,
      curtain = new Curtain(e.path),
      L = curtain.length;
    if (L < (hedge ? 3 : 20)) return;
    const wall = e.kind === 'wall',
      style = e.style || (wall ? 'flanked' : 'palisade');
    const h = hedge ? (e.curtain_width_m || 1.8) / 2 : wall ? 1.5 : 0.75,
      c = e.curtain_width_m || (wall ? 3 : 1.5),
      H = e.height_m || (hedge ? 1.8 : wall ? 9 : 3.5);
    const pattern = WALL_PATTERN[e.material ?? ''] ?? (wall ? 'stone' : 'wood'),
      side = mat(pattern);
    const top = mat(e.material === 'earth-stone' ? 'earth' : pattern),
      wood = mat('wood'),
      earth = mat('earth');
    const crest = (rings: WallShape[], height: number, ground: (p: Point) => number, material = side, kind: BoundaryLine['kind'] = 'parapet'): BoundaryLine[] =>
      rings
        .flatMap(shape => [shape.outer, ...shape.holes])
        .filter(r => r.length >= 3)
        .map(r => ({ points: [...r, r[0]].map(p => ({ ...p, g: ground(p) })), closed: true, kind, height, half: 0.15, side: material, cap: top }));
    // Openings: land gates over their passage width, water gates over the river arc.
    const gatehouses = e.gatehouses ?? [],
      cuts: [number, number][] = [];
    for (const gh of gatehouses)
      if (gh.kind === 'water' || gh.kind === 'shore') {
        let a = curtain.project(gh.passage[0]),
          b = curtain.project(gh.passage[1]);
        if (gh.kind !== 'shore' && (((b - a) % L) + L) % L > L / 2) [a, b] = [b, a];
        cuts.push([a, a + ((((b - a) % L) + L) % L)]);
      }
    e.gates.forEach((q, gi) => {
      if (gatehouses.some(gh => ['water', 'shore'].includes(gh.kind) && gh.passage.some(p => Math.hypot(p.x - q.x, p.y - q.y) < 2))) return;
      const gh = gatehouses.find(x => x.gate === gi && x.kind !== 'water' && x.kind !== 'shore'),
        s = curtain.project(q);
      // An oblique street crosses the curtain over passage / sin(angle) of its length.
      let sin = 1;
      if (gh) {
        const dx = gh.passage[1].x - gh.passage[0].x,
          dy = gh.passage[1].y - gh.passage[0].y,
          l = Math.hypot(dx, dy) || 1,
          o = curtain.at(s).o;
        sin = Math.max(0.5, Math.abs(dx * o.x + dy * o.y) / l);
      }
      const w = (gh?.passage_width_m ?? 5) / 2 / sin + 0.3;
      cuts.push([s - w, s + w]);
    });
    const norm = cuts
      .flatMap(([a, b]): [number, number][] => {
        const k = Math.floor(a / L) * L;
        a -= k;
        b -= k;
        return b > L
          ? [
              [a, L],
              [0, b - L],
            ]
          : [[a, b]];
      })
      .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const cut of norm) {
      const last = merged[merged.length - 1];
      if (last && cut[0] <= last[1]) last[1] = Math.max(last[1], cut[1]);
      else merged.push([cut[0], cut[1]]);
    }
    const runs: [number, number][] = [];
    if (!merged.length) runs.push([0, L]);
    else
      for (let i = 0; i < merged.length; i++) {
        const s0 = merged[i][1],
          s1 = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + L;
        if (s1 - s0 > 0.5) runs.push([s0, s1]);
      }
    // Curtain: wall walk at ground + height, merlons on the outer edge.
    const crenel = wall && style !== 'bastioned';
    let piece = 0;
    for (const [r0, r1] of runs) {
      const k = Math.max(1, Math.ceil((r1 - r0) / WALL_CHUNK));
      for (let j = 0; j < k; j++) {
        const s0 = r0 + ((r1 - r0) * j) / k,
          s1 = r0 + ((r1 - r0) * (j + 1)) / k,
          mesh = new WallMesh();
        const at = style === 'gord' ? c - h - 0.7 : -0.2;
        const stations = curtain.stations(s0, s1, 6);
        const offset = hedge || wall ? c / 2 - h : at + 0.2;
        const points = stations.map(({ p, o }) => {
          const q = { x: p.x + o.x * offset, y: p.y + o.y * offset };
          return { ...q, g: g(q), mx: o.x, my: o.y };
        });
        const line: BoundaryLine = {
          points,
          kind: hedge ? (culture === 'kraal' || e.material === 'thorn' ? 'thorn' : 'hedge') : wall ? (/earth|bastion/.test((e.material ?? '') + ' ' + style) ? 'bank' : 'curtain') : 'palisade',
          height: H,
          half: hedge || wall ? c / 2 : 0.2,
          side: wall ? side : wood,
          cap: top,
        };
        if (hedge) {
          const brush = culture === 'kraal' || e.material === 'thorn';
          line.side = brush ? 'city3d:detail:thorn-base@776c50' : 'city3d:yard:hedge@547447';
          line.cap = brush ? 'city3d:detail:dry-brush@92835d' : 'city3d:yard:hedge@758750';
          mesh.prism(
            curtain.strip(s0, s1, -h, c - h),
            p => g(p) - 0.22,
            p => g(p) + H * 0.52,
            line.side,
            line.side,
          );
          // A laid hedge tapers towards an uneven crown. Sample absolute coordinates
          // for repeatable joins between chunks, and close the exposed ends at gates.
          const cross = curtain.stations(s0, s1, 2.4).map(({ p, o }) => {
            const twist = Math.sin(p.x * 0.67 + p.y * 0.41),
              lift = Math.cos(p.y * 0.69 - p.x * 0.37);
            const at = (fraction: number, z: number) => {
              const q = { x: p.x + o.x * (offset + c * fraction), y: p.y + o.y * (offset + c * fraction) };
              return { ...q, z: g(q) + H * z };
            };
            return [at(-0.5, 0.5), at(-0.28 + 0.025 * twist, 0.76), at(0.08 * twist, 0.94 + 0.07 * lift), at(0.27 + 0.025 * twist, 0.77), at(0.5, 0.5)];
          });
          for (let i = 1; i < cross.length; i++) for (let r = 0; r < 4; r++) mesh.add([cross[i - 1][r], cross[i][r], cross[i][r + 1], cross[i - 1][r + 1]], r === 1 || r === 2 ? line.cap : line.side);
          mesh.add([...cross[0]].reverse(), line.side);
          mesh.add(cross[cross.length - 1], line.side);
        } else if (wall) {
          mesh.prism(
            curtain.strip(s0, s1, -h, c - h),
            p => g(p) - 1,
            p => g(p) + H,
            side,
            top,
          );
          if (crenel)
            for (let s = s0 + 0.6; s + 1.2 < s1; s += 2.4)
              mesh.prism(
                curtain.strip(s, s + 1.2, c - h - 0.6, c - h, 2),
                p => g(p) + H - 0.05,
                p => g(p) + H + 1,
                side,
                side,
              );
        } else {
          let base = -0.5;
          if (style === 'gord') {
            mesh.prism(
              curtain.strip(s0, s1, -h, c - h),
              p => g(p) - 0.5,
              p => g(p) + 1.5,
              earth,
              earth,
            );
            base = 1.3;
          }
          mesh.prism(
            curtain.strip(s0, s1, at, at + 0.4),
            p => g(p) + base,
            p => g(p) + H,
            wood,
            wood,
          );
        }
        push(wallPiece(`${id}:curtain:${piece++}`, `${style}:curtain`, mesh, hedge ? 'thatch' : wall ? pattern : 'wood'), [line]);
      }
    }
    // Towers: a flat platform; a cone on the corner and gate towers of the European round styles.
    (e.towers_detail ?? []).forEach((t, ti) => {
      const ring = t.footprint?.outer;
      if (!ring || ring.length < 3) return;
      const mesh = new WallMesh(),
        z = g(t.center) + (t.height_m || H + 3),
        low = Math.min(...ring.map(g)) - 1;
      mesh.prism(
        { outer: ring, holes: [] },
        () => low,
        () => z,
        wall ? side : wood,
        wall ? top : wood,
      );
      if (t.shape === 'round' && wall && ROUND_ROOFED.has(style) && t.kind !== 'flank') mesh.cone(ring, z, 1.4 * t.radius_m, roofMat('tile'));
      else if (!wall) mesh.pitched({ outer: ring, holes: [] }, z, 1.6, wood);
      push(
        wallPiece(`${id}:tower:${ti}`, `${style}:tower:${t.shape}`, mesh, wall ? pattern : 'wood'),
        crest([t.footprint], t.height_m || H + 3, () => z - (t.height_m || H + 3), wall ? side : wood, wall && !(t.shape === 'round' && ROUND_ROOFED.has(style) && t.kind !== 'flank') && style !== 'bastioned' ? 'battlement' : 'parapet'),
      );
    });
    // Gatehouses: masses either side, a lintel block over the passage; water gates span the river on piers.
    gatehouses.forEach((gh, gi) => {
      if (gh.kind === 'shore') return;
      const mesh = new WallMesh(),
        material = gh.kind === 'timber' ? wood : side;
      if (gh.kind === 'water') {
        const [a, b] = gh.passage,
          ground = Math.max(g(a), g(b)),
          zTop = ground + (gh.height_m || H);
        for (const m of gh.masses ?? [])
          mesh.prism(
            m,
            p => g(p) - 1,
            () => zTop,
            material,
            top,
          );
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len >= 0.5) {
          const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
            o = curtain.at(curtain.project({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).o;
          const n = o.x * -u.y + o.y * u.x >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x }; // outward side of the span
          const rect = (t0: number, t1: number, d0: number, d1: number): WallShape => ({
            outer: [
              [t0, d0],
              [t1, d0],
              [t1, d1],
              [t0, d1],
            ].map(([t, d]) => ({ x: a.x + u.x * t + n.x * d, y: a.y + u.y * t + n.y * d })),
            holes: [],
          });
          const deck = ground + Math.min(4, Math.max(2.5, (gh.height_m || H) - 3));
          mesh.prism(
            rect(0, len, -h, c - h),
            () => deck,
            () => zTop,
            side,
            top,
            true,
          );
          for (let t = 8; t < len - 3; t += 8) {
            const bed = g({ x: a.x + u.x * t, y: a.y + u.y * t });
            if (deck - bed > 1)
              mesh.prism(
                rect(t - 0.9, t + 0.9, -h + 0.2, c - h - 0.2),
                () => bed - 1,
                () => deck,
                side,
                undefined,
              );
          }
        }
        push(
          wallPiece(`${id}:gate:${gi}`, `${style}:gate:water`, mesh, pattern),
          crest(gh.masses ?? [], zTop - ground, () => ground, material, 'gatehead'),
        );
        return;
      }
      const q = e.gates[gh.gate] ?? gh.passage[0],
        ground = g(q),
        zTop = ground + (gh.height_m || H + 2);
      // Only the masses stand on the ground: the passage between them stays open.
      if (!gh.masses?.length) return;
      for (const m of gh.masses)
        mesh.prism(
          m,
          p => g(p) - 1,
          () => zTop,
          material,
          top,
        );
      const clear = Math.min(5.5, Math.max(3, zTop - ground - 2));
      if (gh.shape?.outer?.length >= 3) {
        mesh.prism(
          gh.shape,
          () => ground + clear,
          () => zTop,
          material,
          top,
          true,
        );
        if (gh.kind === 'timber') mesh.pitched(gh.shape, zTop, 2, wood);
        else if (style === 'wengcheng') mesh.pitched(gh.shape, zTop, 3.5, roofMat('tile'));
      }
      push(
        wallPiece(`${id}:gate:${gi}`, `${style}:gate:${gh.kind}`, mesh, gh.kind === 'timber' ? 'wood' : pattern),
        crest(gh.masses ?? [], zTop - ground, () => ground, material, 'gatehead'),
      );
    });
    // Bastions and outworks (the glacis stays on the plan), draped like the curtain.
    const works = [...(e.bastions ?? []).map(w => ({ ...w, kind: 'bastion' })), ...(e.outworks ?? []).filter(w => w.kind !== 'glacis')];
    works.forEach((w, wi) => {
      if (!w.shape?.outer || w.shape.outer.length < 3) return;
      const mesh = new WallMesh(),
        height = w.height_m || 0.8 * H;
      mesh.prism(
        w.shape,
        p => g(p) - 1,
        p => g(p) + height,
        side,
        top,
      );
      push(wallPiece(`${id}:${w.kind}:${wi}`, `${style}:${w.kind}`, mesh, pattern), crest([w.shape], height, g));
    });
    // Moat: the terrain digs the ground (ui/urbanGroundCuts.ts); a wet moat's water lies in it, see city3dMoat.ts.
    (e.ditch ?? []).forEach((d, di) => {
      if (!d.shape?.outer || d.shape.outer.length < 3) return;
      const mesh = new WallMesh();
      moatFaces(d, g, (pts, material) => mesh.add(pts, material), waterColor);
      if (mesh.empty) return;
      mesh.footprint.push({ outer: d.shape.outer, holes: [] });
      push(wallPiece(`${id}:ditch:${di}`, `${style}:ditch:${d.kind}`, mesh, 'earth'));
    });
    // Bridges over the dug moat at the land gates, standing on the undug ground.
    {
      const mesh = new WallMesh();
      if (moatBridges(gatehouses, e.ditch ?? [], g, (shape, zb, zt, s, cap, under) => mesh.prism(shape, zb, zt, s, cap, under), wall ? side : wood, wall ? top : wood)) push(wallPiece(`${id}:moat-bridge`, `${style}:moat-bridge`, mesh, wall ? pattern : 'wood'));
    }
    // Lean-tos against the outer face: low walls under a pitched roof.
    (e.attached ?? []).forEach((a, ai) => {
      if (!a.shape?.outer || a.shape.outer.length < 3) return;
      const mesh = new WallMesh(),
        eave = g(centroid(a.shape.outer)) + Math.max(2.4, (a.height_m || 5) - 1.6);
      mesh.prism(
        a.shape,
        p => g(p) - 0.5,
        () => eave,
        mat('plain'),
        undefined,
      );
      mesh.pitched(a.shape, eave, 1.6, roofMat('tile'));
      push(wallPiece(`${id}:lean-to:${ai}`, `${style}:lean-to`, mesh, 'plain'));
    });
  });
  return out;
}
