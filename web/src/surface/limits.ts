/** Shared browser/compiler/broker payload and working-set ceiling. Override only in
 * explicit offline tools; browser packets are rejected before crossing this limit. */
export const SURFACE_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024;
export const SURFACE_PACKET_MAX_BYTES = SURFACE_MEMORY_BUDGET_BYTES;
