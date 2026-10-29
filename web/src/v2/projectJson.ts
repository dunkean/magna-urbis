/** Write the existing JSON format without allocating a boxed-number array for each raster. */
export function projectJsonChunks(root: unknown): string[] {
  const chunks: string[] = [], active = new Set<object>(), arrays = new WeakMap<object, string[]>();
  let pending = '';
  const write = (text: string) => { pending += text; if (pending.length >= 65536) { chunks.push(pending); pending = ''; } };
  const number = (value: number) => Number.isFinite(value) ? String(value === 0 ? 0 : value) : `{"$mu":"number","value":${JSON.stringify(String(value))}}`;
  const prepare = (value: unknown, key: string): unknown => value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ? (value as { toJSON(key: string): unknown }).toJSON(key) : value;
  const omitted = (value: unknown) => value === undefined || typeof value === 'function' || typeof value === 'symbol';
  function value(item: unknown): void {
    if (item === null) { write('null'); return; }
    if (typeof item === 'number') { write(number(item)); return; }
    if (typeof item !== 'object') { write(JSON.stringify(item) ?? 'null'); return; }
    if (ArrayBuffer.isView(item) && !(item instanceof DataView)) {
      let encoded = arrays.get(item);
      if (!encoded) {
        encoded = [`{"$mu":${JSON.stringify(item.constructor.name)},"data":[`];
        const data = item as unknown as ArrayLike<number>, block: number[] = [];
        for (let offset = 0; offset < data.length; offset += 2048) {
          block.length = Math.min(2048, data.length - offset); let special = false;
          for (let i = 0; i < block.length; i++) {
            const scalar = data[offset + i];
            if (typeof scalar === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
            block[i] = scalar; special ||= !Number.isFinite(scalar);
          }
          // The native JSON number formatter avoids allocating one JS string per cell.
          const text = special ? block.map(number).join(',') : JSON.stringify(block).slice(1, -1);
          encoded.push(`${offset ? ',' : ''}${text}`);
        }
        encoded.push(']}'); arrays.set(item, encoded);
      }
      for (const chunk of encoded) write(chunk); return;
    }
    if (active.has(item)) throw new TypeError('Converting circular structure to JSON');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      write(JSON.stringify(item, (_key, child) => {
        if (ArrayBuffer.isView(child) && !(child instanceof DataView)) return { $mu: child.constructor.name, data: Array.from(child as Float32Array) };
        if (typeof child === 'number' && !Number.isFinite(child)) return { $mu: 'number', value: String(child) };
        return child;
      }) ?? 'null'); return;
    }
    active.add(item);
    if (Array.isArray(item)) {
      write('[');
      for (let index = 0; index < item.length; index++) { if (index) write(','); const child = prepare(item[index], String(index)); if (omitted(child)) write('null'); else value(child); }
      write(']');
    } else {
      write('{'); let first = true;
      for (const key of Object.keys(item)) {
        const child = prepare((item as Record<string, unknown>)[key], key); if (omitted(child)) continue;
        write(`${first ? '' : ','}${JSON.stringify(key)}:`); value(child); first = false;
      }
      write('}');
    }
    active.delete(item);
  }
  const prepared = prepare(root, ''); if (omitted(prepared)) return []; value(prepared);
  if (pending) chunks.push(pending); return chunks;
}
