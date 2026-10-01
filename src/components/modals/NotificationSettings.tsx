import { useCallback, useEffect, useState } from 'react';
import { Bell, Mail, Smartphone, Check, Send, ExternalLink } from 'lucide-react';
import {
  disablePush, enablePush, getConfig, getPushState, isAppleMobile, saveEmailPassword, savePrefs, sendTest, thisDeviceEndpoint,
  type NotifyConfig, type NotifyPrefs, type PushState,
} from '../../services/pushNotifications';
import { useToast } from '../../context/ToastContext';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';
const field = 'w-full px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex-1 min-w-[10rem]">
        <div className="text-sm font-medium text-gray-900 dark:text-white">{title}</div>
        {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">{children}</div>
    </div>
  );
}

const STATE_TEXT: Record<PushState, string> = {
  'no-server': 'Notifications need the Sage server on your Pi. This copy of the app runs without it.',
  unsupported: "This browser can't receive notifications. Try Safari on iPhone (from the Home Screen), Chrome, Edge or Firefox.",
  'needs-install': 'On iPhone and iPad, tap Share, then Add to Home Screen, and open Sage from there. Apple only lets Home Screen apps send notifications.',
  denied: isAppleMobile()
    ? 'Notifications are blocked. Open the iPhone Settings app, then Notifications > Sage, and turn on Allow Notifications.'
    : "Notifications are blocked for this site. Click the lock or site icon next to the address, allow Notifications, then reload.",
  off: 'Get reminders and your morning plan on this device, even when Sage is closed.',
  on: 'This device gets reminders, even when Sage is closed.',
};

