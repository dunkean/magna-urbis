/** Test-only harness of exact production method bodies. It supplies just the
 * scalar controls those methods read, not a browser or a native engine. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import catalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import { retainSelectValue } from '../../src/ui/retainedSelectValue';
import { readUrbanHouseModel, urbanHouseModelCode } from '../../src/ui/urbanHouseModel';
import { defaultProgrammeContext } from '../../../rust/bridge/urbanConfig';
import type { UrbanBuildingDraft, UrbanBuildingState, UrbanBuildingGenerateResult } from '../../src/ui/urbanBuildingsPanel';
import type { PlacementBatchSettings } from '../../../rust/bridge/urbanArchitecture';

class ScalarControl {
  private scalar = ''; checked = true; hidden = false; disabled = false; textContent = '';
  readonly attributes = new Map<string, string>();
  get value() { return this.scalar; } set value(value: unknown) { this.scalar = String(value); }
  checkValidity() { return true; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
}
class OptionControl {
  private token = ''; textContent: string | null = ''; title = ''; dataset: Record<string, string> = {}; parent?: SelectControl;
  get value() { return this.token; } set value(value: unknown) { this.token = String(value); }
  remove() { if (this.parent) this.parent.options.splice(this.parent.options.indexOf(this), 1); }
}
export class SelectControl extends ScalarControl {
  options: OptionControl[] = []; private selected = '';
  ownerDocument = { createElement: (_: string) => new OptionControl() };
  constructor(values: string[]) { super(); for (const value of values) { const o = new OptionControl(); o.value = value; this.add(o); } }
  add(option: OptionControl) { option.parent = this; this.options.push(option); }
  // Real select assignment does not create a missing option. DOMString tokens
  // are exact, and a non-existing value leaves the control empty.
  override get value() { return this.selected; }
  override set value(value: unknown) { const token = String(value); this.selected = this.options.some(o => o.value === token) ? token : ''; }
}
interface Api {
  restoreDraft(draft?: UrbanBuildingDraft): void;
  captureDraft(): UrbanBuildingDraft | undefined;
  restore(saved?: UrbanBuildingState): void;
  setBuildingDraft(saved?: UrbanBuildingState): void;
  generate(applied?: Pick<UrbanBuildingState, 'seed' | 'settings'>): Promise<void>;
}
/** No method logic is reimplemented: AST locates bodies inside the actual panel
 * factory; TypeScript only strips their existing types. BASE uses the same path
 * through URBAN_BUILDING_DRAFT_SOURCE, without replacing live/candidate files. */
function productionFactory() {
  const path = process.env.URBAN_BUILDING_DRAFT_SOURCE ?? fileURLToPath(new URL('../../src/ui/urbanBuildingsPanel.ts', import.meta.url));
  const source = readFileSync(path, 'utf8'), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const panel = tree.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'createUrbanBuildingsPanel');
  if (!panel?.body) throw new Error('Production panel factory missing.');
  const names = ['restoreDraft', 'captureDraft', 'restore', 'setBuildingDraft'], methods = new Map<string, ts.MethodDeclaration[]>();
  const generators: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) methods.set(node.name.text, [...methods.get(node.name.text) ?? [], node]);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'generate') generators.push(node);
    ts.forEachChild(node, visit);
  }; visit(panel.body);
  if (generators.length !== 1 || names.some(name => methods.get(name)?.length !== 1)) throw new Error('Expected exact unique production methods.');
  const declarations = names.map(name => methods.get(name)![0].getText(tree));
  const compiled = ts.transpileModule(`function create(env) {
    const { $, architectureCulture, retainSelectValue, readUrbanHouseModel, urbanHouseModelCode, options, model, state, syncProgramme, report, buildingStyle } = env;
    let epoch = 0, busy = false;
    ${generators[0].getText(tree)}
    return { ${declarations.join(',')} , generate };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('Production method parse failed.');
  return { source, create: new Function('env', compiled.outputText + '\nreturn create(env);') };
}
export function buildingDraftHarness(reject?: string) {
  const production = productionFactory(), nodes = new Map<string, ScalarControl>();
  const keys = ['building-seed', 'building-floors', 'building-house-model', 'building-fit', 'building-draft', 'buildings-generate', 'buildings-status', 'building-visible', 'building-3d'];
  for (const key of keys) nodes.set(`[data-${key}]`, new ScalarControl());
  const html = production.source.match(/<select data-building-typology>([\s\S]*?)<\/select>/)?.[1];
  if (!html) throw new Error('Actual typology select missing.');
  const typology = new SelectControl([...html.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]));
  nodes.set('[data-building-typology]', typology); nodes.set('[data-building-style]', new SelectControl(['cartographic']));
  nodes.set('[data-building-diagnostic]', new SelectControl(['none', 'uses', 'height', 'access']));
  const architectureCulture = new SelectControl(['', ...Object.keys(catalogue.cultures)]);
  const $ = (selector: string): ScalarControl => { const node = nodes.get(selector); if (!node) throw new Error('Unexpected production control read: ' + selector); return node; };
  const state: UrbanBuildingState = { seed: '', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' } };
  const generated: { seed: string; settings: PlacementBatchSettings }[] = [], applied: unknown[][] = [];
  const empty: UrbanBuildingGenerateResult = { scene: { schema_version: '1', generator_version: 'SYNTHETIC-controlled-draft-consumer', buildings: [], refusals: [], open_spaces: [], materials: [] } };
  const options = { getProgramme: defaultProgrammeContext, onChange() {}, async generate(seed: string, settings: PlacementBatchSettings) {
    generated.push({ seed, settings: structuredClone(settings) }); if (reject) throw new Error(reject); return empty;
  } };
  const model = { restore(next: UrbanBuildingState) { for (const key of Object.keys(state)) Reflect.deleteProperty(state, key); Object.assign(state, next); },
    applyGenerated(...args: unknown[]) { applied.push(args); } };
  const api: Api = production.create({ $, architectureCulture, retainSelectValue, readUrbanHouseModel, urbanHouseModelCode, options, model, state,
    syncProgramme() {}, report() {}, buildingStyle: 'cartographic' });
  return { api, architectureCulture, typology, generated, applied, node: $, source: production.source };
}
