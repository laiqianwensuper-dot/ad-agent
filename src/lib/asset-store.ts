"use client";

const databaseName = "adguard-assets";
const storeName = "assets";

function database(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const result = action(db.transaction(storeName, mode).objectStore(storeName));
    result.onsuccess = () => resolve(result.result as T);
    result.onerror = () => reject(result.error);
  }).finally(() => db.close());
}

export function saveAsset(assetId: string, file: File) { return request("readwrite", (store) => store.put(file, assetId)); }
export function loadAsset(assetId: string) { return request<Blob | undefined>("readonly", (store) => store.get(assetId)); }
