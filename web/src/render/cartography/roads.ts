/**
 * Regional roads (drawVector, after the farmsteads): cased roads, tracks and earth ways, clipped to the land. The road
 * painters (casings, natural road looks, canopy runs) are part of the frame (roadPainters) because the field ways, the
 * farm drives, the urban natural ground and the placeholder lanes use them too.
 * Reads: palette, the road style of the host (read once per frame), the path cache, the canopy revision of the roads.
 */
import { groundRoadLook } from '../composition';
import { ruralInk } from '../styles';
import { regionalRoadSurface } from '../roadSurfaces';
import { BLEND_ROAD_ALPHA, BLEND_ROAD_PX } from '../groundBlend';
import { CANOPY_LEVELS, canopyRuns, emphasisAlpha, lookRoadWidth, regionalRank, roadCanopyOpacity, roadCanopyRevision, strokeNaturalRoad, trackInk, type RoadStyle } from '../roadStyle';
import type { LineLayer } from '../scene';
import { runPath } from './geometry';
import type { CartographyContext } from './context';
import type { FrameBase, RoadPainters, VectorFrame } from './frame';

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
    strokeLines(ls, pal.roadEdge, l => lw(l.width, fillMinPx(l)) + 2 * edge * edgeK(l));
    strokeLines(ls, pal.roadFill, l => lw(l.width, fillMinPx(l)));
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
    if (!revision) {
      out[0] = merged(ls);
      return out;
    }
    const runsOf = new Map<string, ReturnType<typeof canopyRuns>[]>();
    const add = (l: LineLayer, key: string, ids: ArrayLike<number>): void => {
      for (let k = 0; k < CANOPY_LEVELS; k++) {
        const p = cached(`${key}|c${revision}|${k}`, () => {
          let runs = runsOf.get(key);
          if (!runs) runsOf.set(key, (runs = Array.from(ids, i => canopyRuns(l.lines[i]))));
          return runPath(P, runs, k, minEdge);
        });
        if (p) (out[k] ??= new P()).addPath(p);
      }
    };
    for (const l of ls) {
      for (const t of l.index.tilesInRect(rect)) add(l, `${l.name}|${band}|t${t}|${l.tileKeys?.[t] ?? ''}`, l.index.itemsOf(t));
      for (const i of l.index.bigInRect(rect)) add(l, `${l.name}|${band}|b${i}|${l.bigKeys?.[Array.prototype.indexOf.call(l.index.big, i)] ?? ''}`, [i]);
    }
    return out;
  };
  const strokeEarthRoads = (ls: LineLayer[], rank: Parameters<typeof strokeNaturalRoad>[2], metres: number): void => {
    if (deps.regionalRoadsOnGround?.()) return;
    const width = lookRoadWidth(roadStyle.look, rank, metres, sc);
    canopyMerged(ls).forEach((p, k) => {
      if (p) strokeNaturalRoad(ctx, p, rank, width, sc, roadStyle, k / (CANOPY_LEVELS - 1), metres);
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
            else strokeNaturalRoad(ctx, merged([l]), regionalRank(kind), lookRoadWidth(roadStyle.look, regionalRank(kind), l.width, sc), sc, { ...roadStyle, pavement }, 0, l.width);
          }
        }
      return;
    }
    // Drawn maps keep their inks: a paved trunk road is a firmer cased road with a centre line, once wide enough to hold it.
    const pavedCentre = (width: (l: LineLayer) => number): void => {
      const ls = roads.filter(l => l.pavement === 'asphalt' && l.kind === 'major' && width(l) * sc >= 4.5);
      if (ls.length) strokeLines(ls, pal.roadEdge, () => px(0.8), Math.min(1, 0.7 * inkAlpha));
    };
    if (roadStyle.look === 'wash') {
      // Pale translucent bands with a faint edge, as the bench draws them (terrainRoads.ts).
      for (const kind of ['minor', 'major'] as const) {
        const ls = roads.filter(l => l.kind === kind),
          rank = kind === 'major' ? 'highway' : 'local',
          width = (l: LineLayer): number => Math.max(px(BLEND_ROAD_PX[rank]), l.width);
        strokeLines(ls, pal.roadEdge, l => width(l) + px(1.6), BLEND_ROAD_ALPHA[rank] * 0.22 * inkAlpha);
        strokeLines(ls, pal.roadFill, width, Math.min(1, BLEND_ROAD_ALPHA[rank] * inkAlpha));
        if (kind === 'major') pavedCentre(width);
      }
      strokeCoveredTracks(tracks);
      return;
    }
    const surface = (l: LineLayer) => regionalRoadSurface(l.kind === 'major' ? 'major' : 'minor', sc, l.width);
    strokeLines(
      roads,
      pal.roadEdge,
      l => {
        const r = surface(l);
        return r.fill + (r.casing - r.fill) * Math.max(1, roadStyle.emphasis) * (l.pavement === 'asphalt' ? 1.5 : 1);
      },
      Math.min(1, inkAlpha),
    );
    strokeLines(roads, pal.roadFill, l => surface(l).fill);
    pavedCentre(l => surface(l).fill);
    strokeCoveredTracks(tracks);
  };
  const strokeCoveredTracks = (tracks: LineLayer[]): void => {
    canopyMerged(tracks).forEach((path, level) => {
      if (!path) return;
      ctx.strokeStyle = trackInk(ruralInk(pal), pal.roadFill);
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
