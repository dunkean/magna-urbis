/**
 * The state the parts of one 3D terrain view share (Terrain3d assembles them): the owner's elements and options, the
 * view's inputs of appearance, the facts of the frame being drawn, and the surface epoch every asynchronous job checks.
 * Each part owns its own fields; only what several parts read lives here, and each field names who writes it.
 *
 * Written by: Terrain3d (`active`, `disposed`, `width`, `height`, `ground`, `look`, `tileBounds`, `useMapShader`,
 * `maxFramebufferDimension`, `epoch` on a lost WebGL context), Terrain3d.clearPatches (`epoch`), the frame loop
 * (`now`, `animating`, `fullQualityCapture`, `frameQuality`, `frameInteracting`), the tile materials and the morphs
 * (`animating` = true while a fade or a morph runs), the capture (`captureMode`), the WebGPU view
 * (`maxFramebufferDimension`).
 */
import { FramePreparation } from '../../framePreparation';
import type { Terrain3dGroundSettings, Terrain3dLookSettings, Terrain3dOptions } from './contract';

export class TerrainViewContext {
  /** Every listener of the view (input, GL context loss): aborted on dispose. */
  readonly events = new AbortController();
  /** Cooperative off-frame work (meshes, tiles, trees, mushrooms, billboards), cleared with the surface epoch. */
  readonly preparation = new FramePreparation();
  active = false;
  disposed = false;
  /** CSS pixels of the view. */
  width = 1;
  height = 1;
  /** Surface epoch: bumped when the relief or the GL context is lost; jobs started before it are dropped. */
  epoch = 0;
  /** Time of the frame being drawn (performance.now()) and whether something in it still moves (fade, morph). */
  now = 0;
  animating = false;
  /** An exact frame for a capture: every stream is built synchronously, nothing is previewed. */
  fullQualityCapture = false;
  /** A capture is preparing: tiles are requested exact, live streams wait. */
  captureMode = false;
  /** Display-quality uniform and moving state of the frame being drawn. */
  frameQuality = 0;
  frameInteracting = false;
  /** Material ground settings (procedural, satellite, Underdark), absent for the draped map. */
  ground?: Terrain3dGroundSettings;
  look: Terrain3dLookSettings = {};
  tileBounds = false;
  /** The small draped-map shader draws the ground (options.fastMapShader without material ground). */
  useMapShader = false;
  maxFramebufferDimension = 8192;

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** The owner's element: input, focus and status attributes (the canvas itself unless options.element). */
    readonly element: HTMLElement,
    readonly options: Terrain3dOptions,
    /** Asks for a frame (the frame loop's request). */
    readonly request: () => void,
    /** Whether the backend lost its context or device. */
    readonly contextLost: () => boolean,
  ) {}
}
