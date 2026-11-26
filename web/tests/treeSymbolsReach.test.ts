import { describe, expect, it } from 'vitest';
import { TREE_SYMBOLS_GLSL, TREE_SYMBOL_EXT_MAX, TREE_SYMBOL_REACH } from '../src/render/treeSymbolsGlsl';

describe('paper map tree symbols', () => {
  it('root a crown only where it lies whole on the woods, never across their edge or a river band', () => {
    // The rooting test of the symbol loop: a centre at forest distance d keeps its symbol only when d >= reach * ext.
    expect(TREE_SYMBOLS_GLSL).toContain(`if(o.y<${TREE_SYMBOL_REACH}*ext||treeSymbolBarred(int(o.z))`);
    // The engraved crown (6.5 glyph units of a 10-unit half-side) and its cast shadow (1.3 units) fit inside the reach.
    expect(TREE_SYMBOL_REACH).toBeGreaterThanOrEqual((6.5 + 1.3) / 10);
    // Past the woods' edge only the transparent sprite margin remains: the early exit drops fragments beyond it.
    const margin = (1 - TREE_SYMBOL_REACH) * TREE_SYMBOL_EXT_MAX;
    expect(TREE_SYMBOLS_GLSL).toContain(`groundOccupation(world).y<-${margin.toFixed(1)})return vec4(0.);`);
    expect(margin).toBeLessThan(TREE_SYMBOL_EXT_MAX * 0.25);
  });
});
