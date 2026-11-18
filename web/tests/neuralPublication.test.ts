import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { stageNeuralPublication } from '../scripts/neural_publication.mjs';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
    await rm(path, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'magna-neural-publication-test-'));
  temporary.push(root);
  const prepared = join(root, 'prepared'),
    output = join(root, 'output');
  await mkdir(join(prepared, 'models'), { recursive: true });
  const wasm = Buffer.from('identified wasm'),
    js = Buffer.from('identified JS');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(prepared, 'magna_urbis_neural_wasm_bg.wasm'), wasm);
  await writeFile(join(prepared, 'magna_urbis_neural_wasm.js'), js);
  const models: Record<string, { file: string; bytes: number; sha256: string }> = {};
  for (const name of ['coarse', 'base', 'decoder']) {
    const bytes = Buffer.alloc(name === 'base' ? 40_000_001 : 7, 42),
      file = `${name}.bin`;
    models[name] = { file, bytes: bytes.length, sha256: hash(bytes) };
    await writeFile(join(prepared, 'models', file), bytes);
  }
  const manifest = { profile: 'test', runtimeSha256: hash(wasm), engineRevision: 'pinned', models };
  await writeFile(join(prepared, 'models/manifest.json'), JSON.stringify(manifest));
  return { prepared, output, manifest, hash };
}
describe('same-origin neural publication', () => {
  it('publishes identified runtime, licences and small chunks without a whole base file', async () => {
    const { prepared, output, hash } = await fixture();
    const manifest = await stageNeuralPublication(prepared, output);
    expect(manifest.models.base.chunks?.map(part => part.bytes)).toEqual([40_000_000, 1]);
    expect(await readdir(join(output, 'models'))).not.toContain('base.bin');
    const assembled = Buffer.concat(
      await Promise.all(
        manifest.models.base.chunks!.map(async part => {
          const bytes = await readFile(join(output, 'models', part.file));
          expect(hash(bytes)).toBe(part.sha256);
          return bytes;
        }),
      ),
    );
    expect(hash(assembled)).toBe(manifest.models.base.sha256);
    expect(await readdir(output)).toEqual(expect.arrayContaining(['LICENSE-NEURAL-MODELS.txt', 'LICENSE-TEACHER.txt']));
    expect(JSON.parse(await readFile(join(prepared, 'models/manifest.json'), 'utf8')).models.base.chunks).toBeUndefined();
  });
  it('refuses runtime mismatch before staging public files', async () => {
    const { prepared, output } = await fixture();
    await writeFile(join(prepared, 'magna_urbis_neural_wasm_bg.wasm'), 'wrong runtime');
    await expect(stageNeuralPublication(prepared, output)).rejects.toThrow('manifest.runtimeSha256');
    await expect(readdir(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses damaged model files', async () => {
    const { prepared, output } = await fixture();
    await writeFile(join(prepared, 'models/base.bin'), 'wrong weights');
    await expect(stageNeuralPublication(prepared, output)).rejects.toThrow('model integrity failure: base');
  });
});
