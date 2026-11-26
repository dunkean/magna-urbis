/** World metre grids used by instance streaming and painted crown ownership. */
export const TREE_CELL_BLOCK = 24;
export const TREE_VOLUME_BLOCK = 4 * TREE_CELL_BLOCK;

export interface TreeIdImage {
  data: Uint32Array;
  width: number;
  height: number;
}

/** Two words per bucket. A zero block tag ends the linear probe, even for crown ID zero. */
export function treeIdImage(total: number, visit: (insert: (id: number, block: number) => void) => void): TreeIdImage {
  const length = 2 ** Math.ceil(Math.log2(Math.max(1, total * 2)));
  const width = Math.min(length, 1024),
    data = new Uint32Array(length * 2);
  visit((id, block) => {
    let at = id & (length - 1);
    while (data[2 * at + 1]) at = (at + 1) & (length - 1);
    data[2 * at] = id;
    data[2 * at + 1] = block + 1;
  });
  return { width, height: length / width, data };
}
/** Root-space decision shared by the terrain crown search and both instance shaders.
 * A stable phase spreads the hand-off across the outer third of the range. */
export const TREE_OWNER_GLSL = `
bool treeInVolume(vec2 root,float phase,vec4 region){
  return region.w>0.&&distance(root,region.xy)<mix(region.z,region.w,phase);
}
`;
