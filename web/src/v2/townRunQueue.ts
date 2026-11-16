/** Schedule only towns whose canonical predecessors have finished. A lane never occupies
 * a slot waiting for a neighbour while a later independent town is ready to compute. */
export function createTownRunQueue(dependencies: readonly (readonly number[])[]) {
  const pending = new Set(dependencies.keys()), completed = new Set<number>(), sleepers = new Set<() => void>();
  let stopped = false;
  const wake = (): void => { for (const resolve of sleepers) resolve(); sleepers.clear(); };
  return {
    async next(): Promise<number | undefined> {
      while (!stopped && pending.size) {
        for (const index of pending) if (dependencies[index].every(dependency => completed.has(dependency))) {
          pending.delete(index); return index;
        }
        await new Promise<void>(resolve => sleepers.add(resolve));
      }
      return undefined;
    },
    complete(index: number): void { completed.add(index); wake(); },
    stop(): void { stopped = true; wake(); },
  };
}
