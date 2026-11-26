import { riverBank } from '../../../rust/bridge/hydrologyRender';
import type { WaterClimate } from '../render/waterRegime';
import { lakeSample } from './lakeGeometry';
import { channelWidth, type RiverLine } from './riverVectors';
import type { VectorWater } from './vectorWater';

export interface Junction {
  width: number;
  station: number;
}
export interface LakeMouth {
  k: number;
  distanceFromEnd: number;
  level: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
}
interface WaterConnections {
  downstream: Map<RiverLine, Junction>;
  incoming: Map<RiverLine, Junction[]>;
  lakes: Map<RiverLine, LakeMouth[]>;
}
const connectionMemo = new WeakMap<VectorWater, WaterConnections>();
export function waterConnections(water: VectorWater): WaterConnections {
  const cached = connectionMemo.get(water);
  if (cached) return cached;
  const links: WaterConnections = { downstream: new Map(), incoming: new Map(), lakes: new Map() };
  const net = water.rivers;
  if (net) {
    const byId = new Map(net.rivers.map(line => [line.id, line]));
    const scale = water.widthScale ?? net.widthScale ?? 1;
    const submerged = new Set(net.lakeLinks);
    for (const line of [...net.rivers, ...net.braids, ...net.distributaries, ...net.oxbows, ...submerged]) {
      const last = line.area.length - 1;
      if (last < 1) continue;
      const host = line.joins !== undefined && line.joins >= 0 ? byId.get(line.joins) : undefined;
      if (host && host !== line) {
        const x = line.points[2 * last],
          y = line.points[2 * last + 1];
        let best = Infinity,
          arc = 0;
        let junction: Junction | undefined;
        for (let k = 1; k < host.area.length; k++) {
          const ax = host.points[2 * k - 2],
            ay = host.points[2 * k - 1];
          const dx = host.points[2 * k] - ax,
            dy = host.points[2 * k + 1] - ay,
            len = Math.hypot(dx, dy);
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len || 1)));
          const d = (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2;
          if (d < best) {
            best = d;
            const a = host.area[k - 1] / (host.threads?.[k - 1] ?? 1),
              b = host.area[k] / (host.threads?.[k] ?? 1);
            junction = { station: arc + t * len, width: channelWidth(a + t * (b - a), scale) };
          }
          arc += len;
        }
        if (junction) {
          links.downstream.set(line, junction);
          const stations = links.incoming.get(host) ?? [];
          stations.push(junction);
          links.incoming.set(host, stations);
        }
      }
      if (!water.lakes || submerged.has(line)) continue;
      for (const k of [0, last]) {
        const x = line.points[2 * k],
          y = line.points[2 * k + 1];
        if (lakeSample(water.lakeField, water.hydro.width, x, y) < -0.002) continue;
        const dir = k ? -1 : 1;
        let shore = k;
        let distanceFromEnd = 0;
        while (shore + dir >= 0 && shore + dir <= last && lakeSample(water.lakeField, water.hydro.width, line.points[2 * (shore + dir)], line.points[2 * (shore + dir) + 1]) >= 0) {
          const next = shore + dir;
          distanceFromEnd += Math.hypot(line.points[2 * next] - line.points[2 * shore], line.points[2 * next + 1] - line.points[2 * shore + 1]);
          shore = next;
        }
        const outside = shore + dir;
        if (outside < 0 || outside > last) continue;
        const ax = line.points[2 * outside],
          ay = line.points[2 * outside + 1];
        const dx = line.points[2 * shore] - ax,
          dy = line.points[2 * shore + 1] - ay,
          len = Math.hypot(dx, dy);
        if (!len) continue;
        let lo = 0,
          hi = 1;
        for (let j = 0; j < 12; j++) {
          const t = (lo + hi) * 0.5;
          if (lakeSample(water.lakeField, water.hydro.width, ax + dx * t, ay + dy * t) > 0) hi = t;
          else lo = t;
        }
        const mx = ax + dx * hi,
          my = ay + dy * hi;
        // Extend the inlet across the exposed shore towards deeper lake water, even for a tangent approach.
        const probe = (water.hydro.width / water.hydro.n) * 0.2;
        const gx = lakeSample(water.lakeField, water.hydro.width, mx + probe, my) - lakeSample(water.lakeField, water.hydro.width, mx - probe, my);
        const gy = lakeSample(water.lakeField, water.hydro.width, mx, my + probe) - lakeSample(water.lakeField, water.hydro.width, mx, my - probe);
        const g = Math.hypot(gx, gy),
          inwardX = dx / len + (g ? (2 * gx) / g : 0),
          inwardY = dy / len + (g ? (2 * gy) / g : 0);
        const norm = Math.hypot(inwardX, inwardY);
        const mouths = links.lakes.get(line) ?? [];
        mouths.push({
          k,
          distanceFromEnd: distanceFromEnd + (1 - hi) * len,
          level: line.level[outside] + hi * (line.level[shore] - line.level[outside]),
          x: mx,
          y: my,
          dx: inwardX / norm,
          dy: inwardY / norm,
          width: channelWidth(line.area[shore] / (line.threads?.[shore] ?? 1), scale),
        });
        links.lakes.set(line, mouths);
      }
    }
    for (const stations of links.incoming.values()) stations.sort((a, b) => a.station - b.station);
  }
  connectionMemo.set(water, links);
  return links;
}

/** The lake fills the open end of a channel. Its inlet flares across the exposed shore into open water. */
export function lakeInlets(water: VectorWater, climate: WaterClimate): number[] {
  const inlets: number[] = [],
    ring = shoreRing(climate);
  if (ring <= 1 || !water.lakes) return inlets;
  for (const mouths of waterConnections(water).lakes.values())
    for (const m of mouths) {
      const reach = 2 * ring + m.width;
      inlets.push(m.x, m.y, m.x + m.dx * reach, m.y + m.dy * reach, m.width, m.width + 0.62 * reach, 1, 0, -2);
    }
  return inlets;
}
export function inletPaths(water: VectorWater, climate: WaterClimate): string {
  const inlets = lakeInlets(water, climate);
  let path = '';
  for (let i = 0; i < inlets.length; i += 9) {
    const [x, y, ex, ey, w0, w1] = inlets.slice(i, i + 6);
    path += riverBank(new Float32Array([x, y, w0, 0, ex, ey, w1, 0]), 0, 2);
  }
  return path;
}
/** Lake draw-down ring width (m): the shore the dry season exposes. */
export const shoreRing = (climate: WaterClimate | undefined): number => (climate ? 80 * climate.drop : 0);
