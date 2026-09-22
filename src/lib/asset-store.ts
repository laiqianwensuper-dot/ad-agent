"use client";

const databaseName = "adguard-assets";
const storeName = "assets";

function database(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const openRequest = indexedDB.open(databaseName, 1);
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(storeName)) openRequest.result.createObjectStore(storeName);
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

/** Resolves only when the transaction has committed, not merely when its request fired. */
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let value: T;
    request.onsuccess = () => { value = request.result as T; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  }).finally(() => db.close());
}

export function saveAsset(assetId: string, file: File) { return transact("readwrite", (store) => store.put(file, assetId)); }
export function loadAsset(assetId: string) { return transact<Blob | undefined>("readonly", (store) => store.get(assetId)); }
