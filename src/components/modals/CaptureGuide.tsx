// CaptureGuide.tsx - Settings > Shortcuts. Step-by-step setup for the ways to
// add tasks without opening Sage: Siri, the Share Sheet, WhatsApp, Home
// Screen shortcuts, and forwarding email to the Inbox (see /api/quick-add and
// /api/email-capture on the Pi).
import { useEffect, useState } from 'react';
import { Mic, Share, MessageCircle, LayoutGrid, Mail, ChevronDown, Copy, Check, Send, Sparkles } from 'lucide-react';
import { getPiApiKey, piBackendUrl, piHeaders } from '../../services/piBackend';
import { useToast } from '../../context/ToastContext';

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

function SendTest({ base }: { base: string }) {
  const [text, setText] = useState('Test from Settings tomorrow 9am #sage');
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${base}/api/quick-add`, {
        method: 'POST',
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text, source: 'api' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || json.error || `The Pi said ${res.status}`);
      showToast(`Added "${json.item?.title || text}"`);
    } catch (err: any) {
      showToast(err.message || 'The test failed', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={e => { e.preventDefault(); if (text.trim()) send(); }} className="flex items-center gap-2">
      <input className={`${field} text-xs`} value={text} onChange={e => setText(e.target.value)} aria-label="Test task" />
      <button type="submit" disabled={busy || !text.trim()} className={`${smallButton} shrink-0`}>
        <Send size={13} /> {busy ? 'Sending…' : 'Try it'}
      </button>
    </form>
  );
}

export function CaptureGuide({ publicUrl }: { publicUrl?: string | null }) {
  const [open, setOpen] = useState<string | null>('siri');
  const [needsKey, setNeedsKey] = useState<boolean | null>(null);
  const toggle = (id: string) => setOpen(o => (o === id ? null : id));

  const local = piBackendUrl();
  // Siri and the Share Sheet run on the phone, often away from home, so
  // prefer the public link when the Pi has one.
  const base = (publicUrl || local || '').replace(/\/+$/, '');
  const key = getPiApiKey();

  useEffect(() => {
    if (!local) return;
    fetch(`${local}/api/health`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => setNeedsKey(json ? Boolean(json.auth) : null))
      .catch(() => setNeedsKey(null));
  }, [local]);

  if (!local) {
    return (
      <div className={`${card} p-5`}>
        <Note>Shortcuts send tasks to the Sage server on your Pi. This copy of the app isn't connected to it.</Note>
      </div>
    );
  }

  const endpoint = `${base}/api/quick-add`;
  const keyValue = key ? `Bearer ${key}` : 'Bearer YOUR_API_SECRET';
  const keyShown = key ? `Bearer ${'•'.repeat(8)}${key.slice(-4)}` : 'Bearer YOUR_API_SECRET';
  const sendsKey = needsKey !== false;

  const urlSteps = (n: number, input: string, source: string) => {
    const body = JSON.stringify({ text: input, source }, null, 2);
    return (
      <>
        <Step n={n} title={<>Add <Ui>Get Contents of URL</Ui> and paste this address as the URL.</>}>
          <CopyField label="URL" value={endpoint} />
        </Step>
        <Step n={n + 1} title={<>Tap the arrow on that action to show more. Set <Ui>Method</Ui> to <Ui>POST</Ui>.</>} />
        {sendsKey && (
          <Step n={n + 2} title={<>Under <Ui>Headers</Ui>, tap <Ui>Add new header</Ui>. Key <Ui>Authorization</Ui>, value below.</>}>
            <CopyField label="Header key" value="Authorization" />
            <CopyField label="Header value" value={keyValue} shown={keyShown} />
            {!key && <Note>This device doesn't have the server key yet. Paste the API_SECRET from /etc/sage/sage.env under Server &amp; Reset, then copy it from here.</Note>}
          </Step>
        )}
        <Step
          n={n + (sendsKey ? 3 : 2)}
          title={<>Set <Ui>Request Body</Ui> to <Ui>JSON</Ui> and add two Text fields: <Ui>text</Ui> set to the {input === 'Provided Input' ? <Ui>Provided Input</Ui> : <Ui>Shortcut Input</Ui>} variable, and <Ui>source</Ui> set to <Ui>{source}</Ui>.</>}
        >
          <CopyField label="What Sage receives" value={body} multiline />
        </Step>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`${card} p-5 space-y-3`}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-blue-500" />
          <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Add tasks without opening Sage</h4>
        </div>
        <Note>
          Everything you capture lands in your Inbox, or on its day if you give a date. It reads the same shorthand as Add Item:
          {' '}<code className="font-mono">tomorrow 3pm</code>, <code className="font-mono">#tag</code>, <code className="font-mono">!high</code>, <code className="font-mono">~30m</code>, <code className="font-mono">every monday</code>.
        </Note>
        <CopyField label="Your Sage address" value={base} />
        {!publicUrl && (
          <Note>This address only works on your home network. For Siri away from home, set up a public link (see Server &amp; Reset) and this guide will use it.</Note>
        )}
        <SendTest base={local} />
      </div>

      <Section
        icon={<Mic size={18} />} tint="bg-blue-50 dark:bg-blue-950/40 text-blue-600"
        title="Siri: “Add to Sage”" hint="iPhone, iPad, Mac and Apple Watch · about 2 minutes"
        open={open === 'siri'} onToggle={() => toggle('siri')}
      >
        <Steps>
          <Step n={1} title={<>Open the <Ui>Shortcuts</Ui> app, tap <Ui>+</Ui>, and name the shortcut <Ui>Add to Sage</Ui>.</>}>
            <Note>The name is what you say to Siri.</Note>
          </Step>
          <Step n={2} title={<>Add <Ui>Ask for Input</Ui>. Leave it on <Ui>Text</Ui> and set the prompt to “What do you need to do?”.</>} />
          {urlSteps(3, 'Provided Input', 'siri')}
          <Step n={sendsKey ? 7 : 6} title={<>Tap <Ui>Done</Ui>. Say “Hey Siri, Add to Sage”, then speak the task.</>}>
            <Note>Try “Call the dentist tomorrow at 3pm #health”. It shows up in Sage within a second.</Note>
          </Step>
        </Steps>
      </Section>

      <Section
        icon={<Share size={18} />} tint="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600"
        title="Share Sheet: send to Sage" hint="Save a link, an email or selected text from any app"
        open={open === 'share'} onToggle={() => toggle('share')}
      >
        <Steps>
          <Step n={1} title={<>In <Ui>Shortcuts</Ui>, tap <Ui>+</Ui> and name it <Ui>Send to Sage</Ui>.</>} />
          <Step n={2} title={<>Tap the <Ui>ⓘ</Ui> button at the bottom and turn on <Ui>Show in Share Sheet</Ui>.</>}>
            <Note>Set it to receive <Ui>Text</Ui> and <Ui>URLs</Ui>, then go back.</Note>
          </Step>
          {urlSteps(3, 'Shortcut Input', 'share-sheet')}
          <Step n={sendsKey ? 7 : 6} title={<>Tap <Ui>Done</Ui>. In Safari, Mail or Notes, tap <Ui>Share</Ui> and pick <Ui>Send to Sage</Ui>.</>}>
            <Note>Already made the Siri shortcut? Duplicate it and swap Ask for Input for Shortcut Input instead.</Note>
          </Step>
        </Steps>
      </Section>

      <Section
        icon={<MessageCircle size={18} />} tint="bg-green-50 dark:bg-green-950/40 text-green-600"
        title="WhatsApp: message to task" hint="Turn a plan or a work ask from a chat into an Inbox item"
        open={open === 'whatsapp'} onToggle={() => toggle('whatsapp')}
      >
        <Steps>
          <Step n={1} title={<>Make the <Ui>Send to Sage</Ui> shortcut above first.</>} />
          <Step n={2} title={<>In <Ui>Shortcuts</Ui>, press and hold it, tap <Ui>Duplicate</Ui>, and rename the copy <Ui>WhatsApp to Sage</Ui>.</>} />
          <Step n={3} title={<>Open the copy and change the <Ui>source</Ui> field to <Ui>whatsapp</Ui>.</>}>
            <CopyField label="What Sage receives" value={JSON.stringify({ text: 'Shortcut Input', source: 'whatsapp' }, null, 2)} multiline />
          </Step>
          <Step n={4} title={<>In WhatsApp, press and hold a message, tap <Ui>Forward</Ui>, tick any others you want, then tap <Ui>Share</Ui> at the bottom right and pick <Ui>WhatsApp to Sage</Ui>.</>}>
            <Note>
              The first message becomes the title and the whole chat goes in the item's notes, tagged <code className="font-mono">#whatsapp</code>.
              A day or time in that first message, like “friday 8pm”, sets the due date. Sage only sees what you send it.
            </Note>
          </Step>
          <Step n={5} title={<>To catch up on a whole chat, go to <Ui>Inbox</Ui> and tap <Ui>From WhatsApp</Ui>.</>}>
            <Note>Export the chat from WhatsApp (tap its name, then Export Chat, Without Media) and pick the file. Sage's AI lists the tasks, plans and milestones it finds, and you tick the ones to keep.</Note>
          </Step>
        </Steps>
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
