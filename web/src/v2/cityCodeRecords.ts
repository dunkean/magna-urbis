/** Edits the short city code (cityCode.ts) keeps with their exact values: parcel edits keyed by parcel id, building
 * house models keyed by building id, and the house model of the region, a settlement, a quarter or a block.
 * Parcel and building ids are the engine's geometry hashes (`layout-…/block-…/parcel-…`, `…/building`): the same recipe
 * on the same engine gives the same ids, so a decoded edit lands on the same lot or building.
 *
 *   record = (key value)+          key = RECORD_KEYS index, written like a parameter ID (1 digit, or escape + 2 digits);
 *                                  leaves in key order, so a decoded record encodes to the same text
 *   value  = "0" false | "1" true | "2" null | "3" text | number
 *   text   = length (2 digits, bytes) bytes          bytes of packText, 5 bits per digit
 *   number = head length magnitude                   head = 4 + 2·decimals + sign (1 digit), length = digits of the
 *                                                    magnitude (1 digit): exact for decimals typed in the inspector
 *   id     = shared (2 digits) length (2 digits) bytes   only the bytes after the first `shared` bytes of the previous id
 *                                                    of the same edit, so lots of one block cost little more than their hash */
import { CODE_BASE, CODE_DIGITS, digit, digitValue, isCodeDigit, readInt, readParamId, writeInt, writeParamId } from './cityCodeFormat';
import { readSettingPath, writeSettingPath } from './parameterForm';
import { scalarLeaves } from './urbanControlSchema';

/** What the short code deliberately leaves out, in one place. The project file (.muproj) carries all of it. */
export const NOT_IN_CODE = {
  /** Keys of a quarter, block or lot edit that hold drawn polygons (outlines, splits, deleted split pieces). */
  geometry: ['shape', 'parts', 'deletedParts'] as readonly string[],
  /** The rest, for the record: pin texts (the debug text carries them), toponyms and names, imported or hand-drawn relief
   * and coasts (the code says so with "*"), road and river edits (world snapshot of the project), quarters and blocks
   * made by a split (`<i>/<k>` keys), typed seed texts (the code stores reroll iterations). Edit kinds added later
   * (for example walls) belong either in RECORD_KEYS or in this list. */
  other: ['pin texts', 'names', 'imported or drawn relief and coast', 'road and river edits', 'split parts', 'typed seed texts'] as readonly string[],
};

/** Record keys; an ID is the index. The most edited first (one-digit IDs); `houseConfig.*` is a lot's house model. */
const HOUSE_KEYS = [
  'recipe',
  'pack',
  'overrides.roof',
  'overrides.floors',
  'overrides.variant',
  'mode',
  'era',
  'seed',
  'size',
  'variation',
  'wealth',
  'allow_late',
  'overrides.footprint',
  'overrides.frame',
  'overrides.infill',
  'overrides.coating',
  'overrides.cladding',
  'overrides.bodies',
  'overrides.courtyard_ratio',
  'overrides.overhang_m',
  'overrides.roof_pitch_deg',
  'overrides.site_slope_deg',
  'count',
  'orientation_deg',
  'schema_version',
  'workshop.preset_id',
  'workshop.footprint',
  'workshop.roof',
  'workshop.width_m',
  'workshop.depth_m',
  'workshop.roof_frame',
  'workshop.base',
  'workshop.support',
  'workshop.support.kind',
  'workshop.support.material',
  'workshop.support.height_m.0',
  'workshop.support.height_m.1',
];
export const RECORD_KEYS: readonly string[] = ['culture', 'role', 'function', 'deleted', 'enclosure', 'households', 'salt', ...HOUSE_KEYS, ...HOUSE_KEYS.map(key => `houseConfig.${key}`)];
const KEY_ID = new Map(RECORD_KEYS.map((key, id) => [key, id]));

// ---------------------------------------------------------------- text

