/** Optional layer probes used by groundLayer, buildingsLayer and treesLayer. Owns observational counters and coarse-tile history; rendering and work decisions never read them. */
import type { LiveLayerStats } from './contract';

/** Committed browser probes use ?test=1. Console callers can opt in before creating a layer with __muLayerDiagnostics. */
export function layerDiagnosticsEnabled(): boolean {
  const enabled = (globalThis as { __muLayerDiagnostics?: boolean }).__muLayerDiagnostics;
  return enabled ?? (typeof location !== 'undefined' && new URLSearchParams(location.search).get('test') === '1');
}

export class GroundDiagnostics {
  private coarseSince = new Map<number, number>();
  private coarseNext = new Map<number, number>();
  constructor(private readonly stats: LiveLayerStats) {
    Object.assign(stats, { otherTier: 0, drapeOtherTier: 0, coarseAgeMs: 0 });
  }
  ancestor(key: number, now: number): void {
    this.coarseNext.set(key, this.coarseSince.get(key) ?? now);
  }
  topFrame(now: number): void {
    let oldest = now;
    for (const since of this.coarseNext.values()) oldest = Math.min(oldest, since);
    this.stats.otherTier = this.coarseNext.size;
    this.stats.coarseAgeMs = now - oldest;
    [this.coarseSince, this.coarseNext] = [this.coarseNext, this.coarseSince];
    this.coarseNext.clear();
  }
  tiltedFrame(otherTier: number, drapeOtherTier: number): void {
    this.stats.otherTier = otherTier;
    this.stats.drapeOtherTier = drapeOtherTier;
  }
}

export class BuildingDiagnostics {
  constructor(private readonly stats: LiveLayerStats) {
    Object.assign(stats, { blocks: 0, sliceMs: 0, demoted: 0 });
  }
  frame(): void {
    this.stats.blocks = 0;
  }
  selection(): void {
    this.stats.blocks = this.stats.demoted = 0;
  }
  block(): void {
    this.stats.blocks++;
  }
  demoted(): void {
    this.stats.demoted++;
  }
  slice(started: number): void {
    const ms = performance.now() - started;
    if (ms > this.stats.sliceMs) this.stats.sliceMs = ms;
  }
}

/** The 300 m target disc is a pitch-sweep probe, independent of the tree distance and budget. */
const INNER_METRES = 300;
export class TreeDiagnostics {
  private buildMs = 0;
  constructor(private readonly stats: LiveLayerStats) {
    Object.assign(stats, { inner: 0, front: 0, coarser: 1, thinner: 1, blocks: 0, built: 0, blockMs: 0, sliceMs: 0 });
  }
  selection(): void {
    this.stats.inner = this.stats.front = this.stats.blocks = 0;
  }
  block(counts: Int32Array, from: number, to: number, minX: number, minY: number, side: number, tx: number, ty: number, gx: number, gy: number, far: number): void {
    let count = 0;
    for (let i = from; i < to; i++) count += counts[i];
    if (Math.hypot(Math.max(tx - minX, minX + side - tx), Math.max(ty - minY, minY + side - ty)) <= INNER_METRES) this.stats.inner += count;
    if (Math.hypot(Math.max(minX - gx, 0, gx - minX - side), Math.max(minY - gy, 0, gy - minY - side)) <= far) this.stats.front += count;
    this.stats.blocks++;
  }
  levels(coarser: number, thinner: number): void {
    this.stats.coarser = coarser;
    this.stats.thinner = thinner;
  }
  startBlock(): void {
    this.buildMs = 0;
  }
  step<Y, R>(steps: Iterator<Y, R>): IteratorResult<Y, R> {
    const started = performance.now(),
      result = steps.next();
    this.buildMs += performance.now() - started;
    return result;
  }
  built(): void {
    this.stats.blockMs = this.buildMs;
    this.stats.built++;
  }
  slice(started: number): void {
    const ms = performance.now() - started;
    if (ms > this.stats.sliceMs) this.stats.sliceMs = ms;
  }
}
