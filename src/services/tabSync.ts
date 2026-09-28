/**
 * SAGE MULTI-TAB SYNCHRONIZATION & LEADER COORDINATION
 * Uses BroadcastChannel to coordinate state updates and elect a single active sync leader across tabs.
 */

type TabMessage = 
  | { type: 'ENTITY_MUTATED'; entityType: string; entityId: string; revision: number }
  | { type: 'STATE_INVALIDATED' }
  | { type: 'SYNC_STATUS_CHANGED'; payload: any }
  | { type: 'LEADER_HEARTBEAT'; tabId: string }
  | { type: 'LEADER_CLAIM'; tabId: string };

type TabEventListener = (msg: TabMessage) => void;

class TabCoordinator {
  private channel: BroadcastChannel | null = null;
  private tabId: string = 'tab_' + Math.random().toString(36).substring(2, 9);
  private isLeader: boolean = false;
  private lastLeaderHeartbeat: number = 0;
  private heartbeatTimer: any = null;
  private listeners: Set<TabEventListener> = new Set();

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('sage_tab_bus');
        this.channel.onmessage = (event) => this.handleMessage(event.data);
        this.startLeaderElection();
      } catch (e) {
        console.warn('[TabCoordinator] BroadcastChannel unavailable, running in standalone mode:', e);
        this.isLeader = true;
      }
    } else {
      this.isLeader = true;
    }
  }

  getTabId(): string {
    return this.tabId;
  }

  isSyncLeader(): boolean {
    return this.isLeader;
  }

  broadcast(message: TabMessage) {
    if (this.channel) {
      try {
        this.channel.postMessage(message);
      } catch (e) {
        console.warn('[TabCoordinator] Failed to broadcast message:', e);
      }
    }
  }

  subscribe(listener: TabEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleMessage(msg: TabMessage) {
    if (!msg || !msg.type) return;

    if (msg.type === 'LEADER_HEARTBEAT') {
      this.lastLeaderHeartbeat = Date.now();
      if (this.isLeader && msg.tabId !== this.tabId) {
        // Tie-breaker: lexicographically lower tabId wins leadership
        if (msg.tabId < this.tabId) {
          this.isLeader = false;
          this.stopHeartbeat();
        }
      }
    } else if (msg.type === 'LEADER_CLAIM') {
      if (msg.tabId < this.tabId || Date.now() - this.lastLeaderHeartbeat > 4000) {
        this.isLeader = (msg.tabId === this.tabId);
        this.lastLeaderHeartbeat = Date.now();
      }
    }

    // Notify application listeners (e.g. store re-hydration)
    this.listeners.forEach(l => l(msg));
  }

  private startLeaderElection() {
    // Check if leader exists or claim leadership
    this.broadcast({ type: 'LEADER_CLAIM', tabId: this.tabId });
    this.isLeader = true;
    this.startHeartbeat();

    setInterval(() => {
      if (!this.isLeader && Date.now() - this.lastLeaderHeartbeat > 5000) {
        // Leader missed heartbeats; claim leadership
        this.isLeader = true;
        this.broadcast({ type: 'LEADER_CLAIM', tabId: this.tabId });
        this.startHeartbeat();
      }
    }, 3000);
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.isLeader) {
        this.broadcast({ type: 'LEADER_HEARTBEAT', tabId: this.tabId });
      }
    }, 2000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const tabCoordinator = new TabCoordinator();
