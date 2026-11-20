import { describe, expect, it } from 'vitest';
import { wasmTownLanes } from '../../src/v2/townLanes';

describe('wasmTownLanes', () => {
  it('runs two large towns at once on a desktop, a huge town alone, and at most four', () => {
    expect(wasmTownLanes([50000, 50000], 24, 8)).toBe(2);
    expect(wasmTownLanes([1000000, 50000], 24, 8)).toBe(1);
    expect(wasmTownLanes([50000, 50000], 4, 4)).toBe(1);
    expect(wasmTownLanes([500, 500, 500, 500, 500, 500], 24, 8)).toBe(4);
  });
});
