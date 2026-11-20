/** Stable City 3D mesh entry for scene adapters and tests. Re-exports specialized mesh builders under city3d/; owns no state. */
export { CITY3D_MATERIALS } from './city3d/materials';
export { CITY3D_LEVEL_M, silhouetteMassing } from './city3d/massing';
export { type City3dHeight } from './city3d/types';
export { surfaceArea, orientedBox, ridgeRoof } from './city3d/roofGeometry';
export { CITY3D_CLIFF_SLOPE, CITY3D_RETAINING_PLINTH_M, CITY3D_FOOTING_DEPTH_M, CITY3D_POST_SINK_M, footprintTerrain, terrainSeat, seatPlan, rasterHeight } from './city3d/terrainSeat';
export { silhouetteBuilding } from './city3d/silhouette';
export { compactBuilding } from './city3d/compact';
export { type City3dKind, type City3dDisplayScene, city3dDisplayKind, projectionDetailMatches, city3dProjectionScene, city3dKind, city3dScene } from './city3d/scene';
export { bridgeCamber, city3dBridges } from './city3d/bridges';
export { city3dWalls } from './city3d/walls';
export { city3dLotEnclosures } from './city3d/yards';
