/**
 * SAGE INDEXEDDB STORAGE LAYER
 * High-performance, transactional, indexed storage replacing monolithic localStorage.
 * Handles schema versioning, entity stores, durable sync operations, and seamless auto-migration.
 */

import { WorkItem, Project, Area, Goal, Habit, Note, Comment, Subtask, Activity } from './types';

const DB_NAME = 'sage_local_db';
const DB_VERSION = 5;

export interface SyncOpRecord {
  operationId: string;       // Unique UUID/ULID
  clientId: string;          // Persistent client device ID
  entityType: string;        // 'workItems' | 'projects' | 'areas' | etc.
  entityId: string;
  operation: 'save' | 'delete' | 'patch';
  payload: any;
  revision: number;
  attemptCount: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: string;
}

export interface MetaRecord {
  key: string;
  value: any;
}

let dbInstance: IDBDatabase | null = null;

export async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. workItems Store
      if (!db.objectStoreNames.contains('workItems')) {
        const itemStore = db.createObjectStore('workItems', { keyPath: 'id' });
        itemStore.createIndex('projectId', 'projectId', { unique: false });
        itemStore.createIndex('areaId', 'areaId', { unique: false });
        itemStore.createIndex('status', 'status', { unique: false });
        itemStore.createIndex('entityType', 'entityType', { unique: false });
        itemStore.createIndex('deletedAt', 'deletedAt', { unique: false });
      }

      // 2. projects Store
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }

      // 3. areas Store
      if (!db.objectStoreNames.contains('areas')) {
        db.createObjectStore('areas', { keyPath: 'id' });
      }

      // 4. goals Store
      if (!db.objectStoreNames.contains('goals')) {
        db.createObjectStore('goals', { keyPath: 'id' });
      }

      // 5. habits Store
      if (!db.objectStoreNames.contains('habits')) {
        db.createObjectStore('habits', { keyPath: 'id' });
      }

      // 6. notes Store
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }

      // 7. comments Store
      if (!db.objectStoreNames.contains('comments')) {
        const commentStore = db.createObjectStore('comments', { keyPath: 'id' });
        commentStore.createIndex('workItemId', 'workItemId', { unique: false });
      }

      // 8. subtasks Store
      if (!db.objectStoreNames.contains('subtasks')) {
        const subtaskStore = db.createObjectStore('subtasks', { keyPath: 'id' });
        subtaskStore.createIndex('workItemId', 'workItemId', { unique: false });
      }

      // 9. activities Store
      if (!db.objectStoreNames.contains('activities')) {
        const activityStore = db.createObjectStore('activities', { keyPath: 'id' });
        activityStore.createIndex('workItemId', 'workItemId', { unique: false });
      }

      // 10. syncOperations Store (Durable Queue)
      if (!db.objectStoreNames.contains('syncOperations')) {
        const syncStore = db.createObjectStore('syncOperations', { keyPath: 'operationId' });
        syncStore.createIndex('status', 'status', { unique: false });
        syncStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // 11. meta Store (Client metadata, server revisions, schema version)
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/** Generic Helpers **/
export async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getFromStore<T>(storeName: string, id: string): Promise<T | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function putToStore<T>(storeName: string, item: T): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function putBatchToStore<T>(storeName: string, items: T[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    items.forEach(item => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteFromStore(storeName: string, id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearStore(storeName: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Metadata Helpers **/
export async function getMeta<T>(key: string, defaultValue: T): Promise<T> {
  const rec = await getFromStore<MetaRecord>('meta', key);
  return rec ? (rec.value as T) : defaultValue;
}

export async function setMeta(key: string, value: any): Promise<void> {
  await putToStore('meta', { key, value });
}

/** Client Device Identification **/
export async function getOrCreateClientId(): Promise<string> {
  let clientId = await getMeta<string | null>('clientId', null);
  if (!clientId) {
    clientId = 'client_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    await setMeta('clientId', clientId);
  }
  return clientId;
}

/** Automatic Migration from localStorage to IndexedDB **/
export async function migrateFromLocalStorage(): Promise<boolean> {
  const isMigrated = await getMeta<boolean>('migrated_from_v5', false);
  if (isMigrated) return false;

  const raw = localStorage.getItem('sage_solo_v5');
  if (!raw) {
    await setMeta('migrated_from_v5', true);
    return false;
  }

  try {
    const parsed = JSON.parse(raw);
    const db = await getDB();
    const tx = db.transaction([
      'workItems', 'projects', 'areas', 'goals', 'habits', 'notes', 'comments', 'subtasks', 'activities', 'meta'
    ], 'readwrite');

    if (Array.isArray(parsed.workItems)) {
      const store = tx.objectStore('workItems');
      parsed.workItems.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.projects)) {
      const store = tx.objectStore('projects');
      parsed.projects.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.areas)) {
      const store = tx.objectStore('areas');
      parsed.areas.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.goals)) {
      const store = tx.objectStore('goals');
      parsed.goals.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.habits)) {
      const store = tx.objectStore('habits');
      parsed.habits.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.notes)) {
      const store = tx.objectStore('notes');
      parsed.notes.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.comments)) {
      const store = tx.objectStore('comments');
      parsed.comments.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.subtasks)) {
      const store = tx.objectStore('subtasks');
      parsed.subtasks.forEach((i: any) => store.put(i));
    }
    if (Array.isArray(parsed.activities)) {
      const store = tx.objectStore('activities');
      parsed.activities.forEach((i: any) => store.put(i));
    }

    const metaStore = tx.objectStore('meta');
    metaStore.put({ key: 'migrated_from_v5', value: true });

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        console.log('[IndexedDB] Successfully migrated legacy localStorage data to IndexedDB');
        resolve(true);
      };
      tx.onerror = () => {
        console.error('[IndexedDB] Migration error:', tx.error);
        resolve(false);
      };
    });
  } catch (err) {
    console.error('[IndexedDB] Failed to parse localStorage for migration:', err);
    return false;
  }
}

export async function clearAllStores(): Promise<void> {
  const stores = [
    'workItems', 'projects', 'areas', 'goals', 'habits', 'notes', 
    'comments', 'subtasks', 'activities', 'syncOperations', 'meta'
  ];
  for (const s of stores) {
    try {
      await clearStore(s);
    } catch (e) {
      console.warn(`[IndexedDB] Failed to clear store ${s}:`, e);
    }
  }
}

