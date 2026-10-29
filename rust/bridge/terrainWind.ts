import type { Context } from './terrainGpu';
export interface WindSettings {
    iterations: number;
    azimuth: number;
    transport: number;
}
const shader = `
struct Params{n:u32,cell:f32,dx:f32,dy:f32,amount:f32,pad:vec3<f32>}
@group(0) @binding(0) var<storage,read_write> height:array<f32>;
@group(0) @binding(1) var<storage,read_write> flux:array<f32>;
@group(0) @binding(2) var<uniform> p:Params;
fn neighbor(i:u32,axis:u32,sign:i32)->u32{let x=i%p.n;let y=i/p.n;return u32(clamp(i32(y)+select(0,sign,axis==1u),0,i32(p.n)-1))*p.n+u32(clamp(i32(x)+select(0,sign,axis==0u),0,i32(p.n)-1));}
@compute @workgroup_size(256)
fn entrain(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=p.n*p.n){return;}let x=i%p.n;let y=i/p.n;
 if(x==0u||y==0u||x==p.n-1u||y==p.n-1u||height[i]<=.3){flux[i]=0.;return;}
 let gx=(height[i+1u]-height[i-1u])/(2.*p.cell);let gy=(height[i+p.n]-height[i-p.n])/(2.*p.cell);
 let slope=gx*p.dx+gy*p.dy;
 let mobility=.75+.25*sin((f32(x)*p.dx+f32(y)*p.dy)*p.cell/64.+height[i]*.03);
 flux[i]=min(max(0.,height[i]-.3),p.amount*clamp(.55+2.*slope,.1,1.)*mobility);
}
@compute @workgroup_size(256)
fn deposit(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=p.n*p.n){return;}let sx=select(-1,1,p.dx>=0.);let sy=select(-1,1,p.dy>=0.);
 let wx=abs(p.dx)/max(.00001,abs(p.dx)+abs(p.dy));let wy=1.-wx;
 let a=neighbor(i,0u,-sx);let b=neighbor(i,1u,-sy);
 let incoming=select(0.,flux[a]*wx,a!=i)+select(0.,flux[b]*wy,b!=i);
 height[i]=height[i]-flux[i]+incoming;
}`;
const cache = new WeakMap<GPUDevice, Promise<{
    layout: GPUBindGroupLayout;
    a: GPUComputePipeline;
    b: GPUComputePipeline;
}>>();
/** Same conservative stencil for CPU generation; GPU/CPU floating point can differ. */
export function erodeWindCpu(source: Float32Array, width: number, s: WindSettings): Float32Array {
    if (!s.iterations || !s.transport)
        return source;
    const h = source.slice(), n = Math.sqrt(h.length), cell = width / n, flux = new Float32Array(h.length), angle = s.azimuth * Math.PI / 180, dx = Math.cos(angle), dy = Math.sin(angle), sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1, wx = Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)), wy = 1 - wx;
    for (let pass = 0; pass < s.iterations; pass++) {
        flux.fill(0);
        for (let y = 1; y < n - 1; y++)
            for (let x = 1; x < n - 1; x++) {
                const i = y * n + x;
                if (h[i] <= .3)
                    continue;
                const slope = ((h[i + 1] - h[i - 1]) * dx + (h[i + n] - h[i - n]) * dy) / (2 * cell), mobility = .75 + .25 * Math.sin((x * dx + y * dy) * cell / 64 + h[i] * .03);
                flux[i] = Math.min(Math.max(0, h[i] - .3), s.transport * Math.max(.1, Math.min(1, .55 + 2 * slope)) * mobility);
            }
        for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++) {
                const i = y * n + x, a = y * n + Math.max(0, Math.min(n - 1, x - sx)), b = Math.max(0, Math.min(n - 1, y - sy)) * n + x;
                h[i] = h[i] - flux[i] + (a !== i ? flux[a] * wx : 0) + (b !== i ? flux[b] * wy : 0);
            }
    }
    return h;
}
export async function erodeWindGpu(context: Context, source: Float32Array, width: number, s: WindSettings): Promise<Float32Array> {
    if (!s.iterations || !s.transport)
        return source;
    const device = context.device, n = Math.sqrt(source.length);
    let program = cache.get(device);
    if (!program) {
        program = (async () => { const module = device.createShaderModule({ code: shader }); const info = await module.getCompilationInfo(); const errors = info.messages.filter(m => m.type === 'error'); if (errors.length)
            throw new Error(errors.map(m => `${m.lineNum}: ${m.message}`).join('\n')); const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] }); const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] }); const [a, b] = await Promise.all(['entrain', 'deposit'].map(entryPoint => device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint } }))); return { layout, a, b }; })();
        cache.set(device, program);
    }
    const { layout, a, b } = await program, owned: GPUBuffer[] = [];
    const make = (size: number, usage: GPUBufferUsageFlags) => { const v = device.createBuffer({ size, usage }); owned.push(v); return v; };
    try {
        const h = make(source.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC), f = make(source.byteLength, GPUBufferUsage.STORAGE), u = make(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), r = make(source.byteLength, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        device.queue.writeBuffer(h, 0, source as GPUAllowSharedBufferSource);
        const params = new ArrayBuffer(48), floats = new Float32Array(params);
        new Uint32Array(params)[0] = n;
        const angle = s.azimuth * Math.PI / 180;
        floats[1] = width / n;
        floats[2] = Math.cos(angle);
        floats[3] = Math.sin(angle);
        floats[4] = s.transport;
        device.queue.writeBuffer(u, 0, params);
        const group = device.createBindGroup({ layout, entries: [h, f, u].map((buffer, binding) => ({ binding, resource: { buffer } })) });
        const e = device.createCommandEncoder(), pass = e.beginComputePass();
        pass.setBindGroup(0, group);
        for (let i = 0; i < s.iterations; i++) {
            pass.setPipeline(a);
            pass.dispatchWorkgroups(Math.ceil(source.length / 256));
            pass.setPipeline(b);
            pass.dispatchWorkgroups(Math.ceil(source.length / 256));
        }
        pass.end();
        e.copyBufferToBuffer(h, 0, r, 0, source.byteLength);
        device.queue.submit([e.finish()]);
        await r.mapAsync(GPUMapMode.READ);
        const out = new Float32Array(r.getMappedRange()).slice();
        r.unmap();
        return out;
    }
    finally {
        owned.forEach(b => b.destroy());
    }
}
