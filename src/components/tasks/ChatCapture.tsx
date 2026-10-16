import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Bell, Calendar, Check, Clock, Flag, Loader2, Pencil, Repeat, RotateCcw, Sparkles, Tag, X } from 'lucide-react';
import { api } from '../../services/api';
import { aiEngine } from '../../services/aiEngine';
import { Project, Area, WorkItem, LifeContext } from '../../services/types';
import { getLifeMode } from '../../services/lifeMode';
import { Select } from '../common/Select';
import { DatePicker } from '../common/DatePicker';
import { TimePicker } from '../common/TimePicker';
import {
  CaptureCard, CaptureContext, CardChange, CardKind, buildCards, mergeAiItems, looksLikeEdit, localEdit,
  applyChanges, newItemPayload, matchUpdates, timesPerWeek,
} from '../../utils/chatCapture';
import { formatShortDate } from '../../utils/quickAddParser';
import { projectTypeInfo } from '../../services/projectTypes';
import { formatTime } from '../../utils/reminders';

const KINDS: CardKind[] = ['task', 'reminder', 'event', 'habit'];
const PRIORITY_CYCLE = ['medium', 'high', 'urgent', 'low'] as const;
const AI_TIMEOUT_MS = 15000;

const COLOR_HEX: Record<string, string> = {
  'bg-blue-500': '#3b82f6', 'bg-purple-500': '#a855f7', 'bg-pink-500': '#ec4899', 'bg-amber-500': '#f59e0b',
  'bg-green-500': '#22c55e', 'bg-emerald-500': '#10b981', 'bg-red-500': '#ef4444', 'bg-orange-500': '#f97316',
  'bg-teal-500': '#14b8a6', 'bg-indigo-500': '#6366f1', 'bg-gray-500': '#6b7280', 'bg-cyan-500': '#06b6d4',
};
const dotColor = (c?: string) => (c?.startsWith('#') ? c : COLOR_HEX[c || ''] || '#9ca3af');

type Saved =
  | { kind: 'created'; id: string }
  | { kind: 'habit'; id: string }
  | { kind: 'updated'; id: string; before: Partial<WorkItem> };

type Turn =
  | { id: string; role: 'me'; text: string }
  | { id: string; role: 'sage'; text: string; batch?: string; undo?: () => Promise<void>; undone?: boolean };

interface Batch { id: string; cards: CaptureCard[]; saved: Record<string, Saved> | null; checking: boolean; touched: boolean }

let turnSeq = 0;
const tid = () => `t${++turnSeq}`;

interface ChatCaptureProps {
  lifeContext: LifeContext;
  projects: Project[];
  areas: Area[];
  onChanged: () => void;
  onOpenForm: (text: string) => void;
}

