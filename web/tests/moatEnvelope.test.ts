import { describe, expect, it } from 'vitest';
import type { Layout, MoatRun, Street } from '../../rust/bridge/urban';
import { MoatEnvelopes, moatEnvelopeKey } from '../src/render/moatEnvelope';
import { urbanReplacesCrossing } from '../src/render/cityBridges';

const polar = (r: number, deg: number) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) });
/** A walled town round the origin: the curtain at radius 95, a closed ditch from 100 (inner lip) to 110 (counterscarp). */
const town = (): Layout => {
  const ks = Array.from({ length: 36 }, (_, k) => k * 10),
    run: MoatRun = { closed: true, inner: ks.map(d => polar(100, d)), outer: ks.map(d => polar(110, d)), rim: ks.map(() => 10), bed: ks.map(() => 7), ends: ['closed', 'closed'], reaches: [{ from: 0, to: 35, supply: 'fed' }] };
  return { key: 'walled', streets: [], quarters: [], blocks: [], enclosures: [{ path: ks.map(d => polar(95, d)), kind: 'wall', gates: [], moat: { form: 'earth', runs: [run] } }], warnings: [] } as unknown as Layout;
};
/** A deck of 20 m across the radius `r` at 45 degrees. */
const deck = (r: number): Street => ({ path: [polar(r, 40), polar(r, 50)], widths: [6, 6], rank: 0, role: 'bridge' });

describe('moat envelope', () => {
  it('holds the regional decks whose middle lies between the curtain and the counterscarp, plus 6 m', () => {
    const moats = new MoatEnvelopes([town()]),
      // The chord's middle lies inside the arc: radius r * cos(5 degrees).
      at = (r: number): boolean => moats.holdsDeck(deck(r / Math.cos((5 * Math.PI) / 180)).path);
    expect(at(105)).toBe(true);
    expect(at(97)).toBe(true);
    expect(at(114)).toBe(true);
    expect(at(120)).toBe(false);
    expect(at(60)).toBe(false);
    expect(new MoatEnvelopes([]).holdsDeck(deck(105).path)).toBe(false);
  });

  it('retires a regional deck in the moat band in every display', () => {
    const layouts = [town()];
    expect(urbanReplacesCrossing(deck(105 / Math.cos((5 * Math.PI) / 180)), layouts)).toBe(true);
  });

  it('cuts a stream the moat takes in at the outer lip, and leaves a river that goes on', () => {
    const moats = new MoatEnvelopes([town()]);
    // Flowing west to the curtain: cut on its last segment where it crosses the counterscarp.
    const cut = moats.courseCut([400, 3, 200, 3, 120, 3, 96, 3])!;
    expect(cut.segment).toBe(2);
    const x = 120 - 24 * cut.t;
    expect(x).toBeGreaterThan(108);
    expect(x).toBeLessThan(110.01);
    // Through the town and out, past it, or rising inside it: untouched.
    expect(moats.courseCut([400, 3, -400, 3])).toBeUndefined();
    expect(moats.courseCut([400, 3, -150, 3])).toBeUndefined();
    expect(moats.courseCut([400, 130, 112, 130])).toBeUndefined();
    expect(moats.courseCut([0, 3, 50, 3])).toBeUndefined();
    // A stream that enters far upstream of its end is a river through the town.
    expect(moats.courseCut([400, 3, 120, 3, -90, 3])).toBeUndefined();
  });

  it('keys the moat runs of a set of layouts', () => {
    const layouts = [town()];
    expect(moatEnvelopeKey(layouts)).toBe(moatEnvelopeKey([town()]));
    expect(moatEnvelopeKey([])).toBe('');
  });
});
