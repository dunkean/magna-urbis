import { configDefaults, defineWorkspace } from 'vitest/config';

// Keep the expensive real-generation fixtures together in the slow project.
const slow = [
  'tests/caverns.test.ts',
  'tests/fields.test.ts',
  'tests/mega.quality.test.ts',
  'tests/render.countryside.test.ts',
  'tests/render.landscape-ground.test.ts',
  'tests/render.road_surfaces.test.ts',
  'tests/urban.culturequality.test.ts',
  'tests/urban.cultures.city.test.ts',
  'tests/urban.densehouses.test.ts',
  'tests/urban.densityRepair.test.ts',
  'tests/urban.edgeRoofs.hybrid.test.ts',
  'tests/urban.edgeRoofs.test.ts',
  'tests/urban.openfringe.test.ts',
  'tests/urban.port.test.ts',
  'tests/urban.waterland.test.ts',
];

export default defineWorkspace([
  { extends: './vitest.config.ts', test: { name: 'fast', include: ['tests/**/*.test.ts'], exclude: [...configDefaults.exclude, ...slow] } },
  { extends: './vitest.config.ts', test: { name: 'slow', include: slow } },
]);
