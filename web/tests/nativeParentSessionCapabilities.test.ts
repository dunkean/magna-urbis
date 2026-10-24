import { afterEach, expect, it, vi } from 'vitest';
import { nativeParentSessionApi } from '../../rust/bridge/architecture';
import { NATIVE_PARENT_SESSION_SCHEMA, type BeginParentSessionRequest, type PlanParentSessionRequest } from '../../rust/bridge/nativeParentSessionContract';
const caps = ['houses.native-assembly-pair-1', 'houses.native-assembly-std-json-v1', 'houses.native-parent-batch-1', 'houses.native-parent-session-1'];
const runtime = { profile: 'local' as const, server: 'http://parent-session-protocol-mock.test' };
const begin: BeginParentSessionRequest = { schema_version: NATIVE_PARENT_SESSION_SCHEMA, run_id: 'test-run', source: { fingerprint: 'a'.repeat(64), revision: 'b'.repeat(64), coordinate_space: 'world-metres' }, total_requests: 2, settings: null };
const page: PlanParentSessionRequest = { schema_version: NATIVE_PARENT_SESSION_SCHEMA, session_id: 'incarnation-A:test-run', source_fingerprint: begin.source.fingerprint,
  revision: begin.source.revision, expected_offset: 0, key: 'test-run:0', requests: [], footprints: {} };
afterEach(() => vi.unstubAllGlobals());
it('new local session capability absent: only fresh status read, no begin/plan/native action', async () => {
  const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: caps.slice(0, 3) })));
  vi.stubGlobal('fetch', fetch); const api = nativeParentSessionApi(runtime);
  await expect(api.begin(begin)).rejects.toThrow('houses.native-parent-session-1'); expect(fetch).toHaveBeenCalledOnce();
  expect(String(fetch.mock.calls[0][0])).toBe(`${runtime.server}/status`);
});
it('one fresh qualification before begin, NONE per page/ACK/release; exact same plan bytes can be retried', async () => {
  const requests: { path: string; body: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const path = String(url); requests.push({ path, body: String(options?.body ?? '') });
    if (path.endsWith('/status')) return new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: caps }));
    if (path.endsWith('/native-assembly-capability')) return new Response(JSON.stringify({ ok: true, data: 'native-assembly-pair-1' }));
    return new Response('{"ok":true,"data":{"transport_mock_only":true}}');
  }));
  const api = nativeParentSessionApi(runtime); await api.require(); await api.require(); await api.begin(begin); await api.plan(page); await api.plan(page);
  await api.ack({ session_id: page.session_id, source_fingerprint: page.source_fingerprint, revision: page.revision, key: page.key,
    offset: 0, completed: 1, total: 2, request_sha256: 'c'.repeat(64), batch_sha256: 'd'.repeat(64) });
  await api.release({ schema_version: NATIVE_PARENT_SESSION_SCHEMA, session_id: page.session_id, source_fingerprint: page.source_fingerprint, revision: page.revision });
  expect(requests.filter(r => r.path.endsWith('/status'))).toHaveLength(1); expect(requests.filter(r => r.path.endsWith('/native-assembly-capability'))).toHaveLength(1);
  const plans = requests.filter(r => r.path.endsWith('/plan-parent-session')); expect(plans).toHaveLength(2); expect(plans[0].body).toBe(plans[1].body);
  expect(requests.map(r => r.path.split('/').pop())).toEqual(['status', 'native-assembly-capability', 'begin-parent-session', 'plan-parent-session', 'plan-parent-session', 'ack-parent-session', 'release-parent-session']);
});
it('engine restart/missing nonce is an explicit error, never requalification/rebegin or Single fallback', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const path = String(url); paths.push(path);
    if (path.endsWith('/status')) return new Response(JSON.stringify({ service: 'magna-urbis-local', capabilities: caps }));
    if (path.endsWith('/native-assembly-capability')) return new Response(JSON.stringify({ ok: true, data: 'native-assembly-pair-1' }));
    if (path.endsWith('/begin-parent-session')) return new Response('{"ok":true,"data":{"session_id":"incarnation-A:test-run"}}');
    return new Response('{"ok":false,"error":{"code":"session_missing","message":"Engine incarnation changed"}}');
  }));
  const api = nativeParentSessionApi(runtime); await api.begin(begin); await expect(api.plan(page)).rejects.toThrow('Engine incarnation changed');
  expect(paths.filter(r => r.endsWith('/status'))).toHaveLength(1); expect(paths.filter(r => r.endsWith('/begin-parent-session'))).toHaveLength(1);
  expect(paths.some(r => r.endsWith('/plans') || r.endsWith('/placement'))).toBe(false);
});
