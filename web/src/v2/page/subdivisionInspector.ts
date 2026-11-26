/**
 * The quarter, block and parcel inspector: local overrides of one subdivision (reset of its descendants, regeneration)
 * and the parcel merge tool. Opened from a map click at those inspection levels and after the runs that kept it.
 */
import type { PageActions, PageState } from './contract';
import { setHTML, insertHTML, setText, translate, getLanguage } from '../i18n';
import { organizeInspector } from '../advancedPanel';
import { nativeCityRecords } from '../nativeProducts';
import type { UrbanBuilding } from '../../gen/types';
import { validateSettings } from '../project';
import type { QuarterOverride, BlockOverride, ParcelOverride } from '../../../../rust/bridge/urbanConfig';
import { polygonArea } from '../urbanEditOptions';
import { mergedOutline, type LotShape } from '../parcelMerge';
import { blockEditKey } from '../../../../rust/bridge/urbanBlockEdits';
import { quarterEditKey } from '../../../../rust/bridge/urbanQuarterEdits';
import { editableContours } from '../contourEdits';
import { pointInRing } from '../../gen/geo/poly';
import { townUrban } from '../edits';
import { mountUrbanControls } from '../urbanControls';
import { mountSubdivisionActions } from '../localUrbanEditor';
import { resetSubdivisionChildren } from '../subdivisionEdits';
import { $, esc } from './dom';

