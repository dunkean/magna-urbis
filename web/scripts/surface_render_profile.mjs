import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const profilePaths = { 'surface-v2': 'viewer-local/profiles/surface-v2.json' };
const pathKeys = ['assets', 'vegetationAssets', 'treeAssets', 'heightBatch'];
const flags = {
  assets: '--assets', vegetationAssets: '--vegetation-assets', treeAssets: '--tree-assets', heightBatch: '--height-batch',
  presentation: '--presentation', waterMode: '--water-mode', waterVectorTint: '--water-vector-tint',
  waterSymbolWidthPx: '--water-symbol-width-px', nativeLogMode: '--native-log-mode',
};
const sha = value => createHash('sha256').update(value).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const error = message => new Error(`Surface render profile: ${message}`);

function file(filename, label) {
  try { if (statSync(filename).isFile() && statSync(filename).size > 0) return filename; } catch {}
  throw error(`${label} is missing or empty: ${filename}. Prepare/copy the local artifact explicitly; no download or fallback is performed.`);
}
function json(filename, label) {
  file(filename, label);
  if (statSync(filename).size > 16 * 1024 * 1024) throw error(`${label} exceeds the 16 MiB manifest limit: ${filename}`);
  try { return JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
  catch (cause) { throw error(`${label} is not valid JSON: ${filename} (${cause.message})`); }
}
function reference(manifestPath, value, label) {
  const relative = typeof value === 'string' ? value : value?.path ?? value?.localPath;
  if (typeof relative !== 'string' || !relative) throw error(`${label} has no runtime file path in ${manifestPath}`);
  return file(path.resolve(path.dirname(manifestPath), relative), label);
}
function effectiveOptions(defaults) {
  for (const key of Object.keys(flags)) if (defaults[key] === undefined || defaults[key] === null || defaults[key] === '') throw error(`missing effective option ${key}`);
  if (!['aerial', 'cartographic'].includes(defaults.presentation)) throw error('presentation must be aerial or cartographic');
  if (!['source-map', 'source-levels'].includes(defaults.waterMode)) throw error('waterMode must be source-map or source-levels');
  if (!['uniform', 'source-classes'].includes(defaults.waterVectorTint)) throw error('waterVectorTint must be uniform or source-classes');
  if (!['threaded', 'synchronous'].includes(defaults.nativeLogMode)) throw error('nativeLogMode must be threaded or synchronous');
  if (typeof defaults.waterSymbolWidthPx !== 'number' && (typeof defaults.waterSymbolWidthPx !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(defaults.waterSymbolWidthPx))) throw error('waterSymbolWidthPx must be a decimal number');
  const width = Number(defaults.waterSymbolWidthPx);
  if (!Number.isFinite(width) || width < 0 || width > 1.25) throw error('waterSymbolWidthPx must be finite and between 0 and 1.25');
  if (defaults.waterMode !== 'source-map' && (defaults.waterVectorTint === 'uniform' || width > 0)) throw error('uniform waterVectorTint and nonzero waterSymbolWidthPx require source-map; override the related options explicitly');
  for (const key of pathKeys) if (typeof defaults[key] !== 'string' || !defaults[key]) throw error(`${key} must be a nonempty file path`);
}

/** Resolve an explicitly selected profile; no asset-cache probing or engine call. */
export function loadSurfaceRenderProfile(id, { root = repositoryRoot, platform = process.platform } = {}) {
  if (!Object.hasOwn(profilePaths, id)) throw error(`unknown profile ${JSON.stringify(id)}; available: surface-v2`);
  const absoluteRoot = path.resolve(root), profilePath = path.join(absoluteRoot, profilePaths[id]);
  const bytes = readFileSync(file(profilePath, `profile ${id}`));
  let definition;
  try { definition = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw error(`invalid profile JSON: ${profilePath}`); }
  if (definition?.format !== 'magna-surface-render-profile' || definition.version !== 1 || definition.id !== id || !record(definition.defaults) || !/^[a-f0-9]{64}$/.test(definition.requirements?.treeDigest ?? '')) throw error(`invalid profile schema: ${profilePath}`);
  const defaults = { ...definition.defaults };
  if (!record(defaults.heightBatch)) throw error(`invalid platform executable map: ${profilePath}`);
  defaults.heightBatch = defaults.heightBatch[platform] ?? defaults.heightBatch.default;
  for (const key of pathKeys) {
    if (typeof defaults[key] !== 'string' || !defaults[key]) throw error(`profile path ${key} is invalid: ${profilePath}`);
    defaults[key] = path.resolve(absoluteRoot, defaults[key]);
  }
  effectiveOptions(defaults);
  return { defaults, metadata: { id, version: definition.version, format: definition.format, profilePath, profileSha256: sha(bytes), root: absoluteRoot, platform, requiredTreeDigest: definition.requirements.treeDigest } };
}

/** Validate EFFECTIVE paths after caller overrides, before starting Godot. */
export function validateSurfaceRenderProfile(profile, { defaults = profile.defaults, cwd = process.cwd() } = {}) {
  effectiveOptions(defaults);
  const resolved = { ...defaults }, artifacts = {};
  for (const key of pathKeys) {
    resolved[key] = path.resolve(cwd, defaults[key]);
    artifacts[key] = { path: file(resolved[key], flags[key]), sha256: sha(readFileSync(resolved[key])) };
  }
  const materials = json(resolved.assets, 'PBR assets manifest');
  if (!Array.isArray(materials.materials) || !materials.materials.length) throw error('PBR assets manifest must contain prepared materials');
  const runtimeFiles = new Set(pathKeys.map(key => resolved[key]));
  const required = (manifestPath, value, label) => {
    const filename = reference(manifestPath, value, label); runtimeFiles.add(filename); return filename;
  };
  for (const material of materials.materials) {
    for (const role of ['baseColor', 'normal', 'roughness', 'height']) {
      required(resolved.assets, material?.maps?.[role], `PBR ${material?.id ?? 'unknown'} ${role}`);
    }
  }
  const vegetation = json(resolved.vegetationAssets, 'vegetation manifest');
  if (vegetation?.format !== 'magna-vegetation-assets' || vegetation.version !== 1 || !Array.isArray(vegetation.assets) || vegetation.assets.length !== 1 || vegetation.assets[0]?.family !== 'grass') throw error('vegetation manifest must contain one prepared grass asset');
  const grass = vegetation.assets[0];
  required(resolved.vegetationAssets, grass.product, 'prepared grass meshes');
  for (const role of ['baseColor', 'normal', 'arm', 'alpha']) required(resolved.vegetationAssets, grass.sources?.[role], `grass ${role}`);
  const trees = json(resolved.treeAssets, 'tree manifest');
  if (trees?.format !== 'magna-tree-render-assets' || trees.version !== 1 || trees.digest !== profile.metadata.requiredTreeDigest) throw error(`tree manifest must use corrected digest ${profile.metadata.requiredTreeDigest}; got ${trees?.digest ?? 'none'}`);
  const correction = trees.albedoEncodingCorrection;
  if (correction?.source16bitRGBExact !== true || correction.alphaNormalizedValuesExact !== true || correction.allOriginalBinBytesRetained !== true || correction.geometryAccessorsMeshesUVNormalsTangentsMaterialsUnchanged !== true || correction.outputGlbSha256 !== trees.sourceGeometry?.sha256) throw error('tree manifest lacks the validated source-sRGB encoding correction');
  const geometry = required(resolved.treeAssets, trees.sourceGeometry, 'corrected tree geometry');
  if (sha(readFileSync(geometry)) !== correction.outputGlbSha256) throw error('corrected tree geometry SHA256 mismatch');
  for (const [role, value] of [['mask', trees.mask], ['lookup', trees.lookup]]) required(resolved.treeAssets, value, `tree ${role}`);
  if (!Array.isArray(trees.views) || trees.views.length !== 5) throw error('tree manifest must contain five prepared views');
  for (const view of trees.views) for (const role of ['color', 'normal']) required(resolved.treeAssets, view.products?.[role], `tree ${view.name ?? '?'} ${role}`);
  const overrides = Object.keys(flags).filter(key => String(defaults[key]) !== String(profile.defaults[key]));
  const effectiveSha256 = sha(JSON.stringify({ id: profile.metadata.id, profileSha256: profile.metadata.profileSha256, defaults: resolved, artifacts, treeDigest: trees.digest }));
  return { defaults: { ...defaults }, metadata: { ...profile.metadata, effectiveSha256, effectiveDefaults: resolved, artifacts, treeDigest: trees.digest, treeEncodingCorrectionVerified: true, runtimeFileCount: runtimeFiles.size, overrides } };
}

/** Expand only --render-profile; explicit caller values (including relative paths) win. */
export function applySurfaceRenderProfile(argv, options = {}) {
  const args = [...argv], selections = args.flatMap((value, index) => value === '--render-profile' ? [index] : []);
  if (!selections.length) return { args, profile: null };
  if (selections.length !== 1) throw error('--render-profile may be supplied only once');
  const at = selections[0], id = args[at + 1];
  if (!id || id.startsWith('--')) throw error('--render-profile requires an explicit profile id');
  args.splice(at, 2);
  const profile = loadSurfaceRenderProfile(id, options), defaults = { ...profile.defaults };
  for (const [key, flag] of Object.entries(flags)) {
    const found = args.flatMap((value, index) => value === flag ? [index] : []);
    if (found.length > 1) throw error(`duplicate ${flag} is ambiguous in a render profile`);
    if (found.length) {
      const value = args[found[0] + 1];
      if (!value || value.startsWith('--')) throw error(`${flag} requires a value`);
      defaults[key] = value;
    } else args.push(flag, String(defaults[key]));
  }
  return { args, profile: validateSurfaceRenderProfile(profile, { defaults, cwd: options.cwd }) };
}
