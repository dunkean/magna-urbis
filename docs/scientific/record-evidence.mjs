// Deliberately explicit asset inventory. No generated illustration is evidence.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { collectReports } from './collect-reports.mjs';
import { recordLocalization } from './record-localization.mjs';
const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const v1 = await json('docs/images/screenshots.json');
const norse = await json('web/out/city-visual-bench/03-validated/03-norse-hamlet.json');
const report = await json('web/out/city-visual-bench/03-validated/report.json');
const canopy = await json('docs/surface/evidence/canopy-v9/manifest.json');
const v2Report = await json('web/out/v2-browser/results.json');
const figures = [
  { file: 'medieval-city.png', source: 'docs/images/medieval-city.png', kind: 'application-screenshot', engine: 'TypeScript V1', recipe: v1.screenshots.find(x => x.image === 'medieval-city.png'), capturedAt: null, sourceCommit: null },
  { file: 'desert-medina.png', source: 'docs/images/desert-medina.png', kind: 'application-screenshot', engine: 'TypeScript V1', recipe: v1.screenshots.find(x => x.image === 'desert-medina.png'), capturedAt: null, sourceCommit: null },
  { file: 'island-tropical.jpg', source: 'docs/rust_images/island-tropical.jpg', kind: 'application-screenshot', engine: 'Rust terrain/settlements prototype', recipe: null, capturedAt: null, sourceCommit: null, limitation: 'Source folder supplies no exact recipe, date or source commit. Illustrative only.' },
  { file: 'norse-quarters.png', source: 'web/out/city-visual-bench/03-validated/03-norse-hamlet.png', kind: 'diagnostic-screenshot', engine: 'City Bench + Rust native', capturedAt: report.started, sourceCommit: report.sourceHead, recipe: { id: norse.id, title: norse.title, population: norse.population, culture: norse.culture, artifact: norse.artifact, architecture: norse.architecture, gate: norse.gate, camera: norse.camera, visualVerdict: norse.visualVerdict, status: norse.status, limitations: norse.limitations }, limitation: 'Historical needs_rework verdict. No visually discernible house ensemble; this figure is not evidence of successful built occupation.' },
  { file: 'canopy-640m.png', source: 'docs/surface/evidence/canopy-v9/top-640m.png', kind: 'diagnostic-screenshot', engine: 'Local Godot surface viewer, canopy-v9 campaign', capturedAt: canopy.recordedAtUtc, sourceCommit: canopy.nativeCommit, recipe: { sourceScope: canopy.sourceScope, retainedInputSha256: canopy.input.sha256, view: 'top 640 m', sourceManifest: 'docs/surface/evidence/canopy-v9/manifest.json' }, limitation: 'Retained source, no new neural generation. Different viewer from web Render3D.' },
  { file: 'ground-overview.webp', source: 'docs/methods/images/render3d-ground-overview.webp', kind: 'application-screenshot', engine: 'Render3D method note', recipe: null, capturedAt: null, sourceCommit: null, limitation: 'Illustrative screenshot supplied by the ground method note; exact capture recipe not recorded beside the asset.' },
  { file: 'v2-topography.png', source: 'web/out/v2-browser/01-topography.png', kind: 'application-screenshot', engine: 'Atelier V2, CPU TypeScript', capturedAt: v2Report.time, sourceCommit: null, recipe: { seed: 'v2-ui-evidence', mapSize: 2400, relief: 'flat', coast: 'none', river: 'stream', stage: 'terrain', evidence: v2Report.checks.terrain }, limitation: 'New V2 UI integration replay, not a Rust urban benchmark. Source working tree in active development.' },
  { file: 'v2-placements.png', source: 'web/out/v2-browser/02-placements.png', kind: 'application-screenshot', engine: 'Atelier V2, CPU TypeScript', capturedAt: v2Report.time, sourceCommit: null, recipe: { seed: 'v2-ui-evidence', mapSize: 2400, relief: 'flat', coast: 'none', river: 'stream', stage: 'region', settlementCount: 2, mainRequestedPopulation: 300, evidence: v2Report.checks.region }, limitation: 'Sites and regional routes only; no town plan built in this capture.' },
];
await mkdir(resolve(dir, 'assets'), { recursive: true });
for (const figure of figures) {
  const bytes = await readFile(resolve(root, figure.source));
  await copyFile(resolve(root, figure.source), resolve(dir, 'assets', figure.file));
  figure.sha256 = hash(bytes); figure.bytes = bytes.length; figure.transformation = 'none; byte-for-byte copy';
}
for (const file of ['pipeline.svg', 'hydrology.svg', 'capacity.svg', 'parcel.svg']) {
  const bytes = await readFile(resolve(dir, 'assets', file));
  figures.push({ file, kind: 'original-educational-vector-diagram', source: `docs/scientific/assets/${file}`, sha256: hash(bytes), bytes: bytes.length, limitation: 'Schematic, not measured output; not to scale.' });
}
const html = await readFile(resolve(dir, 'index.html'), 'utf8');
// Export serialization is part of the documentation's reproducibility boundary,
// even though the page links to its method note instead of this implementation.
const paths = [...new Set([...html.matchAll(/data-repo="([^"]+)"/g)].map(x => x[1]).concat('web/src/render/svg.ts'))].sort();
const linkedSources = [];
for (const path of paths) { const bytes = await readFile(resolve(root, path)); linkedSources.push({ path, sha256: hash(bytes), bytes: bytes.length }); }
const externalReferences = [...new Set([...html.matchAll(/href="(https?:[^"]+)"/g)].map(x => x[1].replaceAll('&amp;', '&')))].filter(x => !x.startsWith('https://github.com/dunkean/magna-urbis/'));
const integrationReports = await collectReports();
const manifest = {
  schema: 'magna-urbis-scientific-documentation-v1', recordedAt: new Date().toISOString(), documentationDate: '2026-10-28',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceCaveat: 'Active shared working tree, including pre-existing local changes. Hashes identify linked files as read at record time; HEAD alone does not identify those contents. No new full scientific benchmark is claimed.',
  figures, linkedSources, externalReferences, integrationReports,
  bibliographyReview: { reviewedOn: '2026-10-28', method: 'Primary author, publisher or official project pages opened through web browsing; DOI failures handled explicitly.', braunWillett: 'Publisher DOI could not be fetched. Bibliographic metadata verified against the author institutional record at https://gfzpublic.gfz.de/pubman/faces/ViewItemFullPage.jsp?itemId=item_1945954_3' },
};
await recordLocalization(manifest);
await writeFile(resolve(dir, 'evidence.json'), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(resolve(root, 'web/out/v2-browser/results.json'), resolve(dir, 'v2-browser-evidence.json'));
console.log(`Recorded ${figures.length} figures, ${linkedSources.length} linked source files and ${externalReferences.length} primary/project URLs.`);
