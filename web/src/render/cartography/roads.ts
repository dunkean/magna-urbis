/**
 * Regional roads (drawVector, after the farmsteads): cased roads, tracks and earth ways, clipped to the land. The road
 * painters (casings, natural road looks, canopy runs) are part of the frame (roadPainters) because the field ways, the
 * farm drives, the urban natural ground and the placeholder lanes use them too.
 * Reads: palette, the road style of the host (read once per frame), the path cache, the canopy revision of the roads.
 */
import { groundRoadLook } from '../composition';
import { setMapInk } from '../gpu/recorder';
import { literalPalette } from './bandRecording';
import { type Palette, ruralInk } from '../styles';
import { regionalRoadSurface } from '../roadSurfaces';
import { BLEND_ROAD_ALPHA, BLEND_ROAD_PX } from '../groundBlend';
import { CANOPY_LEVELS, ROAD_CANOPY_REACH, canopyRuns, emphasisAlpha, hasRoadCanopy, lookRoadWidth, regionalRank, roadCanopyChanges, roadCanopyLineChanged, roadCanopyOpacity, roadCanopyRevision, strokeNaturalRoad, trackInk, type RoadStyle } from '../roadStyle';
import type { LineLayer } from '../scene';
import type { Rect4 } from '../view';
import { growRect, runPath } from './geometry';
import type { CartographyContext } from './context';
import type { FrameBase, RoadPainters, VectorFrame } from './frame';

/** Tracks choose the lighter road fill on dark ground. The choice is retained, its pigment is rebound. */
export function trackSlot(pal: Palette): 'ruralInk' | 'roadFill' {
  const p = literalPalette(pal),
    ink = ruralInk(p);
  return trackInk(ink, p.roadFill) === ink ? 'ruralInk' : 'roadFill';
}

export function materialBedSlot(c: CartographyContext, style: RoadStyle, track: boolean) {
  const color = style.colors?.[track ? 'track' : 'road'];
  if (!color) return;
  const slot = c.ink(track ? 'trackFill' : 'roadFill');
  return slot.css === color && slot.valid ? slot : undefined;
}

export const canopyBoxesMeet = (a: Rect4, b: Rect4): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** The path must cross the changed canopy, even when its bounding box is much larger. */
export function canopyLineMeets(line: readonly { x: number; y: number }[], box: Rect4): boolean {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      dx = b.x - a.x;
    if (Math.max(a.x, b.x) < box.minX || Math.min(a.x, b.x) > box.maxX) continue;
    const t0 = dx ? Math.max(0, Math.min((box.minX - a.x) / dx, (box.maxX - a.x) / dx)) : 0,
      t1 = dx ? Math.min(1, Math.max((box.minX - a.x) / dx, (box.maxX - a.x) / dx)) : 1;
    const y0 = a.y + (b.y - a.y) * t0,
      y1 = a.y + (b.y - a.y) * t1;
    if (Math.max(y0, y1) >= box.minY && Math.min(y0, y1) <= box.maxY) return true;
  }
  return false;
}

/** Only canopy-sensitive ways can change an overlay tile. Ground-painted roads use the ground's own revision. */
export function roadCanopyRegions(c: CartographyContext, since: number): readonly Rect4[] | undefined {
  const natural = groundRoadLook(c.deps.roadStyle?.().look ?? c.deps.roadLook ?? 'ink');
  if (natural && c.deps.regionalRoadsOnGround?.()) return [];
  const layers = c.scene.lines.filter(l => (l.role === 'road' && (l.kind === 'track' || (natural && l.pavement !== 'asphalt'))) || (natural && (l.role === 'drive' || l.name === 'field-ways')));
  if (!layers.length) return [];
  return roadCanopyChanges(since)?.flatMap(box => {
    let width = 0;
    for (const layer of layers) if (layer.index.query(box).some(i => canopyLineMeets(layer.lines[i], box) && roadCanopyLineChanged(layer.lines[i], since))) width = Math.max(width, layer.width);
    return width ? [growRect(box, ROAD_CANOPY_REACH + width)] : [];
  });
}

