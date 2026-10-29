/** Actual work events shared by benches and V2. Zero/absent totals mean indeterminate work. */
export interface TerrainWorkProgress { stage: string; completed?: number; total?: number; detail?: string }
export type TerrainProgressCallback = (message: string, work?: TerrainWorkProgress) => void;

/** Keep WebAssembly streaming compilation; count the bytes consumed instead of copying the whole module. */
export async function loadTerrainRuntime(url:string,initialize:(module:Response)=>Promise<unknown>,progress?:TerrainProgressCallback):Promise<void>{
  progress?.('Chargement du moteur Rust/WASM…',{stage:'runtime-download'});
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Chargement du moteur Rust/WASM impossible : HTTP ${response.status}.`);
  // fetch already decoded gzip/br, so a compressed Content-Length is not a byte-progress denominator.
  const encoding=response.headers.get('content-encoding');
  const length=encoding?0:Number(response.headers.get('content-length'));
  const total=Number.isSafeInteger(length)&&length>0?length:0;
  let received=0,last=0;
  const publish=(force=false)=>{const now=performance.now();if(force||now-last>=200){last=now;const loaded=(received/1048576).toFixed(1),size=(total/1048576).toFixed(1);progress?.(total?`Moteur Rust/WASM · ${loaded} / ${size} Mio reçus`:`Moteur Rust/WASM · ${loaded} Mio reçus`,{stage:'runtime-download',completed:received,total});}};
  let module=response;
  if(response.body){
    const reader=response.body.getReader(),headers=new Headers(response.headers);
    if(encoding){headers.delete('content-encoding');headers.delete('content-length');}
    module=new Response(new ReadableStream<Uint8Array>({
      async pull(controller){try{const {done,value}=await reader.read();if(done){publish(true);progress?.('Compilation du moteur Rust/WASM…',{stage:'runtime-compile'});controller.close();}else{received+=value.byteLength;publish();controller.enqueue(value);}}catch(error){controller.error(error);}},
      cancel:reason=>reader.cancel(reason),
    }),{headers,status:response.status,statusText:response.statusText});
  }else progress?.('Compilation du moteur Rust/WASM…',{stage:'runtime-compile'});
  await initialize(module);
  progress?.('Moteur Rust/WASM prêt',{stage:'runtime-ready'});
}

/** A driver setup promise must fail visibly rather than holding a generation forever. */
export async function gpuSetupDeadline<T>(operation:Promise<T>,milliseconds=45000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('La préparation WebGPU ne répond pas. Réessayez sur CPU ou en mode Automatique.')),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
