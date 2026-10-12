// Render actual native house batches without generating architecture in JS.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { tsImport } from 'tsx/esm/api';

const contractModule = await tsImport('../../rust/bridge/housesContract.ts', import.meta.url);
const rendererModule = await tsImport('../../rust/bridge/houseRender.ts', import.meta.url);
const contract = contractModule.parseHouseBatch ? contractModule : contractModule.default;
const renderer = rendererModule.renderHouseSvg ? rendererModule : rendererModule.default;
const catalogue = JSON.parse(await readFile(resolve('../rust/crates/houses/data/recipes.json'), 'utf8'));
const out = resolve('out/houses-ui/complex');
await mkdir(out, { recursive: true });
if (!process.argv[2]) throw new Error('Usage: node scripts/houses_render_check.mjs <native-batch.json> [...]');
for (const file of process.argv.slice(2)) {
  const batch = contract.parseHouseBatch(await readFile(resolve(file), 'utf8'));
  for (const unit of batch.units) {
    const views = [{mode: 'roof', level: 0}, ...unit.levels.map(level => ({mode: 'plan', level: level.index}))];
    for (const view of views) {
      const name = `${basename(file, '.json')}-${unit.id}-${view.mode}${view.mode === 'plan' ? `-${view.level}` : ''}`;
      const svg = renderer.renderHouseSvg(unit, catalogue, {...view, graph: false, dimensions: true}, {width: 1200, height: 1000, prefix: name});
      await writeFile(join(out, `${name}.svg`), svg);
      await writeFile(join(out, `${name}.png`), new Resvg(svg).render().asPng());
    }
    console.log(JSON.stringify({file, recipe: unit.recipe_id, bodies: unit.bodies.length, levels: unit.levels.length, roofGroups: unit.roofs.groups.length, featureCovers: unit.roofs.groups.filter(group => group.feature_id).length}));
  }
}
