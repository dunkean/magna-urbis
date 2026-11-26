/**
 * The V2 page shell: header, workbench bar, sidebar, map area and dialogs, written into #app once by main.ts before any
 * control mounts. The ids and data attributes here are the page's contract with its modules, tests and shot scripts.
 */
import { setHTML, LANGUAGES } from '../i18n';
import logo from '../../ui/assets/logo-magna-urbis.png';
import { CULTURE_LABELS } from '../../gen/options';
import { STYLE_LIST } from '../../render/styles';
import { EXPORT_LAYER_NAMES } from '../../render/exportLayers';
import { desktopReleasesUrl } from '../desktopUpdates';
import { $, icon, field, tri, wallStyles, layerNames } from './dom';

export function mountPageShell(localEdition: boolean): void {
  setHTML(
    $('#app'),
    `
<header class="app-header">
  <img class="brand-icon" src="${logo}" alt=""><div class="brand"><h1>MAGNA URBIS</h1><p>The region workshop</p></div><span class="version">V2 · ALPHA</span>
  <button id="project-links-open" type="button" aria-haspopup="dialog" aria-controls="project-links-dialog">Links</button>
  <a id="desktop-download" href="${desktopReleasesUrl}" target="_blank" rel="noopener noreferrer">Download app</a>
  <div class="project-actions"><button id="import-open">Open</button><button id="save-map">Save map</button><button id="osm-open" type="button" class="primary" aria-haspopup="dialog" aria-controls="osm-dialog" title="Import a real place">OpenStreetMap</button><button id="export-open">Export ↗</button></div>
  <div class="header-tools"><span class="edition">${localEdition ? 'Desktop / local edition' : 'Web edition'}</span><label class="language-control header-language"><select id="language-select" aria-label="Interface language">${LANGUAGES.map(item => `<option value="${item.code}" data-l10n-keep>${item.name}</option>`).join('')}</select></label><button id="hardware-open" title="Settings, engines and activity">${icon('settings-gear', 20)} <span class="status-dot" id="hardware-led"></span> <span id="hardware-caption">Settings</span></button></div>
</header>
<section class="workbench-bar" aria-label="Scene and editing tools">
  <div class="view-strip"><div class="style-control"><label class="strip-label" for="map-style">Appearance</label><select id="map-style" aria-label="Map style">${STYLE_LIST.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}</select></div><div id="scene-controls" class="scene-controls"></div></div>
  <nav class="header-menu" id="header-menu" aria-label="Map tools"><span class="strip-label">Edit map</span><button id="edit-navigate" type="button" aria-pressed="true">Navigate</button><label class="inspector-mode"><input id="inspect-mode" type="checkbox"><span>Select on map</span></label><div id="network-tool-slot"></div><button id="rivers-open" type="button" aria-pressed="false">Rivers</button><button id="labels-open" type="button" aria-pressed="false">Names & labels</button><span class="tool-spacer"></span><output id="active-tool" aria-live="polite">Navigate</output><button id="edit-done" type="button" hidden>Finish editing</button></nav>
</section>
<button class="mobile-toggle" id="mobile-toggle" aria-expanded="false" aria-controls="sidebar">☰ Workshop</button>
<main class="workspace">
  <aside class="sidebar mobile-closed" id="sidebar" aria-label="Generation chain">
    <div id="terrain-controls"></div>
    <div class="sidebar-footer"><div class="footer-actions"><button class="primary generate" id="generate-region"><i class="art art-terrain" aria-hidden="true"></i><span id="generate-label">Create the relief</span></button><button id="run-chain" type="button" title="Generate the whole chain: relief, settlements and cities">${icon('family-settlements', 24)}<span>Full generation</span></button></div><div class="footer-note"><span class="status-dot"></span><span id="footer-status" class="grow">Terrain and water, in one click</span><button id="expert-open" class="quiet small">JSON recipe</button></div></div>
  </aside>
  <div id="stage-staging" hidden>
    <div class="stage-field" data-control="widget:seed"><label class="label" for="seed">Region seed</label><div class="row seed-row"><input id="seed" data-option="seed" type="text" maxlength="200" pattern="[0-9a-hjkmnp-tv-z]{6}" spellcheck="false" aria-label="Region seed"><button id="random-seed" title="New seed" aria-label="New seed"><i class="art art-dice"></i></button></div><p class="hint" id="extent-hint"></p></div>
    <div class="stage-field" data-control="main:town-count"><label class="label" for="town-count">Requested settlements</label><input id="town-count" type="number" min="1" max="32" value="4"></div>
    <div class="stage-field" data-control="main:population">${field('Population principale', 'population', undefined, 'type="number" min="10" max="5000000" step="100"')}</div>
    <div class="stage-field" data-control="main:culture">${field('Culture commune', 'culture', CULTURE_LABELS)}</div>
    <div id="region-controls"></div>
    <div id="urban-settings-panel"><div id="urban-controls"></div></div>
    <div class="stage-field" data-control="main:sprawl">${field('Sprawl · 0.5 compact / 2 dispersed', 'sprawl', undefined, 'type="number" min="0.5" max="2" step="0.1"')}</div>
    <div class="stage-field" data-control="main:walls">${field('Fortifications', 'walls', [
      ['auto', 'Automatic'],
      ['none', 'Open town'],
      ['single', 'Single enclosure'],
      ['double', 'Double enclosure'],
    ])}</div>
    <div class="stage-field" data-control="main:wallStyle">${field('Fortification style', 'wallStyle', wallStyles)}</div>
    ${[
      ['moat', 'Moat'],
      ['monasteries', 'Monasteries'],
      ['port', 'Port'],
      ['arena', 'Arena'],
      ['activities', 'Crafts & activities'],
    ]
      .map(([k, l]) => `<div class="stage-field" data-control="main:${k}">${field(l, k, tri)}</div>`)
      .join('')}
    <div class="stage-field" data-control="main:suburbs">${field('Suburbs', 'suburbs', [
      ['auto', 'Automatic'],
      ['none', 'None'],
      ['some', 'Some'],
      ['many', 'Many'],
    ])}</div>
    <details class="section" id="settings-endpoints-box"><summary>Model and service addresses</summary><div id="settings-endpoints" class="parameter-form"></div></details>
    <button id="terrain-only"></button><button id="region-only"></button><button id="heightmap-import-quick"></button>
  </div>
  <section class="map-area" aria-label="Interactive map">
    <aside id="editor-dock" class="editor-dock glass" hidden aria-labelledby="editor-title"><header><div><span class="eyebrow">Edit map</span><h2 id="editor-title">Edit map</h2></div><button id="editor-close" type="button" aria-label="Close">×</button></header><div id="editor-content"><div id="edit-buildings"><p class="hint">Select a town, district or building on the map to edit its properties.</p></div><div id="edit-roads" hidden></div><div id="edit-rivers" hidden></div><div id="edit-labels" hidden></div></div></aside>
    <div class="canvas-wrap" id="map"><canvas id="map-canvas" aria-label="Generated map: drag to pan, scroll to zoom"></canvas></div>
    <div class="empty-map" id="empty-map"><div class="serif">Terra incognita</div></div>
    <div class="map-compass" aria-hidden="true"><small>N</small><b>✧</b></div>
    <div class="glass map-tools"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit-map" aria-label="Fit map" title="Fit map">⛶</button></div>
    <aside class="glass places-panel" id="places-panel" hidden aria-labelledby="places-title"><header><h2 class="serif" id="places-title">Places</h2><span class="count-badge" id="towns-count">0</span><button id="towns-only">Build targeted cities</button><button id="places-collapse" class="quiet small" aria-expanded="true" aria-controls="settlement-list" title="Collapse the list">–</button></header><div class="places-selection"><button id="cities-select-all" class="small">Select all</button><button id="cities-select-none" class="small" hidden>Clear selection</button><output id="cities-selected-count" aria-live="polite"></output></div><div class="settlement-list" id="settlement-list"><p class="hint">Create settlement sites to select a place.</p></div><aside id="inspector" class="inspector" hidden aria-label="Settlement inspector"></aside></aside>
    <div class="glass progress-card" id="progress-card" hidden role="status" aria-live="polite"><div class="row"><i class="spinner"></i><strong class="grow small" id="progress-label">Preparing the region…</strong><button id="cancel-job" class="quiet small">Cancel</button></div><p id="progress-context" hidden></p><progress id="progress" max="100" value="0"></progress><div class="row spread"><p id="progress-detail">CPU · generation worker</p><p id="progress-time">0 s</p></div></div>
    <div class="map-bottom"><div class="glass mini-card"><canvas id="minimap" aria-label="Overview"></canvas><div class="map-scale"><span id="scale-label">—</span><div class="scale-line"></div><p id="map-metrics">No map</p><div id="cursor-readout"></div></div></div></div><div class="legend-strip"></div>
  </section>
</main>
<dialog id="project-links-dialog" aria-labelledby="project-links-title">
  <div class="dialog-head"><h2 id="project-links-title">Links</h2><button data-close="project-links-dialog" aria-label="Close">×</button></div>
  <nav class="project-links" aria-labelledby="project-links-title">
    <a href="./scientific/index.html" target="_blank" rel="noopener">How it works? ↗</a>
    <a href="https://v1.magna-urbis.org/" target="_blank" rel="noopener">V1 ↗</a>
    <a href="https://github.com/dunkean/magna-urbis" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
    <a href="https://github.com/dunkean/magna-urbis/discussions" target="_blank" rel="noopener noreferrer">Discussions ↗</a>
    <a href="${desktopReleasesUrl}" target="_blank" rel="noopener noreferrer">Releases ↗</a>
    <a href="https://ko-fi.com/dunkean" target="_blank" rel="noopener">Ko-fi ↗</a>
  </nav>
  <p id="build-info"></p>
</dialog>
<dialog id="import-dialog"><div class="dialog-head"><div><span class="eyebrow">Return to a region</span><h2>Open & compose</h2></div><button data-close="import-dialog" aria-label="Close">×</button></div><p class="hint">A project contains the map, settings and edits. A recipe recreates a region with the same engine version.</p><div class="file-card"><h3>Magna Urbis V2 project or recipe</h3><p class="hint">Binary .muproj, complete JSON, or seeds + settings. Projects retain the elevation grids.</p><input id="project-file" type="file" accept=".muproj,.json,application/octet-stream,application/json" aria-label="Import a V2 project or recipe"></div><div class="file-card"><h3>Heightmap → territory</h3><p class="hint">Grayscale PNG, JPEG or WebP, cropped to a square. Set the elevation and sea level before creating the terrain. The import replaces the current terrain.</p><input id="heightmap-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Import a heightmap"><button id="clear-heightmap" class="quiet small">Remove imported terrain</button><p class="hint" id="import-height-info">No heightmap imported.</p></div><div class="dialog-actions"><button data-close="import-dialog">Close</button></div></dialog>
<dialog id="export-dialog"><div class="dialog-head"><div><span class="eyebrow">Take your region with you</span><h2>Export your way</h2></div><button data-close="export-dialog" aria-label="Close">×</button></div><p class="hint">A complete map, a crop, or just the elements you need for your game.</p><div class="control-grid"><div><label class="label" for="export-format">Format</label><select id="export-format"><option value="binary">Save map · .muproj</option><option value="png">Image PNG</option><option value="dd2vtt">Universal VTT · .dd2vtt</option><option value="svg">SVG vector map</option><option value="project">Export complete project (JSON)</option><option value="recipe">Seeds + settings + edits</option><option value="seed">Seed only · JSON</option><option value="heightmap">Heightmap · 16-bit PNG</option><option value="names">Names · JSON</option></select></div></div><div id="export-map-options"><h3>Elements to include</h3><div class="export-layers">${EXPORT_LAYER_NAMES.map(k => `<label class="checkline"><input type="checkbox" data-layer="${k}" checked>${layerNames[k]}</label>`).join('')}</div><div class="control-grid"><div><label class="label" for="export-resolution">Longest edge</label><select id="export-resolution"><option value="1600">1,600 px · quick</option><option value="3000" selected>3,000 px · standard</option><option value="4096">4,096 px · detailed</option></select></div><label class="checkline"><input id="export-crop" type="checkbox" checked>Choose the export area</label></div></div><div id="export-vtt-options" class="control-grid" hidden><div><label class="label" for="export-vtt-grid">Metres per VTT grid cell</label><input type="number" id="export-vtt-grid" min="0.01" step="any" placeholder="Automatic"></div><label class="checkline"><input type="checkbox" id="export-vtt-building-walls">Buildings block vision</label></div><p class="hint" id="export-note" style="margin-top:15px">Visual exports use the current map without rerunning generation.</p><div class="dialog-actions"><button data-close="export-dialog">Cancel</button><button class="primary" id="export-go">Export</button></div></dialog>
<dialog id="expert-dialog"><div class="dialog-head"><div><span class="eyebrow">The region recipe</span><h2>Expert settings</h2></div><button data-close="expert-dialog" aria-label="Close">×</button></div><p class="hint">Global settings, local overrides by stable key, growth plans and site preferences. Imported terrain data is retained separately.</p><label class="label" for="expert-json">JSON recipe</label><textarea id="expert-json" spellcheck="false"></textarea><p class="warning" id="expert-error" role="alert"></p><div class="dialog-actions"><button data-close="expert-dialog">Cancel</button><button class="primary" id="expert-apply">Apply recipe</button></div></dialog>
<dialog id="hardware-dialog"><div class="dialog-head"><div><span class="eyebrow">The workshop at work</span><h2>Settings & engines</h2></div><button data-close="hardware-dialog" aria-label="Close">×</button></div><p class="hint">Choose the engine for each process. Available hardware and the last execution are shown separately.</p><details class="section preferences-section"><summary>Preferences & documentation</summary><div id="workbench-preferences" class="workbench-preferences"></div><a class="science-link" href="./scientific/index.html" target="_blank" rel="noopener">Scientific atlas ↗</a></details><div id="hardware-details"></div><details class="section"><summary>Generation log</summary><pre class="job-log" id="job-log">The workshop is ready.</pre></details><div class="dialog-actions"><button id="hardware-refresh">Refresh connections</button><button data-close="hardware-dialog">Close</button></div></dialog>
<div class="toast" id="toast" role="status" hidden></div>`,
  );
}
