import { afterEach, expect, it, vi } from 'vitest';
import { callArchitecture } from '../../rust/bridge/architecture';
import type { ExecutionRuntime } from '../src/ui/executionProfile';

afterEach(() => vi.unstubAllGlobals());

it('never sends a proven-pose contract to an older engine that would ignore its new field', async () => {
  let supported = false;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) return new Response(JSON.stringify({
      service: 'magna-urbis-local', capabilities: ['houses.placement', 'houses.compact-plans',
        ...(supported ? ['houses.native-minimum-candidates-v1'] : [])],
    }));
    expect(url.endsWith('/houses/plans')).toBe(true);
    expect(JSON.parse(String(init?.body)).requests[0].native_minimum_candidates).toHaveLength(1);
    return new Response(JSON.stringify({ok: true, data: {buildings: [], refusals: []}}));
  });
  vi.stubGlobal('fetch', fetch);
  const runtime = {profile: 'local', server: 'http://native-minimum-contract.test'} as ExecutionRuntime;
  // Capability negotiation precedes native validation of the complete request.
  const input = {requests: [{native_minimum_candidates: [{identity: {version: 'native-admission-witness-1'}}]}]};
  await expect(callArchitecture('plans', input, runtime)).rejects.toThrow('ancien moteur');
  expect(fetch).toHaveBeenCalledTimes(1);
  supported = true;
  await expect(callArchitecture('plans', input, runtime)).resolves.toMatchObject({refusals: []});
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects the legacy placement route before dispatch when native poses are supplied', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(callArchitecture('placement', {requests: [{native_minimum_candidates: [{}]}]}, {
    profile: 'local', server: 'http://unused-native-minimum.test',
  } as ExecutionRuntime)).rejects.toThrow('route de plans');
  expect(fetch).not.toHaveBeenCalled();
});
