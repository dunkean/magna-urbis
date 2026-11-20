import { describe, expect, it } from 'vitest';
import { parseCaveTunnels } from '../src/gen/terrain/caveTunnels';
import { tunnelStrokes, caveTunnelsSvg } from '../src/render/caveTunnels';
import { roleNoun, roleText } from '../src/gen/names/meanings';

describe('Underdark tunnels', () => {
  it('parses the engine wire form and skips unknown or truncated records', () => {
    const flat = Float32Array.from([1, 5, 2, 0, 0, 100, 0, 9, 4, 2, 0, 0, 1, 1, 2, 8, 3, 10, 10, 20, 20, 30, 30, 2, 4, 5]);
    const tunnels = parseCaveTunnels(flat);
    expect(tunnels.map(t => t.kind)).toEqual(['lava-tube', 'river-passage']);
    expect(tunnels[1].path).toHaveLength(3);
    expect(parseCaveTunnels(undefined)).toEqual([]);
  });
  it('draws every tunnel at its own width', () => {
    const tube = {
      kind: 'lava-tube' as const,
      halfWidth: 4,
      path: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
    };
    // A lava tube is the bare floor of its gut: nothing is drawn over it.
    expect(tunnelStrokes(tube)).toEqual([]);
    // A river passage keeps its ledge path, sized by the gut's half width whatever the terrain cell.
    expect(tunnelStrokes({ ...tube, kind: 'river-passage' as const })[0].width).toBeCloseTo(0.88, 5);
    const dug = {
      kind: 'dug' as const,
      halfWidth: 3,
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 200 },
      ],
    };
    expect(tunnelStrokes(dug).filter(s => s.d.length === 2 && s.d[0].y === s.d[1].y)).toHaveLength(2);
    // A dug tunnel is the road's bore, not a carved floor: it keeps the road's width.
    expect(tunnelStrokes(dug)[0].width).toBe(6);
    expect(caveTunnelsSvg([tube])).toContain('layer-cave-tunnels');
  });
  it('names each kind with its own generic word', () => {
    expect(roleNoun('terrain.tunnel.lava-tube')).toBe('lavaTube');
    expect(roleNoun('terrain.tunnel.river-passage')).toBe('riverPassage');
    expect(roleNoun('terrain.tunnel.dug')).toBe('tunnel');
    expect(roleText('terrain.tunnel.lava-tube', 'fr')).toBe('Tube de lave');
  });
});

describe('Underdark tunnel names', () => {
  it('names every tunnel along its passage', async () => {
    const { generate } = await import('../src/gen/pipeline');
    const { DEFAULTS } = await import('../src/gen/options');
    const { generateNames } = await import('../src/gen/names');
    const { Rng } = await import('../src/gen/core/rng');
    const world = generate({ ...DEFAULTS, seed: 'tunnel-names', size: 'hamlet', population: 120, settlements: 'none', coast: 'none', river: 'none', biome: 'underdark' });
    const { w, h, cell } = world.terrain.height;
    const mask = new Uint8Array(w * h);
    const y = Math.floor(h / 2),
      path = [
        { x: 0.2 * w * cell, y: (y + 0.5) * cell },
        { x: 0.8 * w * cell, y: (y + 0.5) * cell },
      ];
    world.terrain = {
      ...world.terrain,
      caverns: {
        floor: [],
        solid: [],
        mask,
        clearance: new Float32Array(w * h),
        chambers: [],
        tunnels: [
          { kind: 'lava-tube', path, halfWidth: 5 },
          { kind: 'dug', path: path.map(p => ({ x: p.x, y: p.y + 4 * cell })), halfWidth: 3 },
        ],
      },
    };
    const names = generateNames(world, new Rng('magna-urbis:tunnel-names'));
    const tunnels = names.entries.filter(e => String(e.parts?.role ?? '').startsWith('terrain.tunnel.'));
    expect(tunnels.map(e => e.parts?.role).sort()).toEqual(['terrain.tunnel.dug', 'terrain.tunnel.lava-tube']);
    expect(tunnels.every(e => (e.path?.length ?? 0) >= 2 && /Lava Tube|Tunnel/.test(e.text))).toBe(true);
  });
});

describe('Underdark tunnel portals', () => {
  it('paints one framed opening at each mouth of a dug tunnel only', async () => {
    const { drawTunnelPortals } = await import('../src/render/caveTunnels');
    let fills = 0,
      strokes = 0;
    const ctx = new Proxy(
      {},
      {
        get: (_, k) =>
          k === 'fill'
            ? () => {
                fills++;
              }
            : k === 'stroke'
              ? () => {
                  strokes++;
                }
              : () => undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const path = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    drawTunnelPortals(
      ctx,
      [
        { kind: 'dug', path, halfWidth: 3 },
        { kind: 'lava-tube', path, halfWidth: 5 },
      ],
      20,
      1,
    );
    expect(fills).toBe(2);
    expect(strokes).toBe(2);
  });
});
