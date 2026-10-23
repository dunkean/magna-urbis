export interface SurfaceRepositorySnapshot {
  root: string;
  head: string;
  status: string;
  files: Record<string, string>;
}

export function captureSurfaceRepositorySnapshot(root: string): Promise<SurfaceRepositorySnapshot>;
export function assertFrozenSurfaceSnapshots(initial: SurfaceRepositorySnapshot, final?: SurfaceRepositorySnapshot): void;
