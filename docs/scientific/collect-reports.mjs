import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../..');
const sources = [
  ['web/out/v2-rust-urban/results.json', 'v2-rust-urban.json', 'Four urban stages through Rust/WASM; local house invalidation, bounded to the recorded case.'],
  ['web/out/v2-native-urban/results.json', 'v2-native-urban.json', 'Four urban stages through the local Rust service; not a WASM/native numerical equivalence proof.'],
  ['web/out/v2-compose-browser/results.json', 'v2-compose-browser.json', 'Browser replay of territory/urban-recipe composition, exact retained physical hash, cache and reconstruction.'],
  ['web/out/v2-platform-check.json', 'v2-platform.json', 'Procedural CPU/GPU/native and neural WebGPU/Python-CUDA execution, with model identities.'],
  ['web/out/v2-desktop-startup.json', 'v2-desktop-startup.json', 'Observed Windows app startup and its child Rust service on loopback, not cross-platform installation validation.'],
];
export async function collectReports() {
  const reports = [];
  await mkdir(resolve(dir, 'evidence'), { recursive: true });
  for (const [source, file, scope] of sources) {
    const path = resolve(root, source), bytes = await readFile(path), metadata = await stat(path);
    JSON.parse(bytes.toString('utf8'));
    await copyFile(path, resolve(dir, 'evidence', file));
    reports.push({ file, source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sourceFileModifiedAt: metadata.mtime.toISOString(), scope, transformation: 'none; byte-for-byte copy' });
  }
  const provenance = { collectedAt: new Date().toISOString(), caveat: 'Reports are bounded functional integration cases produced on a shared development machine. Collection time and source file modification time are not necessarily execution time. Source files may continue to evolve; these copies retain the exact report bytes collected.', reports };
  await writeFile(resolve(dir, 'evidence/report-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const provenance = await collectReports();
  console.log(`Collected ${provenance.reports.length} V2 integration reports without refreshing source-code fingerprints.`);
}
