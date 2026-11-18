/**
 * The map on display: what the last `set()` was given, and the page's frame hook.
 *
 * Every part of the display (v2/display/) reads the map from here. Written by:
 *   appearance.ts : `world`, `scene`, `settings`, `resolved`, `exportLayers`, `native`, the papers, `input`, `request`,
 *                   `townContent`, and `stats.passes/style/renderer/terrainBackend`;
 *   mapView.ts    : `suspended`, `preparing`, `townContent` (another display quality or vector engine), `stats.live`;
 *   the paints    : `dpr` (ExactFrame.paint, ComposedView.draw) and `stats.city` (the statistics of the last exact
 *                   town paint);
 *   the products  : `stats.gpuFallback`, `stats.cartographyUpdate`, `stats.resourcesError`, `passes.reset` (a product
 *                   that must be made again);
 *   benchRenderer : `disposed`, `resourceSource`.
 *
 * It also carries the three ways the display asks the page for an animation frame, which differ in what they make
 * due:
 *
 *   invalidate : the content changed (a product arrived, a look moved): the picture at rest and the miniature are due;
 *   repaint    : same content, but the picture at rest is due again (a stepwise paint progressed, the view rested);
 *   compose    : same content, a frame for the compositor alone (a baked tile or a prepared layer arrived).
 */
import { RenderReadiness } from '../../render/renderReadiness';
import type { World } from '../../gen/types';
import type { V2Settings } from '../contracts';
import type { ResolvedAppearance } from '../../render/appearanceRecipe';
import type { ExportLayers } from '../../render/exportLayers';
import type { TerrainData } from '../../../../rust/bridge/terrain';
import type { RenderScene } from '../renderScene';
import { PassState } from '../passes/pass';
import type { ResourceSource } from '../resourceLayer';
import type { PassInput } from '../passes/pass';
import type { SharedPassResources } from './contract';

export class MapState {
  world?: World;
  scene?: RenderScene;
  settings?: V2Settings;
  resolved?: ResolvedAppearance;
  /** Layers switched off by an export, with the roads the cartography hides. */
  exportLayers: Partial<ExportLayers> = {};
  native?: TerrainData;
  /** Paper of the map style, and the paper the ground shader itself lays under and around the map. */
  paper = '#ffffff';
  groundPaper = '#ffffff';
  /** Device pixel ratio of the last frame painted (the cartography reads it lazily). */
  dpr = 1;
  disposed = false;
  /** The 2D view is hidden behind another one (3D): nothing is drawn. */
  suspended = false;
  /** The appearance passes are running: the terrain renderer's state is changing under them. */
  preparing = false;
  request?: RenderReadiness;
  readonly stats: Record<string, unknown> = {};
  readonly passes = new PassState();
  /** Inputs of the pass keys, read lazily: the terrain data pass may demote the ground to the CPU. */
  input!: () => PassInput;
  /** Resource payload provider (StudioClient): fetched lazily, only when a resource diagnostic is shown. */
  resourceSource?: ResourceSource;
  /** Bumped by every set() and quality or engine change: a town layer kept by the exact town renderer is then repainted. */
  townContent = 0;
  /** True while the page is asked for a frame of the same content (its miniature stays valid). */
  redrawOnly = false;
  /** Bumped whenever the picture at rest is due again; a view compares it with the revision it painted. */
  paintRevision = 0;

  constructor(
    private readonly notify: () => void,
    readonly shared: SharedPassResources,
    readonly ownsShared: boolean,
    /** True inside a compositor frame or work slice. A request raised there comes from a live layer (the overlay
     * layer reports through the cartography's `invalidate`), not from new content. */
    private readonly inCompositor: () => boolean,
  ) {}

  invalidate(): void {
    if (this.inCompositor()) {
      this.frame();
      return;
    }
    this.paintRevision++;
    this.notify();
  }
  repaint(): void {
    if (!this.inCompositor()) this.paintRevision++;
    this.frame();
  }
  compose = (): void => {
    if (!this.disposed && !this.suspended) this.frame();
  };
  private frame(): void {
    const only = this.redrawOnly;
    this.redrawOnly = true;
    try {
      this.notify();
    } finally {
      this.redrawOnly = only;
    }
  }
  /** Ground layers of the appearance, less what an export switched off. */
  layers(): ResolvedAppearance['ground']['layers'] {
    const r = this.resolved!,
      l = this.exportLayers;
    return { ...r.ground.layers, relief: l.terrain !== false && r.ground.layers.relief, water: l.water !== false && r.ground.layers.water, frame: l.decor !== false && r.ground.layers.frame };
  }
}
