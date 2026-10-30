/** Recognised resource and lore tokens: the same file the native programme
 * reads (`programme_tokens.json`). Suggestions list only tokens with a real
 * consumer; imported strings are kept, an unknown one has no effect. */
import tokens from '../../../rust/crates/core/src/urban/programme_tokens.json';
import { urbanText } from './urbanPanelLocale';

export type ProgrammeTokenKind = 'resources' | 'lore';
export const PROGRAMME_TOKEN_SUGGESTIONS: Readonly<Record<ProgrammeTokenKind, readonly string[]>> = {
  resources: Object.keys(tokens.resources), lore: Object.keys(tokens.lore),
};
export type ProgrammeTokenStatus = 'applied' | 'ignored' | 'unknown';
export interface ProgrammeTokenRow { token: string; status: ProgrammeTokenStatus; text: string }

const known = (kind: ProgrammeTokenKind, token: string): boolean => Object.hasOwn(tokens[kind], token);

/** Every resource token with a consumer applies (one shared workshop need);
 * lore applies only its first recognised entry; the rest stays unchanged. */
export function programmeTokenRows(kind: ProgrammeTokenKind, values: readonly string[]): ProgrammeTokenRow[] {
  let loreApplied = false;
  return values.map(token => {
    if (!known(kind, token)) return { token, status: 'unknown', text: urbanText(['conservé, sans effet (aucun consommateur)', 'kept, no effect (no consumer)', '已保留，无效果（无使用方）', 'conservado, sin efecto (sin consumidor)', 'mantido, sem efeito (sem consumidor)']) };
    if (kind === 'resources') return { token, status: 'applied', text: urbanText(['atelier ≥ 80 m² (besoin unique partagé par les ressources)', 'workshop ≥ 80 m² (one need shared by all resources)', '作坊 ≥ 80 平方米（所有资源共享一项需求）', 'taller ≥ 80 m² (una necesidad compartida)', 'oficina ≥ 80 m² (uma necessidade compartilhada)']) };
    if (loreApplied) return { token, status: 'ignored', text: urbanText(['reconnu, ignoré : seule la première entrée reconnue s’applique', 'recognised, ignored: only the first recognised entry applies', '已识别但忽略：仅第一项已识别条目生效', 'reconocido, ignorado: solo se aplica la primera entrada reconocida', 'reconhecido, ignorado: só a primeira entrada reconhecida se aplica']) };
    loreApplied = true;
    return { token, status: 'applied', text: urbanText([`monument lore.${token}, ≥ 250 m², réservé en tête`, `lore.${token} landmark, ≥ 250 m², reserved first`, `lore.${token} 地标，≥ 250 平方米，优先保留`, `monumento lore.${token}, ≥ 250 m², reservado primero`, `monumento lore.${token}, ≥ 250 m², reservado primeiro`]) };
  });
}

const xml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const parseProgrammeTokens = (value: string): string[] => value.split(',').map(v => v.trim()).filter(Boolean);

/** Suggestion chips + per-token feedback under the resources and lore inputs. */
export function bindProgrammeTokenControls(host: ParentNode): { refresh(): void } {
  const mounts = (['resources', 'lore'] as const).flatMap(kind => {
    const input = host.querySelector<HTMLInputElement>(`[data-programme="${kind}"]`);
    if (!input) return [];
    input.placeholder = PROGRAMME_TOKEN_SUGGESTIONS[kind].join(', ');
    const box = document.createElement('div'); box.dataset.programmeTokens = kind; box.className = 'urban-programme-tokens';
    input.closest('label')!.after(box);
    return [{ kind, input, box }];
  });
  const intent = host.querySelector<HTMLSelectElement>('[data-programme-intent]');
  const navigable = host.querySelector<HTMLInputElement>('[data-programme="navigableAccess"]')?.closest('label');
  const refresh = (): void => {
    // An isolated structure applies only its intent: settlement inputs are hidden, never erased.
    const isolated = !!intent && intent.value !== 'settlement';
    for (const { input, box } of mounts) { input.closest('label')!.hidden = isolated; box.hidden = isolated; }
    if (navigable) { navigable.hidden = isolated; (navigable.nextElementSibling as HTMLElement | null)?.toggleAttribute('hidden', isolated); }
    for (const { kind, input, box } of mounts) {
      const values = parseProgrammeTokens(input.value);
      const chips = PROGRAMME_TOKEN_SUGGESTIONS[kind].filter(t => !values.includes(t))
        .map(t => `<button type="button" data-programme-token="${xml(t)}">+ ${xml(t)}</button>`).join(' ');
      const rows = programmeTokenRows(kind, values).map(r => `<li data-token-status="${r.status}"><code>${xml(r.token)}</code> → ${xml(r.text)}</li>`).join('');
      box.innerHTML = `${chips ? `<small>${urbanText(['Reconnus :', 'Recognised:', '可识别：', 'Reconocidos:', 'Reconhecidos:'])} ${chips}</small>` : ''}${rows ? `<ul>${rows}</ul>` : ''}`;
      for (const button of Array.from(box.querySelectorAll<HTMLButtonElement>('[data-programme-token]'))) button.onclick = () => {
        input.value = [...parseProgrammeTokens(input.value), button.dataset.programmeToken!].join(', ');
        input.dispatchEvent(new Event('change', { bubbles: true })); refresh();
      };
    }
  };
  for (const { input } of mounts) input.addEventListener('input', refresh);
  intent?.addEventListener('change', refresh);
  refresh();
  return { refresh };
}
