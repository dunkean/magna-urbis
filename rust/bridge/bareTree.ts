/** A bare tree in crown radii (x,z) and tree heights (y). Radius is a fraction of the crown radius.
 * The plan projects these same tapered limbs that the close 3D mesh draws as triangular tubes. */
type Joint = readonly [number, number, number, number];
const joints: readonly Joint[] = [
  [0, 0, 0, 0.095],
  [0.035, 0.39, -0.025, 0.078],
  [-0.09, 0.68, 0.12, 0.052],
  [-0.22, 0.87, 0.19, 0.025],
  [0.34, 0.6, 0.18, 0.05],
  [0.67, 0.74, 0.32, 0.027],
  [0.47, 0.82, 0.47, 0],
  [-0.36, 0.57, 0.22, 0.052],
  [-0.8, 0.7, 0.12, 0],
  [-0.56, 0.8, 0.52, 0],
  [0.08, 0.78, -0.42, 0.043],
  [0.29, 0.91, -0.85, 0],
  [-0.19, 0.9, -0.68, 0],
  [-0.15, 1.0, 0.32, 0],
  [-0.38, 0.96, 0.22, 0],
  [0.91, 0.8, 0.37, 0],
  [0.73, 0.86, 0.19, 0],
];
const links = [
  [0, 1],
  [1, 2],
  [2, 3],
  [1, 4],
  [4, 5],
  [4, 6],
  [1, 7],
  [7, 8],
  [7, 9],
  [2, 10],
  [10, 11],
  [10, 12],
  [3, 13],
  [3, 14],
  [5, 15],
  [5, 16],
];
export const bareLimbs = links.map(([a, b]) => [joints[a], joints[b]] as const);

// A single ring at each joint. The section lies in the horizontal plane and the tubes rise along every limb.
function tubeIndices(limbs: number[][]): number[] {
  return limbs.flatMap(([a, b]) =>
    [0, 1, 2].flatMap(i => {
      const j = (i + 1) % 3;
      if (joints[b][3] === 0) return [3 * a + i, 3 * b, 3 * a + j];
      return [3 * a + i, 3 * b + i, 3 * a + j, 3 * a + j, 3 * b + i, 3 * b + j];
    }),
  );
}
export const bareTreeMesh = {
  segments: -1,
  vertices: joints.flatMap(([x, y, z, r]) =>
    [0, 1, 2].flatMap(side => {
      const a = (2 * Math.PI * side) / 3;
      return [x + r * Math.cos(a), y, z + r * Math.sin(a), 0.84 + 0.12 * Math.cos(a)];
    }),
  ),
  indices: tubeIndices(links),
};
// The same scaffold with terminal twigs pruned. Seven triangular tubes fit the middle foliage budget.
const middleLinks = [
  [0, 1],
  [1, 2],
  [1, 8],
  [1, 15],
  [2, 13],
  [2, 11],
  [2, 9],
];
export const bareMiddleMesh = { segments: -1, vertices: bareTreeMesh.vertices, indices: tubeIndices(middleLinks) };

// One tapered stroke per limb in the distant silhouette. Its base spans the limb in plan so forks
// remain separated overhead. In profile the rising limbs read against the sky.
const distantLinks = middleLinks.slice(0, 6);
export const bareDistantMesh = {
  segments: -1,
  vertices: distantLinks.flatMap(([a, b]) => {
    const [x, y, z, width] = joints[a],
      [tx, ty, tz] = joints[b];
    const scale = (1.4 * width) / Math.hypot(tx - x, tz - z);
    const dx = (tz - z) * scale,
      dz = (x - tx) * scale;
    return [x - dx, y, z - dz, 0.9, x + dx, y, z + dz, 0.9, tx, ty, tz, 1];
  }),
  indices: Array.from({ length: distantLinks.length * 3 }, (_, i) => i),
};
const gl = (v: number) => v.toFixed(4);
export const BARE_LIMBS_GLSL = `
const int limbCount=${links.length};
const vec4 limbA[limbCount]=vec4[limbCount](${bareLimbs.map(([a]) => 'vec4(' + a.map(gl).join(',') + ')').join(',')});
const vec4 limbB[limbCount]=vec4[limbCount](${bareLimbs.map(([, b]) => 'vec4(' + b.map(gl).join(',') + ')').join(',')});
`;
