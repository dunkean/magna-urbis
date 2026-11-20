import { describe, expect, it } from 'vitest';
import { TownFirstDisplay } from '../../src/v2/townFirstDisplay';
import type { World } from '../../src/gen/types';

function world(scene: object, other: object = {}): World {
  return { settlements: [{ key: 'main', main: true }, { key: 'other' }], debug: { v2RustCities: { main: { layouts: [{}], scene }, other: { layouts: [{}], scene: other } } } } as unknown as World;
}

describe('first town presentation', () => {
  it('waits for presentation after generation and again for regenerated geometry', () => {
    const tracker = new TownFirstDisplay(),
      scene = {},
      other = {},
      first = world(scene, other);
    expect(tracker.pending(first, 'main')).toBe(true);
    tracker.notePresented(first);
    expect(tracker.pending(first, 'main')).toBe(false);
    expect(tracker.pending(world(scene, other), 'main')).toBe(false);
    const regenerated = world({}, other);
    expect(tracker.pending(regenerated, 'main')).toBe(true);
    expect(tracker.pending(regenerated, 'other')).toBe(false);
    tracker.notePresented(first); // A superseded frame cannot finish the new town.
    expect(tracker.pending(regenerated, 'main')).toBe(true);
    tracker.notePresented(regenerated);
    expect(tracker.pending(regenerated, 'main')).toBe(false);
  });

  it('does not show a display spinner for sites without a built plan', () => {
    expect(new TownFirstDisplay().pending({ settlements: [{ key: 'site' }] } as unknown as World, 'site')).toBe(false);
  });
});
