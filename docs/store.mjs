import { emptyState } from './core.mjs';

const DB_NAME = 'daily-value-board-t04';
const STORE = 'board-states';
let opening;

function openDatabase() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

export async function readState(scope) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(scope);
    request.onsuccess = () => resolve(request.result ?? emptyState());
    request.onerror = () => reject(request.error);
  });
}

export async function updateState(scope, transform) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(scope);
    let result;
    get.onsuccess = () => {
      try { result = transform(get.result ?? emptyState()); store.put(result, scope); }
      catch (error) { tx.abort(); reject(error); }
    };
    get.onerror = () => { tx.abort(); reject(get.error); };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? Error('저장 작업이 중단되었습니다.'));
  });
}

export async function resetDemo() {
  return updateState('demo', () => emptyState());
}
