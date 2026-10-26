// CaptureGuide.tsx - Settings > Shortcuts. Step-by-step setup for using Sage
// without opening it: ONE Siri shortcut that sends whatever you say to
// /api/voice (the Pi works out what you meant and does it), Home Screen
// shortcuts, and forwarding email to the Inbox (see /api/voice and
// /api/email-capture on the Pi).
import { useEffect, useState } from 'react';
import { Mic, LayoutGrid, Mail, ChevronDown, Copy, Check, Send, Sparkles } from 'lucide-react';
import { getPiApiKey, piBackendUrl, piHeaders } from '../../services/piBackend';
import { useToast } from '../../context/ToastContext';
import { SiriSetupDemo } from './SiriSetupDemo';

const card = 'rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5';
const field = 'w-full px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5';

// navigator.clipboard only exists on https and localhost, and the Pi is
// usually opened over plain http at home, so fall back to the old way.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea route.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else {
          showToast("Couldn't copy. Press and hold the text to copy it instead.", 'error');
        }
      }}
      className={`${smallButton} shrink-0`}
    >
      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

// One value to paste somewhere, with a label above it and a copy button.
function CopyField({ label, value, shown, multiline }: { label: string; value: string; shown?: string; multiline?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="flex items-start gap-2">
        {multiline ? (
          <pre className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white dark:bg-black/30 border border-black/10 dark:border-white/10 text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all">{shown ?? value}</pre>
        ) : (
          <code className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white dark:bg-black/30 border border-black/10 dark:border-white/10 text-xs font-mono text-gray-800 dark:text-gray-200 break-all">{shown ?? value}</code>
        )}
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-4">{children}</ol>;
}

function Step({ n, title, children }: { n: number; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 shrink-0 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-px" aria-hidden="true">{n}</span>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-sm text-gray-900 dark:text-white leading-snug">{title}</div>
        {children}
      </div>
    </li>
  );
}

// The name of a button or action in another app, shown the way it looks there.
function Ui({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold whitespace-nowrap">{children}</span>;
}

function Section({ icon, tint, title, hint, open, onToggle, children }: {
  icon: React.ReactNode; tint: string; title: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className={card}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full p-5 flex items-center gap-3 text-left">
        <span className={`p-2.5 rounded-xl shrink-0 ${tint}`}>{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-sm text-gray-900 dark:text-white">{title}</span>
          <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>
        </span>
        <ChevronDown size={18} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-5 pt-1 space-y-4">{children}</div>}
    </section>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{children}</p>
);

type EmailCapture = { enabled: boolean; imapHost: string; imapPort: number; imapUser: string; folder: string };
type EmailConfig = {
  emailCapture: EmailCapture;
  emailCaptureReady: boolean;
  imapPasswordSet: boolean;   // a password just for capture
  usesEmailPassword: boolean; // falling back to the notification email's
  emailAccount: string;       // the account notifications send from
  mailbox: string;            // the account Sage actually reads
};

// you@gmail.com -> you+sage@gmail.com, which Gmail delivers to the same inbox.
const plusAddress = (account: string) => (account.includes('@') ? account.replace('@', '+sage@') : '');

function EmailSteps() {
  const [config, setConfig] = useState<EmailConfig | null | undefined>(undefined);
  const [draft, setDraft] = useState<EmailCapture | null>(null);
  const [password, setPassword] = useState('');
  const [ownAccount, setOwnAccount] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { showToast } = useToast();

  const accept = (json: EmailConfig) => {
    setConfig(json);
    setDraft(json.emailCapture);
    setOwnAccount(Boolean(json.emailCapture.imapUser || json.imapPasswordSet));
  };

  useEffect(() => {
    fetch(`${piBackendUrl()}/api/email-capture`, { headers: piHeaders() })
      .then(res => (res.ok ? res.json() : null))
      .then(json => (json?.success ? accept(json) : setConfig(null)))
      .catch(() => setConfig(null));
  }, []);

  const call = async (name: string, path: string, method: string, body?: unknown) => {
    setBusy(name);
    try {
      const res = await fetch(`${piBackendUrl()}${path}`, {
        method,
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || `The Pi said ${res.status}`);
      return json;
    } catch (err: any) {
      showToast(err.message || 'Something went wrong', 'error');
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (config === undefined) return <Note>Checking your Pi…</Note>;
  if (config === null || !draft) return <Note>Couldn't reach the Pi. Check the server key under Server &amp; Reset, then come back.</Note>;

  const mailbox = (ownAccount && draft.imapUser) || config.emailAccount;
  const forwardTo = plusAddress(mailbox);
  const needsPassword = !config.usesEmailPassword && !config.imapPasswordSet;

  const save = async () => {
    if (password.trim()) {
      const saved = await call('save', '/api/email-capture/password', 'POST', { password });
      if (!saved) return;
      setPassword('');
    }
    const prefs = { ...draft, imapUser: ownAccount ? draft.imapUser : '', imapPort: Number(draft.imapPort) || 993 };
    const json = await call('save', '/api/email-capture/prefs', 'PUT', prefs);
    if (json) { accept(json); showToast(json.emailCaptureReady ? 'Email capture is on' : 'Saved'); }
  };

  // Back to the notification email's account and password.
  const useNotificationAccount = async () => {
    if (config.imapPasswordSet && !(await call('save', '/api/email-capture/password', 'POST', { password: '' }))) return;
    const json = await call('save', '/api/email-capture/prefs', 'PUT', { ...draft, imapUser: '' });
    if (json) { accept(json); setOwnAccount(false); }
  };

  const checkNow = async () => {
    const json = await call('check', '/api/email-capture/test', 'POST');
    if (json) showToast(json.captured ? `Added ${json.captured} task${json.captured === 1 ? '' : 's'} to your Inbox` : 'Connected. No new emails in the folder.');
  };

  const set = (patch: Partial<EmailCapture>) => setDraft(d => (d ? { ...d, ...patch } : d));

  return (
    <Steps>
      <Step n={1} title={<>In Gmail{mailbox ? <> for <Ui>{mailbox}</Ui></> : ''}, create a label called <Ui>{draft.folder || 'SageInbox'}</Ui>.</>}>
        <Note>On a computer: the <Ui>+</Ui> next to Labels in the left sidebar.</Note>
      </Step>
      <Step n={2} title={<>Make a filter that puts your Sage emails under that label.</>}>
        <Note>
          In the search bar, open the filter options and set <Ui>To</Ui> to the address below. Then <Ui>Create filter</Ui> with
          {' '}<Ui>Skip the Inbox</Ui> and <Ui>Apply the label: {draft.folder || 'SageInbox'}</Ui>.
        </Note>
        {forwardTo && <CopyField label="Sage email address" value={forwardTo} />}
      </Step>
      <Step n={3} title={<>Turn it on and save.</>}>
        <div className="p-4 rounded-xl bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={`inline-block w-2.5 h-2.5 shrink-0 rounded-full ${config.emailCaptureReady ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
            <span className="text-gray-700 dark:text-gray-300">
              {config.emailCaptureReady ? `On. Sage checks ${config.emailCapture.folder} every 30 seconds.` : 'Off'}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
            <input type="checkbox" checked={draft.enabled} onChange={e => set({ enabled: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            Turn on email capture
          </label>

          {!ownAccount ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-1.5">
                {config.usesEmailPassword && <Check size={14} className="text-emerald-500 shrink-0 mt-px" />}
                <span>
                  {config.usesEmailPassword
                    ? <>Reads <Ui>{config.emailAccount}</Ui> with the same app password as your notification emails. Nothing else to enter.</>
                    : <>Uses the account and app password from your notification emails. There's no password there yet, so add it under Notifications first, or paste one here.</>}
                </span>
              </p>
              {needsPassword && (
                <input className={`${field} font-mono`} type="password" autoComplete="off" placeholder="Gmail app password" aria-label="Gmail app password" value={password} onChange={e => setPassword(e.target.value)} />
              )}
              <button type="button" onClick={() => setOwnAccount(true)} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                Use a different Gmail account
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-gray-500">Gmail address</span>
                <input className={field} type="email" autoComplete="off" placeholder={config.emailAccount || 'you@gmail.com'} value={draft.imapUser} onChange={e => set({ imapUser: e.target.value.trim() })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-gray-500">
                  App password for that account {config.imapPasswordSet && <span className="text-emerald-600 dark:text-emerald-400">(saved)</span>}
                </span>
                <input className={`${field} font-mono`} type="password" autoComplete="off" placeholder={config.imapPasswordSet ? 'Paste a new one to replace it' : 'abcd efgh ijkl mnop'} value={password} onChange={e => setPassword(e.target.value)} />
              </label>
              <Note>
                Make one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">myaccount.google.com/apppasswords</a> while
                signed in to that account. It needs 2-Step Verification.
              </Note>
              <button type="button" onClick={useNotificationAccount} disabled={busy !== null} className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">
                Use my notification email instead
              </button>
            </div>
          )}

          <button type="button" onClick={() => setShowAdvanced(v => !v)} aria-expanded={showAdvanced} className="text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1">
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} /> Label and server
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-gray-500">Label (folder)</span>
                <input className={field} value={draft.folder} onChange={e => set({ folder: e.target.value.trim() })} />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1 col-span-2">
                  <span className="text-xs text-gray-500">IMAP server</span>
                  <input className={field} value={draft.imapHost} onChange={e => set({ imapHost: e.target.value.trim() })} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-gray-500">Port</span>
                  <input className={field} inputMode="numeric" value={String(draft.imapPort)} onChange={e => set({ imapPort: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </label>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={save} disabled={busy !== null} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-sm">
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={checkNow} disabled={busy !== null || !config.emailCaptureReady} className={smallButton}>
              <Mail size={13} /> {busy === 'check' ? 'Checking…' : 'Check now'}
            </button>
          </div>
        </div>
      </Step>
      <Step n={4} title={<>Forward any email to {forwardTo ? <Ui>{forwardTo}</Ui> : <>your <code className="font-mono">+sage</code> address</>}.</>}>
        <Note>The subject becomes the task, the start of the email goes in its notes, and it's tagged #email. Sage then files the email under {draft.folder || 'SageInbox'}/SageProcessed so it's only added once.</Note>
      </Step>
    </Steps>
  );
}

type VoiceReply = { say?: string; engine?: string; understood?: { intent?: string; title?: string; date?: string; time?: string } };

// Types a sentence the way Siri would send it and shows what Sage answers.
function VoiceTest({ base }: { base: string }) {
  const [text, setText] = useState('tomorrow 5pm call mom urgent');
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<VoiceReply | null>(null);
  const { showToast } = useToast();
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/api/voice`, {
        method: 'POST',
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text, source: 'api', dryRun }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || json.error || `The Pi said ${res.status}`);
      setReply(json);
    } catch (err: any) {
      setReply(null);
      showToast(err.message || 'The test failed', 'error');
    } finally {
      setBusy(false);
    }
  };
  const u = reply?.understood;
  return (
    <div className="space-y-2">
      <form onSubmit={e => { e.preventDefault(); if (text.trim()) send(); }} className="flex items-center gap-2">
        <input className={`${field} text-xs`} value={text} onChange={e => setText(e.target.value)} aria-label="Something to say to Sage" />
        <button type="submit" disabled={busy || !text.trim()} className={`${smallButton} shrink-0`}>
          <Send size={13} /> {busy ? 'Sending…' : 'Try it'}
        </button>
      </form>
      <label className="flex items-center gap-2 text-xs text-gray-500">
        <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
        Only show what Sage understood, don't save anything
      </label>
      {reply && (
        <div className="px-3 py-2 rounded-xl bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 text-xs space-y-1">
          <div className="text-gray-900 dark:text-white">{reply.say}</div>
          {u && (
            <div className="text-gray-500 font-mono break-words">
              {[u.intent, u.title, u.date, u.time].filter(Boolean).join(' · ')}{reply.engine && reply.engine !== 'rules' ? ` · read with ${reply.engine}` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SAY_EXAMPLES: Array<[string, string[]]> = [
  ['Add a task', ['Call mom tomorrow 5pm', '5pm tomorrow call mom urgent', 'kal subah 6 baje gym']],
  ['Be reminded', ['Remind me in 20 minutes to check the oven', 'Remind me Friday at 9 about the dentist']],
  ['Book a meeting', ['Lunch with Priya Friday at 1']],
  ['Repeat something', ['Water the plants every other day', 'Gym every Mon Wed Fri 7am']],
  ['Start a habit', ['Start a habit meditation 5 times a week']],
  ['Save a note', ['Note: the wifi password is in the drawer']],
  ['Finish or move one', ['Mark call mom as done', 'Snooze the dentist for 2 hours', 'Move call mom to Friday 3pm']],
  ['Ask', ["What's on today", 'Anything overdue', 'How many tasks do I have']],
];

export function CaptureGuide({ publicUrl }: { publicUrl?: string | null }) {
  const [open, setOpen] = useState<string | null>('siri');
  const [needsKey, setNeedsKey] = useState<boolean | null>(null);
  const [voice, setVoice] = useState<{ ai: boolean } | null>(null);
  const toggle = (id: string) => setOpen(o => (o === id ? null : id));

  const local = piBackendUrl();
  // Siri runs on the phone, often away from home, so
  // prefer the public link when the Pi has one.
  const base = (publicUrl || local || '').replace(/\/+$/, '');
  const key = getPiApiKey();

  useEffect(() => {
    if (!local) return;
    fetch(`${local}/api/health`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => setNeedsKey(json ? Boolean(json.auth) : null))
      .catch(() => setNeedsKey(null));
    fetch(`${local}/api/voice`, { headers: piHeaders() })
      .then(res => (res.ok ? res.json() : null))
      .then(json => setVoice(json?.success ? { ai: Boolean(json.ai) } : null))
      .catch(() => setVoice(null));
  }, [local]);

  if (!local) {
    return (
      <div className={`${card} p-5`}>
        <Note>Shortcuts send tasks to the Sage server on your Pi. This copy of the app isn't connected to it.</Note>
      </div>
    );
  }

  const endpoint = `${base}/api/voice`;
  const keyValue = key ? `Bearer ${key}` : 'Bearer YOUR_API_SECRET';
  const keyShown = key ? `Bearer ${'•'.repeat(8)}${key.slice(-4)}` : 'Bearer YOUR_API_SECRET';
  const sendsKey = needsKey !== false;
  const body = JSON.stringify({ text: 'Dictated Text', source: 'siri' }, null, 2);

  return (
    <div className="space-y-4">
      <div className={`${card} p-5 space-y-3`}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-blue-500" />
          <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Talk to Sage without opening it</h4>
        </div>
        <Note>
          One Siri shortcut does everything. Say it however you like, with the day and time at the start, middle or end, in slang or a mix of languages.
          Your Pi works out what you meant, does it, and Siri says back what happened.
          {voice && (voice.ai
            ? ' When a sentence is hard it asks the AI, and without the AI it still reads the usual ways of saying things.'
            : ' No AI is set up, so it reads the usual ways of saying things. Add a Groq key under Server & Reset to help with unusual phrasing and mixed languages.')}
          {' '}If it isn't sure, it saves what you said to your Inbox so nothing is lost.
        </Note>
        <CopyField label="Your Sage address" value={base} />
        {!publicUrl && (
          <Note>This address only works on your home network. For Siri away from home, set up a public link (see Server &amp; Reset) and this guide will use it.</Note>
        )}
        <VoiceTest base={local} />
      </div>

      <SiriSetupDemo url={endpoint} />

      <Section
        icon={<Mic size={18} />} tint="bg-blue-50 dark:bg-blue-950/40 text-blue-600"
        title="Siri: one shortcut for everything" hint="iPhone, iPad, Mac and Apple Watch · about 3 minutes, once"
        open={open === 'siri'} onToggle={() => toggle('siri')}
      >
        <Steps>
          <Step n={1} title={<>Open the <Ui>Shortcuts</Ui> app, tap <Ui>+</Ui>, and name the shortcut <Ui>Sage</Ui>.</>}>
            <Note>The name is what you say: “Hey Siri, Sage”.</Note>
          </Step>
          <Step n={2} title={<>Add <Ui>Dictate Text</Ui>. Set <Ui>Stop Listening</Ui> to <Ui>After Pause</Ui>.</>}>
            <Note>Leave the language on its default. Sage reads English with Hindi, Spanish and other words mixed in.</Note>
          </Step>
          <Step n={3} title={<>Add <Ui>Get Contents of URL</Ui> and paste this address as the URL.</>}>
            <CopyField label="URL" value={endpoint} />
          </Step>
          <Step n={4} title={<>Tap the arrow on that action to show more. Set <Ui>Method</Ui> to <Ui>POST</Ui>.</>} />
          {sendsKey && (
            <Step n={5} title={<>Under <Ui>Headers</Ui>, tap <Ui>Add new header</Ui>. Key <Ui>Authorization</Ui>, value below.</>}>
              <CopyField label="Header key" value="Authorization" />
              <CopyField label="Header value" value={keyValue} shown={keyShown} />
              {!key && <Note>This device doesn't have the server key yet. Paste the API_SECRET from /etc/sage/sage.env under Server &amp; Reset, then copy it from here.</Note>}
            </Step>
          )}
          <Step
            n={sendsKey ? 6 : 5}
            title={<>Set <Ui>Request Body</Ui> to <Ui>JSON</Ui> and add two Text fields: <Ui>text</Ui> set to the <Ui>Dictated Text</Ui> variable, and <Ui>source</Ui> set to <Ui>siri</Ui>.</>}
          >
            <CopyField label="What Sage receives" value={body} multiline />
          </Step>
          <Step n={sendsKey ? 7 : 6} title={<>Add <Ui>Get Dictionary Value</Ui>. Set it to get the value for <Ui>say</Ui> in <Ui>Contents of URL</Ui>.</>}>
            <Note>That is the sentence Sage sends back, like “Added Call mom tomorrow at 5 pm.”</Note>
          </Step>
          <Step n={sendsKey ? 8 : 7} title={<>Add <Ui>Speak Text</Ui> and give it the <Ui>Dictionary Value</Ui>. Tap <Ui>Done</Ui>.</>}>
            <Note>Prefer to read it? Use <Ui>Show Result</Ui> instead, or add both.</Note>
          </Step>
          <Step n={sendsKey ? 9 : 8} title={<>Say “Hey Siri, Sage”, then say anything.</>}>
            <Note>Optional: to use the same shortcut from the Share Sheet, tap <Ui>ⓘ</Ui>, turn on <Ui>Show in Share Sheet</Ui> for Text and URLs, and put <Ui>If Shortcut Input has any value</Ui> before Dictate Text: use the input as the text, otherwise dictate.</Note>
          </Step>
        </Steps>

        <div className="space-y-2 pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Things you can say</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SAY_EXAMPLES.map(([what, examples]) => (
              <div key={what} className="p-3 rounded-xl bg-white dark:bg-black/20 border border-black/10 dark:border-white/10">
                <div className="text-xs font-semibold text-gray-900 dark:text-white mb-1">{what}</div>
                {examples.map(e => (
                  <div key={e} className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">“{e}”</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        icon={<LayoutGrid size={18} />} tint="bg-purple-50 dark:bg-purple-950/40 text-purple-600"
        title="Home Screen shortcuts" hint="New Task, Today and Focus one tap from the app icon"
        open={open === 'home'} onToggle={() => toggle('home')}
      >
        <Steps>
          <Step n={1} title={<>Install Sage as an app.</>}>
            <Note>
              <Ui>iPhone:</Ui> open Sage in Safari, tap <Ui>Share</Ui>, then <Ui>Add to Home Screen</Ui>.
              {' '}<Ui>Android or computer:</Ui> in Chrome or Edge, open the menu and choose <Ui>Install app</Ui>.
            </Note>
          </Step>
          <Step n={2} title={<>Long-press the Sage icon (Android) or right-click it in the dock or taskbar (computer).</>}>
            <Note>You'll see New Task, Today and Focus. Drag one onto the Home Screen to keep it there.</Note>
          </Step>
          <Step n={3} title={<>On iPhone, use these links instead.</>}>
            <Note>Safari doesn't show icon shortcuts, so make a shortcut with one <Ui>Open URLs</Ui> action, paste a link, and add it to the Home Screen from its <Ui>ⓘ</Ui> menu.</Note>
            <CopyField label="New Task" value={`${base}/?action=new-task`} />
            <CopyField label="Today" value={`${base}/?view=dashboard`} />
            <CopyField label="Focus" value={`${base}/?view=focus`} />
          </Step>
        </Steps>
      </Section>

      <Section
        icon={<Mail size={18} />} tint="bg-amber-50 dark:bg-amber-950/40 text-amber-600"
        title="Email to Inbox" hint="Forward an email and it becomes a task"
        open={open === 'email'} onToggle={() => toggle('email')}
      >
        <EmailSteps />
      </Section>
    </div>
  );
}