export function NotificationSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [config, setConfig] = useState<NotifyConfig | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [emailDraft, setEmailDraft] = useState<NotifyPrefs['email'] | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const next = await getPushState().catch(() => 'unsupported' as PushState);
    setState(next);
    setEndpoint(await thisDeviceEndpoint().catch(() => null));
    if (next === 'no-server') return;
    try {
      const cfg = await getConfig();
      setConfig(cfg);
      setEmailDraft(cfg.prefs.email);
    } catch (err: any) {
      showToast(err.message || 'Could not load notification settings', 'error');
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try {
      await action();
    } catch (err: any) {
      showToast(err.message || 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  };

  const update = (change: Partial<NotifyPrefs>) => run('prefs', async () => {
    setConfig(await savePrefs(change));
  });

  const turnOn = () => run('push', async () => {
    const next = await enablePush();
    setState(next);
    if (next === 'on') {
      const mine = await thisDeviceEndpoint();
      setEndpoint(mine);
      setConfig(await getConfig());
      await sendTest('push', mine || undefined).catch(() => {});
      showToast("Notifications are on. A test one is on its way.");
    } else if (next === 'denied') {
      showToast('Notifications were blocked', 'error');
    }
  });

  const turnOff = () => run('push', async () => {
    await disablePush();
    setState('off');
    setEndpoint(null);
    setConfig(await getConfig());
    showToast('Notifications are off on this device');
  });

  const test = () => run('test', async () => {
    const res = await sendTest('push', endpoint || undefined);
    const failed = (res.results || []).find(r => !r.ok);
    if (failed) throw new Error(failed.error || 'The test notification failed');
    showToast('Test sent. It should appear in a few seconds.');
  });

  const saveEmail = () => run('email', async () => {
    if (!emailDraft) return;
    if (password.trim()) await saveEmailPassword(password);
    setConfig(await savePrefs({ email: emailDraft }));
    setPassword('');
    showToast('Email settings saved');
  });

  const testEmail = () => run('email-test', async () => {
    if (emailDraft) await savePrefs({ email: emailDraft });
    if (password.trim()) { await saveEmailPassword(password); setPassword(''); }
    await sendTest('email');
    setConfig(await getConfig());
    showToast(`Test email sent to ${emailDraft?.to}`);
  });

  const prefs = config?.prefs;
  const email = emailDraft;
  const setEmail = (change: Partial<NotifyPrefs['email']>) => setEmailDraft(e => (e ? { ...e, ...change } : e));
  const isGmail = !email || email.smtpHost === 'smtp.gmail.com';

  return (
    <div className="space-y-6">
      {/* This device */}
      <div className={card}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 shrink-0"><Bell size={18} /></div>
            <div className="min-w-0">
              <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Notifications on this device</h4>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{state ? STATE_TEXT[state] : 'Checking…'}</p>
            </div>
          </div>
          {state === 'on' && (
            <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 font-semibold text-xs rounded-full flex items-center gap-1 shrink-0">
              <Check size={13} /> On
            </span>
          )}
          {state === 'off' && (
            <button onClick={turnOn} disabled={busy === 'push'} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-xs rounded-xl shadow-sm shrink-0">
              {busy === 'push' ? 'Turning on…' : 'Turn on'}
            </button>
          )}
        </div>
        {state === 'on' && (
          <div className="flex gap-2">
            <button onClick={test} disabled={busy === 'test'} className={smallButton}><Send size={13} /> Send a test</button>
            <button onClick={turnOff} disabled={busy === 'push'} className={smallButton}>Turn off here</button>
          </div>
        )}
        {config && !config.pushAvailable && (
          <p className="text-xs text-amber-600">The Pi can't send pushes yet. On the Pi, run <code>pip install -r requirements.txt</code> in raspberry_pi/venv and restart Sage.</p>
        )}
      </div>

      {/* What to notify */}
      {prefs && (
        <div className={card}>
          <h4 className="font-semibold text-sm text-gray-900 dark:text-white">What Sage tells you</h4>
          <Row title="Reminders" hint="At the time you set on a task or event">
            <Toggle label="Reminders" on={prefs.reminders} onChange={on => update({ reminders: on })} />
          </Row>
          <Row title="Morning plan" hint="What's due today and anything overdue">
            <input type="time" className="field !w-[7.5rem] !py-1 !px-2 text-sm" value={prefs.morningTime} disabled={!prefs.morningPlan}
              onChange={e => e.target.value && update({ morningTime: e.target.value })} />
            <Toggle label="Morning plan" on={prefs.morningPlan} onChange={on => update({ morningPlan: on })} />
          </Row>
          <Row title="Evening check-in" hint="Only when something due today is still open">
            <input type="time" className="field !w-[7.5rem] !py-1 !px-2 text-sm" value={prefs.eveningTime} disabled={!prefs.eveningCheckIn}
              onChange={e => e.target.value && update({ eveningTime: e.target.value })} />
            <Toggle label="Evening check-in" on={prefs.eveningCheckIn} onChange={on => update({ eveningCheckIn: on })} />
          </Row>
          <p className="text-xs text-gray-400">Times are in {prefs.timezone.replace(/_/g, ' ')}.</p>
        </div>
      )}

      {/* Devices */}
      {config && config.devices.length > 0 && (
        <div className={card}>
          <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Devices getting notifications</h4>
          {config.devices.map(d => (
            <Row key={d.endpoint} title={d.endpoint === endpoint ? `${d.label} (this one)` : d.label}
              hint={d.lastSuccessAt ? `Last delivered ${new Date(d.lastSuccessAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Nothing delivered yet'}>
              <Smartphone size={16} className="text-gray-400" />
            </Row>
          ))}
        </div>
      )}

      {/* Email */}
      {email && (
        <div className={card}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 shrink-0"><Mail size={18} /></div>
              <div className="min-w-0">
                <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Email</h4>
                <p className="text-xs text-gray-400 mt-0.5">Your morning plan in your inbox, sent from your own email account.</p>
              </div>
            </div>
            <Toggle label="Email notifications" on={email.enabled} onChange={on => setEmail({ enabled: on })} />
          </div>

          {email.enabled && (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-500">Send to</span>
                <input className={field} type="email" autoComplete="email" placeholder="you@gmail.com" value={email.to}
                  onChange={e => setEmail({ to: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-500">Send from</span>
                <input className={field} type="email" placeholder="reminders@gmail.com" value={email.smtpUser}
                  onChange={e => setEmail({ smtpUser: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-500">
                  {isGmail ? `App password for ${email.smtpUser || email.to || 'the sending account'}` : 'SMTP password'} {config?.emailPasswordSet && <span className="text-emerald-600">· saved</span>}
                </span>
                <input className={field} type="password" autoComplete="new-password" value={password}
                  placeholder={config?.emailPasswordSet ? 'Leave empty to keep the saved one' : 'xxxx xxxx xxxx xxxx'}
                  onChange={e => setPassword(e.target.value)} />
                {isGmail && (
                  <span className="text-xs text-gray-400 flex flex-wrap items-center gap-1">
                    Not the account's normal password. Signed in as the sending account, make one at
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-0.5">
                      myaccount.google.com/apppasswords <ExternalLink size={11} />
                    </a>
                    (needs 2-Step Verification). It stays on your Pi.
                  </span>
                )}
              </label>
              <Row title="Morning plan">
                <Toggle label="Email the morning plan" on={email.morningPlan} onChange={on => setEmail({ morningPlan: on })} />
              </Row>
              <Row title="Reminders too" hint="An email for each reminder, as well as the notification">
                <Toggle label="Email reminders" on={email.reminders} onChange={on => setEmail({ reminders: on })} />
              </Row>

              <button onClick={() => setShowAdvanced(v => !v)} className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                {showAdvanced ? 'Hide' : 'Not using Gmail?'}
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-3 gap-2">
                  <label className="col-span-2 space-y-1">
                    <span className="text-xs font-medium text-gray-500">SMTP server</span>
                    <input className={field} value={email.smtpHost} onChange={e => setEmail({ smtpHost: e.target.value })} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-500">Port</span>
                    <input className={field} inputMode="numeric" value={email.smtpPort} onChange={e => setEmail({ smtpPort: Number(e.target.value) || 587 })} />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={saveEmail} disabled={busy === 'email'} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-semibold text-xs rounded-xl shadow-sm">
              {busy === 'email' ? 'Saving…' : 'Save'}
            </button>
            {email.enabled && (
              <button onClick={testEmail} disabled={busy === 'email-test' || !email.to} className={smallButton}>
                <Send size={13} /> {busy === 'email-test' ? 'Sending…' : 'Send a test email'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
