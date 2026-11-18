/**
 * The settlement inspector: local settings of one town (culture, population, walls, recipe JSON), its rename and
 * name origin, rebuild and stage-by-stage runs, the engine report and restored deletions. Opened from the Places list,
 * a map click and the runs that targeted the town.
 */
import type { PageActions, PageState } from './contract';
import { setHTML, insertHTML, setText, translate, getLanguage, nameHTML, numberHTML, registerMessages } from '../i18n';
import { settlementDisplayName } from '../mapPresentation';
import { groupCultureSelector } from '../workbenchLayout';
import { organizeInspector } from '../advancedPanel';
import { CULTURE_LABELS } from '../../gen/options';
import { nativeCityRecords } from '../nativeProducts';
import { populationText, populationShortfallText } from '../../render/cityPopulation';
import { validateSettings } from '../project';
import type { V2TownStage } from '../contracts';
import { urbanParameterHelp } from '../urbanParameterHelp';
import { townUrban, type BuildingEdit } from '../edits';
import { mountUrbanControls, writeUrbanControl } from '../urbanControls';
import { mountNameOriginControls } from '../nameOriginControls';
import { mountPlaceRename } from '../placeRename';
import { mountDeletedSubdivisions } from '../localUrbanEditor';
import { rerollSettlement } from '../urbanSeeds';
import { resetUrbanChildren } from '../generationEdits';
import { $, esc, options, wallStyles } from './dom';
import { populationFormat } from './places';

