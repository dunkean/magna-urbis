import { afterEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/gen/types';
import type { View } from '../../src/render/view';
import { mountTownMoveEditor } from '../../src/v2/townMoveEditor';
import { translate } from '../../src/v2/i18n';

afterEach(() => vi.unstubAllGlobals());

// Only the editor's DOM/event surface; no browser or rendering engine is needed.
class EditorElement {
  children: EditorElement[] = [];
  parentElement?: EditorElement;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, ((event: any) => void)[]>();
  classList = { add() {}, remove() {} };
  namespaceURI = 'http://www.w3.org/2000/svg';
  clientWidth = 400;
  clientHeight = 300;
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  onclick?: () => void | Promise<void>;
  append(...nodes: EditorElement[]) {
    nodes.forEach(node => {
      node.parentElement = this;
      this.children.push(node);
    });
  }
  prepend(node: EditorElement) {
    node.parentElement = this;
    this.children.unshift(node);
  }
  replaceChildren(...nodes: EditorElement[]) {
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  toggleAttribute(key: string, value: boolean) {
    if (value) this.attributes.set(key, '');
    else this.attributes.delete(key);
  }
  matches(selector: string) {
    return selector.startsWith('.') ? this.className === selector.slice(1) : this.attributes.has(selector.slice(1, -1));
  }
  querySelectorAll(selector: string): EditorElement[] {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0];
  }
  closest(selector: string): EditorElement | undefined {
    return this.matches(selector) ? this : this.parentElement?.closest(selector);
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, init: Record<string, unknown> = {}) {
    const event = { type, target: this, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...init };
    this.listeners.get(type)?.forEach(listener => listener(event));
    return event;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function setup() {
  const mutations: (() => void)[] = [],
    events = new EventTarget(),
    dialogs = new EditorElement();
  vi.stubGlobal('document', { createElement: () => new EditorElement(), createElementNS: () => new EditorElement(), querySelector: (selector: string) => (selector === 'dialog[open]' ? (dialogs.querySelector('[open]') ?? null) : null) });
  vi.stubGlobal('window', events);
  vi.stubGlobal(
    'CustomEvent',
    class extends Event {
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        super(type);
        this.detail = init.detail;
      }
    },
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        mutations.push(callback);
      }
      observe() {}
    },
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const map = new EditorElement(),
    toolbar = new EditorElement(),
    panel = new EditorElement(),
    parent = new EditorElement();
  parent.append(map);
  function row(key: string) {
    const choice = new EditorElement(),
      button = new EditorElement();
    choice.className = 'settlement-choice';
    button.setAttribute('data-town', key);
    choice.append(button);
    panel.append(choice);
    return button;
  }
  const rows = [row('main'), row('village')];
  const world = {
    mapSize: 2000,
    options: { style: 'parchment' },
    settlements: [
      { key: 'main', main: true, center: { x: 100, y: 100 }, radius: 5, extent: [] },
      { key: 'village', center: { x: 900, y: 900 }, radius: 5, extent: [] },
    ],
    names: { entries: [{ id: 'settlement:main', kind: 'town', text: 'Old name', hidden: true }] },
  } as unknown as World;
  let view: View = { cx: 100, cy: 100, scale: 1 };
  const commit = vi.fn(async () => {}),
    apply = vi.fn(async (_positions: ReadonlyMap<string, { x: number; y: number }>) => {});
  const editor = mountTownMoveEditor({
    map: map as unknown as HTMLElement,
    toolbar: toolbar as unknown as HTMLElement,
    places: panel as unknown as HTMLElement,
    getWorld: () => world,
    getView: () => view,
    setView: next => {
      view = next;
    },
    getName: key => (key === 'main' ? 'Current map name' : 'Le Hameau'),
    busy: () => false,
    commit,
    deferred: { commit: apply },
    error: error => {
      throw error;
    },
  });
  const start = () => toolbar.children.find(button => button.id === 'move-towns')!.onclick!();
  const handle = (key: string) => map.querySelectorAll('[data-town-handle]').find(node => node.dataset.townHandle === key)!;
  const pick = (x = 200, y = 150) => {
    map.fire('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 1 });
    map.fire('pointerup', { pointerId: 1 });
  };
  return {
    map,
    panel,
    rows,
    world,
    events,
    dialogs,
    editor,
    start,
    pick,
    handle,
    toolbar,
    mutations,
    row,
    commit,
    apply,
    view: () => view,
    setView: (next: View) => {
      view = next;
    },
  };
}

describe('town position selection', () => {
  it('selects from Places without opening the inspector or applying positions, and pans only if needed', () => {
    const s = setup();
    s.start();
    const click = s.panel.fire('click', { target: s.rows[0] });
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(s.rows.map(row => row.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(s.handle('main').dataset.selected).toBe('true');
    expect(s.view()).toEqual({ cx: 100, cy: 100, scale: 1 });
    s.panel.fire('click', { target: s.rows[1] });
    expect(s.handle('village').dataset.selected).toBe('true');
    expect(s.rows.map(row => row.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(s.view()).toEqual({ cx: 900, cy: 900, scale: 1 });
    expect(s.world.settlements![1].center).toEqual({ x: 900, y: 900 });
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.apply).not.toHaveBeenCalled();
  });

  it('keeps selection after a list refresh and clears it on Escape when no dialog is open', () => {
    const s = setup();
    s.start();
    s.pick();
    expect(s.rows[0].getAttribute('aria-pressed')).toBe('true');
    expect(s.handle('main').dataset.selected).toBe('true');
    s.panel.replaceChildren();
    const replacement = s.row('main');
    s.mutations.forEach(notify => notify());
    expect(replacement.getAttribute('aria-pressed')).toBe('true');
    const dialog = new EditorElement();
    dialog.setAttribute('open', '');
    s.dialogs.append(dialog);
    s.events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(replacement.getAttribute('aria-pressed')).toBe('true');
    expect(s.handle('main').dataset.selected).toBe('true');
    dialog.removeAttribute('open');
    s.events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(replacement.getAttribute('aria-pressed')).toBe('false');
    s.start();
    expect(s.handle('main').dataset.selected).toBe('false');
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.apply).not.toHaveBeenCalled();
  });

  it('moves a list-selected place on the next map click using the existing deferred Apply path', async () => {
    const s = setup();
    s.start();
    s.panel.fire('click', { target: s.rows[0] });
    s.pick(300, 250); // World (200, 200), away from either handle.
    expect(s.handle('main').getAttribute('cx')).toBe('200');
    expect(s.world.settlements![0].center).toEqual({ x: 100, y: 100 });
    expect(s.apply).not.toHaveBeenCalled();
    let positions: Map<string, { x: number; y: number }> | undefined;
    s.apply.mockImplementation(async pending => {
      positions = new Map(pending);
    });
    await s.toolbar.children.find(button => button.id === 'town-positions-apply')!.onclick!();
    expect(positions?.get('main')).toEqual({ x: 200, y: 200 });
    expect(s.rows[0].getAttribute('aria-pressed')).toBe('false');
    const click = s.panel.fire('click', { target: s.rows[0] });
    expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('draws all current names at a readable screen size at low and high zoom, including hidden map labels', () => {
    const s = setup();
    s.start();
    for (const scale of [0.001, 128]) {
      s.setView({ ...s.view(), scale });
      s.editor.sync();
      const labels = s.map.querySelectorAll('[data-town-label]');
      expect(labels.map(label => label.textContent)).toEqual(['Current map name', 'Le Hameau']);
      expect(labels[0].getAttribute('transform')).toContain(`scale(${1 / scale})`);
      expect(Number(labels[0].getAttribute('font-size'))).toBeGreaterThanOrEqual(13);
      expect(labels[0].getAttribute('font-family')).toContain('Georgia');
    }
    s.editor.stop();
    expect(s.map.children[0].getAttribute('hidden')).toBe('');
    const hint = 'Select a place on the map or in Places, then drag it or click its new position. Esc exits.';
    expect(translate(hint, 'fr')).toBe('Sélectionnez une localité sur la carte ou dans Lieux, puis glissez-la ou cliquez sur sa nouvelle position. Échap pour terminer.');
  });
});
