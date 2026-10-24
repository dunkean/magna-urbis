/** Root-only headless host for the REAL Canvas painter commands. No browser.
 * Flushes at each <=64-record chunk: fixed PNG + bounded SVG command page, never
 * one all-city SVG. Resvg/native allocator RSS still requires actual measurement;
 * this adapter does not claim a hard native heap bound or browser equivalence. */
import { Resvg } from '@resvg/resvg-js';
import type { OverviewRaster } from '../../src/ui/urbanColdOverviewCache';
type Matrix = [number, number, number, number, number, number];
type State = { matrix: Matrix; clips: string[]; fill: string; stroke: string; width: number; alpha: number; join: string; cap: string };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export class SvgOverviewRaster implements OverviewRaster {
  readonly context = this as unknown as CanvasRenderingContext2D;
  private state: State = { matrix: [1, 0, 0, 1, 0, 0], clips: [], fill: '#000', stroke: '#000', width: 1, alpha: 1, join: 'miter', cap: 'butt' };
  private stack: State[] = []; private path: string[] = []; private defs: string[] = []; private ops: string[] = [];
  private bytes?: Uint8Array; private sequence = 0; private commands = 0; private chars = 0;
  lastSvg = ''; disposed = false; flushes = 0; maxPageCommands = 0;
  constructor(readonly pixels: number) { if (typeof Path2D !== 'undefined') throw new Error('Headless SVG host expects explicit path commands, not opaque Path2D.'); }
  get fillStyle() { return this.state.fill; } set fillStyle(v: string) { this.state.fill = v; }
  get strokeStyle() { return this.state.stroke; } set strokeStyle(v: string) { this.state.stroke = v; }
  get lineWidth() { return this.state.width; } set lineWidth(v: number) { this.state.width = v; }
  get globalAlpha() { return this.state.alpha; } set globalAlpha(v: number) { this.state.alpha = v; }
  get lineJoin() { return this.state.join; } set lineJoin(v: string) { this.state.join = v; }
  get lineCap() { return this.state.cap; } set lineCap(v: string) { this.state.cap = v; }
  save() { this.stack.push({ ...this.state, matrix: [...this.state.matrix], clips: [...this.state.clips] }); }
  restore() { const old = this.stack.pop(); if (!old) throw new Error('Unbalanced Canvas restore.'); this.state = old; }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (![a, b, c, d, e, f].every(Number.isFinite) || b !== 0 || c !== 0 || a !== d || a <= 0) throw new Error('Headless overview supports its exact uniform world frame only.');
    this.state.matrix = [a, b, c, d, e, f];
  }
  translate(x: number, y: number) { const m = this.state.matrix; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  beginPath() { this.path = []; }
  private command(s: string) {
    this.commands++; this.chars += s.length;
    if (this.commands > 500000 || this.chars > 32 * 1024 * 1024) throw new Error('Headless SVG command page exceeded explicit budget.');
    this.path.push(s);
  }
  private point(x: number, y: number) { const m = this.state.matrix; return `${m[0] * x + m[2] * y + m[4]} ${m[1] * x + m[3] * y + m[5]}`; }
  moveTo(x: number, y: number) { this.command(`M${this.point(x, y)}`); }
  lineTo(x: number, y: number) { this.command(`L${this.point(x, y)}`); }
  closePath() { this.command('Z'); }
  rect(x: number, y: number, w: number, h: number) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(x: number, y: number, radius: number, start: number, end: number, anti = false) {
    if (start !== 0 || end !== Math.PI * 2 || anti || radius < 0) throw new Error('Only the painter exact full access-circle is supported.');
    const r = radius * this.state.matrix[0];
    this.command(`A${r} ${r} 0 1 0 ${this.point(x - radius, y)}`);
    this.command(`A${r} ${r} 0 1 0 ${this.point(x + radius, y)}`);
  }
  clip(rule = 'nonzero') {
    if (typeof rule !== 'string') throw new Error('Opaque headless clip unsupported.');
    const id = `clip${this.sequence++}`; this.defs.push(`<clipPath id="${id}"><path d="${this.path.join(' ')}" clip-rule="${rule}"/></clipPath>`); this.state.clips.push(id);
  }
  private emit(attributes: string) {
    const open = this.state.clips.map(id => `<g clip-path="url(#${id})">`).join('');
    this.ops.push(`${open}<path d="${this.path.join(' ')}" ${attributes} opacity="${this.state.alpha}"/>${'</g>'.repeat(this.state.clips.length)}`);
  }
  fill(rule = 'nonzero') {
    if (typeof rule !== 'string' || typeof this.fillStyle !== 'string') throw new Error('Unsupported headless fill.');
    this.emit(`fill="${esc(this.fillStyle)}" fill-rule="${rule}"`);
  }
  stroke() { this.emit(`fill="none" stroke="${esc(this.strokeStyle)}" stroke-width="${this.lineWidth * this.state.matrix[0]}" stroke-linejoin="${this.lineJoin}" stroke-linecap="${this.lineCap}"`); }
  async flush() {
    if (this.disposed || this.stack.length || this.state.clips.length) throw new Error('Invalid SVG flush lifecycle.');
    const prior = this.bytes ? `<image width="${this.pixels}" height="${this.pixels}" href="data:image/png;base64,${Buffer.from(this.bytes).toString('base64')}"/>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.pixels}" height="${this.pixels}" viewBox="0 0 ${this.pixels} ${this.pixels}"><defs>${this.defs.join('')}</defs>${prior}${this.ops.join('')}</svg>`;
    this.bytes = new Uint8Array(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng()); this.lastSvg = svg; this.flushes++;
    this.maxPageCommands = Math.max(this.maxPageCommands, this.commands); this.path = []; this.defs = []; this.ops = []; this.commands = this.chars = this.sequence = 0;
  }
  async png() { if (!this.bytes || this.ops.length) await this.flush(); return this.bytes!; }
  dispose() { this.disposed = true; this.bytes = undefined; this.path = []; this.ops = []; this.defs = []; this.stack = []; this.lastSvg = ''; }
}
