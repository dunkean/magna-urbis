/**
 * Regenerates the WGSL of the WebGPU 3D terrain view (src/ui/terrain3dGpu.ts) from the WebGL2 shaders of
 * Terrain3d (terrain3d.ts) and UrbanBuildingPass (urbanBuilding3d.ts).
 *
 *   npm run shaders:wgsl:3d       (from web/; needs cargo, RUSTUP_HOME as for the engine)
 *
 * Same route as the map shaders (wgsl_shaders.ts): GLSL ES 3.00 rewritten to Vulkan GLSL 450, translated,
 * validated and re-parsed by naga (rust/tools/glsl-wgsl). The rewrite:
 * - loose uniforms become one read-only std430 storage block per program (binding 0), shared by its
 *   stages; the byte offsets written to the generated module are checked against naga's struct;
 * - `sampler2D`/`sampler2DArray` become textures sampled through a shared sampler chosen per texture
 *   (`sampler2D(tex, sNearest|sLinear|sAniso|sRepeat)` at the call sites; texelFetch keeps none);
 * - the ground switches (groundEnabled, uRenderV2, uForest, uForestBrushes) become WGSL `override`s;
 * - unlike the map, the 3D view renders straight to the canvas, without flipping clip y: images keep their
 *   orientation, and the few window-space terms are rewritten to GL's convention instead (`dFdy` is
 *   negated, the sky's `gl_FragCoord.y` counted from the bottom);
 * - clip z is remapped from GL's [-w, w] to WebGPU's [0, w], so depth values equal GL's window depth.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERRAIN_3D_GLSL } from '../src/ui/terrain3d';
import { BUILDING_3D_GLSL } from '../src/ui/urbanBuilding3d';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const tool = join(root, 'rust/tools/glsl-wgsl');
const targetDir = join(root, 'rust/target/glsl-wgsl');
const output = join(root, 'web/src/ui/terrain3dWgsl.generated.ts');

/** Ground switches turned into WGSL overrides (pipeline constants by id). */
const OVERRIDES = ['groundEnabled', 'uRenderV2', 'uForest', 'uForestBrushes'] as const;

type SamplerKind = 'nearest' | 'linear' | 'aniso' | 'repeat';
/** Shared samplers: 1 non-filtering, 2 filtering (trilinear, clamped), 3 anisotropic (clamped), 4 anisotropic repeating. */
const SAMPLER_BINDING: Record<SamplerKind, number> = { nearest: 1, linear: 2, aniso: 3, repeat: 4 };
const SAMPLER_NAME: Record<SamplerKind, string> = { nearest: 'sNearest', linear: 'sLinear', aniso: 'sAniso', repeat: 'sRepeat' };
/** Texture bindings, with the sampler each texture is filtered with (its GL filter and wrap). */
const TEXTURES: Record<string, { binding: number; sampler: SamplerKind }> = {
  material: { binding: 5, sampler: 'aniso' }, previousMaterial: { binding: 6, sampler: 'aniso' }, macroField: { binding: 7, sampler: 'nearest' },
  uShoreRing: { binding: 8, sampler: 'linear' }, canopyWater: { binding: 9, sampler: 'linear' }, previousCanopyWater: { binding: 10, sampler: 'linear' },
  uForestField: { binding: 11, sampler: 'linear' }, uForestBank: { binding: 12, sampler: 'linear' }, uOccupation: { binding: 13, sampler: 'linear' },
  uForestBeach: { binding: 14, sampler: 'linear' }, uForestBrushAtlas: { binding: 15, sampler: 'linear' },
  albedoTex: { binding: 16, sampler: 'repeat' }, normalTex: { binding: 17, sampler: 'repeat' },
  // Only in the map's auxiliary-texture branch (#ifdef AUX_TEXTURE), never compiled here.
  uAux: { binding: 18, sampler: 'nearest' },
};
const TEXTURE_TYPE: Record<string, string> = { sampler2D: 'texture2D', usampler2D: 'utexture2D', sampler2DArray: 'texture2DArray' };
const TEXTURE_BUILTINS = 'texture|textureLod|texelFetch|textureSize|textureGrad|textureOffset|textureLodOffset|texelFetchOffset|textureQueryLevels';

