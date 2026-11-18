import type { CaveTunnel } from '../types';

/** Wire codes of the Rust carve (`underdark::TUNNEL_*`); 3 is the dug road tunnel. */
const KINDS: Record<number, CaveTunnel['kind']> = { 1: 'lava-tube', 2: 'river-passage', 3: 'dug' };

/** Natural Underdark tunnels from the flattened engine form `[kind, halfWidth, count, x0, y0, …]` (metres).
 *  Unknown kinds and truncated records are skipped. */
export function parseCaveTunnels(flat: ArrayLike<number> | undefined): CaveTunnel[] {
  const out: CaveTunnel[] = [];
  if (!flat) return out;
  for (let i = 0; i + 3 <= flat.length;) {
    const kind = KINDS[flat[i]],
      halfWidth = flat[i + 1],
      count = flat[i + 2];
    const end = i + 3 + 2 * count;
    if (!Number.isInteger(count) || count < 0 || end > flat.length) break;
    if (kind && count >= 2 && halfWidth > 0) {
      const path = Array.from({ length: count }, (_, j) => ({ x: flat[i + 3 + 2 * j], y: flat[i + 4 + 2 * j] }));
      out.push({ kind, path, halfWidth });
    }
    i = end;
  }
  return out;
}

/** Length of a tunnel's centre line in metres. */
export function caveTunnelLength(tunnel: CaveTunnel): number {
  let length = 0;
  for (let j = 1; j < tunnel.path.length; j++) length += Math.hypot(tunnel.path[j].x - tunnel.path[j - 1].x, tunnel.path[j].y - tunnel.path[j - 1].y);
  return length;
}
