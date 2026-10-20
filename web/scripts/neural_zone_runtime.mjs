// A small adapter overlay on generated sources; the upstream runtime stays unchanged.
import { readFile, writeFile } from 'node:fs/promises';
export async function installZoneRuntime(earth, rust) {
  const directory = `${earth}/native/neural-earth/generated-engine/`;
  const replace = (code, before, after) => {
    if (!code.includes(before)) throw Error(`Neural zone overlay no longer matches: ${before.slice(0, 80)}`);
    return code.replace(before, after);
  };
  let code = (await readFile(`${directory}sketch.rs`, 'utf8')).replaceAll('\r\n', '\n');
  code = replace(code, 'pub enum Sketch {', `pub enum Sketch {
    ReliefMap { resolution: usize, relief: Vec<f32>, strength: Vec<f32>, extent: f64, origin: (f64, f64), context: Box<Sketch> },`);
  code = replace(code, 'Sketch::Validation(case) =>', 'Sketch::ReliefMap { context, .. } => context.elevation(x, y),\n            Sketch::Validation(case) =>');
  code = replace(code, 'Sketch::Validation(_) =>', 'Sketch::ReliefMap { context, .. } => context.climate(),\n            Sketch::Validation(_) =>');
  code += '\n' + await readFile(`${rust}/crates/neural/src/zone_profile.rs`, 'utf8');
  await writeFile(`${directory}sketch.rs`, code);
  code = await readFile(`${directory}pipeline.rs`, 'utf8');
  code = replace(code, 'let used = tuning.relief_fixed.unwrap_or(relief * tuning.relief_scale);',
    'let baseline = tuning.relief_fixed.unwrap_or(relief * tuning.relief_scale);\n                    let used = request.sketch.relief_mask_at(cx, cy).map_or(baseline, |(weight, target)| baseline * (1.0 - weight) + target * weight);');
  await writeFile(`${directory}pipeline.rs`, code);
}
