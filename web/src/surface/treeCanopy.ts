/** Physical crown disc used by the viewer's tree silhouette. `size` is total
 * characteristic tree height; crown radius is 0.42 * size, in metres. */
export const TREE_CROWN_RADIUS_RATIO = 0.42;
export const TREE_CELL_M = 20;
export const TREE_SLOTS_PER_CELL = 32;
const MIN_SIZE = 4, MAX_SIZE = 18;
const MIN_RADIUS = MIN_SIZE * TREE_CROWN_RADIUS_RATIO, MAX_RADIUS = MAX_SIZE * TREE_CROWN_RADIUS_RATIO;
let calibration: { covers: Float64Array; probabilities: Float64Array } | undefined;

/** Exact Boolean law for the generator's stratified binomial process:
 * mean uncovered fraction = E_probe[product_cells(1-p*q_cell(probe))^slots].
 * q integrates uniform candidate positions and the uniform physical radius
 * distribution. Fixed quadrature is a recipe parameter, never camera-driven. */
function buildCalibration() {
  const probeN = 8, integralN = 32, probabilityN = 256;
  const probabilities = new Float64Array(probabilityN + 1), covers = new Float64Array(probabilityN + 1);
  const supports: number[][] = [];
  for (let pz = 0; pz < probeN; pz++) for (let px = 0; px < probeN; px++) {
    const x = (px + .5) * TREE_CELL_M / probeN, z = (pz + .5) * TREE_CELL_M / probeN, cells: number[] = [];
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
      let support = 0;
      for (let iz = 0; iz < integralN; iz++) for (let ix = 0; ix < integralN; ix++) {
        const dx = (cx + (ix + .5) / integralN) * TREE_CELL_M - x;
        const dz = (cz + (iz + .5) / integralN) * TREE_CELL_M - z;
        const distance = Math.hypot(dx, dz);
        support += distance <= MIN_RADIUS ? 1 : distance >= MAX_RADIUS ? 0 : (MAX_RADIUS - distance) / (MAX_RADIUS - MIN_RADIUS);
      }
      if (support) cells.push(support / (integralN ** 2));
    }
    supports.push(cells);
  }
  for (let i = 0; i <= probabilityN; i++) {
    const probability = i / probabilityN;
    let uncovered = 0;
    for (const cells of supports) {
      let local = 1;
      for (const support of cells) local *= Math.pow(1 - probability * support, TREE_SLOTS_PER_CELL);
      uncovered += local;
    }
    probabilities[i] = probability; covers[i] = 1 - uncovered / supports.length;
  }
  return { probabilities, covers };
}
function table() { return calibration ??= buildCalibration(); }

/** Target fraction -> stable per-slot acceptance. Dense cover requires more
 * potential slots, not larger crowns or changed positions on a camera LOD. */
export function treeAcceptanceForCover(cover: number): number {
  if (!Number.isFinite(cover)) throw new Error('Tree cover must be finite.');
  if (cover <= 0) return 0;
  const { covers, probabilities } = table();
  if (cover >= covers[covers.length - 1]) return 1;
  let low = 0, high = covers.length - 1;
  while (high - low > 1) { const middle = (low + high) >>> 1; if (covers[middle] < cover) low = middle; else high = middle; }
  const t = (cover - covers[low]) / (covers[high] - covers[low]);
  return probabilities[low] * (1 - t) + probabilities[high] * t;
}

export function expectedTreeCover(acceptance: number): number {
  if (!Number.isFinite(acceptance)) throw new Error('Tree acceptance must be finite.');
  const { covers } = table(), address = Math.max(0, Math.min(1, acceptance)) * (covers.length - 1);
  const low = Math.floor(address), high = Math.min(covers.length - 1, low + 1), t = address - low;
  return covers[low] * (1 - t) + covers[high] * t;
}
