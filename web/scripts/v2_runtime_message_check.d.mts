import type { RuntimeMessageSource } from './v2_runtime_message_sources.mjs';
export function runtimeMessageSignature(source: string, formatted?: boolean): string;
export function checkRuntimeMessages(pairs: readonly (readonly [string, string])[], root?: string): {
  counts: Record<string, { scanned: number; missing: number }>;
  scanned: RuntimeMessageSource[];
  missing: RuntimeMessageSource[];
  sample: (message: Pick<RuntimeMessageSource, 'source' | 'format'>) => string;
};
export function formatRuntimeMessageFailures(messages: RuntimeMessageSource[]): string;
