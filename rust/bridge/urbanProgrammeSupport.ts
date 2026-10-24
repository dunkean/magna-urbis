import type { UrbanRequest } from './urban';
import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import { normalizeProgrammeFunctions } from './urbanConfig';

export const URBAN_PROGRAMME_FUNCTIONS_CAPABILITY = 'urban.programme-functions-v1';
const unsupported = () => new Error('Ce moteur urbain ne prend pas en charge les fonctions combinées (version 1 requise). Les fonctions demandées n’ont pas été appliquées ; utilisez un moteur compatible ou revenez au profil automatique.');
export function requiresProgrammeFunctions(request: Pick<UrbanRequest, 'layoutConfig' | 'layouts' | 'partitions'>): boolean {
  return request.layoutConfig?.programme?.functions != null
    || !!request.layouts?.some(layout => layout.config?.programme?.functions != null || layout.programme?.context?.functions != null)
    || !!request.partitions?.some(partition => partition.programme?.context?.functions != null);
}
type ProgrammeFunctionRequest = Pick<UrbanRequest, 'layoutConfig' | 'layouts' | 'partitions'> & Partial<Pick<UrbanRequest, 'kind'>>;
function validateRequestedFunctions(request?: ProgrammeFunctionRequest): void {
  if (!request) return;
  if (request.kind && request.kind !== 'quarters' && request.layoutConfig?.programme?.functions != null)
    throw new Error('Les fonctions du lieu se règlent en régénérant les quartiers ; cette étape ne peut pas appliquer un nouveau programme de plan.');
  const contexts = [request.layoutConfig?.programme,
    ...(request.layouts?.flatMap(layout => [layout.config?.programme, layout.programme?.context]) ?? []),
    ...(request.partitions?.map(partition => partition.programme?.context) ?? [])];
  for (const context of contexts) if (context?.functions != null) normalizeProgrammeFunctions(context.functions);
}
/** A fresh status check precedes even raster upload. Never infer support from
 * an old cached result after a local server was restarted on the same port. */
export async function requireLocalProgrammeFunctions(runtime: ExecutionRuntime, request?: ProgrammeFunctionRequest): Promise<void> {
  validateRequestedFunctions(request);
  const response = await fetch(`${runtime.server.replace(/\/+$/, '')}/status`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw unsupported();
  const status = await response.json() as { service?: unknown; capabilities?: unknown };
  if (status.service !== 'magna-urbis-local' || !Array.isArray(status.capabilities) || !status.capabilities.includes(URBAN_PROGRAMME_FUNCTIONS_CAPABILITY)) throw unsupported();
}
/** Static method, so old WASM is rejected before constructing a terrain or
 * calling any urban generator. A JS class name or wrapper alone is not proof. */
export function requireWasmProgrammeFunctions(terrainClass: unknown, request?: ProgrammeFunctionRequest): void {
  validateRequestedFunctions(request);
  if (!terrainClass || !['object', 'function'].includes(typeof terrainClass)) throw unsupported();
  const candidate = terrainClass as { urban_programme_functions_version?: unknown };
  try { if (typeof candidate.urban_programme_functions_version === 'function' && candidate.urban_programme_functions_version() === 1) return; }
  catch { /* New wrapper against an old binary is also unsupported. */ }
  throw unsupported();
}
