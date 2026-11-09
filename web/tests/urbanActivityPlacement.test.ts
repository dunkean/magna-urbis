import { expect, it, vi } from 'vitest';
import type { UrbanRequest, UrbanResponse } from '../../rust/bridge/urban';
import { runActivityPlacement } from '../src/ui/urbanActivityPlacement';

const request = { id: 7, kind: 'quarters', seed: 'farm', sites: [{ key: 'city', center: { x: 2000, y: 2000 } }],
  layoutConfig: { programme: { intent: 'activity', template: 'small_farm' } }, raster: {} } as UrbanRequest;
const response = (reserved: boolean) => ({ id: 7, layouts: [{ programme: {
  demands: [{ id: 'activity', role: 'craft.activity', deficit: 728 }],
  reservations: reserved ? [{ demandId: 'activity' }] : [], allocations: [],
} }] }) as unknown as UrbanResponse;

it('continues after a clipped yard refusal and stops at a reservation before parcel allocation', async () => {
  const accepted = response(true), run = vi.fn().mockResolvedValueOnce(response(false)).mockResolvedValue(accepted);
  expect(await runActivityPlacement({ run }, request)).toBe(accepted);
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][0]).toMatchObject({ id: 7, sites: [{ center: { x: 2070, y: 2000 } }] });
  expect(run.mock.calls[1][0].raster).toBeUndefined();
  expect(request.sites![0].center).toEqual({ x: 2000, y: 2000 });
});

it('bounds the search and does not retry replaced requests or native errors', async () => {
  const run = vi.fn().mockResolvedValue(response(false));
  await runActivityPlacement({ run }, request);
  expect(run).toHaveBeenCalledTimes(33);
  run.mockClear();
  await runActivityPlacement({ run }, request, () => false);
  expect(run).toHaveBeenCalledTimes(1);
  run.mockClear().mockResolvedValue({ id: 7, error: 'native refusal' });
  await runActivityPlacement({ run }, request);
  expect(run).toHaveBeenCalledTimes(1);
});
