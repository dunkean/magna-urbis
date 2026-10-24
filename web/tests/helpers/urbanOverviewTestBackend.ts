import type { ColdOverviewBackend, StoredColdOverview } from '../../src/ui/urbanColdOverviewCache';
import { DerivedTestBackend } from './urbanDerivedTestBackend';
import { deferred } from './urbanBuildingColdTestBackend';
export class OverviewTestBackend extends DerivedTestBackend {
  overviews = new Map<string, StoredColdOverview>();
  failOverview?: 'read' | 'commit'; overviewCommits = 0;
  overviewGate?: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
  overview: ColdOverviewBackend = {
    read: async (sceneId, key) => {
      if (this.failOverview === 'read') throw new Error('Overview cache unavailable');
      return structuredClone(this.overviews.get(`${sceneId}|${key}`));
    },
    commit: async (value, options) => {
      options?.signal?.throwIfAborted();
      if (this.overviewGate) { const gate = this.overviewGate; this.overviewGate = undefined; gate.entered.resolve(); await gate.release.promise; }
      options?.signal?.throwIfAborted(); if (this.failOverview === 'commit') throw new Error('Overview quota');
      const n = this.stages.get(value.sceneId)?.manifest, d = this.caches.get(value.sceneId)?.manifest;
      if (n?.fingerprint !== value.parentFingerprint || d?.fingerprint !== value.derivedFingerprint || n.sourceFingerprint !== value.sourceFingerprint) throw new Error('Overview parent changed');
      this.overviewCommits++; this.overviews.set(`${value.sceneId}|${value.key}`, structuredClone(value));
    },
  };
}
