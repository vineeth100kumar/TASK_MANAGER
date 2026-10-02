/**
 * SAGE INDUSTRIAL-GRADE DURABLE SYNC QUEUE ENGINE (V3.1)
 * 
 * Features:
 * - Multi-Tab Leader Coordination (Single-worker dispatching via tabSync)
 * - Per-Operation Batch Results handling (Applied, Deleted, Stale, Rejected)
 * - Incremental Pull Protocol (Cloud -> Local delta synchronization)
 * - Exponential Backoff Retries with randomized Jitter
 * - Detailed Operations Queue Inspection & Granular Discard/Retry
 * - Debounced Note Autosave
 */

import { getAllFromStore, putToStore, deleteFromStore, getMeta, setMeta, getOrCreateClientId, SyncOpRecord } from './db';
import { tabCoordinator } from './tabSync';
import { piBackendUrl, piHeaders } from './piBackend';
import { LiveStream } from './liveStream';

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
    return PI_BACKEND_URL ? 'The Pi server rejected the key. Enter it in Settings > Server & Reset.' : message;
  }
  return message;
};

export type SyncState = 'synced' | 'syncing' | 'pending' | 'retrying' | 'offline' | 'error';

export interface SyncEngineStatus {
  state: SyncState;
  pendingCount: number;
  failedCount: number;
  lastSuccessfulSync: string | null;
  serverRevision: number;
  clientId: string;
  isLeader: boolean;
  lastError: string | null;
}

// A local change the server turned down because another device got there first:
// the record was deleted there, or saved there more recently.
export interface OverruledEvent {
  entityType: string;
  entityId: string;
  reason: 'deleted' | 'stale';
}

