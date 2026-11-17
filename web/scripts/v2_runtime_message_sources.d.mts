export interface RuntimeMessageSource { source: string; offset: number; format: boolean; group: string; file: string; line: number }
export const repositoryRoot: string;
export const runtimeMessageAllowlist: Map<string, string>;
export function rustMessageLiterals(source: string): Pick<RuntimeMessageSource, 'source' | 'offset' | 'format'>[];
export function bridgeMessageLiterals(source: string, file?: string): Pick<RuntimeMessageSource, 'source' | 'offset' | 'format'>[];
export function scanRuntimeMessageSources(root?: string): RuntimeMessageSource[];
export function runtimeMessageSample(message: Pick<RuntimeMessageSource, 'source' | 'format'>): string;
