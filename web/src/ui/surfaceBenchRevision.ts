export interface SurfaceBenchSnapshot {
  query: string; workshop: string; draft: string; stage: string;
  terrain?: object; settings?: object; context?: object; layouts?: object; scene?: object;
}
const DISPLAY_KEYS = new Set(['view', 'camera3d', 'projection', 'profile', 'standalone', 'auto', 'render', 'style', 'overlay', 'diagnostic', 'legend',
  'shading', 'refinement3d', 'tiles3d', 'pins', 'showPins', 'contours', 'water', 'lakes', 'oxbows']);

/** Camera/render changes never invalidate canonical occupation or climate. */
export function surfaceBenchPhysicsQuery(query: string, stage?: string): string {
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (DISPLAY_KEYS.has(key) || key.startsWith('layer_') || key.startsWith('light_')) params.delete(key);
  if (stage === 'terrain') for (const key of ['urban', 'settlements', 'roads']) params.delete(key);
  params.sort(); return params.toString();
}

/** Browser-local epochs compare applied strings and immutable result identities, not city meshes or raster JSON. */
export function createSurfaceBenchRevisionReader() {
  let previous: SurfaceBenchSnapshot | undefined, serial = 0;
  let result = { sourceEpoch: 'bench-source-0', sceneEpoch: 'bench-scene-0' };
  return (snapshot: SurfaceBenchSnapshot) => {
    const current = { ...snapshot, query: surfaceBenchPhysicsQuery(snapshot.query, snapshot.stage) };
    const keys: Array<keyof SurfaceBenchSnapshot> = ['query', 'workshop', 'draft', 'stage', 'terrain', 'settings', 'context', 'layouts', 'scene'];
    if (!previous || keys.some(key => current[key] !== previous![key])) {
      serial++; previous = current;
      result = { sourceEpoch: `bench-source-${serial}`, sceneEpoch: `bench-scene-${serial}` };
    }
    return result;
  };
}