type SyncStatusListener = (status: SyncEngineStatus) => void;
type EntityChangeListener = (entityType: string, changes: any[]) => void;
type OverruledListener = (event: OverruledEvent) => void;

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
  private overruledListeners: Set<OverruledListener> = new Set();
  private localChangeListeners: Set<EntityChangeListener> = new Set();
  private noteDebounceTimers: Map<string, any> = new Map();
  // Records saved here but still in the debounce window, so not queued yet.
  private debouncedKeys: Set<string> = new Set();
  // When each record was last accepted by the server, to spot a pull that set
  // off before that save and so carries the older copy.
  private pushedAt: Map<string, number> = new Map();
  private batchDebounceTimer: any = null;
  private retryTimer: any = null;
  private consecutiveFailures = 0;
  private liveStream: LiveStream | null = null;
  private pullInFlight: Promise<void> | null = null;
  private pullAgain = false;
  private lastSeq = 0;

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
        // Only the leader tab uploads, so it sends what other tabs queued too.
        if (tabCoordinator.isSyncLeader()) this.scheduleUpload();
      }
    });

    this.isInitialized = true;

    // With the Pi, its live stream says when there is something to pull. Polling
    // stays as the fallback while the stream is down, and as a slow safety net.
    if (PI_BACKEND_URL) {
      this.liveStream = new LiveStream(
        PI_BACKEND_URL,
        (event) => {
          if (event.type === 'SYNC_CLEARED') {
            this.serverRevision = 0;
            setMeta('serverRevision', 0);
          }
          if (event.serverRevision !== this.serverRevision) this.pullIncrementalChanges();
        },
        (connected) => {
          // Catch up on anything missed while disconnected.
          if (connected) this.pullIncrementalChanges();
        }
      );
      this.liveStream.start();
    }

    let lastPull = Date.now();
    setInterval(() => {
      const interval = this.liveStream?.isConnected() ? 5 * 60000 : 30000;
      if (Date.now() - lastPull < interval) return;
      if (tabCoordinator.isSyncLeader() && navigator.onLine) {
        lastPull = Date.now();
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

  // Fires when this tab changes something locally (the change is queued for upload).
  onLocalChange(listener: EntityChangeListener): () => void {
    this.localChangeListeners.add(listener);
    return () => this.localChangeListeners.delete(listener);
  }

  onOverruled(listener: OverruledListener): () => void {
    this.overruledListeners.add(listener);
    return () => this.overruledListeners.delete(listener);
  }

  private notifyOverruled(event: OverruledEvent): void {
    this.overruledListeners.forEach(l => l(event));
  }

  getStatus(): SyncEngineStatus {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return {
      state: !isOnline ? 'offline' : this.currentState,
      pendingCount: 0,
      failedCount: 0,
      lastSuccessfulSync: this.lastSuccessfulSync,
      serverRevision: this.serverRevision,
      clientId: this.clientId,
      isLeader: tabCoordinator.isSyncLeader(),
      lastError: this.lastError
    };
  }

  // For the diagnostics panel: whether the Pi's live stream is up.
  liveStreamLabel(): string {
    if (!this.liveStream) return 'Not used (Apps Script has no live stream; checking every 30s)';
    return this.liveStream.isConnected() ? 'Connected (changes arrive instantly)' : 'Reconnecting (checking every 30s meanwhile)';
  }

  async getDetailedStatus(): Promise<SyncEngineStatus> {
    const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
    const pending = ops.filter(o => o.status === 'pending' || o.status === 'syncing');
    const failed = ops.filter(o => o.status === 'failed');

    const base = this.getStatus();
    return {
      ...base,
      pendingCount: pending.length,
      failedCount: failed.length
    };
  }

  // "entityType:id" for every record with a local change not yet accepted by the
  // server. Pulled data must not overwrite these, or the edit vanishes from view.
  async getUnsyncedKeys(): Promise<Set<string>> {
    const ops = await getAllFromStore<SyncOpRecord>('syncOperations');
    return new Set([...ops.map(o => `${o.entityType}:${o.entityId}`), ...this.debouncedKeys]);
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
    const seq = this.lastSeq = Math.max(Date.now(), this.lastSeq + 1);

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
      createdAt: new Date(seq).toISOString(),
      seq
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
    this.localChangeListeners.forEach(l => l(entityType, [{ id: entityId, revision }]));

    this.scheduleUpload();
    return operationId;
  }

  // 1500ms batch collector window to save mobile battery & Apps Script execution quota
  private scheduleUpload(): void {
    if (this.batchDebounceTimer) clearTimeout(this.batchDebounceTimer);
    this.batchDebounceTimer = setTimeout(() => {
      this.processQueue();
    }, 1500);
  }

  // Drops a save still waiting out its debounce, e.g. for a note being deleted,
  // so the delayed save can't upload after the delete and bring it back.
  cancelDebounced(entityType: string, id: string): void {
    const key = entityType === 'boards' ? `board:${id}` : id;
    const timer = this.noteDebounceTimers.get(key);
    if (timer) clearTimeout(timer);
    this.noteDebounceTimers.delete(key);
    this.debouncedKeys.delete(`${entityType}:${id}`);
  }

  // Queues a save once edits pause, so typing or drawing isn't one upload per change.
  // `key` groups the edits; `payload.id` is the record that gets saved.
  enqueueNoteDebounced(key: string, payload: any, entityType = 'notes'): void {
    if (this.noteDebounceTimers.has(key)) {
      clearTimeout(this.noteDebounceTimers.get(key));
    }

    const recordKey = `${entityType}:${payload.id}`;
    this.debouncedKeys.add(recordKey);
    const timer = setTimeout(async () => {
      this.noteDebounceTimers.delete(key);
      try {
        await this.enqueueOperation(entityType, payload.id, 'save', payload, payload.revision || 1);
      } finally {
        if (!this.noteDebounceTimers.has(key)) this.debouncedKeys.delete(recordKey);
      }
    }, 600);

    this.noteDebounceTimers.set(key, timer);
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
        // The store returns ops by their random id; upload them in the order they were made.
        const pendingOps = ops.filter(o => o.status === 'pending').sort(opOrder);

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

        // The revision only moves forward through pulls: other devices may have
        // saved in between, and jumping to the upload's revision would skip them.

        // Process Per-Operation Results
        const results: Array<{ operationId: string; status: string; reason?: string; entityRevision?: number; currentRecord?: any }> = json.results || [];

        for (const op of batch) {
          const res = results.find(r => r.operationId === op.operationId);
          if (res && (res.status === 'applied' || res.status === 'idempotent')) {
            this.pushedAt.set(`${op.entityType}:${op.entityId}`, Date.now());
            await deleteFromStore('syncOperations', op.operationId);
          } else if (res && (res.status === 'deleted' || res.status === 'stale')) {
            // The server has the final word: the record was deleted on another
            // device, or another device saved a newer copy. Show that here.
            await deleteFromStore('syncOperations', op.operationId);
            const stillQueued = (await getAllFromStore<SyncOpRecord>('syncOperations'))
              .some(o => o.entityType === op.entityType && o.entityId === op.entityId);
            if (!stillQueued) {
              if (res.status === 'deleted') await deleteFromStore(op.entityType, op.entityId);
              else if (res.currentRecord) await putToStore(op.entityType, res.currentRecord);
              this.notifyEntityListeners(op.entityType, [{ id: op.entityId }]);
            }
            this.notifyOverruled({ entityType: op.entityType, entityId: op.entityId, reason: res.status as 'deleted' | 'stale' });
          } else if (res && res.status === 'rejected') {
            // The server will never accept this op (bad table or operation); retrying won't help.
            op.status = 'failed';
            op.attemptCount = (op.attemptCount || 0) + 1;
            op.lastAttemptAt = new Date().toISOString();
            op.lastError = res.reason || 'Rejected by the server';
            await putToStore('syncOperations', op);
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
        this.currentState = 'syncing';
        this.lastError = null;
        this.consecutiveFailures = 0;
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

  // One pull at a time; a request that arrives mid-pull runs once more after it,
  // so a burst of live events costs at most two requests.
  async pullIncrementalChanges(): Promise<void> {
    if (this.pullInFlight) {
      this.pullAgain = true;
      return this.pullInFlight;
    }
    this.pullInFlight = (async () => {
      do {
        this.pullAgain = false;
        await this.pullOnce();
      } while (this.pullAgain);
    })().finally(() => {
      this.pullInFlight = null;
    });
    return this.pullInFlight;
  }

  private async pullOnce(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const startedAt = Date.now();
    try {
      const baseUrl = getGasUrl('getChangesSince');
      const url = baseUrl.includes('?') ? `${baseUrl}&sinceRevision=${this.serverRevision}` : `${baseUrl}?sinceRevision=${this.serverRevision}`;
      const response = await fetch(url, { headers: syncHeaders() });
      if (!response.ok) return;

      const json = await response.json();
      if (json.success && json.changes) {
        const changes = json.changes;
        const unsynced = await this.getUnsyncedKeys();
        for (const table in changes) {
          const rows = changes[table];
          if (Array.isArray(rows) && rows.length > 0) {
            // A row saved here after this pull set off may come back as its older copy.
            const incoming = rows.filter((row: any) => {
              const key = `${table}:${row?.id}`;
              return !unsynced.has(key) && (this.pushedAt.get(key) ?? 0) < startedAt;
            });
            for (const row of incoming) {
              await putToStore(table, row);
            }
            if (incoming.length > 0) this.notifyEntityListeners(table, incoming);
          }
        }

        // Records deleted on another device. One with an edit still queued here
        // is left for the upload, which the server answers with "deleted".
        const deleted: Record<string, string[]> = json.deleted || {};
        for (const table in deleted) {
          const ids = (deleted[table] || []).filter(id => !unsynced.has(`${table}:${id}`));
          for (const id of ids) {
            await deleteFromStore(table, id);
          }
          if (ids.length > 0) this.notifyEntityListeners(table, ids.map(id => ({ id, deleted: true })));
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
    // 2s, 4s, 8s ... capped at a minute, so a down server isn't hit every few seconds.
    this.consecutiveFailures += 1;
    const delay = Math.min(60000, Math.pow(2, this.consecutiveFailures) * 1000) + Math.random() * 1000;
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

// Upload order: when each op was made. Ops queued before `seq` existed fall back to createdAt.
const opOrder = (a: SyncOpRecord, b: SyncOpRecord) =>
  (a.seq ?? Date.parse(a.createdAt)) - (b.seq ?? Date.parse(b.createdAt));

export const syncEngine = new SyncEngine();
