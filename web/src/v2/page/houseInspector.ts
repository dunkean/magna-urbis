/**
 * The house inspector: a building's metadata edits (kept as project mods) or, for an engine-built house, its generation
 * form, parcel content and regeneration. Opened from a map click, the 3D view and the runs that kept a selected house.
 */
import type { PageActions, PageState } from './contract';
import { setHTML, insertHTML, translate, nameHTML } from '../i18n';
import { getDistanceUnit, unitFactor } from '../units';
import { featureDisplayName } from '../mapPresentation';
import { organizeInspector } from '../advancedPanel';
import { nativeCityRecords } from '../nativeProducts';
import type { UrbanBuilding } from '../../gen/types';
import { validateSettings } from '../project';
import { houseControlDefaults, urbanField } from '../urbanControlSchema';
import { mountParameterForm } from '../parameterForm';
import { compatibleBuildingTypes, polygonArea } from '../urbanEditOptions';
import { massingRoofs, siteQuarter, siteBlock } from '../../../../rust/bridge/urbanHouseEdits';
import { applyBuildingEdits, buildingAt, townUrban, buildingSignature, validateBuildingPatch, type BuildingEdit } from '../edits';
import { mountUrbanControls } from '../urbanControls';
import { resetSubdivisionChildren } from '../subdivisionEdits';
import { rerollSeed } from '../../../../rust/bridge/generationSeed';
import { $, esc, options } from './dom';
import { buildingVolumeId } from './worldPicking';

