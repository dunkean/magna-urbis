#!/usr/bin/env node
/** Fetch a reproducible PBR library; no network is needed by the renderer afterward. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`Missing --${name} value`);
  return args[at + 1];
};
const cataloguePath = resolve(option('catalogue', resolve(repository, 'surface/materials/catalogue.json')));
const out = resolve(option('out', resolve(repository, 'web/out/surface-assets')));
const resolution = option('resolution', '1k');
if (!['1k', '2k', '4k'].includes(resolution)) throw new Error('Resolution must be 1k, 2k or 4k.');
const only = option('only', '').split(',').filter(Boolean);
const offline = args.includes('--offline');
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const scoped = (...parts) => {
  const path = resolve(out, ...parts), rel = relative(out, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Asset path escapes output directory');
  return path;
};
async function json(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'MagnaUrbis-SurfaceAssets/1.0' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.json();
}
async function existing(path, expected, algorithm) {
  try { const bytes = await readFile(path); return hash(bytes, algorithm) === expected ? bytes : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'));
if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.materials)) throw new Error('Unsupported material catalogue');
await mkdir(out, { recursive: true });
const manifestPath = scoped('resolved.json');
if (offline) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const material of manifest.materials) for (const map of Object.values(material.maps)) {
    const file = scoped(map.relativePath);
    if (!await existing(file, map.sha256, 'sha256')) throw new Error(`Missing or changed asset: ${file}`);
  }
  process.stdout.write(`Verified ${manifest.materials.length} cached PBR materials offline\n`);
  process.exit(0);
}
const mapKeys = { baseColor: ['Diffuse', 'jpg'], normal: ['nor_gl', 'png'], roughness: ['Rough', 'jpg'], height: ['Displacement', 'png'] };
const materials = [];
for (const entry of catalogue.materials.filter(e => !only.length || only.includes(e.id) || only.includes(e.assetId))) {
  if (!/^[a-z0-9_-]+$/.test(entry.assetId)) throw new Error(`Invalid asset id: ${entry.assetId}`);
  const [files, info] = await Promise.all([json(`https://api.polyhaven.com/files/${entry.assetId}`), json(`https://api.polyhaven.com/info/${entry.assetId}`)]);
  const material = { ...entry, source: `https://polyhaven.com/a/${entry.assetId}`, license: catalogue.license,
    normalConvention: 'opengl', providerDimensions: info.dimensions ?? null,
    scaleProvenance: 'authored-rendering-scale', maps: {} };
  const downloads = Object.entries(mapKeys).map(async ([key, [providerKey, preferred]]) => {
    const variants = files[providerKey]?.[resolution];
    const selected = variants?.[preferred] ?? variants?.png ?? variants?.jpg;
    if (!selected) { if (key === 'height') return; throw new Error(`No ${key}/${resolution} for ${entry.assetId}`); }
    const url = new URL(selected.url);
    if (url.protocol !== 'https:' || url.hostname !== 'dl.polyhaven.org') throw new Error('Unexpected asset host');
    const extension = url.pathname.match(/\.(jpg|png|exr)$/)?.[1];
    if (!extension) throw new Error('Unsupported map format');
    const relativePath = `${entry.assetId}/${key}-${resolution}.${extension}`;
    const path = scoped(relativePath);
    await mkdir(dirname(path), { recursive: true });
    let bytes = await existing(path, selected.md5, 'md5');
    if (!bytes) {
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes, 'md5') !== selected.md5) throw new Error(`Provider checksum mismatch: ${relativePath}`);
      const temporary = `${path}.part`;
      try { await writeFile(temporary, bytes); await rename(temporary, path); }
      catch (error) { await rm(temporary, { force: true }); throw error; }
    }
    material.maps[key] = { path, relativePath, url: selected.url, sha256: hash(bytes), providerMD5: selected.md5, bytes: bytes.length };
  });
  const results = await Promise.allSettled(downloads);
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) throw new AggregateError(failed.map(r => r.reason), `Failed material ${entry.id}`);
  materials.push(material);
  process.stdout.write(`Ready ${entry.id}: ${Object.keys(material.maps).length} maps\n`);
}
const manifest = { schemaVersion: 1, catalogueSha256: hash(await readFile(cataloguePath)), resolution,
  license: catalogue.license, licenseUrl: catalogue.licenseUrl, scalePolicy: catalogue.scalePolicy, materials };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`${manifestPath}\n`);
