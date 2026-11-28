import { emptyState, migrate } from './engine.js';
export async function openStore(){return new Promise((resolve,reject)=>{
 let expired=false;const timer=setTimeout(()=>{expired=true;reject(Error('Хранилище долго не отвечает. Закройте старые вкладки и попробуйте открыть приложение снова. Данные не удалены.'))},10000),request=indexedDB.open('holy-mommy-pwa',3);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('state'))request.result.createObjectStore('state')};
 request.onerror=()=>{clearTimeout(timer);reject(request.error)};
 request.onblocked=()=>{}; // Allow old connections to close; the 10-second timeout bounds the wait.
 request.onsuccess=()=>{clearTimeout(timer);if(expired){request.result.close();return}request.result.onversionchange=()=>request.result.close();resolve(request.result)};
})}
export async function load(db){return new Promise((resolve,reject)=>{const tx=db.transaction('state'),req=tx.objectStore('state').get('local');req.onsuccess=()=>resolve(migrate(req.result||emptyState()));req.onerror=()=>reject(req.error)})}
const queues=new WeakMap();
function conflict(){const e=Error('Данные обновились в другом окне. Ваш ввод сохранён в этом окне: сохраните копию перед обновлением данных.');e.code='STATE_CONFLICT';return e}
export async function save(db,state){
 const previous=queues.get(db)||Promise.resolve();
 const task=previous.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
  const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get('local');let error,next,written;
  req.onsuccess=()=>{const actual=req.result?._revision||0;if(actual!==(state._revision||0)){error=conflict();tx.abort();return}next=crypto.randomUUID();written=structuredClone({...state,_revision:next});store.put(written,'local')};
  tx.oncomplete=()=>{state._revision=next;resolve(written)};tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
 }));queues.set(db,task);return task;
}
export async function clear(db,expectedRevision){return new Promise((resolve,reject)=>{
 const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get('local');let error;
 req.onsuccess=()=>{if(expectedRevision!=null&&(req.result?._revision||0)!==expectedRevision){error=conflict();tx.abort();return}store.delete('local')};tx.oncomplete=resolve;tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
})}
