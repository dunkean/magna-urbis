/** Node loader for the shader generators (npm run shaders:wgsl*): they only need GLSL strings, but the shader
 * modules' import graph reaches the Vite-only WASM bridges (`*.wasm?url&inline`, `import.meta.glob`).
 * Those modules resolve to an inert stub here: every export is a function returning a pending promise. */
import { registerHooks } from 'node:module';
const stub = new URL('./shaderModuleStub.cjs', import.meta.url).href;
registerHooks({ resolve(spec, context, next) { return /\.wasm(\?|$)|\/wasmThreads(\.ts)?$|\/wasmRuntime(\.ts)?$/.test(spec) ? { url: stub, format: 'commonjs', shortCircuit: true } : next(spec, context); } });