export function ChatCapture({ lifeContext, projects, areas, onChanged, onOpenForm }: ChatCaptureProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [batches, setBatches] = useState<Record<string, Batch>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastBatch = useRef<string | null>(null);
  const batchesRef = useRef(batches);
  batchesRef.current = batches;

  const loadItems = () => api.workItems.list().then(list => setItems(list.filter(i => i && i.status !== 'done' && !i.deletedAt)));
  useEffect(() => {
    loadItems();
    api.workItems.allTags().then(t => setTags(t.map(x => x.tag)));
    // Is the Pi there to ask? Without it the parser and matcher still work.
    aiEngine.chatCaptureEngine().then(() => setAiReady(true)).catch(() => setAiReady(false));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns, batches]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, []);

  const ctx: CaptureContext = useMemo(() => ({ projects, areas, items, tags, lifeContext }), [projects, areas, items, tags, lifeContext]);
  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name || '';
  const areaName = (id: string | null) => areas.find(a => a.id === id)?.name || '';

  const aiLists = () => ({
    today: new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    projects: projects.map(p => ({ id: p.id, name: p.name, key: p.key || '', type: projectTypeInfo(p).label, branches: (p.branches || []).filter(b => !b.mergedAt).map(b => ({ id: b.id, name: b.name })) })),
    areas: areas.map(a => ({ id: a.id, name: a.name })),
    openItems: items.filter(i => !(i.labels || []).includes('alarm')).slice(0, 60).map(i => ({ id: i.id, key: i.key, title: i.title, project: projectName(i.projectId || null) || areaName(i.areaId || null) })),
    tags: tags.slice(0, 40),
  });

  const askAi = async (payload: any) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    try { return await aiEngine.chatCapture(payload, ctrl.signal); } finally { clearTimeout(timer); }
  };

  const setBatch = (id: string, fn: (b: Batch) => Batch) => setBatches(prev => (prev[id] ? { ...prev, [id]: fn(prev[id]) } : prev));
  const say = (text: string, extra: Partial<Turn> = {}) => setTurns(t => [...t, { id: tid(), role: 'sage', text, ...extra } as Turn]);

  // --- Saving, and taking it back ---

  const commit = async (c: CaptureCard): Promise<Saved> => {
    if (c.kind === 'habit') {
      const h = await api.habits.create({ name: c.title, targetCount: timesPerWeek(c.repeatRule), areaId: c.lifeContext === 'personal' ? c.areaId : null });
      return { kind: 'habit', id: h.id };
    }
    const item = c.match && c.useMatch ? items.find(i => i.id === c.match!.id) : null;
    if (item) {
      const updates = matchUpdates(c, item);
      const before: any = {};
      for (const k of Object.keys(updates)) before[k] = (item as any)[k] ?? null;
      await api.workItems.updateDetails(item.id, updates);
      return { kind: 'updated', id: item.id, before };
    }
    const created = await api.workItems.create(newItemPayload(c));
    return { kind: 'created', id: created.id };
  };
  const uncommit = async (s: Saved) => {
    if (s.kind === 'habit') await api.habits.delete(s.id);
    else if (s.kind === 'created') await api.workItems.softDelete(s.id);
    else await api.workItems.updateDetails(s.id, s.before);
  };
  // A saved card that changed: edit what it made in place where that's the same kind of thing.
  const recommit = async (s: Saved | undefined, c: CaptureCard): Promise<Saved | undefined> => {
    if (!c.include) { if (s) await uncommit(s); return undefined; }
    if (s?.kind === 'created' && c.kind !== 'habit' && !(c.match && c.useMatch)) {
      await api.workItems.updateDetails(s.id, newItemPayload(c));
      return s;
    }
    if (s) await uncommit(s);
    return commit(c);
  };

  const saveBatch = async (batchId: string) => {
    const b = batchesRef.current[batchId];
    if (!b || b.saved || busy) return;
    setBusy(true);
    const saved: Record<string, Saved> = {};
    try {
      for (const c of b.cards) if (c.include) saved[c.id] = await commit(c);
    } catch (e: any) {
      for (const s of Object.values(saved)) await uncommit(s).catch(() => {});
      say(`Couldn't save: ${e?.message || e}. Nothing was kept.`);
      setBusy(false);
      return;
    }
    setBatch(batchId, x => ({ ...x, saved }));
    const all = Object.values(saved);
    const updated = all.filter(s => s.kind === 'updated').length;
    const habits = all.filter(s => s.kind === 'habit').length;
    const undo = async () => {
      for (const s of all) await uncommit(s).catch(() => {});
      setBatch(batchId, x => ({ ...x, saved: null }));
      onChanged(); loadItems();
    };
    // Chill hides work: say so, so a saved work item isn't taken for lost.
    const hiddenWork = getLifeMode().mode === 'chill'
      ? b.cards.filter(c => c.include && c.kind !== 'habit' && c.lifeContext !== 'personal').length : 0;
    say(`Saved ${all.length} item${all.length === 1 ? '' : 's'}${updated ? ` · ${updated} updated` : ''}${habits ? ` · ${habits} habit${habits === 1 ? '' : 's'}` : ''}${hiddenWork ? ` · ${hiddenWork} work, hidden while you're in Chill` : ''}`, { batch: batchId, undo });
    onChanged(); loadItems();
    setBusy(false);
  };

  // --- Messages ---

  const editBatch = async (batchId: string, message: string) => {
    const b = batchesRef.current[batchId];
    let changes: CardChange[] | null = localEdit(message, b.cards, ctx);
    let aiSaid = '';
    if (!changes && aiReady !== false) {
      try {
        const res = await askAi({
          mode: 'edit', message, ...aiLists(),
          cards: b.cards.map(c => ({
            title: c.title, kind: c.kind, project: projectName(c.projectId), area: areaName(c.areaId),
            branch: projects.find(p => p.id === c.projectId)?.branches?.find(x => x.id === c.branchId)?.name || '',
            context: c.lifeContext, priority: c.priority,
            when: [c.date && formatShortDate(c.date), c.time && formatTime(c.time), c.repeatLabel].filter(Boolean).join(' '),
          })),
        });
        changes = (res.changes || []) as CardChange[];
        aiSaid = res.reply || '';
      } catch { /* no AI: say so below */ }
    }
    if (!changes || changes.length === 0) {
      say(`I didn't catch what to change. Name the item, like "make gym high priority", or tap a chip on the card.`);
      return;
    }
    const { cards, said } = applyChanges(b.cards, changes, ctx);
    if (!b.saved) {
      setBatch(batchId, x => ({ ...x, cards, touched: true }));
      say(aiSaid || said || 'Done.');
      return;
    }
    // Already saved: change the records too, with an Undo for just this.
    setBusy(true);
    const before = b.cards;
    const prevSaved = { ...b.saved };
    const nextSaved = { ...b.saved };
    try {
      for (const ch of changes) {
        const c = cards[ch.card];
        if (!c) continue;
        const s = await recommit(nextSaved[c.id], c);
        if (s) nextSaved[c.id] = s; else delete nextSaved[c.id];
      }
    } catch (e: any) {
      say(`Couldn't change it: ${e?.message || e}`);
      setBusy(false);
      return;
    }
    setBatch(batchId, x => ({ ...x, cards, saved: nextSaved }));
    const undo = async () => {
      const restored: Record<string, Saved> = {};
      for (const c of before) {
        const s = await recommit(nextSaved[c.id], { ...c, include: !!prevSaved[c.id] }).catch(() => undefined);
        if (s) restored[c.id] = s;
      }
      setBatch(batchId, x => ({ ...x, cards: before, saved: restored }));
      onChanged(); loadItems();
    };
    say(aiSaid || said || 'Done.', { undo });
    onChanged(); loadItems();
    setBusy(false);
  };

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    setTurns(t => [...t, { id: tid(), role: 'me', text: message }]);
    const last = lastBatch.current ? batchesRef.current[lastBatch.current] : null;
    if (last && looksLikeEdit(message)) { await editBatch(last.id, message); return; }

    const cards = buildCards(message, ctx);
    if (cards.length === 0) { say(`Tell me what to add, like "call Sam tomorrow 5pm".`); return; }
    const batchId = `b${Date.now()}`;
    lastBatch.current = batchId;
    const unsure = cards.some(c => c.unsure) || cards.length === 1 && /\b(?:and|also)\b/i.test(message) && message.length > 60;
    const checking = unsure && aiReady !== false;
    setBatches(prev => ({ ...prev, [batchId]: { id: batchId, cards, saved: null, checking, touched: false } }));
    setTurns(t => [...t, { id: tid(), role: 'sage', text: '', batch: batchId }]);
    if (!checking) return;
    try {
      const res = await askAi({ mode: 'split', message, ...aiLists() });
      if (res.items?.length) {
        const merged = mergeAiItems(res.items, ctx);
        setBatch(batchId, b => (b.touched || b.saved ? { ...b, checking: false } : { ...b, cards: merged.length ? merged : b.cards, checking: false }));
        return;
      }
    } catch { /* keep what the parser found */ }
    setBatch(batchId, b => ({ ...b, checking: false }));
  };

  const updateCard = (batchId: string, cardId: string, patch: Partial<CaptureCard>) =>
    setBatch(batchId, b => ({ ...b, touched: true, cards: b.cards.map(c => (c.id === cardId ? { ...c, ...patch } : c)) }));

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const last = lastBatch.current ? batchesRef.current[lastBatch.current] : null;
      // Enter on an empty box saves the cards waiting below.
      if (!input.trim() && last && !last.saved) saveBatch(last.id);
      else send();
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <ContextStrip projects={projects} areas={areas} openCount={items.filter(i => !(i.labels || []).includes('alarm')).length} />
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-6 pt-4 pb-2 space-y-3.5 min-h-[260px]" aria-live="polite">
        {turns.length === 0 && <EmptyHints onPick={t => { setInput(t); inputRef.current?.focus(); }} />}
        {turns.map(t => t.role === 'me' ? (
          <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="ml-auto max-w-[85%] sm:max-w-[78%] w-fit bg-blue-600 text-white px-3.5 py-2.5 rounded-[18px] rounded-br-md text-[14px] leading-snug font-medium whitespace-pre-wrap">
            {t.text}
          </motion.div>
        ) : t.batch && !t.text ? (
          <BatchTurn key={t.id} batch={batches[t.batch]} projects={projects} areas={areas} busy={busy}
            onSave={() => saveBatch(t.batch!)} onCard={(cid, patch) => updateCard(t.batch!, cid, patch)}
            onOpenForm={onOpenForm} />
        ) : (
          <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 items-start">
            <SageMark />
            <div className="pt-1 text-[13.5px] leading-snug text-gray-600 dark:text-gray-300 flex flex-wrap items-center gap-x-2">
              {t.undo ? <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900 dark:text-white"><Check size={14} className="text-green-600 dark:text-green-400" /> {t.text}</span> : t.text}
              {t.undo && !t.undone && (
                <button type="button" onClick={async () => { await t.undo!(); setTurns(ts => ts.map(x => (x.id === t.id ? { ...x, undone: true } as Turn : x))); }}
                  className="text-blue-600 dark:text-blue-400 font-semibold hover:underline inline-flex items-center gap-1"><RotateCcw size={12} /> Undo</button>
              )}
              {t.undone && <span className="text-gray-400">Undone</span>}
            </div>
          </motion.div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-1 shrink-0">
        <div className="flex items-end gap-2 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] pl-3.5 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-blue-500/40">
          <textarea ref={inputRef} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
            aria-label="Tell Sage what to add" placeholder="Tell Sage what's on your mind…"
            className="flex-1 resize-none bg-transparent outline-none text-[14px] py-2 max-h-32 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            style={{ fieldSizing: 'content' } as any} />
          <button type="button" onClick={send} disabled={!input.trim() || busy} aria-label="Send"
            className="h-9 w-9 shrink-0 rounded-xl bg-blue-600 text-white grid place-items-center disabled:opacity-40 active:scale-95 transition">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5 px-1 hidden sm:block">Enter sends · Enter again saves · reply to change anything</p>
      </div>
    </div>
  );
}

function SageMark() {
  return <span className="h-7 w-7 shrink-0 rounded-[9px] bg-[#0f1f3d] dark:bg-[#3a3a3c] text-white grid place-items-center text-[12px] font-extrabold" aria-hidden>S</span>;
}

function ContextStrip({ projects, areas, openCount }: { projects: Project[]; areas: Area[]; openCount: number }) {
  const branches = projects.reduce((n, p) => n + (p.branches || []).filter(b => !b.mergedAt).length, 0);
  return (
    <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2 border-b border-gray-100 dark:border-white/5 overflow-x-auto no-scrollbar text-[11px] shrink-0">
      <span className="font-semibold text-gray-500 dark:text-gray-400 shrink-0">Sage knows</span>
      {projects.slice(0, 5).map(p => (
        <span key={p.id} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 font-semibold">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor(p.color) }} />{p.name}
        </span>
      ))}
      {areas.slice(0, 4).map(a => (
        <span key={a.id} className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 font-semibold">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor(a.color) }} />{a.name}
        </span>
      ))}
      <span className="shrink-0 text-gray-400">{branches ? `${branches} branches · ` : ''}{openCount} open items</span>
    </div>
  );
}

function EmptyHints({ onPick }: { onPick: (t: string) => void }) {
  const hints = [
    'tmrw 10am call the vendor about the ci4 sonar parts',
    'remind me to pay rent on the 1st every month',
    'gym mon wed fri 7am',
  ];
  return (
    <div className="py-6 text-center">
      <div className="mx-auto mb-3 h-10 w-10 rounded-2xl bg-blue-50 dark:bg-blue-500/10 grid place-items-center text-blue-600 dark:text-blue-400"><Sparkles size={18} /></div>
      <p className="text-[14px] font-semibold text-gray-900 dark:text-white">Type it the way you'd say it</p>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 mt-1">Several things at once is fine. You'll see each one before it saves.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {hints.map(h => (
          <button key={h} type="button" onClick={() => onPick(h)} className="text-[12px] font-medium px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10">{h}</button>
        ))}
      </div>
    </div>
  );
}

function BatchTurn({ batch, projects, areas, busy, onSave, onCard, onOpenForm }: {
  batch: Batch | undefined; projects: Project[]; areas: Area[]; busy: boolean;
  onSave: () => void; onCard: (cardId: string, patch: Partial<CaptureCard>) => void; onOpenForm: (text: string) => void;
}) {
  if (!batch) return null;
  const included = batch.cards.filter(c => c.include);
  const updates = included.filter(c => c.match && c.useMatch).length;
  const intro = `Got it. ${batch.cards.length} item${batch.cards.length === 1 ? '' : 's'}${updates ? `, ${updates === 1 ? '1 already exists so I’ll update it' : `${updates} already exist so I’ll update those`} instead of adding a copy` : ''}.`;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 items-start">
      <SageMark />
      <div className="flex-1 min-w-0">
        <p className="pt-1 text-[13.5px] leading-snug text-gray-600 dark:text-gray-300">{intro}</p>
        {batch.checking && (
          <p className="mt-1 text-[11.5px] text-gray-400 inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Checking the unclear bits with Groq…</p>
        )}
        <div className={`mt-2.5 space-y-2 ${batch.saved ? 'opacity-80' : ''}`}>
          <AnimatePresence initial={false}>
            {batch.cards.map(c => (
              <CardView key={c.id} card={c} projects={projects} areas={areas} locked={!!batch.saved}
                onChange={patch => onCard(c.id, patch)} />
            ))}
          </AnimatePresence>
        </div>
        {!batch.saved && (
          <div className="flex items-center gap-2 mt-2.5">
            <button type="button" onClick={onSave} disabled={busy || included.length === 0}
              className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-semibold disabled:opacity-40 active:scale-[0.97] transition inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {included.length === 1 ? 'Save' : `Save all ${included.length}`}
            </button>
            {batch.cards.length === 1 && (
              <button type="button" onClick={() => onOpenForm(batch.cards[0].text)} className="h-9 px-3 rounded-xl text-[13px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">Edit in form</button>
            )}
            <span className="ml-auto text-[11px] text-gray-400 hidden sm:block">Tap any chip to change it</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors';
const chipBlue = `${chip} bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/70`;
const chipGray = `${chip} bg-gray-100 dark:bg-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/[0.12]`;

function CardView({ card: c, projects, areas, locked, onChange }: {
  card: CaptureCard; projects: Project[]; areas: Area[]; locked: boolean; onChange: (patch: Partial<CaptureCard>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const project = projects.find(p => p.id === c.projectId);
  const branch = project?.branches?.find(b => b.id === c.branchId);
  const area = areas.find(a => a.id === c.areaId);
  const personal = c.lifeContext === 'personal';
  const placeValue = personal ? (area ? `a:${area.id}` : '') : project ? (branch ? `b:${project.id}:${branch.id}` : `p:${project.id}`) : '';
  const setPlace = (v: string) => {
    const [kind, id, bid] = v.split(':');
    if (kind === 'p') onChange({ projectId: id, branchId: null, areaId: null, lifeContext: 'work', unsure: false });
    else if (kind === 'b') onChange({ projectId: id, branchId: bid, areaId: null, lifeContext: 'work', unsure: false });
    else if (kind === 'a') onChange({ areaId: id, projectId: null, branchId: null, lifeContext: 'personal', unsure: false });
    else onChange({ projectId: null, branchId: null, areaId: null });
  };
  const placeColor = personal ? area?.color : branch?.color || project?.color;
  const nextKind = KINDS[(KINDS.indexOf(c.kind) + 1) % KINDS.length];
  const WhenIcon = c.kind === 'reminder' ? Bell : Calendar;

  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className={`rounded-2xl border px-3 py-2.5 flex gap-2.5 bg-white dark:bg-[#2c2c2e] ${c.include ? 'border-gray-200 dark:border-white/[0.08]' : 'border-dashed border-gray-200 dark:border-white/10 opacity-50'}`}>
      <button type="button" disabled={locked} onClick={() => onChange({ include: !c.include })} aria-pressed={c.include} aria-label={c.include ? `Leave out ${c.title}` : `Include ${c.title}`}
        className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-md grid place-items-center ${c.include ? 'bg-blue-600 text-white' : 'ring-[1.5px] ring-inset ring-gray-300 dark:ring-white/25'}`}>
        {c.include && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" disabled={locked} onClick={() => onChange({ kind: nextKind })} title={`Make it a ${nextKind}`}
            className="text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-blue-600 shrink-0">{c.kind}</button>
          {editing ? (
            <input autoFocus defaultValue={c.title} onBlur={e => { onChange({ title: e.target.value.trim() || c.title }); setEditing(false); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
              className="flex-1 min-w-0 text-[14px] font-semibold bg-transparent outline-none border-b border-blue-500 text-gray-900 dark:text-white" />
          ) : (
            <span className="flex-1 min-w-0 truncate text-[14px] font-semibold text-gray-900 dark:text-white">{c.title}</span>
          )}
          {!locked && !editing && <button type="button" onClick={() => setEditing(true)} aria-label="Rename" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0"><Pencil size={13} /></button>}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <Select value={placeValue} onChange={setPlace} disabled={locked} aria-label="Where it goes"
            className={`${chipGray} !gap-1 ${c.unsure ? 'ring-1 ring-amber-400/70' : ''}`}
            icon={<span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor(placeColor) }} />}>
            <option value="">{personal ? 'No area' : 'No project (Inbox)'}</option>
            {!personal && projects.map(p => (
              <optgroup key={p.id} label={p.name}>
                <option value={`p:${p.id}`}>{p.name}</option>
                {(p.branches || []).filter(b => !b.mergedAt || b.id === c.branchId).map(b => <option key={b.id} value={`b:${p.id}:${b.id}`}>{p.name} › {b.name}</option>)}
              </optgroup>
            ))}
            {areas.length > 0 && <optgroup label="Personal areas">{areas.map(a => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>}
          </Select>
          <button type="button" disabled={locked} onClick={() => onChange({ lifeContext: personal ? 'work' : 'personal', ...(personal ? { areaId: null } : { projectId: null, branchId: null }) })}
            className={personal ? `${chip} bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300` : chipGray}>{personal ? 'Personal' : 'Work'}</button>
          {c.kind !== 'habit' && <>
          <DatePicker value={c.date} onChange={d => onChange({ date: d || null })} disabled={locked} aria-label="Day" className={c.date ? chipBlue : chipGray}>
            <WhenIcon size={10} /> {c.date ? formatShortDate(c.date) : 'No date'}
          </DatePicker>
          {(c.date || c.time) && (
            <TimePicker value={c.time} onChange={t => onChange({ time: t || null })} disabled={locked} aria-label="Time" className={c.time ? chipBlue : chipGray}>
              <Clock size={10} /> {c.time ? formatTime(c.time) : 'Any time'}
            </TimePicker>
          )}
          </>}
          {c.repeatLabel && (
            <span className={`${chip} bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300`}>
              <Repeat size={10} /> {c.repeatLabel}
              {!locked && <button type="button" aria-label="Don't repeat" onClick={() => onChange({ repeatRule: null, repeatLabel: null })}><X size={10} /></button>}
            </span>
          )}
          {c.kind !== 'habit' && (
            <button type="button" disabled={locked} title="Change priority"
              onClick={() => onChange({ priority: PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(c.priority as any) + 1) % PRIORITY_CYCLE.length], priorityGiven: true })}
              className={c.priority === 'urgent' ? `${chip} bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300` : c.priority === 'high' ? `${chip} bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300` : chipGray}>
              <Flag size={10} /> {c.priority[0].toUpperCase() + c.priority.slice(1)}
            </button>
          )}
          {c.durationMinutes ? <span className={chipGray}>~{c.durationMinutes >= 60 ? `${Math.round(c.durationMinutes / 6) / 10}h` : `${c.durationMinutes}m`}</span> : null}
          {c.tags.map(t => <span key={t} className={`${chip} bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300`}><Tag size={10} />#{t}</span>)}
        </div>
        {c.match && c.kind !== 'habit' && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-amber-50 dark:bg-amber-900/25 text-amber-800 dark:text-amber-300 px-2.5 py-1.5 text-[11.5px] font-semibold">
            <span className="min-w-0 flex-1 basis-44 flex gap-1.5"><RotateCcw size={12} className="shrink-0 mt-0.5" /><span>{c.match.isInbox ? 'In your Inbox' : 'Already in Sage'} as {c.match.key} <span className="font-medium opacity-80">· {c.match.title}</span></span></span>
            <span className="ml-auto flex rounded-lg bg-white/60 dark:bg-black/20 p-0.5 gap-0.5 shrink-0">
              {[{ v: true, l: c.match.isInbox ? 'Schedule it' : 'Update it' }, { v: false, l: 'New item' }].map(o => (
                <button key={o.l} type="button" disabled={locked} onClick={() => onChange({ useMatch: o.v })}
                  className={`px-2 py-0.5 rounded-md text-[10.5px] whitespace-nowrap ${c.useMatch === o.v ? 'bg-white dark:bg-[#3a3a3c] text-gray-900 dark:text-white shadow-sm' : ''}`}>{o.l}</button>
              ))}
            </span>
          </div>
        )}
        {c.kind === 'habit' && <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Saves as a habit, {timesPerWeek(c.repeatRule)}× a week.</p>}
        {c.unsure && <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">Not sure where this goes. Pick a place, or it lands in your {personal ? 'list' : 'Inbox'}.</p>}
        {c.why.length > 0 && <p className="mt-1.5 text-[10.5px] text-gray-400 truncate">{c.why.join(' · ')}</p>}
      </div>
    </motion.div>
  );
}
