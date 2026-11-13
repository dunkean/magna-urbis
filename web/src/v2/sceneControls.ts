import type { V2Settings } from './contracts';
import { currentComposition, writeAppearanceControl } from './renderControls';
import { bindTree, registerMessages, setHTML, setText, translate, onLanguageChange } from './i18n';
import winterIcon from './assets/scene/winter.png';
import springIcon from './assets/scene/spring.png';
import summerIcon from './assets/scene/summer.png';
import autumnIcon from './assets/scene/autumn.png';
import dayIcon from './assets/scene/day.png';
import nightIcon from './assets/scene/night.png';
import './sceneControls.css';

registerMessages({
  'Season': { en: 'Season', fr: 'Saison' },
  'Azimuth': { en: 'Azimuth', fr: 'Azimut' },
  'Height': { en: 'Height', fr: 'Hauteur' },
  'Shading strength': { en: 'Shading strength', fr: 'Intensité de l’ombrage' },
  'Light direction, clockwise from north': { en: 'Light direction, clockwise from north', fr: 'Direction de la lumière, dans le sens horaire depuis le nord' },
  'Height above the horizon': { en: 'Height above the horizon', fr: 'Hauteur au-dessus de l’horizon' },
  'Day': { en: 'Day', fr: 'Jour' }, 'Night': { en: 'Night', fr: 'Nuit' },
  'Winter': { en: 'Winter', fr: 'Hiver' }, 'Spring': { en: 'Spring', fr: 'Printemps' },
  'Summer': { en: 'Summer', fr: 'Été' }, 'Autumn': { en: 'Autumn', fr: 'Automne' },
});

const SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'] as const;
const icons = [winterIcon, springIcon, summerIcon, autumnIcon];
const icon = (src: string) => '<img src="' + src + '" alt="" aria-hidden="true" draggable="false">';

