import { describe, expect, it } from 'vitest';
import { wasmTownLanes } from '../../src/v2/townLanes';

describe('wasmTownLanes', () => {
  it('runs two large towns at once on a desktop, a huge town alone, and at most four', () => {
    expect(wasmTownLanes([50000, 50000], 24, 8, false)).toBe(2);
    expect(wasmTownLanes([1000000, 50000], 24, 8, false)).toBe(1);
    expect(wasmTownLanes([50000, 50000], 4, 4, false)).toBe(1);
    expect(wasmTownLanes([500, 500, 500, 500, 500, 500], 24, 8, false)).toBe(4);
  });
  it('runs at most two towns on a handheld and assumes 4 GB when the browser hides its memory', () => {
    expect(wasmTownLanes([500, 500, 500, 500, 500, 500], 8, 8, true)).toBe(2);
    expect(wasmTownLanes([60000, 60000], 24, undefined, false)).toBe(2);
    expect(wasmTownLanes([60000, 60000], 8, undefined, true)).toBe(1);
  });
});
