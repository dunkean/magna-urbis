/** Portable coarse heightmap: cell centres, north-west origin, metres, sea at zero. */
export interface TerrainSketch { version: 1; resolution: number; heights: number[]; processing?: 'surface' | 'erosion' }

/** Neural request placement; portable JSON sketches themselves always cover the user's map. */
export interface NeuralSketchRegion { x: number; y: number; width: number; heightScale: number }

export function neuralSketchInput(sketch: TerrainSketch, window: NeuralSketchRegion): TerrainSketch & { region: { x: number; y: number; width: number } } {
  const heights = sketch.heights.map(h => h / window.heightScale);
  if (heights.some(h => !Number.isFinite(h) || Math.abs(h) > 12000)) {
    throw new Error('Altitude trop élevée pour cette échelle neuronale : désactiver « Pentes conservées » ou réduire l’altitude de l’esquisse.');
  }
  return { ...sketch, heights, region: { x: window.x, y: window.y, width: window.width } };
}

export function fitNeuralSketch(sketch: TerrainSketch, extent: number, window: NeuralSketchRegion): TerrainSketch {
  const n = sketch.resolution, heights = new Array<number>(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    heights[y * n + x] = sketchHeight(sketch, (window.x + (x + 0.5) * window.width / n) / extent,
      (window.y + (y + 0.5) * window.width / n) / extent) * window.heightScale;
  }
  return { version: 1, resolution: n, heights };
}

export function parseTerrainSketch(value: unknown, copy = true): TerrainSketch {
  const s = value as TerrainSketch;
  if (!s || s.version !== 1 || (s.processing !== undefined && s.processing !== 'surface' && s.processing !== 'erosion')
    || !Number.isInteger(s.resolution) || s.resolution < 8 || s.resolution > (s.processing ? 1024 : 128)
    || !Array.isArray(s.heights) || s.heights.length !== s.resolution ** 2) {
    throw new Error('Heightmap invalide : grille carrée 8–1024² (esquisse : 128² max.), altitudes entre −12 000 et 12 000 m.');
  }
  for (let i = 0; i < s.heights.length; i++) {
    const h = s.heights[i];
    if (typeof h !== 'number' || !Number.isFinite(h) || h < -12000 || h > 12000) {
      throw new Error(`Esquisse invalide : altitude de la cellule ${i + 1}.`);
    }
  }
  return { version: 1, resolution: s.resolution, heights: copy ? [...s.heights] : s.heights, ...(s.processing ? { processing: s.processing } : {}) };
}

/** Resample cell-centred metre elevations without introducing generated detail. */
export function heightmapSurface(s: TerrainSketch, n = 1024): Float32Array {
  if (s.resolution === n) return Float32Array.from(s.heights);
  return Float32Array.from({ length: n * n }, (_, i) => sketchHeight(s, (i % n + 0.5) / n, (Math.floor(i / n) + 0.5) / n));
}

export function sketchHeight(s: TerrainSketch, u: number, v: number): number {
  const n = s.resolution;
  const x = Math.max(0, Math.min(n - 1, u * n - 0.5)), y = Math.max(0, Math.min(n - 1, v * n - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const a = s.heights[y0 * n + x0] * (1 - x + x0) + s.heights[y0 * n + x1] * (x - x0);
  const b = s.heights[y1 * n + x0] * (1 - x + x0) + s.heights[y1 * n + x1] * (x - x0);
  return a * (1 - y + y0) + b * (y - y0);
}

export function coarseSurface(height: ArrayLike<number>, resolution: number, n = 64): TerrainSketch {
  const heights = new Array<number>(n * n).fill(0), counts = new Uint32Array(n * n);
  const bins = new Uint32Array(resolution);
  for (let x = 0; x < resolution; x++) bins[x] = Math.min(n - 1, Math.floor(x * n / resolution));
  for (let y = 0; y < resolution; y++) {
    const row = bins[y] * n, sourceRow = y * resolution;
    for (let x = 0; x < resolution; x++) {
      const i = row + bins[x];
      heights[i] += height[sourceRow + x]; counts[i]++;
    }
  }
  heights.forEach((h, i) => { heights[i] = counts[i] ? h / counts[i] : 0; });
  return { version: 1, resolution: n, heights };
}

/** Keep the existing generator's small scales; replace its large-scale elevations. */
export function refineSketch(sketch: TerrainSketch, detail: Float32Array, resolution: number): Float32Array {
  // Editing resolution controls brush precision, not the procedural detail cutoff.
  const low = coarseSurface(detail, resolution, Math.min(sketch.resolution, 16));
  const axis = (n: number): { first: Uint16Array; last: Uint16Array; w0: Float64Array; w1: Float64Array } => {
    const first = new Uint16Array(resolution), last = new Uint16Array(resolution);
    const w0 = new Float64Array(resolution), w1 = new Float64Array(resolution);
    for (let k = 0; k < resolution; k++) {
      const g = Math.max(0, Math.min(n - 1, (k + 0.5) / resolution * n - 0.5)), i = Math.floor(g);
      first[k] = i; last[k] = Math.min(n - 1, i + 1); w0[k] = 1 - g + i; w1[k] = g - i;
    }
    return { first, last, w0, w1 };
  };
  const baseAxis = axis(sketch.resolution), lowAxis = axis(low.resolution);
  const out = new Float32Array(detail.length);
  const rowHeight = (s: TerrainSketch, a: ReturnType<typeof axis>, x: number, y: number, row0: number, row1: number): number => {
    const top = s.heights[row0 + a.first[x]] * a.w0[x] + s.heights[row0 + a.last[x]] * a.w1[x];
    const bottom = s.heights[row1 + a.first[x]] * a.w0[x] + s.heights[row1 + a.last[x]] * a.w1[x];
    return top * a.w0[y] + bottom * a.w1[y];
  };
  for (let y = 0; y < resolution; y++) {
    const row = y * resolution, b0 = baseAxis.first[y] * sketch.resolution, b1 = baseAxis.last[y] * sketch.resolution;
    const l0 = lowAxis.first[y] * low.resolution, l1 = lowAxis.last[y] * low.resolution;
    for (let x = 0; x < resolution; x++) {
      const i = row + x, base = rowHeight(sketch, baseAxis, x, y, b0, b1);
      // Sea beds stay signed and calm; coastal relief appears gradually above the datum.
      const gain = Math.max(0, Math.min(1, base / 100));
      out[i] = base + gain * (detail[i] - rowHeight(low, lowAxis, x, y, l0, l1));
    }
  }
  return out;
}
