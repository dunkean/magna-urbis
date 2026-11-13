/** Byte-bounded LRU for dormant display products and exact presented frames.
 * Ownership moves out on take(); eviction always releases the owned resource. */
export class RetainedBudget {
  private entries = new Map<string, { value: unknown; bytes: number; frame: boolean; release(): void }>();
  bytes = 0;
  frameBytes = 0;
  constructor(readonly maxBytes = 128 * 1024 * 1024, readonly maxFrameBytes = 32 * 1024 * 1024) {}
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value as T;
  }
  take<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.bytes -= entry.bytes; if (entry.frame) this.frameBytes -= entry.bytes;
    return entry.value as T;
  }
  put<T>(key: string, value: T, bytes: number, release: () => void, frame = false): void {
    this.delete(key);
    bytes = Math.max(0, Math.ceil(bytes));
    if (bytes > this.maxBytes || frame && bytes > this.maxFrameBytes) { release(); return; }
    this.entries.set(key, { value, bytes, release, frame }); this.bytes += bytes; if (frame) this.frameBytes += bytes;
    while (this.frameBytes > this.maxFrameBytes) this.delete([...this.entries].find(([, e]) => e.frame)![0]);
    while (this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value!);
  }
  delete(key: string): void {
    const entry = this.entries.get(key); if (!entry) return;
    this.entries.delete(key); this.bytes -= entry.bytes; if (entry.frame) this.frameBytes -= entry.bytes;
    entry.release();
  }
  clear(): void { for (const key of this.entries.keys()) this.delete(key); }
}
