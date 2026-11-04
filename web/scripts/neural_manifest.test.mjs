import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateNeuralManifest } from './neural_manifest.mjs';

test('conditioning rebuild updates only the runtime hash in an existing manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'neural-manifest-'));
  try {
    await mkdir(join(root, 'models'));
    await writeFile(join(root, 'magna_urbis_neural_wasm_bg.wasm'), 'abc');
    await writeFile(join(root, 'models/manifest.json'), JSON.stringify({runtimeSha256: 'old', upstreamRuntimeSha256: 'original', profile: 'existing'}));
    await updateNeuralManifest(root, {conditioningOnly: true});
    assert.deepEqual(JSON.parse(await readFile(join(root, 'models/manifest.json'), 'utf8')), {
      runtimeSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', upstreamRuntimeSha256: 'original', profile: 'existing'
    });
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('conditioning-only with no models does not create a manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'neural-manifest-'));
  try {
    assert.equal(await updateNeuralManifest(root, {conditioningOnly: true}), false);
    await assert.rejects(readFile(join(root, 'models/manifest.json')), {code: 'ENOENT'});
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('full build retains the upstream runtime hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'neural-manifest-'));
  try {
    await mkdir(join(root, 'models'));
    await writeFile(join(root, 'magna_urbis_neural_wasm_bg.wasm'), 'abc');
    await writeFile(join(root, 'models/manifest.json'), JSON.stringify({runtimeSha256: 'upstream'}));
    await updateNeuralManifest(root);
    assert.equal(JSON.parse(await readFile(join(root, 'models/manifest.json'), 'utf8')).upstreamRuntimeSha256, 'upstream');
  } finally { await rm(root, {recursive: true, force: true}); }
});
