/**
 * Regenerates the WGSL of the WebGPU map renderer (src/ui/terrainGpu.ts) from the WebGL2 map shaders.
 *
 *   npm run shaders:wgsl          (from web/; needs cargo, RUSTUP_HOME as for the engine)
 *
 * The GLSL ES 3.00 sources of TerrainGl (assembled from the material, forest, Render v2 and water modules)
 * are rewritten to Vulkan GLSL 450, then translated, validated and re-parsed by naga
 * (rust/tools/glsl-wgsl). The rewrite:
 * - loose uniforms become one read-only std430 storage block per program (binding 0), shared by its
 *   vertex and fragment stages; std430 equals the WGSL host-shareable layout, so the byte offsets
 *   written to the generated module are the ones the WGSL struct uses (checked against naga's output);
 * - `sampler2D`/`usampler2D`/`sampler2DArray` become textures, sampled through one of two shared samplers
 *   (`sampler2D(tex, sNearest|sLinear)` at the call sites; texelFetch keeps no sampler);
 * - the look switches (uMode, uRenderV2, uForest, uForestBrushes) become WGSL `override` constants,
 *   NATURAL / AUX_PASS / AUX_TEXTURE stay preprocessor defines: one module per combination;
 * - vertex shaders flip clip-space y, so WebGPU framebuffers hold the rows of the GL ones (gl_FragCoord,
 *   texelFetch of render targets and texture v coordinates keep their GL meaning); the renderer flips
 *   once when presenting.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITE_FS, COMPOSITE_VS, RIVER_FS, RIVER_VS, TERRAIN_FS, TERRAIN_VS } from '../src/ui/terrainGl';
import { RENDER_WATER_FS } from '../src/render/renderWaterShader';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const tool = join(root, 'rust/tools/glsl-wgsl');
const targetDir = join(root, 'rust/target/glsl-wgsl');
const output = join(root, 'web/src/ui/terrainWgsl.generated.ts');

/** Look switches turned into WGSL overrides (pipeline constants by id). */
const OVERRIDES = ['uMode', 'uRenderV2', 'uForest', 'uForestBrushes'] as const;

type SamplerKind = 'nearest' | 'linear';
/** Shared samplers: 1 non-filtering, 2 filtering (trilinear, clamped). */
const SAMPLER_BINDING: Record<SamplerKind, number> = { nearest: 1, linear: 2 };
const SAMPLER_NAME: Record<SamplerKind, string> = { nearest: 'sNearest', linear: 'sLinear' };
/** Texture bindings shared by every program, with the sampler each texture is filtered with
 * (the GL filter of the texture; texelFetch-only textures never use theirs). */
const TEXTURES: Record<string, { binding: number; sampler: SamplerKind }> = {
  uField: { binding: 3, sampler: 'nearest' }, uCave: { binding: 4, sampler: 'linear' }, uLake: { binding: 5, sampler: 'nearest' },
  uOverlay: { binding: 6, sampler: 'nearest' }, uCoastDistance: { binding: 7, sampler: 'nearest' }, uRefined: { binding: 8, sampler: 'nearest' },
  uPreviousRefined: { binding: 9, sampler: 'nearest' }, uForestField: { binding: 10, sampler: 'linear' }, uOccupation: { binding: 11, sampler: 'linear' },
  uForestBrushAtlas: { binding: 12, sampler: 'linear' }, uWaterLayer: { binding: 13, sampler: 'linear' }, uLayer: { binding: 14, sampler: 'linear' },
  uForestBank: { binding: 15, sampler: 'linear' }, uForestBeach: { binding: 16, sampler: 'linear' }, uShoreRing: { binding: 17, sampler: 'linear' },
  uAux: { binding: 18, sampler: 'nearest' },
};
const TEXTURE_TYPE: Record<string, string> = { sampler2D: 'texture2D', usampler2D: 'utexture2D', sampler2DArray: 'texture2DArray' };
const TEXTURE_BUILTINS = 'texture|textureLod|texelFetch|textureSize|textureGrad|textureOffset|textureLodOffset|texelFetchOffset|textureQueryLevels';

/** WGSL host-shareable (= std430) size and alignment of a scalar or vector type. */
const LAYOUT: Record<string, { size: number; align: number }> = {
  float: { size: 4, align: 4 }, int: { size: 4, align: 4 }, uint: { size: 4, align: 4 }, bool: { size: 4, align: 4 },
  vec2: { size: 8, align: 8 }, ivec2: { size: 8, align: 8 }, uvec2: { size: 8, align: 8 },
  vec3: { size: 12, align: 16 }, ivec3: { size: 12, align: 16 }, uvec3: { size: 12, align: 16 },
  vec4: { size: 16, align: 16 }, ivec4: { size: 16, align: 16 }, uvec4: { size: 16, align: 16 },
};
interface ParamField { offset: number; type: string; count: number }
interface Uniform { type: string; name: string; count: number }

