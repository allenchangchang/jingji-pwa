import { emptyLedger, validateLedger } from "./ledger-core.js";

const DB_NAME = "jingji-pwa";
const STORE_NAME = "state";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => { database.close(); resolve(request.result); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function write(key, value) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function loadLedger() {
  const stored = await read("ledger");
  return stored ? validateLedger(stored) : emptyLedger();
}

export async function saveLedger(ledger) { await write("ledger", validateLedger(ledger)); }
export async function saveBeforeRestore(ledger) { await write("beforeRestore", validateLedger(ledger)); }
export async function loadBeforeRestore() {
  const stored = await read("beforeRestore");
  return stored ? validateLedger(stored) : null;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