export function createSubdivisionInspector(state: PageState, actions: PageActions) {
  /** Merge tool of the parcel inspector: while it is on, each map click on a parcel of the same block grows the
   * selected lot's outline over it (a native lot shape edit: the engine absorbs the covered neighbour, keeps the
   * selected lot's id and use); Regenerate area applies it. Repeated clicks merge more lots. */
  function mountParcelMerge(key: string, id: string, index: number, shape: LotShape, currentRole?: string): void {
    state.parcelMerge = undefined;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.setAttribute('aria-pressed', 'false');
    setText(button, 'Merge with neighbour');
    button.title = translate('Then click adjacent parcels of the same block on the map. Regenerate area applies the merge.');
    let merged = 0;
    const status = () => setText($('#selection-status'), merged ? translate('{n} parcel(s) will be merged into this one. Regenerate area to apply.').replace('{n}', String(merged)) : 'Click adjacent parcels of the same block on the map.');
    const add = (p: { x: number; y: number }) => {
      if (!state.world || state.busy) return;
      const urban = townUrban(state.world, key),
        native = nativeCityRecords(state.world)?.[key];
      if (!urban) return;
      const shapeOf = (i: number): LotShape => native?.partitions?.[0]?.parcels[i]?.shape ?? { outer: urban.parcels[i].poly, holes: [] };
      const hit = urban.parcels.findIndex((_, i) => {
        const s = shapeOf(i);
        return pointInRing(s.outer, p) && !s.holes?.some(h => pointInRing(h, p));
      });
      const other = hit >= 0 ? urban.parcels[hit] : undefined;
      if (!other?.nativeId || other.nativeId === id) return;
      if (other.block !== urban.parcels[index].block) {
        actions.toast('Pick a parcel of the same block: a street separates these lots.', true);
        return;
      }
      state.settings.urban ??= { backend: state.settings.runtime?.backend ?? 'rust' };
      const local = ((state.settings.urban.local ??= {})[key] ??= {});
      local.parcels ??= {};
      local.parcels.overrides ??= {};
      const entries = (local.parcels.overrides.parcels ??= {});
      const own = (entries[id] ??= {});
      const outline = mergedOutline(own.shape ?? shape, shapeOf(hit));
      if (!outline) {
        actions.toast('These parcels do not touch: pick a parcel that shares a side with this one.', true);
        return;
      }
      own.shape = outline;
      merged++;
      // The merged lot keeps the selected lot's content unless the content menu says otherwise.
      if (!own.role && !own.function && currentRole) own.role = currentRole;
      delete entries[other.nativeId];
      const requests = [...(native?.sites ?? native?.requests ?? []).filter(site => site.parcel_id === other.nativeId).map(site => site.id)];
      resetSubdivisionChildren(state.settings, key, 'parcel', { parcels: [other.nativeId], requests });
      state.selectionOutline.set([outline.outer, ...(outline.holes ?? [])]);
      actions.touchRecipe();
      status();
      state.inspectorForms.forEach(form => form.sync());
    };
    button.onclick = () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      state.parcelMerge = on ? { key, id, add } : undefined;
      if (on) status();
    };
    // Regenerate applies the merge and ends the picking; map clicks select again.
    $('#subdivision-apply').addEventListener('click', () => {
      state.parcelMerge = undefined;
      button.setAttribute('aria-pressed', 'false');
    });
    $('#subdivision-actions').append(button);
  }

  function inspectSubdivision(kind: 'quarter' | 'block' | 'parcel', p: { x: number; y: number }, settlementKey?: string, selectedId?: string): boolean {
    if (!state.world) return false;
    state.parcelMerge = undefined;
    for (const settlement of state.world.settlements ?? []) {
      if (settlementKey && settlement.key !== settlementKey) continue;
      const urban = townUrban(state.world, settlement.key);
      if (!urban) continue;
      const native = nativeCityRecords(state.world)?.[settlement.key],
        layout = native?.layouts[0],
        savedBlocks = state.settings.urban?.local?.[settlement.key]?.parcels?.overrides?.blocks;
      const items =
        kind === 'quarter'
          ? urban.quarters.map((q, i) => ({ shape: q.poly, id: q.nativeId, index: i }))
          : kind === 'block'
            ? urban.blocks.map((ring, i) => ({ shape: layout?.blocks[i]?.kind === 'deleted' ? { outer: [], holes: [] } : (layout?.blocks[i]?.shape ?? { outer: ring, holes: [] }), id: layout ? blockEditKey(layout, i, savedBlocks) : undefined, index: i }))
            : urban.parcels.map((parcel, i) => ({ shape: native?.partitions?.[0]?.parcels[i]?.shape ?? { outer: parcel.poly, holes: [] }, id: parcel.nativeId, index: i }));
      const item = items.find(item => (selectedId !== undefined ? item.id === selectedId : pointInRing(item.shape.outer, p) && !item.shape.holes?.some(h => pointInRing(h, p))));
      if (!item) continue;
      const nativeId = item.id;
      actions.openInspector(settlement.key, kind);
      state.selectedSubdivision = { key: settlement.key, kind, id: nativeId ?? String(item.index), point: p };
      const rings = [item.shape.outer, ...(item.shape.holes ?? [])];
      state.selectionOutline.set(rings);
      const title = translate(kind === 'quarter' ? 'Quarter' : kind === 'block' ? 'Block' : 'Parcel') + ' ' + (item.index + 1);
      setHTML(
        $('#building-inspector'),
        `<div class="edit-building"><h3 data-l10n-keep>${esc(title)}</h3><p class="hint" data-i18n="Regenerate this area and its descendants. Display settings stay unchanged.">${translate('Regenerate this area and its descendants. Display settings stay unchanged.')}</p><div id="subdivision-actions" class="v2-edit-actions"><button id="subdivision-apply" class="small selection-rebuild">↻ <span data-i18n="Regenerate area">${translate('Regenerate area')}</span></button><button id="subdivision-reset" class="quiet small selection-reset" data-i18n="Use parent settings">${translate('Use parent settings')}</button></div><p id="selection-status" class="hint selection-status" role="status" data-i18n="Regenerate keeps the seed. The dice creates a new random layout and descendants.">${translate('Regenerate keeps the seed. The dice creates a new random layout and descendants.')}</p><div id="subdivision-controls"></div></div>`,
      );
      if (!nativeId) {
        setText($('#subdivision-controls'), 'Local editing requires the Rust engine.');
        $('#subdivision-actions').hidden = true;
        actions.appendLocalFacts($('#building-inspector'), settlement.key, { kind, index: item.index });
        return true;
      }
      // Saved recipes name a quarter or block by its stable edit key; the native index only addresses this layout.
      const quarterIndex = kind === 'quarter' ? item.index : kind === 'block' ? layout!.blocks[item.index].quarter : (layout?.blocks[urban.parcels[item.index].block]?.quarter ?? 0);
      const quarterId = layout ? quarterEditKey(layout, quarterIndex) : String(quarterIndex);
      const blockId = kind === 'block' ? nativeId : kind === 'parcel' && layout ? blockEditKey(layout, urban.parcels[item.index].block, savedBlocks) : undefined;
      const blockIds = new Set(kind === 'quarter' ? layout?.blocks.flatMap((b, i) => (b.quarter === item.index ? [String(i)] : [])) : kind === 'block' ? [String(item.index)] : []);
      const parcelIds = new Set(
        kind === 'parcel'
          ? [nativeId]
          : urban.parcels
              .filter(parcel => blockIds.has(String(parcel.block)))
              .map(parcel => parcel.nativeId)
              .filter((id): id is string => !!id),
      );
      const children = {
        blocks: layout
          ? [...blockIds].flatMap(id => {
              const key = blockEditKey(layout, Number(id), savedBlocks);
              return key ? [key] : [];
            })
          : [],
        parcels: [...parcelIds],
        requests: [
          ...new Set(
            [
              ...(native?.sites ?? native?.requests ?? []).filter(site => parcelIds.has(site.parcel_id)).map(site => site.id),
              ...urban.buildings.filter(building => parcelIds.has((building as UrbanBuilding & { nativeParcelId?: string }).nativeParcelId ?? '')).map(building => (building as UrbanBuilding & { nativeRequestId?: string }).nativeRequestId),
            ].filter((id): id is string => !!id),
          ),
        ],
      };
      const get = (): QuarterOverride | BlockOverride | ParcelOverride | undefined => {
        const local = state.settings.urban?.local?.[settlement.key];
        return kind === 'quarter' ? local?.layout?.overrides?.quarters?.[nativeId] : kind === 'block' ? local?.parcels?.overrides?.blocks?.[nativeId] : local?.parcels?.overrides?.parcels?.[nativeId];
      };
      const apply = (value: QuarterOverride | BlockOverride | ParcelOverride | undefined) => {
        if (state.busy) {
          actions.toast('Wait for the current generation to finish.', true);
          return;
        }
        const next = structuredClone(state.settings);
        next.urban ??= { backend: state.settings.runtime?.backend ?? 'rust' };
        const local = (next.urban.local ??= {});
        const scope = (local[settlement.key] ??= {});
        if (kind === 'quarter') {
          scope.layout ??= {};
          scope.layout.overrides ??= {};
          const entries = (scope.layout.overrides.quarters ??= {});
          if (value) entries[nativeId] = value as QuarterOverride;
          else delete entries[nativeId];
        } else {
          scope.parcels ??= {};
          scope.parcels.overrides ??= {};
          if (kind === 'block') {
            const entries = (scope.parcels.overrides.blocks ??= {});
            if (value) entries[nativeId] = value as BlockOverride;
            else delete entries[nativeId];
          } else {
            const entries = (scope.parcels.overrides.parcels ??= {});
            if (value) entries[nativeId] = value as ParcelOverride;
            else delete entries[nativeId];
          }
        }
        resetSubdivisionChildren(next, settlement.key, kind, children);
        validateSettings(next);
        state.settings = next;
        actions.touchRecipe();
        void actions.generate('town', settlement.key, 'buildings', undefined, undefined, undefined, false, true);
      };
      mountSubdivisionActions($('#subdivision-actions'), {
        kind,
        actionsOnly: true,
        french: getLanguage() === 'fr',
        get,
        apply: value => {
          try {
            apply(value);
          } catch (e) {
            actions.toast(String(e), true);
          }
        },
        shape: item.shape,
        map: $('#map'),
        getView: () => state.client.viewer.getView(),
      });
      const contourButton = document.createElement('button');
      contourButton.type = 'button';
      contourButton.className = 'small';
      contourButton.dataset.editContour = kind;
      setText(contourButton, 'Edit outline');
      contourButton.onclick = () => {
        const chosen = state.world && editableContours(state.world, kind, state.settings).find(t => t.town === settlement.key && t.id === nativeId);
        if (!chosen) return;
        state.selectionOutline.set();
        state.contourEditor.edit(chosen);
      };
      $('#subdivision-actions').append(contourButton);
      $('#subdivision-apply').onclick = () => {
        try {
          apply(get() ?? {});
        } catch (e) {
          actions.toast(String(e), true);
        }
      };
      $('#subdivision-reset').title = translate('Remove local overrides and regenerate using the parent settings.');
      $('#subdivision-reset').onclick = () => {
        try {
          apply(undefined);
        } catch (e) {
          actions.toast(String(e), true);
        }
      };
      const controls = $('#subdivision-controls');
      const allocation = kind === 'parcel' ? native?.programmePartitions?.[0]?.programme?.allocations.find(a => a.parcelId === nativeId) : undefined;
      if (kind === 'parcel') mountParcelMerge(settlement.key, nativeId, item.index, item.shape, allocation?.role);
      const quarter = layout?.quarters[quarterIndex];
      const defaults: Record<string, unknown> =
        kind === 'quarter'
          ? { culture: layout?.phases?.[quarter?.phase ?? 0]?.culture ?? layout?.culture, zone: quarter?.zone }
          : kind === 'block'
            ? { culture: layout?.config?.overrides?.quarters?.[quarterId]?.culture ?? layout?.phases?.[layout.blocks[item.index].phase ?? quarter?.phase ?? 0]?.culture ?? layout?.culture }
            : allocation
              ? { culture: allocation.culture, role: allocation.role, function: allocation.function, households: allocation.households }
              : {};
      const available = urban.parcels
        .filter(parcel => parcelIds.has(parcel.nativeId ?? ''))
        .map(parcel => polygonArea(native?.partitions?.[0]?.parcels.find(p => p.id === parcel.nativeId)?.envelope ?? native?.partitions?.[0]?.parcels.find(p => p.id === parcel.nativeId)?.shape ?? { outer: parcel.poly }));
      Object.assign(defaults, {
        area: kind === 'parcel' ? available[0] : available.length ? Math.min(...available) : polygonArea(item.shape),
        blockArea: polygonArea(item.shape),
        historicalMode: layout?.config?.programme.mode ?? 'inspired',
        period: layout?.config?.programme.period,
        navigableAccess: layout?.config?.programme.navigableAccess,
      });
      const source = (native?.sites ?? native?.requests ?? []).find(site => parcelIds.has(site.parcel_id));
      if (source) defaults.houseConfig = { pack: source.culture.pack, mode: source.culture.mode };
      state.inspectorForms.push(
        mountUrbanControls(
          controls,
          () => state.settings,
          () => {
            actions.touchRecipe();
            setText($('#selection-status'), 'Changes pending. Regenerate to apply them to this area and its descendants.');
          },
          { kind, key: settlement.key, id: nativeId, quarter: quarterId, block: blockId, defaults },
          { hideReset: true },
        ),
      );
      organizeInspector($('#building-inspector'));
      actions.appendLocalFacts($('#building-inspector'), settlement.key, { kind, index: item.index });
      insertHTML($('#building-inspector'), 'afterbegin', '<button id="back-to-city" class="quiet small">← ' + translate('Back to city') + '</button>');
      $('#back-to-city').onclick = () => actions.showInspector(settlement.key);
      $('#building-inspector').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return true;
    }
    return false;
  }
  return { inspectSubdivision };
}
