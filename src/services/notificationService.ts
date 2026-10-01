/**
 * In-tab reminders, for builds that don't use the Pi.
 *
 * With the Pi, reminders come as Web Push from the server (see
 * pushNotifications.ts and raspberry_pi/notifier.py) and reach the device even
 * when Sage is closed, so this watcher stays off to avoid showing each one twice.
 */

import { api } from './api';
import { piBackendUrl } from './piBackend';

class NotificationService {
  private isSupported: boolean = false;
  private checkTimer: any = null;
  private notifiedIds: Set<string> = new Set();

  constructor() {
    this.isSupported = typeof window !== 'undefined' && 'Notification' in window;
  }

  isNotificationSupported(): boolean {
    return this.isSupported;
  }

  getPermissionStatus(): NotificationPermission | 'unsupported' {
    if (!this.isSupported) return 'unsupported';
    return Notification.permission;
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.startReminderWatcher();
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[NotificationService] Permission request failed:', e);
      return false;
    }
  }

  startReminderWatcher(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (!this.isSupported || Notification.permission !== 'granted' || piBackendUrl()) return;

    // Check every 30 seconds for due reminders
    this.checkDueReminders();
    this.checkTimer = setInterval(() => {
      this.checkDueReminders();
    }, 30000);
  }

  private async checkDueReminders(): Promise<void> {
    try {
      const now = new Date();
      const nowTime = now.getTime();

      const state = api.sync.getState();
      const activeItems = state.workItems.filter(i => !i.deletedAt && i.status !== 'done');

      for (const item of activeItems) {
        // Check remindAt or startAt or dueDate
        const targetTimeStr = item.remindAt || item.startAt;
        if (targetTimeStr) {
          const targetTime = new Date(targetTimeStr).getTime();
          // If within 1 minute window and not already notified
          if (Math.abs(nowTime - targetTime) <= 60000 && !this.notifiedIds.has(item.id)) {
            this.sendNotification(item.title, {
              body: item.location ? `📍 ${item.location}` : `Due right now · ${item.entityType.toUpperCase()}`,
              tag: item.id
            });
            this.notifiedIds.add(item.id);
          }
        }
      }
    } catch (e) {
      console.warn('[NotificationService] Check due reminders error:', e);
    }
  }

  sendNotification(title: string, options?: NotificationOptions): void {
    if (!this.isSupported || Notification.permission !== 'granted') return;
    const full = { icon: '/icon-192.png', badge: '/icon-192.png', ...options };
    // Phones only show notifications through the service worker.
    const lookup = 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined);
    lookup
      .then(reg => { if (reg) return reg.showNotification(title, full); new Notification(title, full); })
      .catch(e => console.warn('[NotificationService] Send notification failed:', e));
  }
}

export const notificationService = new NotificationService();
