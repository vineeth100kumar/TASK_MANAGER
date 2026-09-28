/**
 * SAGE INDUSTRIAL-GRADE DURABLE SYNC QUEUE ENGINE (V3.1)
 * 
 * Features:
 * - Multi-Tab Leader Coordination (Single-worker dispatching via tabSync)
 * - Per-Operation Batch Results handling (Applied, Conflict, Rejected)
 * - Incremental Pull Protocol (Cloud -> Local delta synchronization)
 * - Exponential Backoff Retries with randomized Jitter
 * - Detailed Operations Queue Inspection & Granular Discard/Retry
 * - Debounced Note Autosave
 */

import { getDB, getAllFromStore, putToStore, deleteFromStore, getMeta, setMeta, getOrCreateClientId, SyncOpRecord } from './db';
import { tabCoordinator } from './tabSync';
import { piBackendUrl, piHeaders } from './piBackend';

const GAS_URL = import.meta.env.VITE_GAS_URL || 'https://script.google.com/macros/s/AKfycbzZAbFXHcDt9ZfVvH9iJCLyy8AghHhGhEwZZnB6P9RSO0zjvgMcDxojKCm1-VQ1MNrg/exec';
const PI_BACKEND_URL = piBackendUrl();

// Headers for a sync request: the Pi server wants its key, Apps Script must get none.
export const syncHeaders = (headers: Record<string, string> = {}) => (PI_BACKEND_URL ? piHeaders(headers) : headers);
const AUTH_KEY = import.meta.env.VITE_GAS_AUTH_KEY || '';

export const getGasUrl = (action = '') => {
  if (PI_BACKEND_URL) {
    if (action === 'getAll') return `${PI_BACKEND_URL}/api/sync/all`;
    if (action === 'getChangesSince') return `${PI_BACKEND_URL}/api/sync/changes`;
    if (action === 'clearAll') return `${PI_BACKEND_URL}/api/sync/clear`;
    return `${PI_BACKEND_URL}/api/sync/operations`;
  }
  return `${GAS_URL}${action ? '?action=' + action : ''}${AUTH_KEY ? (action ? '&' : '?') + 'authKey=' + encodeURIComponent(AUTH_KEY) : ''}`;
};

// Where sync requests go, for the diagnostics panel. The auth key is left out.
export const syncEndpointLabel = (): string => (PI_BACKEND_URL ? `Pi server (${PI_BACKEND_URL})` : `Apps Script (${GAS_URL})`);

// Turns a failed request into something a person can act on.
const describeSyncError = (err: any): string => {
  const message = err?.message || String(err);
  if (err instanceof TypeError) {
    return PI_BACKEND_URL
      ? `Could not reach the Pi server at ${PI_BACKEND_URL} (${message})`
      : `Could not reach Apps Script (${message}). Check the deployment is set to "Anyone" access.`;
  }
  if (message.includes('HTTP error 401')) {
    return PI_BACKEND_URL ? 'The Pi server rejected the key. Enter it in Settings > Cloud Limits & Reset.' : message;
  }
  return message;
};

export type SyncState = 'synced' | 'syncing' | 'pending' | 'retrying' | 'conflict' | 'offline' | 'error';

export interface SyncEngineStatus {
  state: SyncState;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSuccessfulSync: string | null;
  serverRevision: number;
  clientId: string;
  isLeader: boolean;
  lastError: string | null;
}

export interface ConflictEvent {
  operationId: string;
  entityType: string;
  entityId: string;
  reason: string;
  localRecord: any;
  serverRecord?: any;
}

type SyncStatusListener = (status: SyncEngineStatus) => void;
type EntityChangeListener = (entityType: string, changes: any[]) => void;
type ConflictListener = (conflict: ConflictEvent) => void;

class SyncEngine {
  private isInitialized = false;
  private isProcessing = false;
  private currentState: SyncState = 'synced';
  private lastSuccessfulSync: string | null = null;
  private serverRevision: number = 1;
  private clientId: string = '';
  private lastError: string | null = null;
  private listeners: Set<SyncStatusListener> = new Set();
  private entityListeners: Set<EntityChangeListener> = new Set();
  private conflictListeners: Set<ConflictListener> = new Set();
  private noteDebounceTimers: Map<string, any> = new Map();
  private batchDebounceTimer: any = null;
  private retryTimer: any = null;
  private incrementalPullTimer: any = null;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.clientId = await getOrCreateClientId();
    this.serverRevision = (await getMeta<number>('serverRevision')) || 1;
    this.lastSuccessfulSync = (await getMeta<string>('lastSuccessfulSync')) || null;

