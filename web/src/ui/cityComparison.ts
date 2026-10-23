import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { Layout, Partition } from '../../../rust/bridge/urban';
import type { NativeBuildingProjectionScene } from './urbanBuildingProjection';

/**
 * Same-input comparison of one retained City scene: lots, flat silhouettes and
 * native compact plans under one camera, without any new native call. The
 * silhouettes are built once from the scene's exact original site projections; showing a
 * mode is a transient paint override. Used by the Visual50 auxiliary runner
 * (`window.magnaBenchContext.comparison`).
 */
export type ComparisonView = 'parcels' | 'buildings';
export type ComparisonArchitecture = 'compact' | 'silhouette';
/** `requests` is the stable source identity; capable clients supply only exact
 * visual projections, never full constraints or a resolver that performs I/O. */
export interface ComparisonSources { layouts: Layout[]; partitions: Partition[]; scene: PlacementBatch | NativeBuildingProjectionScene; requests: unknown[] }
export interface ComparisonSnapshot {
  active: boolean;
  identity: { layouts: string; partitions: string; scene: string; requests: string } | null;
  renderView: ComparisonView | null; architecture: ComparisonArchitecture | null;
  /** Incremented after each completed comparison paint (no pending raster tiles). */
  frameSerial: number; pending: boolean;
  counts: { blocks: number; parcels: number; streets: number; buildings: number } | null;
}
export interface ComparisonApi {
  begin(): ComparisonSnapshot; show(mode: { renderView: ComparisonView; architecture: ComparisonArchitecture }): ComparisonSnapshot;
  snapshot(): ComparisonSnapshot; end(): ComparisonSnapshot;
}

/** Stable serializable tokens for retained references (identity, not content). */
const tokens = new WeakMap<object, string>();
let nextToken = 0;
export const identityToken = (value: object): string => {
  let token = tokens.get(value);
  if (!token) { token = `ref-${++nextToken}`; tokens.set(value, token); }
  return token;
};

export interface ComparisonState {
  sources: ComparisonSources; silhouette: PlacementBatch;
  renderView: ComparisonView; architecture: ComparisonArchitecture;
  frameSerial: number; pending: boolean; counts: ComparisonSnapshot['counts'];
}

/** Host hooks: current retained sources, a silhouette builder and a repaint. */
export function createCityComparison(host: {
  current(): ComparisonSources | undefined;
  silhouette(requests: unknown[]): PlacementBatch;
  repaint(): void;
}): { api: ComparisonApi; state(): ComparisonState | undefined; painted(pending: boolean, counts: ComparisonSnapshot['counts']): void } {
  let state: ComparisonState | undefined;
  const snapshot = (): ComparisonSnapshot => state ? {
    active: true, identity: { layouts: identityToken(state.sources.layouts), partitions: identityToken(state.sources.partitions), scene: identityToken(state.sources.scene), requests: identityToken(state.sources.requests) },
    renderView: state.renderView, architecture: state.architecture, frameSerial: state.frameSerial, pending: state.pending, counts: state.counts,
  } : { active: false, identity: null, renderView: null, architecture: null, frameSerial: 0, pending: false, counts: null };
  /** Any change of the referenced data ends the comparison: it would no longer be same-input. */
  const check = (): void => {
    if (!state) throw new Error('Comparaison inactive : appelez begin().');
    const now = host.current();
    if (!now || now.layouts !== state.sources.layouts || now.partitions !== state.sources.partitions || now.scene !== state.sources.scene || now.requests !== state.sources.requests) {
      state = undefined; host.repaint();
      throw new Error('Données de la scène modifiées : comparaison annulée.');
    }
  };
  const api: ComparisonApi = {
    begin() {
      const sources = host.current();
      if (!sources) throw new Error('Comparaison impossible : il faut une scène native complète avec ses sites d’implantation.');
      state = { sources, silhouette: host.silhouette(sources.requests), renderView: 'buildings', architecture: 'compact', frameSerial: 0, pending: true, counts: null };
      host.repaint(); return snapshot();
    },
    show(mode) {
      check();
      if (!['parcels', 'buildings'].includes(mode.renderView) || !['compact', 'silhouette'].includes(mode.architecture)) throw new Error('Mode de comparaison inconnu.');
      state!.renderView = mode.renderView; state!.architecture = mode.architecture; state!.pending = true;
      host.repaint(); return snapshot();
    },
    snapshot() { if (state) check(); return snapshot(); },
    end() { state = undefined; host.repaint(); return snapshot(); },
  };
  return { api, state: () => state, painted(pending, counts) { if (!state) return; state.pending = pending; state.counts = counts; if (!pending) state.frameSerial++; } };
}
