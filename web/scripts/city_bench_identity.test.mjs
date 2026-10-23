import test from 'node:test';
import assert from 'node:assert/strict';
import { settlementIdentity } from './city_bench_identity.mjs';

const expected = { key: 'city', population: 5000, culture: 'roman-core', position: { x: 2639.9315590685324, y: 2668.9433913724934 } };
const actual = { key: 'city', population: 5000, culture: 'roman-core', center: { ...expected.position } };

test('same population and culture do not validate the wrong mountain-bay location', () => {
  const evidence = settlementIdentity(expected, [{ ...actual, center: { x: 2000, y: 2000 } }]);
  assert.equal(evidence.matches, false);
  assert(evidence.displacementM > 900);
  assert.match(evidence.issues.join(' '), /pinned/);
});

test('the exact case tolerates only coordinate round-trip noise', () => {
  assert.equal(settlementIdentity(expected, [actual]).matches, true);
  assert.equal(settlementIdentity(expected, [{ ...actual, center: { ...actual.center, y: 2668.943391372494 } }]).matches, true);
  assert.equal(settlementIdentity(expected, [{ ...actual, center: { x: 2640, y: 2669 } }]).matches, false);
});

test('automatic placement has no invented position requirement', () => {
  const { position, ...automatic } = expected;
  const evidence = settlementIdentity(automatic, [{ ...actual, center: { x: 123, y: 456 } }]);
  assert.equal(evidence.matches, true);
  assert.equal(evidence.displacementM, null);
});

test('missing, wrong or malformed applied identities remain failures', () => {
  for (const entries of [[], [{ ...actual, key: 'other' }], [{ ...actual, population: 100000 }],
    [{ ...actual, culture: 'javanese-courts' }], [{ ...actual, center: { x: NaN, y: 0 } }]]) {
    assert.equal(settlementIdentity(expected, entries).matches, false);
  }
  assert.equal(settlementIdentity({ ...expected, position: { x: Infinity, y: 0 } }, [actual]).matches, false);
});
