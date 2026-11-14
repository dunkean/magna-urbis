import { iconUrl, type IconId } from './stageIcons';

/** Decorative paint stays separate from the live, localized button caption. */
export function editorButtonIcon(button: HTMLButtonElement, icon: IconId, badge?: '+' | '−' | '×' | '↶' | '✓'): void {
  const url = iconUrl(icon); if (!url) return;
  button.dataset.editorIcon = icon;
  button.style.setProperty('--editor-icon', `url("${url}")`);
  if (badge) button.dataset.editorBadge = badge;
}

export function networkToolIcon(button: HTMLButtonElement, tool: 'roads' | 'draw' | 'rivers'): void {
  editorButtonIcon(button, tool === 'rivers' ? 'family-water' : 'display-roads', tool === 'draw' ? '+' : tool === 'rivers' ? '×' : undefined);
}
