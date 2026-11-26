import { emptyState } from "./engine.js";
export async function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("holy-mommy-pwa", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function load(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state");
    const req = tx.objectStore("state").get("local");
    req.onsuccess = () => resolve(req.result || emptyState());
    req.onerror = () => reject(req.error);
  });
}
export async function save(db, state) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(state, "local");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function clear(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