/** Index of the brace closing the one at `open`. */
function closing(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i;
  }
  throw new Error('Unbalanced braces');
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

interface Rewrite { stage: 'vert' | 'frag'; source: string; defines?: Record<string, number>; block?: Uniform[]; blockName: string }

/** GLSL ES 3.00 to Vulkan GLSL 450 for naga (see the header comment). */
function rewrite({ stage, source, defines = {}, block, blockName }: Rewrite): string {
  let s = source.replace(/\r\n/g, '\n');
  if (!s.startsWith('#version 300 es\n')) throw new Error('Expected a GLSL ES 3.00 source');
  s = s.slice('#version 300 es\n'.length);
  s = s.replace(/\bprecision\s+(?:highp|mediump|lowp)\s+\w+\s*;/g, '').replace(/\b(?:highp|mediump|lowp)\s+/g, '');
  // The auxiliary pass writes its uint target only: its colour output becomes a private variable.
  if (defines.AUX_PASS) s = s.replace('layout(location=1) out vec4 outColor;', 'vec4 outColor;');
  // Sampler parameters of functions become textures, read with the non-filtering sampler.
  const textures = new Map<string, { type: string; sampler: SamplerKind }>();
  s = s.replace(/([(,]\s*)(sampler2D|usampler2D|sampler2DArray)\s+(\w+)(?=\s*[,)])/g, (_, lead: string, type: string, name: string) => {
    textures.set(name, { type, sampler: 'nearest' });
    return `${lead}${TEXTURE_TYPE[type]} ${name}`;
  });
  // Uniforms: textures get their bindings, look switches become overrides, the rest moves to the block.
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
  // Texture builtins take a constructed combined sampler.
  const combined: Record<string, string> = { sampler2D: 'sampler2D', usampler2D: 'usampler2D', sampler2DArray: 'sampler2DArray' };
  s = s.replace(new RegExp(`\\b(${TEXTURE_BUILTINS})\\s*\\(\\s*(\\w+)\\s*,`, 'g'), (all, fn: string, name: string) => {
    const t = textures.get(name);
    return t ? `${fn}(${combined[t.type]}(${name},${SAMPLER_NAME[t.sampler]}),` : all;
  });
  // Varyings and outputs without a location get one, in declaration order (both stages list them alike).
  const locations = { in: 0, out: 0 };
  s = s.replace(/(?<=^|[;\n])(\s*)((?:flat\s+)?(in|out)\s+\w+\s+\w+\s*;)/g, (_, space: string, declaration: string, direction: 'in' | 'out') =>
    `${space}layout(location=${locations[direction]++}) ${declaration}`);
  // naga gives every declarator of `float a[12], b` the array type: split after an array declarator.
  s = s.replace(/(?<=[;{}\n]\s*)(\w+)(\s+\w+\s*\[\s*\d+\s*\])\s*,/g, '$1$2; $1 ');
  if (stage === 'vert') {
    s = s.replace(/\bgl_VertexID\b/g, 'gl_VertexIndex').replace(/\bgl_InstanceID\b/g, 'gl_InstanceIndex');
    // WebGPU framebuffers are y-down: flipping clip y stores the GL rows (see the header comment).
    const main = s.indexOf('void main()'), end = closing(s, s.indexOf('{', main));
    s = `${s.slice(0, end)}  gl_Position.y = -gl_Position.y;\n${s.slice(end)}`;
  }
  const head = ['#version 450', ...Object.entries(defines).map(([name, value]) => `#define ${name} ${value}`)];
  if (block?.length) head.push(`layout(std430,set=0,binding=0) readonly buffer ${blockName} {\n${block.map(u => `  ${u.type} ${u.name}${u.count ? `[${u.count}]` : ''};`).join('\n')}\n};`);
  if ([...textures.values()].some(t => t.sampler === 'nearest')) head.push(`layout(set=0,binding=${SAMPLER_BINDING.nearest}) uniform sampler sNearest;`);
  if ([...textures.values()].some(t => t.sampler === 'linear')) head.push(`layout(set=0,binding=${SAMPLER_BINDING.linear}) uniform sampler sLinear;`);
  return `${head.join('\n')}\n${s}`;
}

