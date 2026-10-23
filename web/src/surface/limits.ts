/** Shared per-operation owned-workspace and packet byte guards, not a process-RSS
 * ceiling. Inputs, runtime, simultaneous copies and generator memory are separate. */
export const SURFACE_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024;
export const SURFACE_PACKET_MAX_BYTES = SURFACE_MEMORY_BUDGET_BYTES;
/** Keep browser/devtools HTTP request records bounded without JSON/base64. */
export const SURFACE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
