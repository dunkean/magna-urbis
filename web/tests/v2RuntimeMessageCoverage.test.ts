import { describe, expect, it } from 'vitest';
import { checkRuntimeMessages, formatRuntimeMessageFailures, runtimeMessageSignature } from '../scripts/v2_runtime_message_check.mjs';
import { bridgeMessageLiterals, rustMessageLiterals, runtimeMessageSample, runtimeMessageAllowlist } from '../scripts/v2_runtime_message_sources.mjs';
import { runtimeMessagePairs, translateRuntimeMessage as message } from '../src/v2/runtimeMessages';
import { engineRuntimeEntries, engineRuntimeTemplates } from '../src/v2/engineRuntimeMessages';
import { localeMessages } from '../src/v2/localeMessages';

describe('engine and bridge presentation-message coverage', () => {
  it('covers every current source message by an exact bilingual entry or an explicit template', () => {
    const report = checkRuntimeMessages(runtimeMessagePairs());
    expect(report.scanned.length).toBeGreaterThan(800);
    expect(report.missing, formatRuntimeMessageFailures(report.missing)).toEqual([]);
  });

  it('extracts multiline Rust errors and indirect reasons, ignoring comments and test modules', () => {
    const rows = rustMessageLiterals(`
      // Err("Comment error")
      fn run() {
        let fail = || "Invalid traced coast".to_string();
        Err(format!("Erreur {value:.2}: {}", detail));
        value.ok_or("Missing value")?;
        value.map_err(|_| "Invalid field")?;
        warnings.push(format!("{name}: no suitable land"));
        log_warning_detail(format_args!("{name} has no eligible site in the survey."));
        let reason = r#"Une raison lisible"#;
      }
      #[cfg(test)] mod tests { fn helper() { Err("Test error"); } }
      #[test] fn test_case() { Err("Other test error"); }
    `);
    expect(rows.map(row => row.source)).toEqual(['Invalid traced coast', 'Erreur {value:.2}: {}', 'Missing value', 'Invalid field', '{name}: no suitable land', 'Une raison lisible']);
    expect(runtimeMessageSignature(rows[1].source)).toBe('Erreur {}: {}');
  });

  it('extracts bridge templates and progress without treating stage IDs as presentation text', () => {
    const rows = bridgeMessageLiterals("throw new Error(`Invalid coast ${mask}`); progress?.('Computing terrain…', { stage: 'coast-id', detail: 'Preparing coast…' }); const reason = { reason: 'No route available' };");
    expect(rows.map(row => row.source)).toEqual(['Invalid coast {value1}', 'Computing terrain…', 'Preparing coast…', 'No route available']);
    expect(
      bridgeMessageLiterals(
        "const refuse = (code: string, message: string) => { throw new Error(message); }; refuse('code', 'An authored refusal.'); throw new Error(String(value ?? 'Fallback error.')); const error = (message: string) => { throw new Error('Failure: ' + message); }; error('A reason.');",
      ).map(row => row.source),
    ).toEqual(['An authored refusal.', 'Fallback error.', 'Failure: {value1}', 'A reason.']);
  });

  it('does not let broad diagnostic wrappers hide new untranslated prose', () => {
    const signatures = new Set(runtimeMessagePairs().flatMap(pair => pair.map(value => runtimeMessageSignature(value))));
    expect(signatures.has(runtimeMessageSignature('Block {block}: a newly authored error'))).toBe(false);
    expect(signatures.has('A completely new engine error')).toBe(false);
    expect([...runtimeMessageAllowlist.values()].every(reason => reason.length > 15)).toBe(true);
  });

  it('can render every added declaration in both directions without losing or inventing slots', () => {
    for (const [fr, en] of [...engineRuntimeEntries, ...engineRuntimeTemplates]) {
      const sample = (source: string) => runtimeMessageSample({ source, format: /\{[A-Za-z_]/u.test(source) });
      const english = message(sample(fr), 'en'),
        french = message(sample(en), 'fr');
      expect(english, fr).not.toContain('undefined');
      expect(french, en).not.toContain('undefined');
      // Synonyms in the existing catalog may choose another natural translation.
      expect(english, fr).not.toBe(sample(fr));
      expect(french, en).not.toBe(sample(en));
    }
  });

  it('translates original reported errors, nested failures, dynamic values and coded envelopes', () => {
    expect(message('Les côtes d’une surface préparée sont déjà fixées.', 'en')).toBe('The coasts of a prepared surface are already fixed.');
    expect(message('Error: Invalid coast relief samples', 'fr')).toBe('Error: Échantillons de relief côtier invalides');
    expect(message('Failed: Invalid coast relief samples', 'fr')).toBe('Échec : Échantillons de relief côtier invalides');
    expect(message('Failed: Les côtes d’une surface préparée sont déjà fixées.', 'en')).toBe('Failed: The coasts of a prepared surface are already fixed.');
    expect(message('Échec : Invalid coast relief samples', 'fr')).toBe('Échec : Échantillons de relief côtier invalides');
    expect(message('[coast_error] Invalid coast relief samples', 'fr')).toBe('[coast_error] Échantillons de relief côtier invalides');
    expect(message('Invalid traced coast: expected traced:<16..128>:<lowercase hex mask>', 'fr')).toContain('masque hexadécimal en minuscules');
    expect(message('La largeur doit être comprise entre 500 et 8192 mètres.', 'en')).toBe('Width must be between 500 and 8192 metres.');
    expect(message('Native request panicked: Invalid coast relief samples', 'fr')).toBe('La requête native a provoqué une panique : Échantillons de relief côtier invalides');
    expect(message('Village Érable: no town large enough', 'fr')).toBe('Village Érable: no town large enough');
    expect(message('Architectural deficit: allocation missing from the cadastre or duplicated.', 'fr')).toBe('Déficit architectural : allocation absente du cadastre ou dupliquée.');
  });

  it('localizes coastal smoothing and subdivision validation errors while retaining edited IDs', () => {
    const coast = 'Invalid coastal smoothing';
    const subdivision = 'Invalid quarter edit q-42 (shape or parts)';
    expect(message(coast, 'fr')).toBe('Lissage côtier invalide');
    expect(message(subdivision, 'fr')).toBe('Retouche de quartier q-42 invalide (forme ou parties)');
    for (const language of ['es', 'pt', 'zh', 'ar', 'ru', 'ja'] as const) {
      expect(message(coast, language)).not.toContain(coast);
      expect(message(subdivision, language)).not.toContain(subdivision);
      expect(message(subdivision, language)).toContain('q-42');
    }
  });

  it('retains explicit source-text labels for diagnostics awaiting translation in the other six locales', () => {
    for (const language of ['es', 'pt', 'zh', 'ar', 'ru', 'ja'] as const) {
      for (const [, english] of [...engineRuntimeEntries, ...engineRuntimeTemplates]) {
        expect(localeMessages[language][english.trim()], `${language}: ${english}`).toBeTruthy();
      }
    }
  });
});
