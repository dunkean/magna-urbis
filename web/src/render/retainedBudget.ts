/** Byte-bounded store of dormant display products (the cartography renderers of other looks): when it overflows, the
 * entry stored longest ago goes first. Ownership moves out on take(); eviction always releases the owned resource. */
export class RetainedBudget {
  private entries = new Map<string, { value: unknown; bytes: number; release(): void }>();
  bytes = 0;
  constructor(readonly maxBytes = 128 * 1024 * 1024) {}
  take<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    return entry.value as T;
  }
  put<T>(key: string, value: T, bytes: number, release: () => void): void {
    this.delete(key);
    bytes = Math.max(0, Math.ceil(bytes));
    if (bytes > this.maxBytes) {
      release();
      return;
    }
    this.entries.set(key, { value, bytes, release });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value!);
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    entry.release();
  }
  clear(): void {
    for (const key of this.entries.keys()) this.delete(key);
  }
}
