/**
 * The night lights of the towns in the map drape of a tilted night view: the pools of the street lamps and camp fires
 * and those of the lit doors, windows and courtyards of the houses, on the ground under the volumes, added over the dark
 * map once per baked tile. Placed as the top view places them (cityNight.ts nightLamps, nightHouseLights).
 *
 * Owns its program and its buffer; built and driven by townLayer.ts (link and upload from `work`, one instanced draw
 * per tile, one buffer per plan and buildings). A frame pays nothing: the drape tile it samples holds the light.
 */
import { InstanceRanges } from './instanceRanges';
import { cellsInRects, cellCandidates, CITY_EDIT_CELL, pageOf } from '../gl/pages';
import type { CityGlSetOptions } from '../gl/contract';
import { nightHouseLights, streetLamps, blockLamps, parcelLamps } from '../../cityNight';
import { hearthLit } from '../../cityNight';
import type { CityBuildings, CityScene } from '../model/contract';
import type { DrapeCanvas } from '../../world/contract';
import { finishProgram, programLinked, startProgram, type PendingProgram, type Program } from '../gl/programs';

// One instance (x, y, reach m, strength) per lamp. A reach under uFloor is widened to it, the light of the lamp spread
// over the wider disc, so the far tiers keep a faint warm town instead of sparkling or burning out.
const LAMP_VS = `#version 300 es
layout(location = 0) in vec4 aLamp;
uniform vec4 uRect;
uniform float uFloor;
out vec2 vLocal;
flat out float vStrength;
void main() {
  float reach = max(aLamp.z, uFloor), spread = aLamp.z / reach;
  vLocal = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vStrength = aLamp.w * min(1.0, 1.6 * spread * spread);
  vec2 at = (aLamp.xy + vLocal * reach - uRect.xy) / (uRect.zw - uRect.xy);
  gl_Position = vec4(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.0, 1.0);
}`;
// The falloff of the top view's lamps. No alpha: the light adds to the ground under the drape.
const LAMP_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vStrength;
out vec4 outColor;
void main() {
  float light = vStrength * pow(max(0.0, 1.0 - length(vLocal)), 1.6);
  outColor = vec4(vec3(1.0, 0.66, 0.27) * light, 0.0);
}`;

export class NightLamps {
  private program: Program | undefined;
  private pending: PendingProgram | undefined;
  private lamps?: InstanceRanges;
  private revision?: number;
  private houseCells = new Set<number>();
  private records = { streets: new Map<object, boolean>(), blocks: new Map<object, boolean>(), parcels: new Map<object, boolean>() };
  private source: CityScene | undefined;
  private houses: readonly CityBuildings[] | undefined;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  /** The lights of this plan and these towns' buildings are ready to draw. */
  ready(plan: CityScene | undefined, houses: readonly CityBuildings[]): boolean {
    return !!plan && this.source === plan && this.houses === houses;
  }
  /** One step of the link and the upload for a plan and its towns' buildings; true once their lights are ready. */
  step(plan: CityScene, houses: readonly CityBuildings[], parallel: boolean, options?: CityGlSetOptions): boolean {
    const gl = this.gl;
    if (!this.program) {
      this.pending ??= startProgram(gl, LAMP_VS, LAMP_FS);
      if (!programLinked(gl, this.pending, parallel)) return false;
      this.program = finishProgram(gl, this.pending);
      this.pending = undefined;
    }
    const lamps = (this.lamps ??= new InstanceRanges(gl, 4));
    const camp = (p: CityScene, i: number) => hearthLit(p.layouts[i]?.culture);
    const before = this.source;
    const sameCulture = before && before.layouts.length === plan.layouts.length && plan.layouts.every((_, i) => camp(plan, i) === camp(before, i));
    const visit = <T extends { layout: number }>(column: keyof typeof this.records, list: readonly T[], emit: (v: T, camp: boolean, out: number[]) => void) => {
      if (sameCulture && Object.is(before[column], list)) return;
      const prior = this.records[column],
        kept = new Map<object, boolean>();
      for (const v of list) {
        const mode = camp(plan, v.layout);
        kept.set(v, mode);
        if (prior.get(v) === mode) continue;
        const data: number[] = [];
        emit(v, mode, data);
        lamps.replace(v, data);
      }
      for (const v of prior.keys()) if (!kept.has(v)) lamps.replace(v, []);
      this.records[column] = kept;
    };
    visit('streets', plan.streets, streetLamps);
    visit('blocks', plan.blocks, blockLamps);
    visit('parcels', plan.parcels, parcelLamps);
    if (this.houses !== houses) {
      const edit = options?.edit,
        dirty = edit && this.revision === edit.previous ? cellsInRects(edit.rects) : undefined;
      const groups = new Map<number, number[]>();
      for (const town of houses)
        for (const i of cellCandidates(town.bins, town.items.length, dirty, CITY_EDIT_CELL)) {
          const b = town.items[i].building,
            key = pageOf(b.footprint, CITY_EDIT_CELL);
          if (dirty && !dirty.has(key)) continue;
          let data = groups.get(key);
          if (!data) groups.set(key, (data = []));
          nightHouseLights(b, (x, y, reach, strength) => data.push(x, y, reach, strength));
        }
      for (const k of dirty ?? this.houseCells)
        if (!groups.has(k)) {
          lamps.replace(String(k), []);
          this.houseCells.delete(k);
        }
      for (const [k, data] of groups) {
        lamps.replace(String(k), data);
        this.houseCells.add(k);
      }
    }
    lamps.flush();
    this.source = plan;
    this.houses = houses;
    this.revision = options?.revision;
    return true;
  }
  /** The light of the lamps over a drape tile. */
  paint(tile: DrapeCanvas): void {
    const gl = this.gl,
      d = this.program,
      lamps = this.lamps;
    if (!d || !lamps?.count || !tile.group()) return;
    gl.useProgram(d.program);
    gl.uniform4f(d.u.uRect, tile.rect.minX, tile.rect.minY, tile.rect.maxX, tile.rect.maxY);
    gl.uniform1f(d.u.uFloor, 5 / tile.scale);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(lamps.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lamps.count);
    gl.bindVertexArray(null);
    tile.putGroup(1);
  }
  private deleteLamps(): void {
    this.lamps?.dispose();
    this.lamps = this.source = this.houses = undefined;
  }
  /** Forgets everything; `deleteHandles` false when the context is lost (the handles are dead). */
  drop(deleteHandles: boolean): void {
    if (deleteHandles) {
      this.deleteLamps();
      for (const p of [this.program, this.pending]) if (p) this.gl.deleteProgram(p.program);
    }
    for (const map of Object.values(this.records)) map.clear();
    this.houseCells.clear();
    this.revision = undefined;
    this.lamps = this.source = this.houses = this.program = this.pending = undefined;
  }
}
