// Inert stand-in for Vite-only WASM modules while generating shaders (see shaderModuleStubs.mjs).
module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? true : key === 'then' ? undefined : key === 'default' ? '' : () => new Promise(() => {}) });