/** Words of saved ids and catalogue values, one byte each (bytes below 0x20 never occur in them). Append only. */
const WORDS = ['/parcel-', '/block-', 'layout-', '/building', '/part-', 'RF-', '/field/', '/open/'];
/** Followed by 8 bytes: a run of 16 lowercase hexadecimal digits (an engine hash). */
const HEX = 1;
const FIRST_WORD = 2;
function packText(text: string): number[] {
  const out: number[] = [],
    utf8 = new TextEncoder();
  for (let i = 0; i < text.length;) {
    if (/^[0-9a-f]{16}$/.test(text.slice(i, i + 16))) {
      out.push(HEX);
      for (let k = 0; k < 16; k += 2) out.push(parseInt(text.slice(i + k, i + k + 2), 16));
      i += 16;
      continue;
    }
    const word = WORDS.findIndex(w => text.startsWith(w, i));
    if (word >= 0) {
      out.push(FIRST_WORD + word);
      i += WORDS[word].length;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(i)!);
    if (char < ' ') throw new Error('Control characters cannot be shared in a code.');
    out.push(...utf8.encode(char));
    i += char.length;
  }
  return out;
}
function unpackText(bytes: readonly number[]): string {
  let text = '';
  const literal: number[] = [];
  const flush = () => {
    text += new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(literal));
    literal.length = 0;
  };
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i];
    if (byte >= ' '.charCodeAt(0)) {
      literal.push(byte);
      i++;
      continue;
    }
    flush();
    if (byte === HEX && i + 9 <= bytes.length) {
      text += bytes
        .slice(i + 1, i + 9)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      i += 9;
    } else if (byte >= FIRST_WORD && byte < FIRST_WORD + WORDS.length) {
      text += WORDS[byte - FIRST_WORD];
      i++;
    } else throw new Error('Corrupt text');
  }
  flush();
  return text;
}
/** Bytes as base32 digits, 5 bits per digit, the last digit padded with zero bits. */
function writeBytes(bytes: readonly number[]): string {
  let out = '',
    acc = 0,
    bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CODE_DIGITS[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return bits ? out + CODE_DIGITS[(acc << (5 - bits)) & 31] : out;
}
const bytesWidth = (count: number): number => Math.ceil((count * 8) / 5);
function readBytes(text: string, count: number): number[] {
  if (text.length !== bytesWidth(count)) throw new Error('Truncated text');
  const out: number[] = [];
  let acc = 0,
    bits = 0;
  for (const char of text) {
    acc = (acc << 5) | digitValue(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/** Reads `width` digits at `code[at]`. */
function fixed(code: string, at: number, width: number): string {
  const text = code.slice(at, at + width);
  if (text.length !== width || ![...text].every(isCodeDigit)) throw new Error('Truncated record');
  return text;
}

// ---------------------------------------------------------------- values and records

const MAX_DECIMALS = 12;
function writeNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
  const magnitude = Math.abs(value);
  let decimals = 0;
  while (decimals < MAX_DECIMALS && Math.round(magnitude * 10 ** decimals) / 10 ** decimals !== magnitude && magnitude * 10 ** (decimals + 1) < Number.MAX_SAFE_INTEGER) decimals++;
  const text = writeInt(Math.round(magnitude * 10 ** decimals));
  return digit(4 + 2 * decimals + (value < 0 ? 1 : 0)) + digit(text.length) + text;
}
function writeValue(value: unknown, where: string): string {
  if (value === false) return '0';
  if (value === true) return '1';
  if (value === null) return '2';
  if (typeof value === 'number') return writeNumber(value);
  if (typeof value === 'string') {
    const bytes = packText(value);
    return '3' + writeInt(bytes.length, 2) + writeBytes(bytes);
  }
  throw new Error(`Edit value not in the share code: ${where}`);
}
function readValue(code: string, at: number): [unknown, number] {
  const head = digitValue(fixed(code, at, 1));
  if (head < 3) return [head === 2 ? null : head === 1, at + 1];
  if (head === 3) {
    const count = readInt(fixed(code, at + 1, 2)),
      width = bytesWidth(count);
    return [unpackText(readBytes(fixed(code, at + 3, width), count)), at + 3 + width];
  }
  const decimals = (head - 4) >> 1;
  if (decimals > MAX_DECIMALS) throw new Error('Corrupt number');
  const length = digitValue(fixed(code, at + 1, 1)),
    magnitude = readInt(fixed(code, at + 2, length));
  return [((head - 4) & 1 ? -1 : 1) * (magnitude / 10 ** decimals), at + 2 + length];
}

/** The leaves of an edit the code keeps (NOT_IN_CODE.geometry apart); undefined when nothing is left. */
export function codedRecord(edit: object | undefined): Record<string, unknown> | undefined {
  if (!edit) return undefined;
  const record = Object.fromEntries(Object.entries(edit).filter(([key, value]) => value !== undefined && !NOT_IN_CODE.geometry.includes(key)));
  return scalarLeaves(record).some(leaf => leaf.value !== undefined) ? record : undefined;
}
export function writeRecord(record: object): string {
  const leaves = scalarLeaves(record)
    .filter(leaf => leaf.value !== undefined)
    .map(leaf => {
      const id = KEY_ID.get(leaf.path);
      if (id === undefined) throw new Error(`Edit not in the share code: ${leaf.path}`);
      return { id, value: leaf.value, path: leaf.path };
    })
    .sort((a, b) => a.id - b.id);
  if (!leaves.length) throw new Error('Empty edit record');
  return leaves.map(leaf => writeParamId(leaf.id) + writeValue(leaf.value, leaf.path)).join('');
}
export function readRecord(code: string, at: number): [Record<string, unknown>, number] {
  const record: Record<string, unknown> = {};
  let i = at;
  while (isCodeDigit(code[i])) {
    const [id, used] = readParamId(code, i),
      key = RECORD_KEYS[id];
    if (key === undefined || readSettingPath(record, key) !== undefined) throw new Error('Corrupt record');
    const [value, next] = readValue(code, i + used);
    writeSettingPath(record, key, value);
    i = next;
  }
  if (i === at) throw new Error('Empty edit record');
  return [record, i];
}

// ---------------------------------------------------------------- ids

const MAX_ID_BYTES = CODE_BASE * CODE_BASE - 1;
/** An id after the previous id of the same edit: the shared leading bytes are counted, not repeated. */
export function writeId(id: string, previous: readonly number[]): [string, number[]] {
  const bytes = packText(id);
  if (bytes.length > MAX_ID_BYTES) throw new Error(`Id too long for a share code: ${id}`);
  let shared = 0;
  while (shared < Math.min(bytes.length, previous.length) && bytes[shared] === previous[shared]) shared++;
  const rest = bytes.slice(shared);
  return [writeInt(shared, 2) + writeInt(rest.length, 2) + writeBytes(rest), bytes];
}
export function readId(code: string, at: number, previous: readonly number[]): [string, number, number[]] {
  const shared = readInt(fixed(code, at, 2)),
    count = readInt(fixed(code, at + 2, 2)),
    width = bytesWidth(count);
  if (shared > previous.length) throw new Error('Corrupt id');
  const bytes = [...previous.slice(0, shared), ...readBytes(fixed(code, at + 4, width), count)];
  return [unpackText(bytes), at + 4 + width, bytes];
}
