import { onCoreWasmReset } from '../../../../rust/bridge/wasmRuntime';
/** Render cache ownership stays in TS; all landscape geometry runs in the shared Rust core. */
import type { World, UrbanLayer, PolyH, Polygon, TerrainLayer } from '../types';
import type { MacroQuarter } from '../urban/mega/types';
import { orientPos } from '../geo/poly';
import { protectedGround, waterGround, layerGround, dryGround, urbanLandscapeGround, landscapeCoverGround } from '../../../../rust/bridge/landuseNative';
export { protectedGround, waterGround, urbanLandscapeGround, landscapeCoverGround };
const piece = (outer: Polygon): PolyH => ({ outer: orientPos(outer), holes: [] });
export function currentLandscapeGround(world: World, appearance = false): PolyH[] {
  return world.landuse?.landscapeGround === undefined ? [] : urbanLandscapeGround(world, appearance);
}

let moduleVersion = 0;
onCoreWasmReset(() => { moduleVersion++; });
export class LandscapeGroundCache {
  private moduleVersion = -1;
  private terrain: TerrainLayer | undefined;
  private mapSize = 0;
  private terrainVersion = -1;
  private water: PolyH[] = [];
  private waterSafe = false;
  private layers = new WeakMap<UrbanLayer, { version: number; footprint?: Polygon; owner?: UrbanLayer; openEdgeGround?: PolyH[]; ground: PolyH[] }>();
  private quarters = new WeakMap<MacroQuarter, { owner: UrbanLayer; version: number; ground: PolyH[] }>();
  private protections = new WeakMap<UrbanLayer, { version: number; pieces: PolyH[] }>();
  private appearance: World | undefined;
  private appearanceInputs: unknown[] = [];

  prepare(world: World, terrainVersion = 0, appearance = false): void {
    const inputs = appearance ? [world.options.biome, world.site?.fields?.dWater, world.site?.fields?.hab, world.landuse] : [];
    this.appearance = appearance ? world : undefined;
    if (this.moduleVersion === moduleVersion && this.terrain === world.terrain && this.mapSize === world.mapSize && this.terrainVersion === terrainVersion
      && inputs.length === this.appearanceInputs.length && inputs.every((v, i) => v === this.appearanceInputs[i])) return;
    this.moduleVersion = moduleVersion;
    this.appearanceInputs = inputs;
    this.terrain = world.terrain; this.mapSize = world.mapSize; this.terrainVersion = terrainVersion;
    const t = world.terrain;
    const rings = [...t.coastline, ...(t.islands ?? []), ...t.lakes, ...t.rivers.map((r) => r.path)];
    this.waterSafe = rings.every((ring) => ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
      && t.rivers.every((r) => r.width.length === r.path.length && r.width.every(Number.isFinite));
    this.water = [];
    try { if (this.waterSafe) this.water = waterGround(world); } catch { this.waterSafe = false; }
    // Terrain changes invalidate every dry-land permission, including cached macro pieces.
    this.layers = new WeakMap(); this.quarters = new WeakMap(); this.protections = new WeakMap();
  }

  private dry(source: PolyH[], protection: PolyH[]): PolyH[] {
    try { return this.waterSafe && source.length ? dryGround(source, protection, this.water) : []; } catch { return []; }
  }

  layer(u: UrbanLayer, version = 0, footprint?: Polygon, owner?: UrbanLayer): PolyH[] {
    const cached = this.layers.get(u);
    if (cached?.version === version && cached.footprint === footprint && cached.owner === owner
      && cached.openEdgeGround === u.openEdgeGround) return cached.ground;
    let ground: PolyH[] = [];
    try { ground = this.dry(layerGround(u, undefined, this.appearance, footprint, owner), []); } catch { /* Decorative permission fails closed. */ }
    this.layers.set(u, { version, footprint, owner, openEdgeGround: u.openEdgeGround, ground });
    return ground;
  }

  quarter(owner: UrbanLayer, q: MacroQuarter, version = 0): PolyH[] {
    const cached = this.quarters.get(q);
    if (cached?.owner === owner && cached.version === version) return cached.ground;
    let protectedLand = this.protections.get(owner);
    if (protectedLand?.version !== version) {
      let pieces: PolyH[] = [];
      try { pieces = protectedGround(owner, this.appearance); } catch { return []; }
      protectedLand = { version, pieces };
      this.protections.set(owner, protectedLand);
    }
    const source = !owner.renderHints?.stilts && q.kind === 'quarter' && q.district !== 'gardens' ? [piece(q.pts)] : [];
    const ground = this.dry(source, protectedLand.pieces);
    this.quarters.set(q, { owner, version, ground });
    return ground;
  }
}
