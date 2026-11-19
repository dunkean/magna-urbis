import releaseNotes from '../../../docs/DESKTOP_RELEASE_NOTES.md?raw';
import { registerMessages, setHTML } from './i18n';
import './changelog.css';

registerMessages({
  'Recent changes': { en: 'Recent changes', fr: 'Dernières nouveautés' },
  'The four latest versions. Release notes are in English.': { en: 'The four latest versions. Release notes are in English.', fr: 'Les quatre dernières versions. Les notes de version sont en anglais.' },
  'Full changelog ↗': { en: 'Full changelog ↗', fr: 'Historique complet ↗' },
});

/** Bundle the maintained release notes so the history also works offline. */
export function mountChangelog(host: HTMLElement): void {
  const button = document.createElement('button');
  button.id = 'changelog-open';
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'changelog-dialog');
  button.setAttribute('data-i18n-title', 'Recent changes');
  button.setAttribute('data-i18n-aria-label', 'Recent changes');
  setHTML(button, '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></svg>');
  host.insertBefore(button, host.querySelector('#hardware-open'));

  const modal = document.createElement('dialog');
  modal.id = 'changelog-dialog';
  modal.setAttribute('aria-labelledby', 'changelog-title');
  modal.setAttribute('aria-describedby', 'changelog-description');
  setHTML(
    modal,
    `<div class="dialog-head"><h2 id="changelog-title">Recent changes</h2><button type="button" aria-label="Close" autofocus>×</button></div>
    <p id="changelog-description" class="hint">The four latest versions. Release notes are in English.</p>
    <div class="changelog-versions" lang="en" dir="ltr" data-l10n-keep></div>
    <div class="dialog-actions"><a href="https://github.com/dunkean/magna-urbis/blob/main/docs/DESKTOP_RELEASE_NOTES.md" target="_blank" rel="noopener noreferrer">Full changelog ↗</a><button type="button">Close</button></div>`,
  );

  const versions = modal.querySelector('.changelog-versions')!;
  // Only user-facing changes: validation reports and packaging boilerplate stay in the full notes.
  for (const match of [...releaseNotes.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].slice(0, 4)) {
    const section = document.createElement('section'),
      title = document.createElement('h3'),
      list = document.createElement('ul');
    title.textContent = match[1].trim();
    for (const bullet of match[2].matchAll(/^- (.+(?:\r?\n[ \t]+\S.*)*)/gm)) {
      const item = document.createElement('li');
      for (const [index, part] of bullet[1]
        .replace(/\r?\n[ \t]+/g, ' ')
        .split('`')
        .entries()) {
        if (index % 2) {
          const code = document.createElement('code');
          code.textContent = part;
          item.append(code);
        } else item.append(document.createTextNode(part));
      }
      list.append(item);
    }
    section.append(title, list);
    versions.append(section);
  }

  modal.querySelectorAll('button').forEach(close => {
    close.onclick = () => modal.close();
  });
  modal.addEventListener('keydown', event => event.stopPropagation());
  document.body.append(modal);
  button.onclick = () => {
    modal.showModal();
    versions.scrollTop = 0;
  };
}
