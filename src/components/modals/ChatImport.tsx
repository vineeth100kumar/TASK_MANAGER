// ChatImport.tsx - Read an exported WhatsApp chat for tasks, plans and
// milestones. The Pi's AI reads the chat (see /api/chat-import and
// chat_import.py) and suggests items; only the ones ticked here are saved.
import { useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Upload, X, Check, Flag, CalendarDays, CheckSquare } from 'lucide-react';
import { api } from '../../services/api';
import { piBackendUrl, piHeaders } from '../../services/piBackend';
import { formatDisplayDate } from '../../utils/dateUtils';
import { useToast } from '../../context/ToastContext';
import { LifeContext } from '../../services/types';

type Kind = 'task' | 'event' | 'milestone';

interface Suggestion {
  title: string;
  kind: Kind;
  date: string | null;
  time: string | null;
  who: string;
  quote: string;
  sent: string | null;
}

interface ReadResult {
  chatName: string;
  messageCount: number;
  totalMessages: number;
  engine: string;
  items: Suggestion[];
}

const KIND_LABEL: Record<Kind, { label: string; icon: ReactNode; tint: string }> = {
  task: { label: 'Task', icon: <CheckSquare size={11} />, tint: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300' },
  event: { label: 'Plan', icon: <CalendarDays size={11} />, tint: 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300' },
  milestone: { label: 'Milestone', icon: <Flag size={11} />, tint: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300' },
};

const ENGINE_LABEL: Record<string, string> = { groq: 'Groq', claude: 'Claude', local: "the Pi's own model" };

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalDateTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error("Couldn't open that file."));
    reader.readAsDataURL(file);
  });
}

// What the item looks like in Sage. Plans become events with an hour-long
// slot; anything without a date waits in the Inbox.
function toWorkItem(s: Suggestion, chatName: string, lifeContext?: LifeContext) {
  const from = [s.who && `From ${s.who}`, `in WhatsApp “${chatName}”`, s.sent && `on ${s.sent}`].filter(Boolean).join(' ');
  const base = {
    title: s.title,
    description: s.quote ? `${from}:\n“${s.quote}”` : from,
    labels: ['whatsapp'],
    isInbox: !s.date,
    ...(lifeContext ? { lifeContext } : {}),
  };
  if (s.kind === 'event' && s.date) {
    const startAt = `${s.date}T${s.time || '09:00'}`;
    const endAt = toLocalDateTime(new Date(new Date(startAt).getTime() + 60 * 60000));
    return { ...base, entityType: 'event' as const, type: 'meeting', startAt, endAt, startDate: s.date, dueDate: endAt.slice(0, 10) };
  }
  if (s.kind === 'milestone') {
    return { ...base, entityType: 'milestone' as const, type: 'milestone', dueDate: s.date };
  }
  return { ...base, entityType: 'task' as const, type: 'task', dueDate: s.date, dueTime: s.date ? s.time : null };
}

