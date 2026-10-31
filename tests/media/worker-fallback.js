if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join('')});
Object.defineProperty(WebAssembly,'Suspending',{value:undefined,configurable:true});
await import('/media-codecs/0.8.12/worker.js');