/** Regional stamps for split path groups. The ordinary path cache still owns the geometry. */
const canopyStamps = new WeakMap<CartographyContext, Map<string, { checked: number; stamp: number }>>();
function canopyPathStamp(c: CartographyContext, key: string, revision: number, bounds: () => Rect4): number {
  let entries = canopyStamps.get(c);
  if (!entries) canopyStamps.set(c, (entries = new Map()));
  let entry = entries.get(key);
  if (!entry) {
    if (entries.size >= 8000) entries.delete(entries.keys().next().value!);
    entries.set(key, (entry = { checked: revision, stamp: revision }));
  } else if (entry.checked !== revision) {
    const changes = roadCanopyChanges(entry.checked);
    const box = changes?.length ? bounds() : undefined;
    if (!changes || (box && changes.some(r => canopyBoxesMeet(r, box)))) entry.stamp = revision;
    entry.checked = revision;
  }
  return entry.stamp;
}

export function paintRegionalRoads(c: CartographyContext, f: VectorFrame): void {
  const { ctx, land, roads, tracks, drawRegionalRoads } = f;
  // roads, tracks and the street strokes below never spill over the sea or the lakes (bridges come later)
  ctx.save();
  if (land) ctx.clip(land, 'evenodd');
  drawRegionalRoads(roads, tracks);
  ctx.restore();
}