/** The struct naga emits for the block: member names in order, checked against the computed layout. */
function checkBlock(wgsl: string, blockName: string, members: Uniform[]): void {
  const struct = new RegExp(`struct ${blockName} \\{([^}]*)\\}`).exec(wgsl);
  if (!struct) throw new Error(`${blockName} missing from the WGSL`);
  if (/@(size|align)\(/.test(struct[1])) throw new Error(`${blockName}: naga padded the struct, the computed offsets would be wrong`);
  // naga's namer suffixes names ending in a digit with '_' (uLight2 -> uLight2_).
  const names = [...struct[1].matchAll(/(\w+)\s*:/g)].map(m => m[1].replace(/(\d)_$/, '$1'));
  if (names.join() !== members.map(m => m.name).join()) throw new Error(`${blockName}: member order differs from the computed layout`);
}

interface Job { key: string; stage: 'vert' | 'frag'; source: string; defines?: Record<string, number>; program: string }

function main(): void {
  const programs = {
    terrain: { sources: [TERRAIN_VS, TERRAIN_FS], blockName: 'TerrainParams' },
    river: { sources: [RIVER_VS, RIVER_FS], blockName: 'RiverParams' },
    composite: { sources: [COMPOSITE_VS, COMPOSITE_FS], blockName: 'CompositeParams' },
    water: { sources: [COMPOSITE_VS, RENDER_WATER_FS], blockName: 'WaterParams' },
  };
  const blocks = Object.fromEntries(Object.entries(programs).map(([name, p]) => [name, paramsBlock(p.sources)]));
  const jobs: Job[] = [
    { key: 'terrainVs', stage: 'vert', source: TERRAIN_VS, program: 'terrain' },
    // Map fragment modules, with and without the auxiliary texture. NATURAL stays compiled in: the code it
    // guards only runs for uMode >= 2, and uMode is an override, so other looks drop it as dead code.
    { key: 'terrainFs', stage: 'frag', source: TERRAIN_FS, defines: { NATURAL: 1 }, program: 'terrain' },
    { key: 'terrainAuxTextureFs', stage: 'frag', source: TERRAIN_FS, defines: { NATURAL: 1, AUX_TEXTURE: 1 }, program: 'terrain' },
    { key: 'auxFs', stage: 'frag', source: TERRAIN_FS, defines: { NATURAL: 0, AUX_PASS: 1 }, program: 'terrain' },
    { key: 'riverVs', stage: 'vert', source: RIVER_VS, program: 'river' },
    { key: 'riverFs', stage: 'frag', source: RIVER_FS, program: 'river' },
    { key: 'compositeVs', stage: 'vert', source: COMPOSITE_VS, program: 'composite' },
    { key: 'compositeFs', stage: 'frag', source: COMPOSITE_FS, program: 'composite' },
    { key: 'waterFs', stage: 'frag', source: RENDER_WATER_FS, program: 'water' },
  ];
  const work = mkdtempSync(join(tmpdir(), 'glsl-wgsl-'));
  try {
    const jobs3: string[] = [];
    for (const job of jobs) {
      const program = programs[job.program as keyof typeof programs];
      const glsl = rewrite({ stage: job.stage, source: job.source, defines: job.defines, block: blocks[job.program].members, blockName: program.blockName });
      const input = join(work, `${job.key}.${job.stage}`);
      writeFileSync(input, glsl);
      jobs3.push(job.stage, input, join(work, `${job.key}.wgsl`));
    }
    const jobsCount = Math.max(1, cpus().length - 2);
    execFileSync('cargo', ['build', '--release', '--quiet', '-j', String(jobsCount)], { cwd: tool, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: targetDir } });
    const exe = join(targetDir, 'release', process.platform === 'win32' ? 'glsl-wgsl.exe' : 'glsl-wgsl');
    try { execFileSync(exe, jobs3, { stdio: 'inherit' }); }
    catch { throw new Error(`naga failed; the rewritten GLSL is kept in ${work}`); }
    const wgsl: Record<string, string> = {};
    for (const job of jobs) {
      const text = readFileSync(join(work, `${job.key}.wgsl`), 'utf8');
      const members = blocks[job.program].members;
      if (members.length) checkBlock(text, programs[job.program as keyof typeof programs].blockName, members);
      // GLSL takes implicit derivatives (texture, fwidth) in non-uniform control flow, as the GL quads do;
      // WGSL's uniformity analysis would reject them.
      wgsl[job.key] = job.stage === 'frag' ? `diagnostic(off, derivative_uniformity);\n${text}` : text;
    }
    const layouts = Object.fromEntries(Object.entries(blocks).map(([name, b]) => [name, { size: b.size, fields: b.fields }]));
    const textures = Object.fromEntries(Object.entries(TEXTURES).map(([name, t]) => [name, t.binding]));
    const body = [
      '// Generated by web/scripts/wgsl_shaders.ts (npm run shaders:wgsl) from the WebGL2 map shaders: do not edit.',
      '/* eslint-disable */',
      `/** Pipeline override ids of the look switches. */`,
      `export const WGSL_OVERRIDES = ${JSON.stringify(Object.fromEntries(OVERRIDES.map((name, id) => [name, id])))} as const;`,
      `/** Storage-block layout of each program (binding 0): byte offset, GLSL type and array length (0: scalar). */`,
      `export const WGSL_PARAMS: Record<string, { size: number; fields: Record<string, { offset: number; type: string; count: number }> }> = ${JSON.stringify(layouts)};`,
      `/** Texture bindings (group 0); samplers: 1 nearest (non-filtering), 2 linear (filtering). */`,
      `export const WGSL_TEXTURES: Record<string, number> = ${JSON.stringify(textures)};`,
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