export function createHouseInspector(state: PageState, actions: PageActions) {
  function showBuilding(hit: NonNullable<ReturnType<typeof buildingAt>>): void {
    actions.openInspector(hit.settlement, 'house');
    state.selectedBuilding = hit;
    const b = hit.building;
    state.selectionOutline.set([b.poly, ...(b.courtyards ?? [])], undefined, buildingVolumeId(b));
    setHTML(
      $('#building-inspector'),
      `<div class="edit-building"><span class="eyebrow">House ${hit.index + 1}</span><h3>The last detail</h3><p class="hint">${esc(b.kind)} · ${esc(b.arch || 'generated typology')}</p><div class="control-grid"><div><label class="label">Storeys</label><input id="house-storeys" type="number" min="1" max="100" value="${b.storeys ?? 1}"></div><div><label class="label"><span data-i18n="Height">${translate('Height')}</span> (<span data-house-height-unit>${getDistanceUnit()}</span>)</label><input id="house-height" data-distance-unit="${getDistanceUnit()}" type="number" min="${0.5 / unitFactor(getDistanceUnit())}" max="${1000 / unitFactor(getDistanceUnit())}" step="any" value="${(b.height ?? 3) / unitFactor(getDistanceUnit())}"></div></div><label class="label">Roof</label><select id="house-roof">${options(['gable', 'hip', 'flat', 'dome', 'pyramidal', 'pagoda', 'thatch-round', 'none', 'tiled-hip', 'conical', 'barrel', 'terraced'])}</select><label class="label">Material</label><input id="house-material" type="text" maxlength="100" value="${esc(b.material ?? '')}"><details class="section"><summary>Building properties</summary><textarea id="house-json" spellcheck="false">${esc(JSON.stringify({ kind: b.kind, arch: b.arch, material: b.material }, null, 2))}</textarea><p class="hint">Architectural metadata is exported; its appearance depends on the renderer.</p></details><button id="house-apply">Save house</button><button id="house-undo" class="quiet small">Undo the last edit</button></div>`,
    );
    $<HTMLSelectElement>('#house-roof').value = b.roof ?? 'gable';
    $('#house-apply').onclick = () => {
      try {
        if (!state.selectedBuilding || !state.pristine) return;
        const source = townUrban(state.pristine, hit.settlement)?.buildings[hit.index];
        if (!source) throw new Error('Source building not found.');
        const json = JSON.parse($<HTMLTextAreaElement>('#house-json').value);
        const patch = validateBuildingPatch({
          ...json,
          storeys: Number($<HTMLInputElement>('#house-storeys').value),
          height: Number($<HTMLInputElement>('#house-height').value) * unitFactor(getDistanceUnit()),
          roof: $<HTMLSelectElement>('#house-roof').value,
          material: $<HTMLInputElement>('#house-material').value,
        });
        const ids = source as UrbanBuilding & { nativeId?: string; nativeRequestId?: string };
        const edit: BuildingEdit = { type: 'building', settlement: hit.settlement, index: hit.index, nativeId: ids.nativeId, nativeRequestId: ids.nativeRequestId, signature: buildingSignature(source), patch };
        state.mods = state.mods.filter(m => !(m && typeof m === 'object' && (m as BuildingEdit).type === 'building' && (m as BuildingEdit).settlement === hit.settlement && (m as BuildingEdit).index === hit.index));
        state.mods.push(edit);
        state.world = applyBuildingEdits(state.pristine, state.mods).world;
        state.client.show(state.world, true);
        actions.touchRecipe();
        actions.toast('House edited and retained in the project.');
      } catch (e) {
        actions.toast(String(e), true);
      }
    };
    $('#house-undo').onclick = () => {
      if (!state.pristine) return;
      state.mods.pop();
      state.world = applyBuildingEdits(state.pristine, state.mods).world;
      state.client.show(state.world, true);
      actions.touchRecipe();
      actions.showInspector(hit.settlement);
      actions.toast('Last edit undone.');
    };
    const requestId = (b as UrbanBuilding & { nativeRequestId?: string }).nativeRequestId;
    if (requestId) {
      // Native houses have one authoritative generation form; the metadata-only
      // editor cannot change a retained native roof or its structural geometry.
      $('#building-inspector').replaceChildren();
      const nameId = `urban:${encodeURIComponent(hit.settlement)}:building:${encodeURIComponent((b as UrbanBuilding & { nativeId?: string }).nativeId ?? requestId)}`;
      const named = featureDisplayName(state.world!, nameId, state.settings);
      setHTML($('#building-inspector'), `<h3>${nameHTML(named, translate('House') + ' ' + (hit.index + 1))}</h3>`);
      if (named) {
        state.selectionOutline.set([b.poly, ...(b.courtyards ?? [])], named, buildingVolumeId(b));
        insertHTML($('#building-inspector'), 'beforeend', '<label class="label"><input type="checkbox" id="house-name-pin"> <span data-i18n="Always show this name">' + translate('Always show this name') + '</span></label>');
        const pin = $<HTMLInputElement>('#house-name-pin');
        pin.checked = state.settings.naming?.labels?.[nameId]?.hidden === false;
        pin.onchange = () => {
          state.settings.naming ??= {};
          state.settings.naming.labels ??= {};
          state.settings.naming.labels[nameId] = { ...state.settings.naming.labels[nameId], hidden: !pin.checked };
          void actions.redrawNames().then(() => {
            if (state.world) {
              const buildings = townUrban(state.world, hit.settlement)?.buildings ?? [],
                index = buildings.findIndex(building => (building as UrbanBuilding & { nativeRequestId?: string }).nativeRequestId === requestId);
              if (index >= 0) actions.showBuilding({ settlement: hit.settlement, index, building: buildings[index] });
            }
          });
        };
      }
      const scopedId = `${hit.settlement}/${requestId}`;
      insertHTML(
        $('#building-inspector'),
        'beforeend',
        `<div class="edit-building"><div class="v2-edit-actions"><button id="house-native-apply" class="small selection-rebuild">↻ <span data-i18n="Regenerate building">${translate('Regenerate building')}</span></button><button id="house-native-reset" class="quiet small selection-reset" data-i18n="Use parent settings">${translate('Use parent settings')}</button><button id="house-reroll" class="settlement-reroll subdivision-reroll" aria-label="${translate('Reroll house')}"><i class="art art-dice" aria-hidden="true"></i></button></div><div id="house-native-controls" data-request-id="${esc(requestId)}"></div></div>`,
      );
      const apply = (value: unknown) => {
        if (state.busy) {
          actions.toast('Wait for the current generation to finish.', true);
          return;
        }
        const next = { ...state.settings, urban: { ...state.settings.urban, backend: state.settings.urban?.backend ?? state.settings.runtime?.backend ?? ('rust' as const), buildings: { ...state.settings.urban?.buildings, [scopedId]: value } } };
        validateSettings(next);
        state.settings = next;
        actions.touchRecipe();
        // Never keep the old building silently: say so when the regenerated house is identical.
        const identity = (building: UrbanBuilding | undefined, source = state.world) => {
          if (!building) return undefined;
          const id = (building as UrbanBuilding & { nativeId?: string }).nativeId,
            native = nativeCityRecords(source ?? undefined)?.[hit.settlement]?.scene?.buildings.find(item => item.id === id) as { volumes?: { roof_system?: string }[]; programme?: { massing?: { roof?: string; floors?: number }[] } } | undefined;
          return JSON.stringify([buildingSignature(building), building.roof, building.storeys, building.height, building.kind, building.arch, native?.volumes?.map(volume => volume.roof_system), native?.programme?.massing?.map(piece => [piece.roof, piece.floors])]);
        };
        const before = identity(b);
        void actions.generate('town', hit.settlement, 'buildings', undefined, undefined, undefined, false, true).then(done => {
          if (!done || !state.world) return;
          const after = townUrban(state.world, hit.settlement)?.buildings.find(building => (building as UrbanBuilding & { nativeRequestId?: string }).nativeRequestId === requestId);
          if (after && identity(after) === before) actions.toast('The building did not change. The engine kept the previous result for this edit.', true);
        });
      };
      const city = nativeCityRecords(state.world ?? undefined)?.[hit.settlement],
        site = city?.sites?.find(s => s.id === requestId);
      let nativeRequest = city?.requests?.find(request => request.id === requestId);
      const houseControls = $('#house-native-controls'),
        surface = { surface: [{ outer: b.poly, holes: b.courtyards ?? [] }] };
      const parcelId = (b as UrbanBuilding & { nativeParcelId?: string }).nativeParcelId;
      if (parcelId) {
        const typeControl = document.createElement('div');
        houseControls.before(typeControl);
        const allocation = (city?.programmePartitions ?? city?.partitions)?.[0]?.programme?.allocations.find(a => a.parcelId === parcelId);
        const field = { ...urbanField('role', '', 'parcel'), label: 'Parcel content', emptyLabel: 'From culture', help: 'Changes the use of this parcel and regenerates its buildings.' };
        const form = mountParameterForm(typeControl, [field], {
          getValue: () => state.settings.urban?.local?.[hit.settlement]?.parcels?.overrides?.parcels?.[parcelId]?.role ?? allocation?.role,
          choices: () =>
            compatibleBuildingTypes({
              current: allocation?.role,
              fallbackCulture: state.settings.options.culture,
              culture: state.settings.urban?.buildings?.[scopedId]?.culture ?? state.settings.urban?.local?.[hit.settlement]?.parcels?.overrides?.parcels?.[parcelId]?.culture ?? nativeRequest?.culture.culture ?? site?.culture.culture ?? state.settings.options.culture,
              area: polygonArea(
                city?.partitions?.[0]?.parcels.find(parcel => parcel.id === parcelId)?.envelope ??
                  city?.partitions?.[0]?.parcels.find(parcel => parcel.id === parcelId)?.shape ?? { outer: townUrban(state.world!, hit.settlement)?.parcels.find(parcel => parcel.nativeId === parcelId)?.poly ?? b.poly },
              ),
              architecture: state.settings.urban?.architecture,
              pack: nativeRequest?.culture.pack ?? site?.culture.pack,
              mode: city?.layouts[0]?.config?.programme.mode,
              period: city?.layouts[0]?.config?.programme.period,
              navigableAccess: city?.layouts[0]?.config?.programme.navigableAccess,
            }),
          setValue: (_path, value) => {
            state.settings.urban ??= { backend: state.settings.runtime?.backend ?? 'rust' };
            const local = (state.settings.urban.local ??= {});
            const controls = (local[hit.settlement] ??= {});
            controls.parcels ??= {};
            controls.parcels.overrides ??= {};
            const entries = (controls.parcels.overrides.parcels ??= {});
            const edit = (entries[parcelId] ??= {});
            if (value && value !== 'auto') edit.role = String(value);
            else delete edit.role;
            delete edit.function;
            delete edit.households;
            delete edit.houseConfig;
            if (state.settings.urban.buildings) {
              const own = state.settings.urban.buildings[scopedId];
              const requests = (city?.sites ?? city?.requests ?? []).filter(site => site.parcel_id === parcelId).map(site => site.id);
              resetSubdivisionChildren(state.settings, hit.settlement, 'parcel', { parcels: [parcelId], requests });
              if (own?.culture) edit.culture = own.culture;
              state.settings.urban.buildings[scopedId] = { ...(own?.culture ? { culture: own.culture } : {}), ...(own?.seed ? { seed: own.seed } : {}) };
            }
            actions.touchRecipe();
            form.sync();
          },
        });
        state.inspectorForms.push(form);
      }
      const mountHouseControls = () => {
        const actual = city?.scene?.buildings.find(building => building.id === (b as UrbanBuilding & { nativeId?: string }).nativeId);
        const rawRoof = actual?.volumes[0]?.roof_system ?? actual?.cartographic?.roof_system ?? (actual as { programme?: { massing?: { roof?: string }[] } } | undefined)?.programme?.massing?.[0]?.roof;
        // City volumes name their roof by massing shape ('hip'); the editor offers native roof systems ('RF-HIP').
        const roof = rawRoof && (Object.entries(massingRoofs).find(([, shape]) => shape === rawRoof)?.[0] ?? rawRoof);
        state.inspectorForms.push(
          mountUrbanControls(
            houseControls,
            () => state.settings,
            () => {
              actions.touchRecipe();
              state.inspectorForms.forEach(form => form.sync());
            },
            {
              kind: 'building',
              key: hit.settlement,
              id: requestId,
              parcel: (b as UrbanBuilding & { nativeParcelId?: string }).nativeParcelId,
              quarter: city ? siteQuarter(city.layouts, surface) : undefined,
              block: city ? siteBlock(city.layouts, surface) : undefined,
              defaults: {
                ...nativeRequest?.config,
                culture: nativeRequest?.culture.culture ?? site?.culture.culture,
                pack: nativeRequest?.config?.pack ?? nativeRequest?.culture.pack ?? site?.culture.pack,
                overrides: { ...houseControlDefaults().overrides, ...nativeRequest?.config?.overrides, ...(roof ? { roof } : {}), floors: b.storeys ?? 1 },
              },
            },
            { hideReset: true },
          ),
        );
        organizeInspector($('#building-inspector'));
      };
      if (!state.localEdition || nativeRequest || !site || !city?.siteQuery) mountHouseControls();
      else
        void import('../../../../rust/bridge/urbanBuildingSite')
          .then(m => m.readUrbanBuildingSite(city.siteQuery!, { profile: 'local', server: state.backendBindings.localServer() }, site.offset, site.id, city.sites!.length))
          .then(
            request => {
              nativeRequest = request;
            },
            () => undefined,
          )
          .then(() => {
            if (houseControls.isConnected) mountHouseControls();
          });
      $('#house-reroll').title = translate('Reroll house');
      $('#house-reroll').onclick = () => {
        try {
          const current = state.settings.urban?.buildings?.[scopedId] ?? {};
          const base = String(current.seed ?? nativeRequest?.config?.seed ?? state.settings.options.seed);
          apply({ ...current, seed: rerollSeed(base, ['house']) });
        } catch (e) {
          actions.toast(String(e), true);
        }
      };
      $('#house-native-apply').onclick = () => {
        try {
          apply(state.settings.urban?.buildings?.[scopedId] ?? {});
        } catch (e) {
          actions.toast(String(e), true);
        }
      };
      $('#house-native-reset').title = translate('Remove local overrides and regenerate using the parent settings.');
      $('#house-native-reset').onclick = () => {
        try {
          if (state.busy) return;
          const buildings = { ...state.settings.urban?.buildings };
          delete buildings[scopedId];
          if (parcelId) {
            const edit = state.settings.urban?.local?.[hit.settlement]?.parcels?.overrides?.parcels?.[parcelId];
            if (edit) {
              delete edit.role;
              delete edit.function;
            }
          }
          state.settings.urban = { ...state.settings.urban, backend: state.settings.urban?.backend ?? state.settings.runtime?.backend ?? 'rust', buildings };
          actions.touchRecipe();
          void actions.generate('town', hit.settlement, 'buildings', undefined, undefined, undefined, false, true);
        } catch (e) {
          actions.toast(String(e), true);
        }
      };
    }
    organizeInspector($('#building-inspector'));
    insertHTML($('#building-inspector'), 'afterbegin', '<button id="back-to-city" class="quiet small">← ' + 'Back to city' + '</button>');
    $('#back-to-city').onclick = () => actions.showInspector(hit.settlement);
    $('#building-inspector').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  return { showBuilding };
}