export function ChatImport({ lifeContext, onClose, onAdded }: { lifeContext?: LifeContext; onClose: () => void; onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [days, setDays] = useState(30);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const base = piBackendUrl();

  const read = async () => {
    if (!file) return;
    setReading(true);
    setError('');
    try {
      const res = await fetch(`${base}/api/chat-import`, {
        method: 'POST',
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fileName: file.name, dataBase64: await readAsBase64(file), days }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.detail || `The Pi said ${res.status}.`);
      setResult(json);
      setPicked(new Set(json.items.map((_: Suggestion, i: number) => i)));
    } catch (err: any) {
      setError(err.message || "Couldn't read the chat.");
    } finally {
      setReading(false);
    }
  };

  const add = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const chosen = result.items.filter((_, i) => picked.has(i));
      for (const s of chosen) await api.workItems.create(toWorkItem(s, result.chatName, lifeContext));
      showToast(chosen.length === 1 ? '1 item added from WhatsApp' : `${chosen.length} items added from WhatsApp`);
      onAdded();
      onClose();
    } catch (err: any) {
      showToast(err.message || "Couldn't add them", 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (i: number) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="w-full max-w-lg mx-4 mb-4 sm:mb-0 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
        role="dialog" aria-label="Read a WhatsApp chat"
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="w-9 h-9 rounded-xl bg-green-50 dark:bg-green-950/40 text-green-600 flex items-center justify-center">
            <MessageCircle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white">Read a WhatsApp chat</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {result ? `${result.chatName} · ${result.messageCount} messages read by ${ENGINE_LABEL[result.engine] || result.engine}` : 'Sage finds the tasks, plans and milestones in it'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="px-5 pb-4 overflow-y-auto space-y-3">
          {!base ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">This needs the Sage server on your Pi, and this copy of the app isn't connected to it.</p>
          ) : !result ? (
            <>
              <ol className="text-[13px] text-gray-600 dark:text-gray-300 space-y-1.5 list-decimal pl-5">
                <li>In WhatsApp, open the chat or group and tap its name at the top.</li>
                <li>Tap <b>Export Chat</b>, then <b>Without Media</b>, then <b>Save to Files</b>.</li>
                <li>Pick that file here.</li>
              </ol>
              <input ref={input} type="file" accept=".zip,.txt,application/zip,text/plain" className="hidden"
                onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }} />
              <button type="button" onClick={() => input.current?.click()}
                className="w-full px-4 py-3 rounded-xl border border-dashed border-black/15 dark:border-white/15 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 flex items-center justify-center gap-2">
                <Upload size={15} /> {file ? file.name : 'Choose the exported chat'}
              </button>
              <label className="flex items-center justify-between text-[13px] text-gray-600 dark:text-gray-300">
                Read messages from
                <select value={days} onChange={e => setDays(Number(e.target.value))}
                  className="ml-3 px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-white/5 border border-black/10 dark:border-white/10 text-[13px]">
                  <option value={7}>the last week</option>
                  <option value={30}>the last month</option>
                  <option value={90}>the last 3 months</option>
                  <option value={0}>the whole chat</option>
                </select>
              </label>
              <p className="text-[11.5px] text-gray-400">
                The chat goes to your Pi and the AI it uses, and isn't kept. Only what you tick next is saved.
              </p>
            </>
          ) : result.items.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Nothing to do or plan in this chat{days ? ' for that period' : ''}.</p>
          ) : (
            <ul className="space-y-2">
              {result.items.map((s, i) => {
                const k = KIND_LABEL[s.kind] || KIND_LABEL.task;
                const on = picked.has(i);
                return (
                  <li key={i}>
                    <button type="button" onClick={() => toggle(i)} aria-pressed={on}
                      className={`w-full text-left flex gap-3 p-3 rounded-xl border transition-colors ${on ? 'border-blue-500/40 bg-blue-50/60 dark:bg-blue-950/20' : 'border-black/5 dark:border-white/10 opacity-60'}`}>
                      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center ${on ? 'bg-blue-600 text-white' : 'border border-black/20 dark:border-white/20'}`}>
                        {on && <Check size={13} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13.5px] font-medium text-gray-900 dark:text-white">{s.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5 mt-1 text-[11.5px] text-gray-500 dark:text-gray-400">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-medium ${k.tint}`}>{k.icon}{k.label}</span>
                          {s.date ? <span>{formatDisplayDate(s.date)}{s.time ? ` · ${s.time}` : ''}</span> : <span>No date, goes to Inbox</span>}
                          {s.who && <span>· {s.who}</span>}
                        </span>
                        {s.quote && <span className="block mt-1 text-[12px] text-gray-500 dark:text-gray-400 italic line-clamp-2">“{s.quote}”</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
        </div>

        {base && (
          <div className="px-5 py-4 border-t border-black/5 dark:border-white/5 flex gap-2 justify-end">
            {result ? (
              <>
                <button onClick={() => { setResult(null); setFile(null); }} className="px-4 py-2 rounded-xl text-[13px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">Another chat</button>
                <button onClick={add} disabled={saving || picked.size === 0}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-blue-600 text-white disabled:opacity-50">
                  {saving ? 'Adding…' : `Add ${picked.size} to Sage`}
                </button>
              </>
            ) : (
              <button onClick={read} disabled={!file || reading}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-blue-600 text-white disabled:opacity-50">
                {reading ? 'Reading the chat…' : 'Read chat'}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
