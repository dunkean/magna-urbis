// Ordinary TypeScript builds do not require the generated, ignored Rust package.
declare module '*magna_urbis_houses_wasm.js' {
  export default function init(options: {module_or_path: WebAssembly.Module | ArrayBuffer}): Promise<unknown>;
  export function catalogue_json(): string;
  export function preflight_json(input: string): string;
  export function generate_houses_json(input: string): string;
}
