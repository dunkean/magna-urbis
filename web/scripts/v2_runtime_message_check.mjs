import { scanRuntimeMessageSources, runtimeMessageAllowlist, runtimeMessageSample } from './v2_runtime_message_sources.mjs';

/** Compare literal structure, not just a sample: a broad wrapper cannot hide new untranslated prose. */
export function runtimeMessageSignature(source, formatted = true) {
  if (!formatted) return source;
  return source.replace(/\{\{|\}\}|\{[^{}]*\}/gu, token => (token === '{{' ? '{' : token === '}}' ? '}' : '{}'));
}

export function checkRuntimeMessages(pairs, root) {
  const signatures = new Set(pairs.flatMap(pair => pair.map(text => runtimeMessageSignature(text))));
  const scanned = scanRuntimeMessageSources(root);
  const missing = scanned.filter(message => !runtimeMessageAllowlist.has(message.source) && !signatures.has(runtimeMessageSignature(message.source, message.format)));
  const counts = Object.fromEntries(
    ['terrain', 'core', 'local', 'wasm', 'neural', 'bridge'].map(group => [
      group,
      { scanned: new Set(scanned.filter(row => row.group === group && !runtimeMessageAllowlist.has(row.source)).map(row => row.source)).size, missing: new Set(missing.filter(row => row.group === group).map(row => row.source)).size },
    ]),
  );
  return { counts, scanned, missing, sample: runtimeMessageSample };
}

export function formatRuntimeMessageFailures(messages) {
  return [...new Set(messages.map(row => `${row.file}:${row.line} [${row.group}] ${JSON.stringify(row.source)}`))].join('\n');
}
