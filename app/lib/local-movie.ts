/** Device-only persistence. File bytes, handles, names and subtitle contents never leave this origin. */
export type LocalHandle={getFile:()=>Promise<File>;queryPermission:(options:{mode:'read'})=>Promise<PermissionState>;requestPermission:(options:{mode:'read'})=>Promise<PermissionState>};
export type SavedMovie={name:string;type:string;size:number;modified:number;media:string;saved:number;handle?:LocalHandle;blob?:Blob};
export type SavedOptions={subtitle?:{blob:Blob;name:string;type:string};choice?:number;offset?:number;audioTrack?:number};
function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('two-seats-device',1);req.onupgradeneeded=()=>{req.result.createObjectStore('movies');req.result.createObjectStore('options')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('storage_unavailable'))})}
async function get<T>(store:string,key:string):Promise<T|undefined>{const db=await database();try{return await new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}finally{db.close()}}
async function put(store:string,key:string,value:unknown){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
export const readSavedMovie=(scope:string)=>get<SavedMovie>('movies',scope);
export const readSavedOptions=(scope:string,media:string)=>get<SavedOptions>('options',scope+':'+media);
const writes=new Map<string,Promise<unknown>>();
function serialize<T>(scope:string,work:()=>Promise<T>):Promise<T>{const next=(writes.get(scope)||Promise.resolve()).catch(()=>{}).then(work);writes.set(scope,next);void next.finally(()=>{if(writes.get(scope)===next)writes.delete(scope)}).catch(()=>{});return next}
export function saveMovie(scope:string,file:File,media:string,handle?:LocalHandle){return serialize(scope,async()=>{
 const previous=await readSavedMovie(scope);if(previous?.media===media&&!handle)return previous;
 const record:SavedMovie={name:file.name,type:file.type,size:file.size,modified:file.lastModified,media,saved:Date.now(),...(handle?{handle}:{})};
 if(!handle){const estimate=await navigator.storage?.estimate?.();if(estimate?.quota&&file.size>estimate.quota-(estimate.usage||0)+(previous?.blob?.size||0)-20_000_000)throw new DOMException('Not enough browser storage','QuotaExceededError');record.blob=new Blob([file],{type:file.type})}
 await put('movies',scope,record);return record;
})}
export async function saveOptions(scope:string,media:string,patch:SavedOptions){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('options','readwrite'),store=tx.objectStore('options'),key=scope+':'+media,request=store.get(key);request.onsuccess=()=>store.put({...request.result,...patch},key);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}finally{db.close()}}
export function forgetSavedMovie(scope:string){return serialize(scope,async()=>{const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['movies','options'],'readwrite');tx.objectStore('movies').delete(scope);const req=tx.objectStore('options').openCursor();req.onsuccess=()=>{const cursor=req.result;if(cursor){if(String(cursor.key).startsWith(scope+':'))cursor.delete();cursor.continue()}};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)})}finally{db.close()}})}
export async function savedFile(record:SavedMovie,ask=false){
 if(record.handle){let permission=await record.handle.queryPermission({mode:'read'});if(permission!=='granted'&&ask)permission=await record.handle.requestPermission({mode:'read'});if(permission!=='granted')return null;return record.handle.getFile()}
 return record.blob?new File([record.blob],record.name,{type:record.type,lastModified:record.modified}):null;
}
export function storageMessage(error:any){return error?.name==='QuotaExceededError'?'Not enough browser space to remember this movie. It can still play; choose it again after a refresh.':'This browser could not remember the movie. It can still play; choose it again after a refresh.'}
