import type { V2Settings } from './contracts';
import type { LabelEdit } from './mapLabels';

/**
 * Toponym overrides are user edits of the project, stored in the existing naming records:
 * - a settlement name lives in `naming.places[settlementKey]` (the generator uses it as the place's name);
 * - any other toponym lives in `naming.labels[nameEntryId].text` (applied after generation);
 * - visibility is `naming.labels[id].hidden` (true hidden, false always shown, absent automatic).
 * Stable name-entry ids and settlement keys let project files and share codes restore the authored names.
 */
export const TOPONYM_MAX_LENGTH = 200;
/** Label kinds whose name is attached to a native city object without a generated name entry. */
const OBJECT_KINDS = new Set(['quarter', 'parcel', 'building']);

export interface ToponymTarget {
  id: string;
  /** Settlement key when the label names a settlement: its name goes through `naming.places`. */
  town?: string;
  /** Candidate kind (free label, quarter, parcel, building, river…). */
  kind?: string;
}

const labels = (settings: V2Settings): Record<string, LabelEdit> => {
  settings.naming ??= {};
  return (settings.naming.labels ??= {});
};
function prune(settings: V2Settings, id: string): void {
  const map = settings.naming?.labels;
  if (!map?.[id]) return;
  if (!Object.values(map[id]).some(v => v !== undefined)) delete map[id];
}
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, TOPONYM_MAX_LENGTH);

/** The user's literal name for this toponym, if any. */
export function toponymOverride(settings: V2Settings, target: ToponymTarget): string | undefined {
  return (target.town ? settings.naming?.places?.[target.town] : undefined) ?? settings.naming?.labels?.[target.id]?.text ?? undefined;
}
export function hasToponymOverride(settings: V2Settings, target: ToponymTarget): boolean {
  if (target.id.startsWith('free:')) return false;
  const n = settings.naming;
  return !!(target.town && n?.places?.[target.town]) || !!n?.labels?.[target.id]?.text || !!n?.features?.[target.id] || !!n?.variations?.[`feature:${target.id}`];
}

/** Rename a toponym. Empty text is refused (returns false; the caller shows the previous name again).
 * Typing exactly the generated name clears the override instead of storing a copy. */
export function renameToponym(settings: V2Settings, target: ToponymTarget, text: string, generated?: string): boolean {
  const value = clean(text);
  if (!value) return false;
  if (generated !== undefined && value === generated && !target.id.startsWith('free:')) {
    resetToponymName(settings, target);
    return true;
  }
  if (target.town) {
    settings.naming ??= {};
    (settings.naming.places ??= {})[target.town] = value;
    // One store per settlement: a stale label text would otherwise shadow the place name.
    const edit = settings.naming.labels?.[target.id];
    if (edit) {
      delete edit.text;
      delete edit.mode;
      prune(settings, target.id);
    }
    return true;
  }
  const edit: LabelEdit = { ...labels(settings)[target.id], text: value, mode: 'label' };
  if (target.id.startsWith('free:')) edit.kind = 'free';
  else if (target.kind && OBJECT_KINDS.has(target.kind)) edit.kind ??= target.kind as LabelEdit['kind'];
  labels(settings)[target.id] = edit;
  return true;
}

/** Restore the generated name for the current culture and language; visibility, position and style stay. */
export function resetToponymName(settings: V2Settings, target: ToponymTarget): void {
  const n = settings.naming;
  if (!n) return;
  if (target.town && n.places) delete n.places[target.town];
  const edit = n.labels?.[target.id];
  if (edit) {
    delete edit.text;
    delete edit.mode;
    prune(settings, target.id);
  }
  if (n.features) delete n.features[target.id];
  if (n.variations) delete n.variations[`feature:${target.id}`];
}

export function toponymHidden(settings: V2Settings, id: string): boolean {
  return settings.naming?.labels?.[id]?.hidden === true;
}
/** The eye: hidden ⇄ automatic. "Always shown" stays available in the selected-name card. */
export function setToponymHidden(settings: V2Settings, target: ToponymTarget, hidden: boolean): void {
  if (hidden) {
    const edit: LabelEdit = { ...labels(settings)[target.id], hidden: true };
    if (target.kind && OBJECT_KINDS.has(target.kind)) edit.kind ??= target.kind as LabelEdit['kind'];
    labels(settings)[target.id] = edit;
  } else {
    const edit = settings.naming?.labels?.[target.id];
    if (!edit) return;
    delete edit.hidden;
    prune(settings, target.id);
  }
}