export function createTownInspector(state: PageState, actions: PageActions) {
  function showInspector(key: string, focus = false): void {
    if (!state.world) return;
    const source = state.world.settlements?.find(s => s.key === key);
    if (!source) return;
    const s = { ...source, name: settlementDisplayName(state.world, key, state.settings) };
    if (!townUrban(state.world, key)) state.smallPlaces?.prioritize(key);
    window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail: 'selection' }));
    actions.disposeInspectorForms();
    state.selectedTown = key;
    state.selectedBuilding = null;
    state.selectedSubdivision = undefined;
    state.selectionOutline.set();
    state.selectedCities.clear();
    state.selectedCities.add(key);
    state.cityScope = 'selection';
    actions.syncCitySelection();
    document.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.town === key)));
    $('#places-panel').hidden = false;
    state.chain.sync();
    const urban = townUrban(state.world, key),
      local = state.settings.local[key] ?? {};
    const current = { ...state.settings.options, sprawl: state.settings.options.sprawl ?? 1, population: s.population, culture: s.culture, ...local } as Record<string, unknown>;
    if (state.chain.family() !== 'cities') state.chain.selectFamily('cities');
    $('#inspector').dataset.scope = 'settlement';
    $('#inspector').hidden = false;
    setHTML(
      $('#inspector'),
      `<button class="close" aria-label="Close inspector">×</button><span class="eyebrow">Local settings</span><h2>${nameHTML(s.name, s.main ? 'Main settlement' : s.key)}</h2><p class="hint">${actions.reachedPopulation(key, s.population) ? actions.populationMarkup(key, s.population) : `${numberHTML(s.population)} inhabitants`} · <span>${esc(s.archetype)}</span></p>${populationShortfallText(actions.reachedPopulation(key, s.population), populationFormat()) ? `<p class="warning">${esc(populationShortfallText(actions.reachedPopulation(key, s.population), populationFormat()))}</p>` : ''}<div class="breadcrumbs">Territory › ${nameHTML(s.name, s.key)}</div><p class="inspect-note">The fields show the current values. Previous stages and other settlements are retained.</p><label class="label">Culture</label><select id="local-culture">${options(CULTURE_LABELS)}</select><div class="control-grid"><div><label class="label">Population</label><input id="local-population" type="number" min="1" max="5000000" value="${current.population}"></div><div><label class="label">Sprawl</label><input id="local-sprawl" type="number" min="0.5" max="2" step="0.1" value="${current.sprawl ?? 1}"></div></div><label class="label">Fortifications</label><select id="local-walls">${options(
        [
          ['none', 'None'],
          ['single', 'Simple'],
          ['double', 'Double'],
          ['auto', 'Automatic'],
        ],
      )}</select><label class="label">Fortification style</label><select id="local-wallStyle">${options(wallStyles)}</select><button class="primary" id="build-town">${urban ? 'Rebuild this settlement' : 'Build this settlement'}</button><p class="hint" style="margin-top:8px">${urban ? `${urban.quarters.length} quarters · ${urban.parcels.length} parcels · ${urban.buildings.length} buildings` : 'Site reserved · build on demand'}</p><details class="section"><summary>This settlement’s stages</summary><ol class="pipeline-list"><li>Plan & footprint<span>Population, culture and site.</span></li><li>Quarters & streets<span>Growth, layout and hierarchy.</span></li><li>Blocks & parcels<span>Land, access and occupation.</span></li><li>Buildings & houses<span>Typologies, envelopes and landmarks.</span></li></ol></details><details class="section"><summary>Full local recipe</summary><p class="hint">All exposed urban settings: growth plans, landmarks, defences and preferences. Terrain settings are global.</p><textarea id="local-json" spellcheck="false">${esc(JSON.stringify(local, null, 2))}</textarea><button id="local-apply" class="small">Apply</button><button id="local-reset" class="quiet small">Restore default settings</button></details><div id="building-inspector"></div>`,
    );
    for (const [name, helpKey] of Object.entries({ culture: 'culture', population: 'population', sprawl: 'sprawl', walls: 'walls', wallStyle: 'fortificationStyle' })) {
      const input = $<HTMLInputElement | HTMLSelectElement>(`#local-${name}`),
        caption = input.previousElementSibling!;
      caption.setAttribute('for', input.id);
      const description = document.createElement('small');
      description.hidden = true;
      description.id = `${input.id}-help`;
      setText(description, urbanParameterHelp[helpKey]);
      input.after(description);
      input.setAttribute('aria-describedby', description.id);
      for (const target of [caption, input]) {
        target.setAttribute('data-i18n-title', urbanParameterHelp[helpKey]);
        target.setAttribute('title', translate(urbanParameterHelp[helpKey]));
      }
    }
    $('#inspector .close').onclick = () => {
      $('#inspector').hidden = true;
      state.selectedBuilding = null;
      state.selectedSubdivision = undefined;
      state.selectionOutline.set();
    };
    for (const name of ['culture', 'population', 'sprawl', 'walls', 'wallStyle']) {
      const input = $<HTMLInputElement | HTMLSelectElement>(`#local-${name}`);
      input.value = String(current[name] ?? '');
      input.onchange = () => {
        if (input instanceof HTMLInputElement && !input.checkValidity()) {
          input.reportValidity();
          return;
        }
        const next = { ...state.settings.local[key] } as Record<string, unknown>;
        if (input.value === '') delete next[name];
        else next[name] = name === 'population' || name === 'sprawl' ? Number(input.value) : input.value;
        resetUrbanChildren(state.settings, { kind: 'settlement', key }, name === 'culture' || name === 'population' ? 'layout.culture' : 'layout.tissue');
        state.mods = state.mods.filter(m => !(m && typeof m === 'object' && (m as BuildingEdit).settlement === key));
        state.settings.local[key] = next;
        if (name === 'culture' && (state.settings.urban?.backend ?? state.settings.runtime?.backend) !== 'typescript') writeUrbanControl(state.settings, { kind: 'settlement', key }, 'layout.culture', input.value || undefined);
        actions.touchRecipe();
        state.urbanControls.sync();
        state.inspectorForms.forEach(form => form.sync());
      };
    }
    groupCultureSelector($<HTMLSelectElement>('#local-culture'));
    const editPlaceName = document.createElement('button');
    editPlaceName.type = 'button';
    editPlaceName.className = 'quiet small';
    editPlaceName.id = 'edit-place-name';
    setText(editPlaceName, 'Edit name and visibility');
    editPlaceName.onclick = () => {
      state.chain.selectFamily('map');
      state.labelEditor.selectPlace(key);
    };
    $('#inspector h2').after(editPlaceName);
    mountPlaceRename($('#inspector h2'), {
      key,
      getSettings: () => state.settings,
      getName: () => (state.world ? settlementDisplayName(state.world, key, state.settings) : undefined),
      changed: () => {
        void actions.redrawNames();
      },
    });
    const origin = document.createElement('section');
    $('#build-town').before(origin);
    state.inspectorForms.push(
      mountNameOriginControls(origin, 'city-name-origin', {
        getSettings: () => state.settings,
        busy: () => state.busy,
        city: key,
        getCulture: () => state.settings.local[key]?.culture ?? s.culture,
        changed: () => {
          void actions.redrawNames();
        },
      }),
    );
    $('#build-town').onclick = () => void actions.generate('town', key);
    const reroll = document.createElement('button');
    reroll.id = 'reroll-town';
    reroll.type = 'button';
    reroll.className = 'settlement-reroll';
    reroll.innerHTML = '<i class="art art-dice" aria-hidden="true"></i>';
    registerMessages({ 'Rebuild this settlement differently': { en: 'Rebuild this settlement differently', fr: 'Reconstruire ce lieu autrement' } });
    reroll.title = translate('Rebuild this settlement differently');
    reroll.setAttribute('aria-label', reroll.title);
    const rebuildActions = document.createElement('div');
    rebuildActions.className = 'settlement-rebuild-actions';
    $('#build-town').before(rebuildActions);
    rebuildActions.append($('#build-town'), reroll);
    $('#build-town').classList.add('small');
    $('#build-town').textContent = '↻ ' + translate('Regenerate area');
    reroll.onclick = () => {
      if (state.busy) return;
      resetUrbanChildren(state.settings, { kind: 'settlement', key }, 'layout.tissue');
      state.mods = state.mods.filter(m => !(m && typeof m === 'object' && (m as BuildingEdit).settlement === key));
      rerollSettlement(state.settings, key);
      $<HTMLInputElement>('#seed').value = state.settings.options.seed;
      actions.touchRecipe();
      void actions.generate('town', key);
    };
    const backend = state.settings.urban?.backend ?? state.settings.runtime?.backend ?? 'typescript';
    if (backend !== 'typescript') {
      insertHTML(
        rebuildActions,
        'afterend',
        `<div class="section"><span class="eyebrow">Proceed stage by stage</span><div class="urban-stage-buttons">${[
          ['layout', '1 · Plan & quarters'],
          ['parcels', '2 · Blocks & parcels'],
          ['programme', '3 · Programme'],
          ['buildings', '4 · Houses'],
        ]
          .map(([stage, label]) => `<button class="small" data-town-stage="${stage}">${label}</button>`)
          .join(
            '',
          )}</div><p class="hint">These are actual stopping points in the Rust engine. The map shows only the layers already built.</p></div><details class="section"><summary>Rust settings for this settlement</summary><p class="hint">Current values for this settlement. Plan, parcelling and houses each have their own configuration.</p><textarea id="local-rust-json" spellcheck="false">${esc(JSON.stringify(state.settings.urban?.local?.[key] ?? {}, null, 2))}</textarea><button id="local-rust-apply" class="small">Apply to this settlement</button></details>`,
      );
      document.querySelectorAll<HTMLButtonElement>('[data-town-stage]').forEach(button => (button.onclick = () => void actions.generate('town', key, button.dataset.townStage as V2TownStage)));
      $('#local-rust-apply').onclick = () => {
        try {
          const value = JSON.parse($<HTMLTextAreaElement>('#local-rust-json').value);
          const candidate = { ...state.settings, urban: { ...state.settings.urban, backend, local: { ...state.settings.urban?.local, [key]: value } } };
          validateSettings(candidate);
          state.settings = candidate;
          actions.touchRecipe();
          actions.toast('Local Rust settings saved. Choose the stage to rebuild.');
        } catch (e) {
          actions.toast(String(e), true);
        }
      };
      insertHTML(rebuildActions, 'afterend', '<div class="section" id="local-urban-controls"></div>');
      state.inspectorForms.push(
        mountUrbanControls(
          $('#local-urban-controls'),
          () => state.settings,
          () => {
            actions.touchRecipe();
            $<HTMLTextAreaElement>('#local-rust-json').value = JSON.stringify(state.settings.urban?.local?.[key] ?? {}, null, 2);
          },
          { kind: 'settlement', key, defaults: actions.cityControlDefaults(key) },
          { hideReset: true },
        ),
      );
      const native = nativeCityRecords(state.world)?.[key];
      if (native) {
        const refusals = native.stage === 'buildings' ? (native.scene?.refusals ?? []) : [],
          warnings = native.warnings ?? [];
        insertHTML(
          $('#inspector'),
          'beforeend',
          `<details class="section" ${refusals.length || warnings.length ? 'open' : ''}><summary>Engine report · ${refusals.length} refusals</summary><p class="hint">${esc(populationText(s.population, actions.reachedPopulation(key, s.population), populationFormat()))}</p>${populationShortfallText(actions.reachedPopulation(key, s.population), populationFormat()) ? `<p class="warning">${esc(populationShortfallText(actions.reachedPopulation(key, s.population), populationFormat()))}</p>` : ''}<p class="hint">Stage: ${esc(native.stage)} · ${esc(native.backend)}. ${native.lastBuildingRequests ?? 0} house request(s) recomputed in the last run.</p>${warnings.length ? `<pre class="job-log">${esc(warnings.map(warning => translate(warning)).join('\n'))}</pre>` : '<p class="hint">No generation warnings.</p>'}${refusals
            .slice(0, 20)
            .map(refusal => {
              const id = (native.sites ?? native.requests)?.find(r => r.id === refusal.id || r.parcel_id === refusal.parcel_id)?.id ?? refusal.id;
              return `<details class="section"><summary>House ${esc(id)}</summary><p class="warning">${esc(translate(refusal.message))}</p><textarea class="refusal-json" spellcheck="false">${esc(JSON.stringify(state.settings.urban?.buildings?.[`${key}/${id}`] ?? {}, null, 2))}</textarea><button class="small" data-retry-house="${esc(id)}">Retry with these settings</button><p class="hint">Enter {} to restore settlement inheritance. Recipe limits remain enforced by the engine.</p></details>`;
            })
            .join('')}</details>`,
        );
        document.querySelectorAll<HTMLButtonElement>('[data-retry-house]').forEach(
          button =>
            (button.onclick = () => {
              try {
                const value = JSON.parse(button.parentElement!.querySelector('textarea')!.value),
                  id = button.dataset.retryHouse!,
                  next = { ...state.settings, urban: { ...state.settings.urban, backend, buildings: { ...state.settings.urban?.buildings, [`${key}/${id}`]: value } } };
                validateSettings(next);
                state.settings = next;
                actions.touchRecipe();
                void actions.generate('town', key, 'buildings');
              } catch (e) {
                actions.toast(String(e), true);
              }
            }),
        );
      }
    }
    const localOverrides = state.settings.urban?.local?.[key];
    const deletedEntries = [
      ...Object.entries(localOverrides?.layout?.overrides?.quarters ?? {})
        .filter(([, v]) => v?.deleted)
        .map(([id]) => ({ kind: 'quarter' as const, id })),
      ...Object.entries(localOverrides?.parcels?.overrides?.parcels ?? {})
        .filter(([, v]) => v?.deleted)
        .map(([id]) => ({ kind: 'parcel' as const, id })),
    ];
    mountDeletedSubdivisions($('#inspector'), getLanguage() === 'fr', deletedEntries, (kind, id) => {
      try {
        const local = { ...state.settings.urban?.local },
          scope = { ...local[key] };
        if (kind === 'quarter') {
          const quarters = { ...scope.layout?.overrides?.quarters },
            value = { ...quarters[id] };
          delete value.deleted;
          quarters[id] = value;
          scope.layout = { ...scope.layout, overrides: { ...scope.layout?.overrides, quarters } };
        } else {
          const parcels = { ...scope.parcels?.overrides?.parcels },
            value = { ...parcels[id] };
          delete value.deleted;
          parcels[id] = value;
          scope.parcels = { ...scope.parcels, overrides: { ...scope.parcels?.overrides, parcels } };
        }
        local[key] = scope;
        const next = { ...state.settings, urban: { ...state.settings.urban, backend: state.settings.urban?.backend ?? state.settings.runtime?.backend ?? ('rust' as const), local } };
        validateSettings(next);
        state.settings = next;
        actions.touchRecipe();
        const stage = state.world?.stats[`v2.urbanStage:${key}`] as V2TownStage | undefined;
        void actions.generate('town', key, stage ?? (kind === 'quarter' ? 'layout' : 'parcels'));
      } catch (e) {
        actions.toast(String(e), true);
      }
    });
    $('#local-apply').onclick = () => {
      try {
        const patch = JSON.parse($<HTMLTextAreaElement>('#local-json').value);
        const candidate = { ...state.settings, local: { ...state.settings.local, [key]: patch } };
        validateSettings(candidate);
        state.settings = candidate;
        actions.touchRecipe();
        actions.toast('Local recipe saved. Rebuild this settlement to apply it.');
      } catch (e) {
        actions.toast(String(e), true);
      }
    };
    setText($('#local-reset'), 'Use parent settings');
    $('#local-reset').title = translate('Remove local overrides and regenerate using the parent settings.');
    rebuildActions.append($('#local-reset'));
    $('#local-reset').onclick = () => {
      if (state.busy) return;
      delete state.settings.local[key];
      if (state.settings.urban?.local) delete state.settings.urban.local[key];
      if (state.settings.urban?.buildings) for (const id of Object.keys(state.settings.urban.buildings)) if (id.startsWith(`${key}/`)) delete state.settings.urban.buildings[id];
      actions.touchRecipe();
      void actions.generate('town', key);
    };
    organizeInspector($('#inspector'));
    actions.appendLocalFacts($('#inspector'), key);
    // The camera goes to the place's published centre: its built core when the town stands beside its placed centre.
    const seat = s.core ?? s.center;
    if (focus && state.city3d?.active) state.city3d.focus(seat, s.radius);
    else if (focus) state.client.viewer.setView({ cx: seat.x, cy: seat.y, scale: Math.min(3, Math.min($('#map').clientHeight, $('#map').clientWidth) / Math.max(600, s.radius * 3)) });
  }
  return { showInspector };
}
