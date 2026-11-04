import { registerMessages, setText, setDynamicText, translate } from './i18n';
import './desktopUpdates.css';

const releasesApi = 'https://api.github.com/repos/dunkean/magna-urbis/releases?per_page=100';
const downloadsBase = 'https://github.com/dunkean/magna-urbis/releases/download/';
type ReleaseInfo = { version: string; platform: string };
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type DesktopUpdate = { version: string; url: string };

function versionParts(version: string): { core: number[]; pre: string[] } | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(version);
  if (!match) return;
  return { core: match.slice(1, 4).map(Number), pre: match[4]?.split('.') ?? [] };
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a)!, right = versionParts(b)!;
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  if (!left.pre.length || !right.pre.length) return Number(!left.pre.length) - Number(!right.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i], r = right.pre[i];
    if (l === r) continue;
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return Number(l) - Number(r);
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/** Include published prereleases: desktop releases currently use that channel. */
export function selectDesktopUpdate(releases: unknown, current: ReleaseInfo): DesktopUpdate | undefined {
  if (!Array.isArray(releases) || !versionParts(current.version)) throw new Error('Invalid desktop release data');
  const extensions = current.platform === 'windows-x86_64' ? ['_x64-setup.exe']
    : current.platform === 'linux-x86_64' ? ['_amd64.deb', '_amd64.AppImage'] : [];
  let update: DesktopUpdate | undefined;
  for (const release of releases) {
    if (!release || release.draft || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('desktop-v')) continue;
    const version = release.tag_name.slice('desktop-v'.length);
    if (!versionParts(version) || compareVersions(version, current.version) <= 0 || (update && compareVersions(version, update.version) <= 0)) continue;
    if (!Array.isArray(release.assets)) continue;
    for (const extension of extensions) {
      const asset = release.assets.find((item: { name?: unknown; browser_download_url?: unknown; size?: number; state?: string } | null) =>
        item && typeof item.name === 'string' && item.name.endsWith(extension) && item.state === 'uploaded' && (item.size ?? 0) > 0
        && item.browser_download_url === `${downloadsBase}${release.tag_name}/${encodeURIComponent(item.name)}`);
      if (asset) { update = { version, url: asset.browser_download_url }; break; }
    }
  }
  return update;
}

registerMessages({
  'Application updates': { en: 'Application updates', fr: 'Mises à jour de l’application' },
  'Installed version: {version}': { en: 'Installed version: {version}', fr: 'Version installée : {version}' },
  'Check for updates': { en: 'Check for updates', fr: 'Vérifier les mises à jour' },
  'Checking for updates…': { en: 'Checking for updates…', fr: 'Recherche de mises à jour…' },
  'No newer installer available.': { en: 'No newer installer available.', fr: 'Aucun nouvel installeur disponible.' },
  'Could not check for updates. Try again later.': { en: 'Could not check for updates. Try again later.', fr: 'Impossible de vérifier les mises à jour. Réessayez plus tard.' },
  'Update {version} · Download installer ↗': { en: 'Update {version} · Download installer ↗', fr: 'Mise à jour {version} · Télécharger l’installeur ↗' },
  'Download the installer, close Magna Urbis, then run it to replace the current installation. No compatibility checks or data migrations.': { en: 'Download the installer, close Magna Urbis, then run it to replace the current installation. No compatibility checks or data migrations.', fr: 'Téléchargez l’installeur, fermez Magna Urbis, puis lancez-le pour remplacer l’installation actuelle. Aucun contrôle de compatibilité ni migration des données.' },
  'Could not open the download in your browser.': { en: 'Could not open the download in your browser.', fr: 'Impossible d’ouvrir le téléchargement dans votre navigateur.' },
});

/** Desktop only; checking never delays startup or downloads an installer. */
export function mountDesktopUpdates(header: HTMLElement, settings: HTMLElement): void {
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return;
  const invoke: Invoke = internals.invoke;
  const panel = document.createElement('section'); panel.className = 'section desktop-updates';
  const heading = document.createElement('h3'); setText(heading, 'Application updates');
  const installed = document.createElement('p'); installed.className = 'hint';
  const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
  const help = document.createElement('p'); help.className = 'hint';
  setText(help, 'Download the installer, close Magna Urbis, then run it to replace the current installation. No compatibility checks or data migrations.');
  const check = document.createElement('button'); check.type = 'button'; check.className = 'small'; setText(check, 'Check for updates');
  const links = [document.createElement('a'), document.createElement('a')];
  for (const link of links) {
    link.hidden = true; link.className = 'desktop-update-link'; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.onclick = event => {
      event.preventDefault();
      void invoke('desktop_open_download', { url: link.href }).catch(() => { setText(status, 'Could not open the download in your browser.'); });
    };
  }
  header.prepend(links[0]); panel.append(heading, installed, status, links[1], help, check); settings.prepend(panel);
  async function refresh(): Promise<void> {
    if (check.disabled) return;
    check.disabled = true; setText(status, 'Checking for updates…');
    try {
      const info = await invoke<ReleaseInfo>('desktop_release_info');
      setDynamicText(installed, () => translate('Installed version: {version}').replace('{version}', info.version));
      const response = await fetch(releasesApi, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Releases HTTP ${response.status}`);
      const update = selectDesktopUpdate(await response.json(), info);
      for (const link of links) {
        link.hidden = !update;
        if (update) { link.href = update.url; setDynamicText(link, () => translate('Update {version} · Download installer ↗').replace('{version}', update.version)); }
      }
      setText(status, update ? '' : 'No newer installer available.');
    } catch { setText(status, 'Could not check for updates. Try again later.'); }
    finally { check.disabled = false; }
  }
  check.onclick = () => { void refresh(); };
  void refresh();
}
