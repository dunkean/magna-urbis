import type { WorkshopState } from './testbenchUrban';
import { normalizeLayoutConfig, normalizeParcelConfig } from '../../../rust/bridge/urbanConfig';
type Settings = Omit<WorkshopState, 'layouts' | 'partitions'>;
const channel = 'magna-urban-options';
function normalized(state: Settings): Settings {
  return { layoutConfig: normalizeLayoutConfig(state.layoutConfig, true), parcelConfig: normalizeParcelConfig(state.parcelConfig), quarterSeed: state.quarterSeed, parcelSeed: state.parcelSeed };
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
/** Same city/export only: synchronize settings without treating received drafts as new edits. */
export function urbanOptionSync(identity: () => string | undefined, apply: (state: Settings) => void) {
  let signature = '';
  window.addEventListener('storage', event => {
    if (event.key !== channel || !event.newValue) return;
    try {
      const message = JSON.parse(event.newValue);
      if (message.identity !== identity()) return;
      const state = normalized(message.state), next = `${message.identity}:${canonical(state)}`; if (next === signature) return;
      signature = next; apply(state);
    } catch { /* Storage may be disabled, or another version may be open. */ }
  });
  return (state: WorkshopState): void => {
    const id = identity(); if (!id) return;
    const settings = normalized(state), next = `${id}:${canonical(settings)}`;
    if (next === signature) return; signature = next;
    try { localStorage.setItem(channel, JSON.stringify({ identity: id, state: settings, at: Date.now() })); } catch { /* File export/return still carries all settings. */ }
  };
}
