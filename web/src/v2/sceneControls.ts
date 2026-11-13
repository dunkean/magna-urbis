import type { V2Settings } from './contracts';
import { applySceneClock, DEFAULT_SCENE, sceneSun, type SceneClock } from './sceneClock';
import { bindTree, registerMessages, setHTML, setText, translate, onLanguageChange } from './i18n';

registerMessages({
  'Scene date': { en: 'Scene date', fr: 'Date de la scène' },
  'Solar time': { en: 'Solar time', fr: 'Heure solaire' },
  'Latitude': { en: 'Latitude', fr: 'Latitude' },
  'Date drives seasons; solar time and latitude drive sunlight. Noon is solar noon, without a timezone.': { en: 'Date drives seasons; solar time and latitude drive sunlight. Noon is solar noon, without a timezone.', fr: 'La date fixe la saison ; l’heure solaire et la latitude fixent la lumière. Midi correspond au passage du soleil au méridien, sans fuseau horaire.' },
  'Apply date & time': { en: 'Apply date & time', fr: 'Appliquer date et heure' },
  'Manual lighting': { en: 'Manual lighting', fr: 'Lumière manuelle' },
  'Day': { en: 'Day', fr: 'Jour' }, 'Night': { en: 'Night', fr: 'Nuit' },
  'Winter': { en: 'Winter', fr: 'Hiver' }, 'Spring': { en: 'Spring', fr: 'Printemps' },
  'Summer': { en: 'Summer', fr: 'Été' }, 'Autumn': { en: 'Autumn', fr: 'Automne' },
});
export function mountSceneControls(host: HTMLElement, api: { getSettings(): V2Settings; onChange(): void }) {
  setHTML(host, `<label><span>Scene date</span><input id="scene-date" type="date" min="0001-01-01" max="9998-12-31"></label><label><span>Solar time</span><input id="scene-time" type="time" step="60"></label><label class="scene-latitude"><span>Latitude</span><input id="scene-latitude" type="number" min="-90" max="90" step="1" aria-label="Latitude"></label><div class="scene-readout"><output id="scene-state" aria-live="polite"></output><button id="scene-apply" type="button">Apply date & time</button></div><button class="scene-help quiet" type="button" aria-label="Date drives seasons; solar time and latitude drive sunlight. Noon is solar noon, without a timezone." title="Date drives seasons; solar time and latitude drive sunlight. Noon is solar noon, without a timezone.">?</button>`);
  const date = host.querySelector<HTMLInputElement>('#scene-date')!, time = host.querySelector<HTMLInputElement>('#scene-time')!, latitude = host.querySelector<HTMLInputElement>('#scene-latitude')!;
  const apply = host.querySelector<HTMLButtonElement>('#scene-apply')!, state = host.querySelector<HTMLOutputElement>('#scene-state')!;
  const help = host.querySelector<HTMLButtonElement>('.scene-help')!;
  help.onclick = () => { help.classList.toggle('expanded'); help.textContent = help.classList.contains('expanded') ? translate('Date drives seasons; solar time and latitude drive sunlight. Noon is solar noon, without a timezone.') : '?'; };
  function commit(): void {
    if (![date, time, latitude].every(input => input.reportValidity()) || !date.value || !time.value || !latitude.value) return;
    applySceneClock(api.getSettings(), { date: date.value, time: time.value, latitude: Number(latitude.value) });
    api.onChange(); sync();
  }
  for (const input of [date, time, latitude]) input.addEventListener('change', commit);
  apply.onclick = commit;
  function sync(): void {
    const s = api.getSettings(), scene: SceneClock = s.scene ?? DEFAULT_SCENE;
    for (const [input, value] of [[date, scene.date], [time, scene.time], [latitude, String(scene.latitude)]] as const) if (document.activeElement !== input) input.value = value;
    apply.hidden = !!s.scene;
    const effects = s.appearance?.composition?.effects;
    const sun = sceneSun(scene), season = effects?.season ?? .5;
    setText(state, `${translate((effects?.ambience ?? 'day') === 'night' ? 'Night' : 'Day')} · ${translate(['Winter', 'Spring', 'Summer', 'Autumn'][Math.round(season * 4) % 4])}`);
    state.title = s.scene ? `${Math.round(sun.azimuth)}° / ${Math.round(sun.altitude)}°` : translate('Manual lighting');
  }
  bindTree(host); onLanguageChange(sync); sync(); return { sync };
}
