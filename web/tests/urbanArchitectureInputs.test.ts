import { expect, it, vi } from 'vitest';
import { waitForArchitectureInputs } from '../src/ui/urbanArchitectureInputs';
import { deferred } from './helpers/urbanBuildingColdTestBackend';

it('does not wake a replaced generation onto newly ready inputs', async () => {
  const gate = deferred(); let current = true, pending = true;
  const dispatch = vi.fn(), run = waitForArchitectureInputs({ current: () => current, pending: () => pending, wait: () => gate.promise }).then(dispatch);
  const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
  current = false; pending = false; gate.resolve(); await rejected; expect(dispatch).not.toHaveBeenCalled();
});
it('waits for valid inputs and rejects a timeout while upstream remains pending', async () => {
  let pending = true;
  await waitForArchitectureInputs({ current: () => true, pending: () => pending, wait: async () => { pending = false; } });
  await expect(waitForArchitectureInputs({ current: () => true, pending: () => true, intervalMs: 1, maxWaitMs: 2, wait: async () => {} })).rejects.toThrow('encore en cours');
});
