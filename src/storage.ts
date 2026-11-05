import type { StoredProject } from './model';

const DB_NAME = 'shopreel-browser-v1';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage is unavailable. Enable IndexedDB or use a regular browser window.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another tab. Close older ShopReel tabs.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode), request = action(tx.objectStore('projects'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Could not save your project. Browser storage may be full; download your video before closing this page.')); };
  });
}
export async function saveProject(project: StoredProject) {
  const storage = await navigator.storage?.estimate?.();
  const bytes = project.images.reduce((n, file) => n + file.size, 0) + (project.video?.size ?? 0) + (project.music?.size ?? 0);
  if (storage?.quota && storage.usage !== undefined && storage.quota - storage.usage < bytes + 8 * 1024 * 1024) throw new Error('Insufficient browser storage. Download your existing videos and free space before saving.');
  await transaction('readwrite', store => store.put(project));
}
export async function listProjects(): Promise<StoredProject[]> {
  const result = await transaction<StoredProject[]>('readonly', store => store.getAll());
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
