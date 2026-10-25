/** Read the just-rendered frame, including buildings, without preserving its drawing buffer. */
export function captureWebGlFrame(gl: WebGL2RenderingContext, near: number, far: number): { color: HTMLCanvasElement; depth: HTMLCanvasElement } {
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const pixels = (): Uint8Array => {
    const values = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, values); return values;
  };
  const canvasFrom = (pixels: Uint8Array): HTMLCanvasElement => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!, data = context.createImageData(width, height);
    for (let y = 0; y < height; y++) data.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    context.putImageData(data, 0, 0); return canvas;
  };
  const color = canvasFrom(pixels()), framebuffers: WebGLFramebuffer[] = [], textures: WebGLTexture[] = [], shaders: WebGLShader[] = [];
  const previous = { program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), active: gl.getParameter(gl.ACTIVE_TEXTURE),
    depth: gl.isEnabled(gl.DEPTH_TEST), blend: gl.isEnabled(gl.BLEND), cull: gl.isEnabled(gl.CULL_FACE) };
  const shaderProgram = gl.createProgram()!, vao = gl.createVertexArray()!;
  try {
    const texture = (internal: number, format: number, type: number): WebGLTexture => {
      const t = gl.createTexture()!; textures.push(t); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null); return t;
    };
    gl.activeTexture(gl.TEXTURE0);
    // ANGLE can use packed depth/stencil for the default framebuffer even when
    // stencil was not requested. Depth blits require an identical storage format.
    let depth: WebGLTexture | undefined;
    for (const [internal, format, type, attachment] of [
      [gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8, gl.DEPTH_STENCIL_ATTACHMENT],
      [gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.DEPTH_ATTACHMENT],
      [gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, gl.FLOAT, gl.DEPTH_ATTACHMENT],
    ]) {
      const candidate = texture(internal, format, type), depthFrame = gl.createFramebuffer()!; framebuffers.push(depthFrame);
      gl.bindFramebuffer(gl.FRAMEBUFFER, depthFrame); gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, candidate, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) continue;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readBuffer(gl.BACK);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      if (gl.getError() === gl.NO_ERROR) { depth = candidate; break; }
    }
    if (!depth) throw new Error('Le pilote ne permet pas la capture de profondeur.');
    const output = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), outputFrame = gl.createFramebuffer()!; framebuffers.push(outputFrame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, outputFrame); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    for (const [type, source] of [[gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'],
      [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;precision highp int;uniform sampler2D depthMap;out vec4 color;void main(){float d=texelFetch(depthMap,ivec2(gl_FragCoord.xy),0).r;uint p=uint(round(d*16777215.));color=vec4(vec3(uvec3((p>>16)&255u,(p>>8)&255u,p&255u))/255.,1.);}']] as const) {
      const shader = gl.createShader(type)!; shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader de profondeur invalide.');
      gl.attachShader(shaderProgram, shader);
    }
    gl.linkProgram(shaderProgram); if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) throw new Error('Capture de profondeur indisponible.');
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.bindVertexArray(vao); gl.useProgram(shaderProgram);
    gl.bindTexture(gl.TEXTURE_2D, depth); gl.uniform1i(gl.getUniformLocation(shaderProgram, 'depthMap'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Preserve 24 bits during readback. Mapping kilometres directly to an 8-bit
    // far-plane scale erases street/building relief and makes the entire guide dark.
    const raw = pixels(), inverse = new Float32Array(width * height);
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < inverse.length; i++) {
      const p = raw[i * 4] * 65536 + raw[i * 4 + 1] * 256 + raw[i * 4 + 2];
      if (p === 16777215) continue; // Sky, outside the rendered geometry.
      const d = p / 16777215;
      inverse[i] = (far + near - (2 * d - 1) * (far - near)) / (2 * near * far);
      low = Math.min(low, inverse[i]); high = Math.max(high, inverse[i]);
    }
    for (let i = 0; i < inverse.length; i++) {
      const value = inverse[i] ? (high > low ? 1 + Math.round(254 * (inverse[i] - low) / (high - low)) : 255) : 0;
      raw[i * 4] = raw[i * 4 + 1] = raw[i * 4 + 2] = value; raw[i * 4 + 3] = 255;
    }
    return { color, depth: canvasFrom(raw) };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readBuffer(gl.BACK); gl.useProgram(previous.program); gl.bindVertexArray(previous.vao); gl.activeTexture(previous.active);
    for (const [cap, enabled] of [[gl.DEPTH_TEST, previous.depth], [gl.BLEND, previous.blend], [gl.CULL_FACE, previous.cull]] as const) enabled ? gl.enable(cap) : gl.disable(cap);
    framebuffers.forEach(f => gl.deleteFramebuffer(f)); textures.forEach(t => gl.deleteTexture(t)); shaders.forEach(s => gl.deleteShader(s)); gl.deleteProgram(shaderProgram); gl.deleteVertexArray(vao);
  }
}