    // Listen to network events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.notifyListeners();
        this.processQueue();
        this.pullIncrementalChanges();
      });
      window.addEventListener('offline', () => {
        this.currentState = 'offline';
        this.notifyListeners();
      });
    }

    // Listen to cross-tab mutations
    tabCoordinator.subscribe((msg) => {
      if (msg.type === 'ENTITY_MUTATED') {
        this.notifyEntityListeners(msg.entityType, [{ id: msg.entityId, revision: msg.revision }]);
      }
    });

    this.isInitialized = true;

    // Start background incremental pull timer if leader
    this.incrementalPullTimer = setInterval(() => {
      if (tabCoordinator.isSyncLeader() && navigator.onLine) {
        this.pullIncrementalChanges();
      }
    }, 30000);

    // Initial check
    await this.processQueue();
    await this.pullIncrementalChanges();
  }

  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  onEntityChange(listener: EntityChangeListener): () => void {
    this.entityListeners.add(listener);
    return () => this.entityListeners.delete(listener);
  }

  onConflict(listener: ConflictListener): () => void {
    this.conflictListeners.add(listener);
    return () => this.conflictListeners.delete(listener);
  }

  private notifyConflict(conflict: ConflictEvent): void {
    this.conflictListeners.forEach(l => l(conflict));
  }

  getStatus(): SyncEngineStatus {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return {
      state: !isOnline ? 'offline' : this.currentState,
      pendingCount: 0,
      failedCount: 0,
      conflictCount: 0,
      lastSuccessfulSync: this.lastSuccessfulSync,
      serverRevision: this.serverRevision,
      clientId: this.clientId,
      isLeader: tabCoordinator.isSyncLeader(),
      lastError: this.lastError
    };
  }

  async getDetailedStatus(): Promise<SyncEngineStatus> {
    const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
    const pending = ops.filter(o => o.status === 'pending' || o.status === 'syncing');
    const failed = ops.filter(o => o.status === 'failed');
    const conflict = ops.filter(o => o.status === 'failed' && o.lastError?.includes('conflict'));

    const base = this.getStatus();
    return {
      ...base,
      pendingCount: pending.length,
      failedCount: failed.length,
      conflictCount: conflict.length
    };
  }

  async getPendingOperations(): Promise<SyncOpRecord[]> {
    const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
    return ops.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async enqueueOperation(
    entityType: string,
    entityId: string,
    operation: 'save' | 'delete' | 'patch',
    payload: any,
    revision: number = 1
  ): Promise<string> {
    const operationId = crypto.randomUUID ? crypto.randomUUID() : `op_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    const record: SyncOpRecord = {
      operationId,
      clientId: this.clientId,
      entityType,
      entityId,
      operation,
      payload,
      revision,
      attemptCount: 0,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    await putToStore('syncOperations', record);
    
    // Broadcast to other tabs so they refresh local state
    tabCoordinator.broadcast({
      type: 'ENTITY_MUTATED',
      entityType,
      entityId,
      revision
    });

    this.notifyListeners();

    // 1500ms batch collector window to save mobile battery & Apps Script execution quota
    if (this.batchDebounceTimer) clearTimeout(this.batchDebounceTimer);
    this.batchDebounceTimer = setTimeout(() => {
      this.processQueue();
    }, 1500);

    return operationId;
  }

  enqueueNoteDebounced(noteId: string, payload: any): void {
    if (this.noteDebounceTimers.has(noteId)) {
      clearTimeout(this.noteDebounceTimers.get(noteId));
    }

    const timer = setTimeout(() => {
      this.enqueueOperation('notes', noteId, 'save', payload, payload.revision || 1);
      this.noteDebounceTimers.delete(noteId);
    }, 600);

    this.noteDebounceTimers.set(noteId, timer);
  }

  async discardOperation(operationId: string): Promise<void> {
    await deleteFromStore('syncOperations', operationId);
    this.notifyListeners();
  }

  async retryOperation(operationId: string): Promise<void> {
    const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
    const op = ops.find(o => o.operationId === operationId);
    if (op) {
      op.status = 'pending';
      op.attemptCount = 0;
      await putToStore('syncOperations', op);
      this.processQueue();
    }
  }

  async forceSyncNow(): Promise<void> {
    const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
    for (const op of ops) {
      if (op.status === 'failed') {
        op.status = 'pending';
        op.attemptCount = 0;
        await putToStore('syncOperations', op);
      }
    }
    await this.processQueue();
    await this.pullIncrementalChanges();
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.currentState = 'offline';
      this.notifyListeners();
      return;
    }

    // Only leader tab dispatches network operations
    if (!tabCoordinator.isSyncLeader()) {
      return;
    }

    this.isProcessing = true;
    let batch: SyncOpRecord[] = [];

    try {
      while (typeof navigator === 'undefined' || navigator.onLine) {
        const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
        const pendingOps = ops.filter(o => o.status === 'pending');

        if (pendingOps.length === 0) {
          const hasFailed = ops.some(o => o.status === 'failed');
          this.currentState = hasFailed ? 'retrying' : 'synced';
          this.notifyListeners();
          break;
        }

        this.currentState = 'syncing';
        this.notifyListeners();

        // Process batch immediately without delay
        batch = pendingOps.slice(0, 10);
        const batchPayload = {
          action: 'processOperations',
          clientId: this.clientId,
          operations: batch
        };

        const response = await fetch(getGasUrl(),  {
          method: 'POST',
          headers: syncHeaders({ 'Content-Type': 'text/plain;charset=utf-8' }),
          body: JSON.stringify(batchPayload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        let json: any;
        try {
          json = await response.json();
        } catch {
          throw new Error('The sync endpoint did not return JSON. If it is Apps Script, redeploy it with access set to "Anyone".');
        }
        if (!json.success) {
          throw new Error(json.error || 'Server rejected batch');
        }

        // Update server revision
        if (json.serverRevision) {
          this.serverRevision = json.serverRevision;
          await setMeta('serverRevision', this.serverRevision);
        }

        // Process Per-Operation Results
        const results: Array<{ operationId: string; status: string; reason?: string; entityRevision?: number }> = json.results || [];
        let hadConflict = false;

        for (const op of batch) {
          const res = results.find(r => r.operationId === op.operationId);
          if (res && (res.status === 'applied' || res.status === 'idempotent')) {
            await deleteFromStore('syncOperations', op.operationId);
          } else if (res && res.status === 'conflict') {
            hadConflict = true;
            op.status = 'failed';
            op.lastError = `Conflict: ${res.reason || 'Stale version'}`;
            await putToStore('syncOperations', op);
            this.notifyConflict({
              operationId: op.operationId,
              entityType: op.entityType,
              entityId: op.entityId,
              reason: res.reason || 'Stale version',
              localRecord: op.payload,
              serverRecord: (res as any).currentRecord
            });
          } else {
            // Failure / Rejection
            op.attemptCount = (op.attemptCount || 0) + 1;
            op.lastAttemptAt = new Date().toISOString();
            op.lastError = res?.reason || 'Batch processing failed';
            op.status = op.attemptCount > 5 ? 'failed' : 'pending';
            await putToStore('syncOperations', op);
          }
        }

        this.lastSuccessfulSync = new Date().toISOString();
        await setMeta('lastSuccessfulSync', this.lastSuccessfulSync);
        this.currentState = hadConflict ? 'conflict' : 'syncing';
        this.lastError = null;
        this.notifyListeners();

        // Check if there are still pending ops to continue draining without waiting
        const remaining = (await getAllFromStore<SyncOpRecord>('syncOperations')).filter(o => o.status === 'pending');
        if (remaining.length === 0) {
          this.currentState = 'synced';
          this.notifyListeners();
          break;
        }
      }
    } catch (err: any) {
      console.warn('[SyncEngine] Batch upload failed, scheduling backoff:', err);
      this.lastError = describeSyncError(err) || 'Network sync error';
      // Record the failure on each op so the queue shows why it is stuck. They
      // stay pending: a whole-batch failure is usually the network or setup,
      // not the op itself.
      for (const op of batch) {
        try {
          op.attemptCount = (op.attemptCount || 0) + 1;
          op.lastAttemptAt = new Date().toISOString();
          op.lastError = this.lastError;
          await putToStore('syncOperations', op);
        } catch {
          // Leave the op as it was if IndexedDB write fails.
        }
      }
      this.currentState = 'retrying';
      this.scheduleBackoffRetry();
    } finally {
      this.isProcessing = false;
      this.notifyListeners();
    }
  }

  async pullIncrementalChanges(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const baseUrl = getGasUrl('getChangesSince');
      const url = baseUrl.includes('?') ? `${baseUrl}&sinceRevision=${this.serverRevision}` : `${baseUrl}?sinceRevision=${this.serverRevision}`;
      const response = await fetch(url, { headers: syncHeaders() });
      if (!response.ok) return;

      const json = await response.json();
      if (json.success && json.changes) {
        const changes = json.changes;
        for (const table in changes) {
          const rows = changes[table];
          if (Array.isArray(rows) && rows.length > 0) {
            for (const row of rows) {
              await putToStore(table, row);
            }
            this.notifyEntityListeners(table, rows);
          }
        }

        if (json.serverRevision && json.serverRevision > this.serverRevision) {
          this.serverRevision = json.serverRevision;
          await setMeta('serverRevision', this.serverRevision);
        }
        this.lastSuccessfulSync = new Date().toISOString();
        await setMeta('lastSuccessfulSync', this.lastSuccessfulSync);
        this.notifyListeners();
      }
    } catch (e) {
      console.warn('[SyncEngine] Incremental pull failed:', e);
    }
  }

  private scheduleBackoffRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = Math.min(60000, Math.pow(2, 2) * 1000 + Math.random() * 1000);
    this.retryTimer = setTimeout(() => {
      this.processQueue();
    }, delay);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(l => l(status));
  }

  private notifyEntityListeners(entityType: string, changes: any[]): void {
    this.entityListeners.forEach(l => l(entityType, changes));
  }
}

export const syncEngine = new SyncEngine();
