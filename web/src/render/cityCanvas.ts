/**
 * Entry of the town model (render/city/model) and of the exact Canvas 2D town (render/city/canvas): the names the rest
 * of the code imports from this path. It holds no code.
 */
export type { Box, CityAllocation, CityBlock, CityBuilding, CityBuildings, CityDistrict, CityLandmark, CityLayers, CityLod, CityPalette, CityParcel, CityPick, CityRoofs, CityScene, CityStreet, CityView, CityWall } from './city/model/contract';
export { SpatialBins, shapeBox, shapeContains } from './city/model/geometry';
export { BUILDING_FAMILIES, DISTRICT_ROLES, districtRoleLabel, landmarkName } from './city/model/roles';
export { buildCityScene, cityGroundSubjects } from './city/model/scene';
export { buildCityBuildings, cityBuildingBins, cityBuildingCulture, cityBuildingLink, citySnowAltitudes } from './city/model/buildings';
export { pickCity } from './city/model/pick';
export { CITY_LOD_LIMITS, CITY_LOD_OFF, districtRoleKey, roleFamily, selectCityLod } from './city/look';
export type { CityBuildingRenderer, CityDrawOptions, CityFrameStats } from './city/canvas/contract';
export { drawCity, drawCitySteps } from './city/canvas/town';
export { drawRoofedBuildings } from './city/canvas/roofs';
export { landmarkGlyph } from './city/canvas/glyphs';
export { CityCanvasLayer, clearCanvas2d, type CityCanvasFrame } from './city/canvas/host';
