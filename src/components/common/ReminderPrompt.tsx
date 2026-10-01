import { useEffect, useState } from 'react';
import { Bell, Share, X } from 'lucide-react';
import { enablePush, getPushState, sendTest, thisDeviceEndpoint, type PushState } from '../../services/pushNotifications';
import { useToast } from '../../context/ToastContext';

const DISMISS_KEY = 'sage.reminderPromptDismissedAt';
const DISMISS_DAYS = 7;

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < DISMISS_DAYS * 86400000;
  } catch {
    return false;
  }
}

/**
 * A quiet card on Today that offers notifications in context, instead of a
 * permission prompt the moment the app opens. "Not now" hides it for a week.
 */
export function ReminderPrompt() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(recentlyDismissed);
  const { showToast } = useToast();

  useEffect(() => { getPushState().then(setState).catch(() => setState('unsupported')); }, []);

  if (hidden || (state !== 'off' && state !== 'needs-install')) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage blocked */ }
    setHidden(true);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'on') {
        showToast("Reminders are on. You'll get a test one in a moment.");
        const endpoint = await thisDeviceEndpoint();
        sendTest('push', endpoint || undefined).catch(() => {});
      } else if (next === 'denied') {
        showToast('Notifications are blocked. You can allow them in Settings > Notifications.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Could not turn on notifications', 'error');
    } finally {
      setBusy(false);
    }
  };

  const install = state === 'needs-install';

  return (
    <div className="surface p-4 md:p-5 rounded-3xl border border-black/5 dark:border-white/5 flex items-start gap-3.5">
      <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 shrink-0">
        {install ? <Share size={18} /> : <Bell size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white">
          {install ? 'Get reminders on this device' : 'Never miss what you planned'}
        </h3>
        <p className="text-[13.5px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
          {install
            ? 'Tap Share, then Add to Home Screen, and open Sage from there. Apple only lets Home Screen apps send notifications.'
            : 'A nudge at the time you set, and a short plan each morning. Nothing else.'}
        </p>
        {!install && (
          <button
            onClick={turnOn}
            disabled={busy}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-[13px] rounded-xl shadow-sm"
          >
            {busy ? 'Turning on…' : 'Turn on reminders'}
          </button>
        )}
      </div>
      <button onClick={dismiss} aria-label="Not now" className="p-1.5 -m-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
        <X size={16} />
      </button>
    </div>
  );
}
