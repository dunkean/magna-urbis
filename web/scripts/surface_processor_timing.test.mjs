import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installSurfaceProcessorTiming, captureSurfaceProcessorTiming } from './surface_processor_timing.mjs';

test('compile marker preserves message identity, transfer list, ownership and return value', () => {
  class Worker { postMessage(...args) { this.sent = args; return 17; } }
  const window = { Worker };
  vm.runInNewContext(`(${installSurfaceProcessorTiming.toString()})();`, { window });
  const worker = new window.Worker(), binary = new ArrayBuffer(16), transfers = [binary];
  const message = { kind: 'compile', requestId: 2, binary };
  assert.equal(worker.postMessage(message, transfers), 17);
  assert.equal(worker.sent[0], message);
  assert.equal(worker.sent[1], transfers);
  assert.equal(worker.sent[0].binary, binary);
  assert.equal(message.diagnosticTiming, true);
  assert.equal(binary.byteLength, 16);
});

test('noncompile messages and options are forwarded without modification', () => {
  class Worker { postMessage(...args) { this.sent = args; } }
  const window = { Worker };
  vm.runInNewContext(`(${installSurfaceProcessorTiming.toString()})();`, { window });
  const worker = new window.Worker(), options = { transfer: [] };
  for (const message of [Object.freeze({ kind: 'cancel', requestId: 2 }), Object.freeze({ kind: 'initialize' }), null, 'unchanged']) {
    worker.postMessage(message, options);
    assert.equal(worker.sent[0], message);
    assert.equal(worker.sent[1], options);
  }
});

test('receipt proof reads only timing metadata before any binary summary', () => {
  const marker = { version: 'surface-worker-processor-timing-1', synchronousMs: 55 };
  const message = { processorTiming: marker, get binary() { throw Error('binary must not be read'); } };
  const capture = vm.runInNewContext(`(${captureSurfaceProcessorTiming.toString()})`, {
    performance: { now: () => 12, timeOrigin: 1000 }, Date: { now: () => 1012 }, document: { visibilityState: 'visible' },
  });
  const proof = capture(message);
  assert.equal(proof.processorTiming, marker);
  assert.equal(proof.pageReceiveNowMs, 12);
  assert.equal(proof.pageTimeOriginMs, 1000);
  assert.equal(proof.pageReceiveUtcMs, 1012);
  assert.equal(proof.visibilityState, 'visible');
});

test('native transfer semantics still detach once and preserve binary bytes', () => {
  class Worker { postMessage(message, transfer) { this.received = structuredClone(message, { transfer }); } }
  const window = { Worker };
  vm.runInNewContext(`(${installSurfaceProcessorTiming.toString()})();`, { window });
  const worker = new window.Worker(), binary = Uint8Array.from([0, 127, 255, 9]).buffer;
  worker.postMessage({ kind: 'compile', binary }, [binary]);
  assert.equal(binary.byteLength, 0);
  assert.deepEqual([...new Uint8Array(worker.received.binary)], [0, 127, 255, 9]);
  assert.equal(worker.received.diagnosticTiming, true);
});