export function roadPainters(c: CartographyContext, f: FrameBase): RoadPainters {
  const { pal, deps, cached, P } = c;
  const { ctx, sc, lod, rect, band, minEdge, px, lw, linePaths, strokeLines } = f;
  const edge = Math.max(0.5, 0.9 / sc);
  /** Casing + fill for a group of road-like layers (all casings first so junctions merge). */
  const roadGroup = (ls: LineLayer[], fillMinPx: (l: LineLayer) => number, edgeK: (l: LineLayer) => number = () => 1): void => {
    if (!ls.length) return;
    strokeLines(ls, c.ink('roadEdge'), l => lw(l.width, fillMinPx(l)) + 2 * edge * edgeK(l));
    strokeLines(ls, c.ink('roadFill'), l => lw(l.width, fillMinPx(l)));
  };

  const requested: RoadStyle = deps.roadStyle?.() ?? { look: deps.roadLook ?? 'ink', emphasis: 1, night: false, colors: deps.colors };
  const roadStyle: RoadStyle = c.activeLight ? { ...requested, look: requested.look === 'rendered' ? 'rendered' : 'ink', simple: true } : requested;
  const natural = groundRoadLook(roadStyle.look),
    inkAlpha = emphasisAlpha(roadStyle.emphasis);
  /** All the visible pieces of some layers as one path: a translucent stroke never doubles at chunk ends. */
  const merged = (ls: LineLayer[]): Path2D => {
    const out = new P();
    for (const l of ls) for (const p of linePaths(l)) out.addPath(p);
    return out;
  };
  /** The same pieces split by the canopy over them (roadStyle.ts canopyRuns), one path per level, cached per tile and
   * canopy revision: an earth way reads as a fainter continuous trace under closed woods. */
  const canopyMerged = (ls: LineLayer[]): (Path2D | undefined)[] => {
    const revision = roadCanopyRevision(),
      out: (Path2D | undefined)[] = [];
    if (!hasRoadCanopy()) {
      out[0] = merged(ls);
      return out;
    }
    const runsOf = new Map<string, ReturnType<typeof canopyRuns>[]>();
    const add = (l: LineLayer, key: string, ids: ArrayLike<number>, bounds: () => Rect4): void => {
      const stamp = canopyPathStamp(c, key, revision, bounds);
      for (let k = 0; k < CANOPY_LEVELS; k++) {
        const p = cached(`${key}|c${stamp}|${k}`, () => {
          let runs = runsOf.get(key);
          if (!runs) runsOf.set(key, (runs = Array.from(ids, i => canopyRuns(l.lines[i]))));
          return runPath(P, runs, k, minEdge);
        });
        if (p) (out[k] ??= new P()).addPath(p);
      }
    };
    for (const l of ls) {
      for (const t of l.index.tilesInRect(rect)) add(l, `${l.name}|${band}|t${t}|${l.tileKeys?.[t] ?? ''}`, l.index.itemsOf(t), () => growRect(l.index.tileRect(t), l.index.tileSize / 2));
      for (const i of l.index.bigInRect(rect))
        add(l, `${l.name}|${band}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`, [i], () => {
          const b = l.index.boxes,
            j = i * 4;
          return { minX: b[j], minY: b[j + 1], maxX: b[j + 2], maxY: b[j + 3] };
        });
    }
    return out;
  };
  const strokeEarthRoads = (ls: LineLayer[], rank: Parameters<typeof strokeNaturalRoad>[2], metres: number): void => {
    if (deps.regionalRoadsOnGround?.()) return;
    const width = lookRoadWidth(roadStyle.look, rank, metres, sc);
    canopyMerged(ls).forEach((p, k) => {
      if (p) strokeNaturalRoad(ctx, p, rank, width, sc, roadStyle, k / (CANOPY_LEVELS - 1), metres, materialBedSlot(c, roadStyle, rank === 'track' || rank === 'path'));
    });
  };
  const drawRegionalRoads = (roads: LineLayer[], tracks: LineLayer[]): void => {
    if (deps.regionalRoadsOnGround?.()) return;
    if (natural) {
      // Each retained width has its own layer, as on the 3D road surface.
      for (const l of tracks) {
        const rank = l.width < 2 ? 'path' : 'track';
        strokeEarthRoads([l], rank, l.width);
      }
      // Earth and gravel first, then the paved lengths of the same rank (roadPavement.ts).
      for (const kind of ['minor', 'major'] as const)
        for (const pavement of ['earth', 'asphalt'] as const) {
          const ls = roads.filter(l => l.kind === kind && (l.pavement ?? 'earth') === pavement);
          if (!ls.length) continue;
          for (const l of ls) {
            if (pavement === 'earth') strokeEarthRoads([l], regionalRank(kind), l.width);
            else strokeNaturalRoad(ctx, merged([l]), regionalRank(kind), lookRoadWidth(roadStyle.look, regionalRank(kind), l.width, sc), sc, { ...roadStyle, pavement }, 0, l.width, materialBedSlot(c, roadStyle, false));
          }
        }
      return;
    }
    // Drawn maps keep their inks: a paved trunk road is a firmer cased road with a centre line, once wide enough to hold it.
    const pavedCentre = (width: (l: LineLayer) => number): void => {
      const ls = roads.filter(l => l.pavement === 'asphalt' && l.kind === 'major' && width(l) * sc >= 4.5);
      if (ls.length) strokeLines(ls, c.ink('roadEdge'), () => px(0.8), Math.min(1, 0.7 * inkAlpha));
    };
    if (roadStyle.look === 'wash') {
      // Pale translucent bands with a faint edge, as the bench draws them (terrainRoads.ts).
      for (const kind of ['minor', 'major'] as const) {
        const ls = roads.filter(l => l.kind === kind),
          rank = kind === 'major' ? 'highway' : 'local',
          width = (l: LineLayer): number => Math.max(px(BLEND_ROAD_PX[rank]), l.width);
        strokeLines(ls, c.ink('roadEdge'), l => width(l) + px(1.6), BLEND_ROAD_ALPHA[rank] * 0.22 * inkAlpha);
        strokeLines(ls, c.ink('roadFill'), width, Math.min(1, BLEND_ROAD_ALPHA[rank] * inkAlpha));
        if (kind === 'major') pavedCentre(width);
      }
      strokeCoveredTracks(tracks);
      return;
    }
    const surface = (l: LineLayer) => regionalRoadSurface(l.kind === 'major' ? 'major' : 'minor', sc, l.width);
    strokeLines(
      roads,
      c.ink('roadEdge'),
      l => {
        const r = surface(l);
        return r.fill + (r.casing - r.fill) * Math.max(1, roadStyle.emphasis) * (l.pavement === 'asphalt' ? 1.5 : 1);
      },
      Math.min(1, inkAlpha),
    );
    strokeLines(roads, c.ink('roadFill'), l => surface(l).fill);
    pavedCentre(l => surface(l).fill);
    strokeCoveredTracks(tracks);
  };
  const strokeCoveredTracks = (tracks: LineLayer[]): void => {
    if (!tracks.length) return;
    canopyMerged(tracks).forEach((path, level) => {
      if (!path) return;
      setMapInk(ctx, 'strokeStyle', c.ink(trackSlot(pal)));
      ctx.lineWidth = Math.min(lw(1.1, 0.75), px(1.8));
      ctx.globalAlpha = Math.min(1, 0.8 * pal.rural.track * inkAlpha) * roadCanopyOpacity('track', level / (CANOPY_LEVELS - 1));
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    });
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
  };
  return { edge, roadGroup, roadStyle, natural, inkAlpha, merged, canopyMerged, strokeEarthRoads, drawRegionalRoads, strokeCoveredTracks };
}
