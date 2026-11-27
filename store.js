import { emptyState, migrate } from "./engine.js";
export async function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("holy-mommy-pwa", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state"))
        request.result.createObjectStore("state");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        Error(
          "Закройте остальные окна приложения и откройте его снова, чтобы завершить обновление данных.",
        ),
      );
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
export async function load(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state");
    const req = tx.objectStore("state").get("local");
    req.onsuccess = () => resolve(migrate(req.result || emptyState()));
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
