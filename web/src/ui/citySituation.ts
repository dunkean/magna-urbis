/**
 * Portable City Bench situation: the map, every applied option (the share query),
 * the camera and pinned points with notes, packed in one copyable string.
 * `MU1.` + base64url(deflate-raw(JSON)). Same code in the browser and in Node
 * (web/scripts/city_situation.mjs), so an agent can reproduce a reported case.
 */
export interface SituationPin { x: number; y: number; note: string }
export interface CitySituation {
  v: 1;
  /** Share query of the bench (artifact, settlements, roads, urban configs,
   * rpgLabels and rpgPins). Map annotations stay separate from bug-report pins. */
  q: string;
  view?: { cx: number; cy: number; scale: number };
  pins: SituationPin[];
  note?: string;
  created?: string;
}
const PREFIX = 'MU1.';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as Uint8Array<ArrayBuffer>); void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
const toBase64Url = (bytes: Uint8Array): string => {
  let text = ''; for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string): Uint8Array => {
  const raw = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export async function encodeSituation(situation: CitySituation): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(situation));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Accepts a bare code, or any text or link that contains one. */
export async function decodeSituation(text: string): Promise<CitySituation> {
  const match = /MU1\.[A-Za-z0-9_-]+/.exec(text.trim());
  if (!match) throw new Error('Code de situation introuvable (il commence par MU1.).');
  const json = await pipe(fromBase64Url(match[0].slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
  const value = JSON.parse(new TextDecoder().decode(json)) as CitySituation;
  if (value.v !== 1 || typeof value.q !== 'string') throw new Error('Code de situation invalide.');
  return { ...value, pins: Array.isArray(value.pins) ? value.pins : [] };
}
