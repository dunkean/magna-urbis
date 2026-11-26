import { afterEach, describe, expect, it, vi } from 'vitest';
import type { View } from '../../src/render/view';
import type { Entity, EntityKind } from '../../src/v2/entityPick';
import type { PageActions, PageState } from '../../src/v2/page/contract';
import { entityEditor, entityEditors } from '../../src/v2/page/entitySheet';

afterEach(() => vi.unstubAllGlobals());

describe('Entity sheet Edit', () => {
  it('opens the road tool, the river tool and the editor of the picked enclosure', () => {
    vi.stubGlobal('document', { querySelector: () => null });
    const view: View = { cx: 0, cy: 0, scale: 2, pitch: 0.6, yaw: 0 };
    const setView = vi.fn((next: View) => Object.assign(view, next));
    const roads = vi.fn(() => true),
      rivers = vi.fn(() => true),
      editWall = vi.fn(() => true);
    const state = { client: { viewer: { getView: () => view, setView } }, roadEditor: { start: roads }, riverEditor: { start: rivers } } as unknown as PageState;
    const editors = entityEditors(state, { editWall } as unknown as PageActions);
    const point = { x: 40, y: 60 };
    const run = (kind: EntityKind, town?: string): boolean => {
      const editor = entityEditor(kind);
      expect(editor, kind).toBeDefined();
      return editors[editor!]({ kind, index: 3, rings: [], point, ...(town ? { town } : {}) } as Entity);
    };

    expect(run('road')).toBe(true);
    expect(roads).toHaveBeenCalledWith('roads', point);
    // The map editors need the top view: a tilted camera comes down over the road, once.
    expect(setView).toHaveBeenCalledOnce();
    expect(view).toMatchObject({ cx: 40, cy: 60, scale: 2, pitch: 0, yaw: 0 });
    expect(run('river')).toBe(true);
    expect(rivers).toHaveBeenCalledWith('rivers', point);
    expect(setView).toHaveBeenCalledOnce();
    expect(run('wall', 'town-1')).toBe(true);
    expect(editWall).toHaveBeenCalledWith('town-1', 3);
    // No editor, no Edit button.
    expect(entityEditor('lake')).toBeUndefined();
  });
});
