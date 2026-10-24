import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { growthPhaseCultureHtml, growthStepLabel } from '../src/ui/urbanGrowthEvidence';
import { programmePolicyControlsHtml } from '../src/ui/urbanProgrammePolicy';
import { defaultLayoutConfig, normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';

const source = readFileSync(new URL('../src/ui/terrainUrban.ts', import.meta.url), 'utf8');
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Execute the ACTUAL compositionReport body, not a reimplementation. Only its
 * scalar DOM output sink is replaced. No DOM/browser/native generation proof. */
function renderRetained(layouts: unknown[], requestedCulture: string) {
  const tree = ts.createSourceFile('terrainUrban.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions: ts.FunctionDeclaration[] = [];
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'compositionReport') functions.push(n);
    ts.forEachChild(n, visit);
  } visit(tree);
  if (functions.length !== 1) throw new Error('Expected unique real compositionReport.');
  const box = { innerHTML: '', replaceChildren() { this.innerHTML = ''; } }, resolution = { innerHTML: '' };
  const env = { layouts, enabled: true, layoutConfig: { culture: requestedCulture, mixCulture: requestedCulture },
    one(_kind: string, selector: string) { return selector === '[data-composition]' ? box : resolution; },
    esc: escape, growthPhaseCultureHtml, growthStepLabel, morphologyEvidenceHtml() { return ''; },
    mechanisms: {}, families: {}, tissues: {}, zoneColors: {}, phaseLabel() { return 'Phase conservée'; }, shapeArea() { return 0; } };
  const js = ts.transpileModule(`function render(env) {
    const { layouts, enabled, layoutConfig, one, esc, growthPhaseCultureHtml, growthStepLabel, morphologyEvidenceHtml,
      mechanisms, families, tissues, zoneColors, phaseLabel, shapeArea } = env;
    let reportedLayouts, compositionEnabled;
    ${functions[0].getText(tree)}
    compositionReport();
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (js.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Actual report parse failed.');
  new Function('env', js.outputText + '\nrender(env);')(env);
  return box.innerHTML;
}
const phase = (culture?: string) => ({ culture, kind: 'growth', zone: 'core', recipe: 'retained-recipe', population: 300, targetArea: 900, shapes: [] });
const plan = (phases: unknown[]) => ({ key: 'retained-plan', archetype: 'town', quarters: [], phases });

it('actual composition uses each returned phase culture, independent of requested plan and mix cultures', () => {
  const layouts = [plan([phase('javanese-courts'), phase('roman-core')])], before = JSON.stringify(layouts);
  const a = renderRetained(layouts, 'european-organic'), b = renderRetained(layouts, 'maori-pa');
  expect(a).toBe(b);
  expect(a).toContain('data-culture="javanese-courts"'); expect(a).toContain('data-culture="roman-core"');
  expect(a).not.toContain('european-organic'); expect(a).not.toContain('maori-pa');
  expect(JSON.stringify(layouts)).toBe(before);
});
it('actual old import with absent or null phase culture stays unknown and does not borrow a neighboring culture', () => {
  const layouts = JSON.parse(JSON.stringify([plan([phase('roman-core'), phase(), { ...phase(), culture: null }])]));
  const before = JSON.stringify(layouts), html = renderRetained(layouts, 'javanese-courts');
  expect(html.match(/inconnu · non renseigné dans cette phase/g)).toHaveLength(2);
  expect(html.match(/data-culture="roman-core"/g)).toHaveLength(1);
  expect(html).not.toContain('javanese-courts'); expect(JSON.stringify(layouts)).toBe(before);
});
it('unknown catalogue IDs stay exact and escaped, without a guessed catalogue/default/history label', () => {
  const token = 'future-profile/<&>"\'';
  const html = renderRetained([plan([phase(token)])], 'roman-core');
  expect(html).toContain(`data-culture="${escape(token)}"`); expect(html).toContain(`Profil urbain enregistré : ${escape(token)}`);
  expect(html).not.toContain('roman-core'); expect(html).not.toContain('historiquement validé');
});
it('missing empty null and malformed culture evidence remains explicitly unknown without mutation', () => {
  for (const p of [undefined, null, {}, { culture: '' }, { culture: null }, { culture: 42 }]) {
    const before = JSON.stringify(p), html = growthPhaseCultureHtml(p);
    expect(html).toContain('inconnu'); expect(html).not.toContain('data-culture='); expect(JSON.stringify(p)).toBe(before);
  }
  expect(growthPhaseCultureHtml({ culture: ' site ' })).toContain('data-culture=" site "');
});
it('actual retained history renders ordinal steps and preserves data-epoch identity and phase keys', () => {
  const l = { ...plan([phase('roman-core')]), structure: { mechanism: 'accessibility', family: 'organic', districts: [], history: [
    { epoch: 0, kind: 'foundation', center: 0, area: 100 }, { epoch: 2, kind: 'growth', center: 1, area: 200 },
  ] } }, before = JSON.stringify(l);
  const html = renderRetained([l], 'javanese-courts');
  expect(html).toContain('data-epoch="0">Étape 1'); expect(html).toContain('data-epoch="2">Étape 3');
  expect(html).toContain('sans datation historique enregistrée'); expect(html).not.toContain('Époque 1');
  expect(html).toContain('data-phase="0"'); expect(JSON.stringify(l)).toBe(before);
  expect(growthStepLabel(4)).toBe('Étape 5');
});
it('both real UI controls rename ordinal wording only, retaining epochs IDs and bounds', () => {
  expect(source).toContain("footprintNumber('epochs', 'Étapes de croissance', 1, 5)");
  const workshop = readFileSync(new URL('../src/ui/testbench.ts', import.meta.url), 'utf8');
  expect(workshop).toContain('Étapes de croissance<input data-city-footprint="epochs" type="number" min="1" max="5">');
  expect(source).not.toContain('Époques de croissance'); expect(workshop).not.toContain('Époques de croissance');
});
it('historical source period controls remain separate and unchanged; persisted ordinal values roundtrip', () => {
  const html = programmePolicyControlsHtml();
  expect(html).toContain('Filtre d’époque'); expect(html).toContain('data-programme="period"');
  expect(html).toContain('value="A"'); expect(html).toContain('value="M"'); expect(html).not.toContain('Étapes de croissance');
  const config = defaultLayoutConfig(); config.footprint.epochs = 4; config.programme.period = 'M';
  const restored = normalizeLayoutConfig(JSON.parse(JSON.stringify(config)));
  expect(restored.footprint.epochs).toBe(4); expect(restored.programme.period).toBe('M');
});
