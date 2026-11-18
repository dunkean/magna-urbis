import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as generated from '../src/ui/terrainWgsl.generated';
import * as generated3d from '../src/ui/terrain3dWgsl.generated';

// WGSL reserved words (spec "Reserved Words"): an identifier spelled like one fails to compile on recent
// Tint ("'from' is a reserved keyword"), so no shader may use them as variable, parameter, member or function names.
const RESERVED = new Set(
  `NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become
cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast
consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export
extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements
import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace
new nil noexcept noinline nointerpolation non_coherent noncoherent noperspective null nullptr of operator package
packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless
register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast
std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless
unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield`.split(/\s+/),
);

const root = join(__dirname, '..', '..');

/** Reserved words used as tokens in `code`, with their 1-based line, comments ignored. */
function reservedTokens(code: string): string[] {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
  const hits: string[] = [];
  bare.split('\n').forEach((line, i) => {
    for (const token of line.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) if (RESERVED.has(token)) hits.push(`${i + 1}: ${token}`);
  });
  return hits;
}

/** Every WGSL source the app compiles: hand-written modules, generated map/3D modules and inline WGSL literals. */
function sources(): [string, string][] {
  const out: [string, string][] = [];
  const bridge = join(root, 'rust', 'bridge');
  for (const name of readdirSync(bridge).filter(file => file.endsWith('.wgsl'))) out.push([`rust/bridge/${name}`, readFileSync(join(bridge, name), 'utf8')]);
  for (const [name, value] of Object.entries(generated)) if (typeof value === 'string') out.push([`terrainWgsl.generated:${name}`, value]);
  for (const [name, value] of Object.entries(generated3d)) if (typeof value === 'string') out.push([`terrain3dWgsl.generated:${name}`, value]);
  const inline = [join(root, 'rust', 'bridge'), join(root, 'web', 'src')];
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.ts') && !entry.name.includes('.generated.') ? [join(dir, entry.name)] : []));
  for (const file of inline.flatMap(walk)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('createShaderModule')) continue;
    for (const literal of text.match(/`[^`]*`/g) ?? []) if (/@(compute|fragment|vertex)\b/.test(literal)) out.push([relative(root, file).replace(/\\/g, '/'), literal.slice(1, -1)]);
  }
  return out;
}

describe('WGSL reserved words', () => {
  it('finds the WGSL sources', () => {
    expect(sources().length).toBeGreaterThan(20);
  });
  it('no shader uses a reserved word as an identifier', () => {
    const bad = sources().flatMap(([name, code]) => reservedTokens(code).map(hit => `${name}:${hit}`));
    expect(bad).toEqual([]);
  });
});
