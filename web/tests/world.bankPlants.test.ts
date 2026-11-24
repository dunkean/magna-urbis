import { describe, expect, it } from 'vitest';
import { BANK_BLOCK, BANK_STRIDE, bankBlockSteps, type BankBlock } from '../src/render/world/bankPlants';
import type { TreeInputs } from '../src/ui/terrain3dTrees';

const inputs = (water: (x: number, y: number) => number): TreeInputs => ({ field: { x: 0, y: 0, width: 2400, n: 1, rgba: new Uint8Array(4), key: 'f' }, seed: 5, climate: { temperature: 10, precipitation: 900 }, climateZone: 'temperate', renderV2: 1, zone: 1, season: 0.5, water, height: () => 20 });
const build = (source: TreeInputs, bx = 3): BankBlock => {
  const steps = bankBlockSteps(source, bx, 2);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
};

describe('plants of the water edge', () => {
  it('stand along the bank, in clumps, deterministic, and nowhere off the water', () => {
    const bank = 3 * BANK_BLOCK + 20,
      river = inputs(x => (Math.abs(x - bank) < 6 ? 1 : 0)),
      block = build(river);
    expect(block.count).toBeGreaterThan(10);
    expect(block.count).toBeLessThan(400);
    expect(block.data.length).toBe(block.count * BANK_STRIDE);
    for (let i = 0; i < block.data.length; i += BANK_STRIDE) expect(Math.abs(block.data[i] + 3 * BANK_BLOCK - bank)).toBeLessThan(6 + 7);
    expect(build(river)).toEqual(block);
    expect(build(inputs(() => 0)).count).toBe(0);
    expect(build(inputs(() => 1)).count).toBe(0);
  });
});