/** WGSL host-shareable (= std430) size and alignment of a scalar, vector or matrix type. */
const LAYOUT: Record<string, { size: number; align: number }> = {
  float: { size: 4, align: 4 }, int: { size: 4, align: 4 }, uint: { size: 4, align: 4 }, bool: { size: 4, align: 4 },
  vec2: { size: 8, align: 8 }, ivec2: { size: 8, align: 8 }, uvec2: { size: 8, align: 8 },
  vec3: { size: 12, align: 16 }, ivec3: { size: 12, align: 16 }, uvec3: { size: 12, align: 16 },
  vec4: { size: 16, align: 16 }, ivec4: { size: 16, align: 16 }, uvec4: { size: 16, align: 16 },
  mat4: { size: 64, align: 16 },
};
interface ParamField { offset: number; type: string; count: number }
interface Uniform { type: string; name: string; count: number }

function closing(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i;
  }
  throw new Error('Unbalanced braces');
}

/** naga orders functions by definition: a prototype whose definition comes after its first callers fails
 * validation. Each such definition, with the later-defined functions it calls, moves to its prototype. */
function hoistPrototypes(source: string): string {
  let s = source;
  for (;;) {
    const depth = new Int32Array(s.length + 1);
    for (let i = 0, d = 0; i < s.length; i++) { depth[i] = d; if (s[i] === '{') d++; else if (s[i] === '}') d--; }
    const signature = /(?<=^|[;}\n])(\s*)([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*([{;])/g;
    const defs: { name: string; start: number; end: number }[] = [], prototypes: { name: string; start: number; end: number }[] = [];
    for (const m of s.matchAll(signature)) {
      const start = m.index! + m[1].length;
      if (depth[start] !== 0 || m[2] === 'return' || m[2] === 'else') continue;
      if (m[5] === ';') prototypes.push({ name: m[3], start, end: m.index! + m[0].length });
      else defs.push({ name: m[3], start, end: closing(s, m.index! + m[0].length - 1) + 1 });
    }
    const prototype = prototypes.find(p => defs.some(d => d.name === p.name && d.start > p.start));
    if (!prototype) return s;
    const later = defs.filter(d => d.start > prototype.start), needed = new Set([prototype.name]);
    for (let grown = true; grown;) {
      grown = false;
      for (const d of later) if (needed.has(d.name)) for (const call of s.slice(d.start, d.end).matchAll(/\b([A-Za-z_]\w*)\s*\(/g))
        if (!needed.has(call[1]) && later.some(l => l.name === call[1])) { needed.add(call[1]); grown = true; }
    }
    const moved = later.filter(d => needed.has(d.name));
    let rest = s;
    for (const d of [...moved].reverse()) rest = rest.slice(0, d.start) + rest.slice(d.end);
    s = rest.slice(0, prototype.start) + moved.map(d => s.slice(d.start, d.end)).join('\n') + rest.slice(prototype.end);
  }
}

/** Uniform declarations of a GLSL source (every preprocessor branch). */
function uniformsOf(source: string): Uniform[] {
  const result: Uniform[] = [];
  for (const m of source.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g)) {
    if (TEXTURE_TYPE[m[1]]) continue;
    for (const declarator of m[2].split(',')) {
      const d = /^\s*(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*$/.exec(declarator);
      if (!d) throw new Error(`Uniform declarator not understood: ${declarator}`);
      result.push({ type: m[1], name: d[1], count: d[2] ? Number(d[2]) : 0 });
    }
  }
  return result;
}

/** One storage block for the union of the stages' uniforms, with its byte layout. */
function paramsBlock(sources: string[]): { members: Uniform[]; fields: Record<string, ParamField>; size: number } {
  const members: Uniform[] = [], seen = new Map<string, Uniform>();
  for (const u of sources.flatMap(uniformsOf)) {
    if ((OVERRIDES as readonly string[]).includes(u.name)) continue;
    const previous = seen.get(u.name);
    if (previous) {
      if (previous.type !== u.type || previous.count !== u.count) throw new Error(`Uniform ${u.name} declared with two types`);
      continue;
    }
    seen.set(u.name, u); members.push(u);
  }
  const fields: Record<string, ParamField> = {};
  let offset = 0, maxAlign = 4;
  for (const u of members) {
    const l = LAYOUT[u.type];
    if (!l) throw new Error(`Uniform type ${u.type} not supported`);
    const stride = Math.ceil(l.size / l.align) * l.align;
    offset = Math.ceil(offset / l.align) * l.align;
    fields[u.name] = { offset, type: u.type, count: u.count };
    offset += u.count ? stride * u.count : l.size;
    maxAlign = Math.max(maxAlign, l.align);
  }
  return { members, fields, size: Math.max(16, Math.ceil(offset / maxAlign) * maxAlign) };
}

interface Rewrite { stage: 'vert' | 'frag'; source: string; block: Uniform[]; blockName: string; fragCoordHeight?: string }

/** GLSL ES 3.00 to Vulkan GLSL 450 for naga (see the header comment). */
function rewrite({ stage, source, block, blockName, fragCoordHeight }: Rewrite): string {
  let s = source.replace(/\r\n/g, '\n');
  if (!s.startsWith('#version 300 es\n')) throw new Error('Expected a GLSL ES 3.00 source');
  s = s.slice('#version 300 es\n'.length);
  s = s.replace(/\bprecision\s+(?:highp|mediump|lowp)\s+\w+\s*;/g, '').replace(/\b(?:highp|mediump|lowp)\s+/g, '');
  const textures = new Map<string, { type: string; sampler: SamplerKind }>();
  s = s.replace(/([(,]\s*)(sampler2D|usampler2D|sampler2DArray)\s+(\w+)(?=\s*[,)])/g, (_, lead: string, type: string, name: string) => {
    textures.set(name, { type, sampler: 'nearest' });
    return `${lead}${TEXTURE_TYPE[type]} ${name}`;
  });
  s = s.replace(/\buniform\s+(\w+)\s+([^;]+);/g, (_, type: string, list: string) => {
    const names = list.split(',').map(d => d.trim().replace(/\s*\[.*$/, ''));
    if (TEXTURE_TYPE[type]) {
      return names.map(name => {
        const t = TEXTURES[name];
        if (!t) throw new Error(`Texture ${name} has no binding`);
        textures.set(name, { type, sampler: t.sampler });
        return `layout(set=0,binding=${t.binding}) uniform ${TEXTURE_TYPE[type]} ${name};`;
      }).join('\n');
    }
    return names.map(name => {
      const id = (OVERRIDES as readonly string[]).indexOf(name);
      if (id >= 0) return `layout(constant_id=${id}) const ${type} ${name}=0;`;
      return '';
    }).join('');
  });
  s = s.replace(new RegExp(`\\b(${TEXTURE_BUILTINS})\\s*\\(\\s*(\\w+)\\s*,`, 'g'), (all, fn: string, name: string) => {
    const t = textures.get(name);
    return t ? `${fn}(${t.type}(${name},${SAMPLER_NAME[t.sampler]}),` : all;
  });
  const locations = { in: 0, out: 0 };
  s = s.replace(/(?<=^|[;\n])(\s*)((?:flat\s+)?(in|out)\s+\w+\s+\w+\s*;)/g, (_, space: string, declaration: string, direction: 'in' | 'out') =>
    `${space}layout(location=${locations[direction]++}) ${declaration}`);
  s = s.replace(/(?<=[;{}\n]\s*)(\w+)(\s+\w+\s*\[\s*\d+\s*\])\s*,/g, '$1$2; $1 ');
  s = hoistPrototypes(s);
  const head = ['#version 450'];
  if (stage === 'vert') {
    s = s.replace(/\bgl_VertexID\b/g, 'gl_VertexIndex').replace(/\bgl_InstanceID\b/g, 'gl_InstanceIndex');
    // GL clip z spans [-w, w], WebGPU's [0, w]: the remap keeps GL's window depth.
    const main = s.indexOf('void main()'), end = closing(s, s.indexOf('{', main));
    s = `${s.slice(0, end)}  gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;\n${s.slice(end)}`;
  } else {
    // WebGPU window y grows downwards: GL's dFdy is the negated WGSL dpdy, gl_FragCoord.y counts from the bottom.
    if (/\bdFdy\s*\(/.test(s)) {
      s = s.replace(/\bdFdy\s*\(/g, 'glDFdy(');
      head.push(...['float', 'vec2', 'vec3', 'vec4'].map(t => `${t} glDFdy(${t} v){return -dFdy(v);}`));
    }
    // Other gl_FragCoord uses sit in branches compiled out here (main() checks the WGSL).
    if (fragCoordHeight) s = s.replace(/\bgl_FragCoord\.y\b/g, `(${fragCoordHeight}-gl_FragCoord.y)`);
  }
  if (block.length) head.push(`layout(std430,set=0,binding=0) readonly buffer ${blockName} {\n${block.map(u => `  ${u.type} ${u.name}${u.count ? `[${u.count}]` : ''};`).join('\n')}\n};`);
  for (const kind of Object.keys(SAMPLER_BINDING) as SamplerKind[])
    if ([...textures.values()].some(t => t.sampler === kind)) head.push(`layout(set=0,binding=${SAMPLER_BINDING[kind]}) uniform sampler ${SAMPLER_NAME[kind]};`);
  // The dFdy helpers must follow the declarations they do not use but precede every use.
  const helpers = head.filter(line => line.includes('glDFdy')), declarations = head.filter(line => !line.includes('glDFdy'));
  return `${[...declarations, ...helpers].join('\n')}\n${s}`;
}

/** The struct naga emits for the block: member names in order, checked against the computed layout. */
function checkBlock(wgsl: string, blockName: string, members: Uniform[]): void {
  const struct = new RegExp(`struct ${blockName} \\{([^}]*)\\}`).exec(wgsl);
  if (!struct) throw new Error(`${blockName} missing from the WGSL`);
  if (/@(size|align)\(/.test(struct[1])) throw new Error(`${blockName}: naga padded the struct, the computed offsets would be wrong`);
  // naga's namer suffixes names ending in a digit, and reserved words, with '_'.
  const names = [...struct[1].matchAll(/(\w+)\s*:/g)].map(m => m[1].replace(/_$/, ''));
  if (names.join() !== members.map(m => m.name).join()) throw new Error(`${blockName}: member order differs from the computed layout`);
}

interface Job { key: string; stage: 'vert' | 'frag'; source: string; program: string; fragCoordHeight?: string }

function main(): void {
  const g = TERRAIN_3D_GLSL, b = BUILDING_3D_GLSL;
  const programs = {
    terrain: { sources: [g.vertex, g.ground, g.map], blockName: 'TerrainParams' },
    sky: { sources: [g.skyVertex, g.skyFragment], blockName: 'SkyParams' },
    building: { sources: [b.colorVertex, b.colorFragment, b.texVertex, b.texFragment], blockName: 'BuildingParams' },
  };
  const blocks = Object.fromEntries(Object.entries(programs).map(([name, p]) => [name, paramsBlock(p.sources)]));
  const jobs: Job[] = [
    { key: 'terrainVs', stage: 'vert', source: g.vertex, program: 'terrain' },
    { key: 'groundFs', stage: 'frag', source: g.ground, program: 'terrain' },
    { key: 'mapFs', stage: 'frag', source: g.map, program: 'terrain' },
    { key: 'skyVs', stage: 'vert', source: g.skyVertex, program: 'sky' },
    { key: 'skyFs', stage: 'frag', source: g.skyFragment, program: 'sky', fragCoordHeight: 'height' },
    { key: 'buildingColorVs', stage: 'vert', source: b.colorVertex, program: 'building' },
    { key: 'buildingColorFs', stage: 'frag', source: b.colorFragment, program: 'building' },
    { key: 'buildingTexVs', stage: 'vert', source: b.texVertex, program: 'building' },
    { key: 'buildingTexFs', stage: 'frag', source: b.texFragment, program: 'building' },
  ];
  const work = mkdtempSync(join(tmpdir(), 'glsl-wgsl-3d-'));
  try {
    const args: string[] = [];
    for (const job of jobs) {
      const program = programs[job.program as keyof typeof programs];
      const glsl = rewrite({ stage: job.stage, source: job.source, block: blocks[job.program].members, blockName: program.blockName, fragCoordHeight: job.fragCoordHeight });
      const input = join(work, `${job.key}.${job.stage}`);
      writeFileSync(input, glsl);
      args.push(job.stage, input, join(work, `${job.key}.wgsl`));
    }
    const jobsCount = Math.max(1, Math.min(22, cpus().length - 2));
    execFileSync('cargo', ['build', '--release', '--quiet', '-j', String(jobsCount)], { cwd: tool, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: targetDir } });
    const exe = join(targetDir, 'release', process.platform === 'win32' ? 'glsl-wgsl.exe' : 'glsl-wgsl');
    try { execFileSync(exe, args, { stdio: 'inherit' }); }
    catch { throw new Error(`naga failed; the rewritten GLSL is kept in ${work}`); }
    const wgsl: Record<string, string> = {};
    for (const job of jobs) {
      const text = readFileSync(join(work, `${job.key}.wgsl`), 'utf8');
      const members = blocks[job.program].members;
      if (members.length) checkBlock(text, programs[job.program as keyof typeof programs].blockName, members);
      if (job.stage === 'frag' && !job.fragCoordHeight && text.includes('@builtin(position)')) throw new Error(`${job.key}: gl_FragCoord needs a GL-convention rewrite`);
      // GLSL takes implicit derivatives in non-uniform control flow; WGSL's uniformity analysis would reject them.
      wgsl[job.key] = job.stage === 'frag' ? `diagnostic(off, derivative_uniformity);\n${text}` : text;
    }
    const layouts = Object.fromEntries(Object.entries(blocks).map(([name, block]) => [name, { size: block.size, fields: block.fields }]));
    const textures = Object.fromEntries(Object.entries(TEXTURES).map(([name, t]) => [name, t.binding]));
    const body = [
      '// Generated by web/scripts/wgsl_shaders_3d.ts (npm run shaders:wgsl:3d) from the WebGL2 3D view shaders: do not edit.',
      '/* eslint-disable */',
      `/** Pipeline override ids of the ground switches. */`,
      `export const WGSL3D_OVERRIDES = ${JSON.stringify(Object.fromEntries(OVERRIDES.map((name, id) => [name, id])))} as const;`,
      `/** Storage-block layout of each program (binding 0): byte offset, GLSL type and array length (0: scalar). */`,
      `export const WGSL3D_PARAMS: Record<string, { size: number; fields: Record<string, { offset: number; type: string; count: number }> }> = ${JSON.stringify(layouts)};`,
      `/** Texture bindings (group 0); samplers: 1 nearest, 2 linear, 3 anisotropic clamped, 4 anisotropic repeating. */`,
      `export const WGSL3D_TEXTURES: Record<string, number> = ${JSON.stringify(textures)};`,
      ...jobs.map(job => `export const ${job.key} = ${JSON.stringify(wgsl[job.key])};`),
      '',
    ].join('\n');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, body);
    console.log(`${output}: ${jobs.length} modules, ${(body.length / 1024).toFixed(0)} KiB`);
    rmSync(work, { recursive: true, force: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();