export function mountSceneControls(host: HTMLElement, api: { getSettings(): V2Settings; onChange(): void }) {
  setHTML(host, [
    '<div class="scene-season scene-field">',
    '<div class="scene-caption"><label for="scene-season">Season</label><output id="scene-season-value" for="scene-season" aria-live="polite" data-l10n-keep></output></div>',
    '<div class="scene-season-icons">' + SEASONS.map((name, i) => '<button type="button" data-season="' + (i * 3 + 1) + '" aria-label="' + name + '" title="' + name + '">' + icon(icons[i]) + '</button>').join('') + '</div>',
    '<input id="scene-season" type="range" min="0" max="11" step="1" aria-label="Season">',
    '<div class="scene-season-ticks" aria-hidden="true">' + '<i></i>'.repeat(12) + '</div></div>',
    '<div class="scene-daynight" role="group"><button id="scene-day" type="button" aria-label="Day" title="Day" aria-pressed="true">' + icon(dayIcon) + '</button><button id="scene-night" type="button" aria-label="Night" title="Night" aria-pressed="false">' + icon(nightIcon) + '</button></div>',
    '<div class="scene-direction"><div class="scene-compass" role="slider" tabindex="0" aria-label="Azimuth" aria-valuemin="0" aria-valuemax="359" title="Light direction, clockwise from north">',
    '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="scene-compass-ring" cx="24" cy="24" r="19"/><path class="scene-compass-ticks" d="M24 2v5m0 34v5M2 24h5m34 0h5"/><g class="scene-compass-needle"><path d="M24 24V9"/><circle cx="24" cy="9" r="3"/><circle cx="24" cy="24" r="2"/></g></svg>',
    '</div><div class="scene-direction-caption"><span>Azimuth</span><output id="scene-azimuth-value" data-l10n-keep></output></div></div>',
    '<div class="scene-height scene-field"><div class="scene-caption"><label for="scene-elevation">Height</label><output id="scene-elevation-value" for="scene-elevation" data-l10n-keep></output></div><input id="scene-elevation" type="range" min="5" max="90" step="1" title="Height above the horizon"></div>',
    '<div class="scene-shadows scene-field"><div class="scene-caption"><label for="scene-strength">Shading strength</label><output id="scene-strength-value" for="scene-strength" data-l10n-keep></output></div><input id="scene-strength" type="range" min="0" max="3" step="0.05"></div>',
  ].join(''));
  const season = host.querySelector<HTMLInputElement>('#scene-season')!;
  const elevation = host.querySelector<HTMLInputElement>('#scene-elevation')!;
  const strength = host.querySelector<HTMLInputElement>('#scene-strength')!;
  const compass = host.querySelector<HTMLElement>('.scene-compass')!;
  const needle = host.querySelector<SVGGElement>('.scene-compass-needle')!;
  const day = host.querySelector<HTMLButtonElement>('#scene-day')!;
  const night = host.querySelector<HTMLButtonElement>('#scene-night')!;
  const seasonButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-season]'));
  const output = (id: string, value: string) => setText(host.querySelector<HTMLOutputElement>(id)!, value);
  function change(key: string, value: number | string, enableLight = false): void {
    const settings = api.getSettings();
    writeAppearanceControl(settings, 'appearance.composition.effects.' + key, value);
    if (enableLight) writeAppearanceControl(settings, 'appearance.composition.effects.lighting.enabled', true);
    sync(); api.onChange();
  }
  const selectSeason = (step: number) => change('season', ((step + 11) % 12) / 12);
  season.oninput = () => selectSeason(Number(season.value));
  for (const button of seasonButtons) button.onclick = () => selectSeason(Number(button.dataset.season));
  elevation.oninput = () => change('lighting.elevation', Number(elevation.value), true);
  strength.oninput = () => change('lighting.strength', Number(strength.value), true);
  day.onclick = () => change('ambience', 'day', true);
  night.onclick = () => change('ambience', 'night', true);
  function point(event: PointerEvent): void {
    const bounds = compass.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2;
    if (Math.hypot(x, y) < 3) return;
    change('lighting.azimuth', (Math.round(Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360, true);
  }
  compass.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); compass.focus(); compass.setPointerCapture(event.pointerId); point(event);
  };
  compass.onpointermove = event => { if (compass.hasPointerCapture(event.pointerId)) point(event); };
  compass.onpointerup = event => { if (compass.hasPointerCapture(event.pointerId)) compass.releasePointerCapture(event.pointerId); };
  compass.onkeydown = event => {
    const delta = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 15, PageDown: -15 } as Record<string, number>)[event.key];
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const azimuth = currentComposition(api.getSettings()).effects.lighting.azimuth;
    change('lighting.azimuth', event.key === 'Home' ? 0 : event.key === 'End' ? 359 : (azimuth + delta * (event.shiftKey ? 10 : 1) + 360) % 360, true);
  };
  function sync(): void {
    const effects = currentComposition(api.getSettings()).effects, light = effects.lighting;
    // The annual cycle is centred on winter at 0, spring at .25, summer at .5.
    const step = (Math.round(effects.season * 12) + 1) % 12;
    const seasonText = translate(SEASONS[Math.floor(step / 3)]) + ' · ' + (step % 3 + 1) + '/3';
    season.value = String(step); season.setAttribute('aria-valuetext', seasonText);
    output('#scene-season-value', seasonText);
    for (const button of seasonButtons) button.setAttribute('aria-pressed', String(Math.floor(Number(button.dataset.season) / 3) === Math.floor(step / 3)));
    day.setAttribute('aria-pressed', String(effects.ambience === 'day'));
    night.setAttribute('aria-pressed', String(effects.ambience === 'night'));
    const azimuth = Math.round(light.azimuth) % 360;
    compass.setAttribute('aria-valuenow', String(azimuth)); compass.setAttribute('aria-valuetext', azimuth + '°');
    needle.setAttribute('transform', 'rotate(' + azimuth + ' 24 24)');
    output('#scene-azimuth-value', azimuth + '°');
    elevation.value = String(light.elevation); elevation.setAttribute('aria-valuetext', Math.round(light.elevation) + '°');
    strength.value = String(light.enabled ? light.strength : 0);
    const shading = Math.round((light.enabled ? light.strength : 0) * 100) + '%';
    strength.setAttribute('aria-valuetext', shading);
    output('#scene-elevation-value', Math.round(light.elevation) + '°');
    output('#scene-strength-value', shading);
  }
  bindTree(host); onLanguageChange(sync); sync(); return { sync };
}
