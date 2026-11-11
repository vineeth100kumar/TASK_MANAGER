import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { GitBranch, GitMerge, ArrowUp, X, Trash2, CornerDownRight, Plus, ListTree, Network, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '../../services/api';
import { Note, Thought, ThoughtStatus } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { getTodayString } from '../../utils/dateUtils';
import { formatShortDate } from '../../utils/quickAddParser';
import { Select } from '../common/Select';
import {
  STATUSES, STATUS_NAMES, MAIN_COLOR, ThoughtFlow, ThoughtRow, buildThoughtFlow, countStatuses,
  isSettled, nextStatus, parseThought, rootTopics, splitLines, statusOf, topicsOf,
} from './thoughtMap';
import { ThoughtTree } from './ThoughtTree';

type MapView = 'timeline' | 'tree';
const VIEW_KEY = 'sage.mapView';

const ROW_H = 58;
const SLIM_H = 32;
// Lanes sit closer together on a phone so the thoughts keep their room.
interface Geo { laneW: number; pad: number }
const WIDE: Geo = { laneW: 18, pad: 12 };
const NARROW: Geo = { laneW: 11, pad: 9 };
const laneX = (g: Geo, lane: number) => g.pad + lane * g.laneW;
const gutter = (g: Geo, flow: ThoughtFlow) => g.pad * 2 + (flow.laneCount - 1) * g.laneW;

function useWide(): boolean {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}
const NEW_TOPIC = '__new__';

const STATUS_COLORS: Record<ThoughtStatus, string> = { open: '#9ca3af', unsure: '#f59e0b', good: '#16a34a', bad: '#dc2626' };

/** The status icon: an empty dashed ring (open), half full (unsure), full (settled). */
export function ThoughtIcon({ status, size = 22 }: { status: ThoughtStatus; size?: number }) {
  const c = STATUS_COLORS[status];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label={STATUS_NAMES[status]} role="img" className="shrink-0">
      {status === 'open' && <>
        <circle cx="12" cy="12" r="10" fill="none" stroke={c} strokeWidth="2" strokeDasharray="4 3" />
        <path d="M9.4 9.3a2.7 2.7 0 1 1 3.8 2.5c-.7.3-1.2.9-1.2 1.6v.5" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.1" fill={c} />
      </>}
      {status === 'unsure' && <>
        <circle cx="12" cy="12" r="10" className="fill-white dark:fill-[#1c1c1e]" stroke={c} strokeWidth="2" />
        <path d="M12 2a10 10 0 0 0 0 20z" fill={c} />
        <path d="M5.5 13c1.6-2.6 3.2-2.6 4.8 0s3.2 2.6 4.8 0 2.4-2 3.4-.7" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" />
      </>}
      {status === 'good' && <>
        <circle cx="12" cy="12" r="11" fill={c} />
        <path d="M7 12.4l3.3 3.3L17 9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {status === 'bad' && <>
        <circle cx="12" cy="12" r="11" fill={c} />
        <path d="M8.3 8.3l7.4 7.4M15.7 8.3l-7.4 7.4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </>}
    </svg>
  );
}

/** The coloured bar under a map: holds up, doesn't hold, unsure, open. */
export function StatusBar({ thoughts, className = '' }: { thoughts: Thought[]; className?: string }) {
  const c = countStatuses(thoughts);
  if (thoughts.length === 0) return <div className={`h-1.5 rounded-full bg-black/[0.06] dark:bg-white/10 ${className}`} />;
  return (
    <div className={`flex h-1.5 gap-0.5 rounded-full overflow-hidden ${className}`} aria-hidden>
      {(['good', 'bad', 'unsure', 'open'] as ThoughtStatus[]).map(s => c[s] > 0 && (
        <span key={s} style={{ flex: c[s], background: s === 'open' ? undefined : STATUS_COLORS[s] }}
          className={s === 'open' ? 'bg-gray-300 dark:bg-white/15' : ''} />
      ))}
    </div>
  );
}

interface Props {
  map: Note;
}

/**
 * A thought map: every thought on a decision in the order it came, each with
 * an icon for how far it's been worked out, and topics branching off the main
 * line like a project's branches.
 */
export function ThoughtMapView({ map }: Props) {
  const { showToast } = useToast();
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [statusFilter, setStatusFilter] = useState<ThoughtStatus | null>(null);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const wide = useWide();
  const geo = wide ? WIDE : NARROW;
  const [view, setViewState] = useState<MapView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'timeline'; } catch { return 'timeline'; }
  });
  const setView = (v: MapView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };

  // Full screen: the real Fullscreen API where there is one, a fixed overlay otherwise (iPhone Safari). Esc exits either way.
  useEffect(() => {
    if (!full) return;
    try { root.current?.requestFullscreen?.()?.catch(() => {}); } catch { /* the overlay is enough */ }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [full]);
  useEffect(() => setFull(false), [map.id]);

  const load = async () => setThoughts(await api.thoughts.list(map.id));
  useEffect(() => { setStatusFilter(null); setTopicFilter(null); setOpenId(null); load(); }, [map.id]);
  useDataChanges(load);

  const topics = useMemo(() => topicsOf(thoughts), [thoughts]);
  const counts = useMemo(() => countStatuses(thoughts), [thoughts]);
  // A point under a thought belongs to that thought's topic, even with none of its own.
  const rootTopic = useMemo(() => rootTopics(thoughts), [thoughts]);
  const shown = useMemo(() => thoughts.filter(t =>
    (!statusFilter || statusOf(t) === statusFilter) &&
    (!topicFilter || (rootTopic.get(t.id) || '').toLowerCase() === topicFilter.toLowerCase())
  ), [thoughts, statusFilter, topicFilter, rootTopic]);
  const flow = useMemo(() => buildThoughtFlow(shown, topics), [shown, topics]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    thoughts.forEach(t => t.parentId && m.set(t.parentId, (m.get(t.parentId) || 0) + 1));
    return m;
  }, [thoughts]);
  const settled = counts.good + counts.bad;
  const open = thoughts.find(t => t.id === openId) || null;

  const cycle = async (t: Thought) => {
    const to = nextStatus(statusOf(t));
    setThoughts(prev => prev.map(x => x.id === t.id ? { ...x, status: to } : x));
    await api.thoughts.update(t.id, { status: to });
  };

  const add = async (lines: { text: string; status: ThoughtStatus; topic: string; parentId?: string | null }[]) => {
    for (const l of lines) await api.thoughts.create(map.id, l);
    await load();
    if (lines.length > 1) showToast(`Added ${lines.length} thoughts`);
    requestAnimationFrame(() => listEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
  };

  return (
    <div ref={root} className={`flex-1 flex flex-col min-h-0 ${full ? 'fixed inset-0 z-[100] bg-white dark:bg-[#1c1c1e] pt-[env(safe-area-inset-top)]' : ''}`}>
      <div className="px-3 md:px-6 pt-3 pb-3 border-b border-gray-100 dark:border-white/5 space-y-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatusFilter(f => f === s ? null : s)}
              aria-pressed={statusFilter === s}
              className={`shrink-0 inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[12.5px] font-semibold border transition-colors ${statusFilter === s ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'border-black/[0.08] dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-200'}`}>
              <ThoughtIcon status={s} size={17} />
              <span className="hidden sm:inline">{STATUS_NAMES[s]}</span>
              <span className="tabular-nums">{counts[s]}</span>
            </button>
          ))}
          <div className="hidden md:flex items-center gap-2 ml-2 min-w-[12rem] flex-1">
            <StatusBar thoughts={thoughts} className="flex-1 max-w-[14rem]" />
            <span className="text-[12px] text-gray-400 whitespace-nowrap tabular-nums">{settled} of {thoughts.length} settled</span>
          </div>
        </div>
        <StatusBar thoughts={thoughts} className="md:hidden" />
        <div className="flex items-center gap-2">
        <div className="flex p-0.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.06] shrink-0" role="tablist" aria-label="View">
          {([['timeline', 'Timeline', ListTree], ['tree', 'Tree', Network]] as const).map(([v, label, Ic]) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-[12px] font-semibold ${view === v ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}>
              <Ic size={13} />{label}
            </button>
          ))}
        </div>
        <button onClick={() => setFull(f => !f)} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (Esc)' : 'Full screen'}
          className="order-last shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[12px] font-semibold bg-black/[0.05] dark:bg-white/[0.06] text-gray-700 dark:text-gray-200">
          {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}<span className="hidden sm:inline">{full ? 'Exit' : 'Full screen'}</span>
        </button>
        {topics.length > 0 && (
          <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            <TopicChip name="All topics" color={MAIN_COLOR} active={!topicFilter} onClick={() => setTopicFilter(null)} />
            {topics.map(t => (
              <TopicChip key={t.name} name={t.name} color={t.color} active={topicFilter?.toLowerCase() === t.name.toLowerCase()}
                onClick={() => setTopicFilter(f => f?.toLowerCase() === t.name.toLowerCase() ? null : t.name)} />
            ))}
          </div>
        )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-1 md:px-3 py-2">
        {thoughts.length === 0 ? (
          <EmptyMap />
        ) : shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">No thoughts match. Tap the filter again to see them all.</p>
        ) : view === 'tree' ? (
          <ThoughtTree title={map.title} thoughts={shown} topics={topics} rootTopic={rootTopic} wide={wide}
            Icon={ThoughtIcon} onOpen={id => setOpenId(id)} onCycle={cycle} />
        ) : (
          <ol aria-label={`${map.title} thoughts`}>
            {flow.rows.map((row, r) => (
              <li key={rowKey(row)} className="flex items-stretch" style={{ height: rowHeight(row) }}>
                {row.kind !== 'day' && (
                  <svg width={gutter(geo, flow)} height={rowHeight(row)} className="shrink-0" aria-hidden>
                    <RowGraph row={row} r={r} flow={flow} geo={geo} />
                  </svg>
                )}
                <RowContent row={row} flow={flow} geo={geo} childCount={childCount} thoughts={thoughts}
                  onOpen={id => setOpenId(id)} onCycle={cycle} />
              </li>
            ))}
          </ol>
        )}
        <div ref={listEnd} />
      </div>

      <AddBar wide={wide} topics={topics.map(t => t.name)} defaultTopic={topicFilter} onAdd={add} />

      {open && (
        <ThoughtSheet thought={open} thoughts={thoughts} topics={topics.map(t => t.name)}
          onClose={() => setOpenId(null)} onOpen={setOpenId} onChanged={load} onAddUnder={add} />
      )}
    </div>
  );
}

const rowKey = (row: ThoughtRow) =>
  row.kind === 'thought' ? row.thought.id : row.kind === 'day' ? `day:${row.date}` : `${row.kind}:${row.topic}:${row.at}`;
const rowHeight = (row: ThoughtRow) => row.kind === 'thought' ? ROW_H : SLIM_H;

function TopicChip({ name, color, active, onClick }: { name: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`shrink-0 px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-colors ${active ? 'text-white' : ''}`}
      style={active ? { background: color } : { color, background: `${color}1a` }}>
      {name}
    </button>
  );
}

function EmptyMap() {
  return (
    <div className="max-w-sm mx-auto text-center py-12 px-4 space-y-3">
      <div className="flex justify-center gap-2">{STATUSES.map(s => <ThoughtIcon key={s} status={s} size={28} />)}</div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-white">Put every thought down</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
        Type one below, or paste a list to add one per line. Start with <b>pro:</b>, <b>con:</b>, <b>unsure:</b> or <b>?</b> to set the icon,
        and add <b>#topic</b> to branch it off. Tap an icon later to re-sort it.
      </p>
      <p className="text-xs text-gray-400">Claude can add to this map too, from any chat with your Sage connector.</p>
    </div>
  );
}

function RowGraph({ row, r, flow, geo }: { row: ThoughtRow; r: number; flow: ThoughtFlow; geo: Geo }) {
  const h = rowHeight(row);
  const mid = h / 2;
  const parts: ReactElement[] = [];
  flow.spans.forEach((s, i) => {
    if (r < s.from || r > s.to) return;
    const x = laneX(geo, s.lane);
    const isTopic = i > 0;
    if (isTopic && r === s.from && row.kind === 'fork') return;
    if (isTopic && !s.open && r === s.to && row.kind === 'settle') return;
    if (r > s.from || !isTopic) parts.push(<line key={`t${i}`} x1={x} y1={0} x2={x} y2={mid} stroke={s.color} strokeWidth={2} opacity={isTopic ? 1 : 0.5} />);
    if (r < s.to) parts.push(<line key={`b${i}`} x1={x} y1={mid} x2={x} y2={h} stroke={s.color} strokeWidth={2} opacity={isTopic ? 1 : 0.5} />);
  });
  if (row.kind === 'fork' || row.kind === 'settle') {
    const px = laneX(geo, 0);
    const bx = laneX(geo, row.lane);
    const d = row.kind === 'fork'
      ? `M ${px} ${mid} C ${px} ${h}, ${bx} ${mid}, ${bx} ${h}`
      : `M ${bx} 0 C ${bx} ${mid}, ${px} 0, ${px} ${mid}`;
    parts.push(<path key="curve" d={d} fill="none" stroke={row.color} strokeWidth={2} />);
    parts.push(<circle key="dot" cx={px} cy={mid} r={4} stroke={row.color} strokeWidth={2} className="fill-white dark:fill-[#1c1c1e]" />);
  } else if (row.kind === 'thought') {
    parts.push(<circle key="node" cx={laneX(geo, row.lane)} cy={mid} r={4.5} fill={row.color} strokeWidth={2.5} className="stroke-white dark:stroke-[#1c1c1e]" />);
  }
  return <>{parts}</>;
}

function RowContent({ row, flow, geo, childCount, thoughts, onOpen, onCycle }: {
  row: ThoughtRow; flow: ThoughtFlow; geo: Geo; childCount: Map<string, number>; thoughts: Thought[];
  onOpen: (id: string) => void; onCycle: (t: Thought) => void;
}) {
  if (row.kind === 'day') {
    const isToday = row.date === getTodayString();
    return (
      <div className="flex-1 flex items-center gap-2" style={{ paddingLeft: gutter(geo, flow) }}>
        <span className={`text-[11px] font-bold uppercase tracking-wider ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
          {isToday ? 'Today' : formatShortDate(row.date)}
        </span>
        <span className={`flex-1 h-px ${isToday ? 'bg-blue-500/30' : 'bg-black/[0.06] dark:bg-white/[0.06]'}`} />
      </div>
    );
  }
  if (row.kind === 'fork' || row.kind === 'settle') {
    const Icon = row.kind === 'fork' ? GitBranch : GitMerge;
    return (
      <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[12.5px] text-gray-500 dark:text-gray-400">
        <Icon size={13} style={{ color: row.color }} className="shrink-0" />
        <span className="font-semibold" style={{ color: row.color }}>{row.topic}</span>
        <span className="truncate">{row.kind === 'fork' ? 'branched off' : 'all settled'}</span>
        <span className="shrink-0 text-gray-400 tabular-nums">{timeOf(row.at)}</span>
      </div>
    );
  }
  const t = row.thought;
  const s = statusOf(t);
  const kids = childCount.get(t.id) || 0;
  // The parent sits just above when it's shown, so only name it when it isn't.
  const parent = t.parentId && row.depth === 0 ? thoughts.find(p => p.id === t.parentId) : null;
  const indent = Math.min(row.depth, 4) * (geo === WIDE ? 22 : 14);
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2.5 pr-2 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.04] cursor-pointer"
      style={{ paddingLeft: indent }} onClick={() => onOpen(t.id)}>
      {row.depth > 0 && (
        <svg width={14} height={ROW_H} className="shrink-0 -ml-3.5 -mr-1" aria-hidden>
          <path d={`M 4 0 V ${ROW_H / 2 - 4} Q 4 ${ROW_H / 2} 8 ${ROW_H / 2} H 14`} fill="none" stroke={row.color} strokeOpacity={0.5} strokeWidth={1.5} />
        </svg>
      )}
      <button onClick={e => { e.stopPropagation(); onCycle(t); }} className="p-1 -m-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
        title={`${STATUS_NAMES[s]}. Tap for ${STATUS_NAMES[nextStatus(s)]}`} aria-label={`${STATUS_NAMES[s]}, change`}>
        <ThoughtIcon status={s} />
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[14px] sm:text-[14.5px] font-semibold leading-[1.25] line-clamp-2 ${s === 'open' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'} ${s === 'bad' ? 'line-through decoration-red-500/50' : ''}`}>
          {t.text}
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-gray-400 min-w-0">
          {t.topic && row.depth === 0 && <span className="font-semibold shrink-0" style={{ color: row.color }}>{t.topic}</span>}
          <span className="shrink-0 tabular-nums">{timeOf(t.createdAt)}</span>
          {parent && <span className="truncate inline-flex items-center gap-0.5"><CornerDownRight size={11} className="shrink-0" />{parent.text}</span>}
          {kids > 0 && <span className="shrink-0">· {kids} under it</span>}
          {t.source === 'claude' && <span className="shrink-0 px-1.5 rounded bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 font-bold uppercase text-[9.5px] tracking-wide">from Claude</span>}
          {t.note && <span className="shrink-0">· note</span>}
        </div>
      </div>
    </div>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function TopicPicker({ value, topics, onChange, className = '' }: { value: string; topics: string[]; onChange: (v: string) => void; className?: string }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  if (adding) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="New topic" maxLength={40}
        aria-label="New topic name"
        onBlur={() => { if (draft.trim()) onChange(draft.trim()); setAdding(false); setDraft(''); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(''); setAdding(false); }
        }}
        className={`w-28 px-2 py-1.5 rounded-lg text-[12.5px] font-semibold bg-black/[0.04] dark:bg-white/10 outline-none ${className}`} />
    );
  }
  const all = value && !topics.some(t => t.toLowerCase() === value.toLowerCase()) ? [...topics, value] : topics;
  return (
    <Select value={value} aria-label="Topic" onChange={v => v === NEW_TOPIC ? setAdding(true) : onChange(v)}
      className={`px-2 py-1.5 rounded-lg text-[12.5px] font-semibold bg-black/[0.04] dark:bg-white/10 ${className}`}>
      <option value="">No topic</option>
      {all.map(t => <option key={t} value={t}>{t}</option>)}
      <option value={NEW_TOPIC}>+ New topic…</option>
    </Select>
  );
}

function AddBar({ wide, topics, defaultTopic, onAdd }: {
  wide: boolean; topics: string[]; defaultTopic: string | null;
  onAdd: (lines: { text: string; status: ThoughtStatus; topic: string }[]) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ThoughtStatus>('open');
  const [topic, setTopic] = useState('');
  useEffect(() => { if (defaultTopic) setTopic(defaultTopic); }, [defaultTopic]);

  const submit = async () => {
    const lines = splitLines(text).map(line => {
      const p = parseThought(line, topics);
      return { text: p.text, status: p.status || status, topic: p.topic ?? topic };
    }).filter(l => l.text);
    if (lines.length === 0) return;
    setText('');
    await onAdd(lines);
  };

  return (
    <div className="px-3 md:px-8 pb-3 pt-2">
      <div className="flex items-end gap-2 p-2 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/[0.08] dark:border-white/10 shadow-sm">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1}
          aria-label="Add a thought"
          placeholder={wide ? 'Add a thought… try “con: grant is slow #money”' : 'Add a thought…'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 min-w-0 resize-none bg-transparent outline-none text-[15px] px-2 py-1.5 max-h-32 dark:text-white placeholder:text-gray-400" />
        <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-xl bg-black/[0.04] dark:bg-white/10 self-center" role="radiogroup" aria-label="Icon for new thoughts">
          {STATUSES.map(s => (
            <button key={s} role="radio" aria-checked={status === s} title={STATUS_NAMES[s]} onClick={() => setStatus(s)}
              className={`p-1 rounded-lg ${status === s ? 'bg-white dark:bg-white/20 shadow-sm' : 'opacity-60 hover:opacity-100'}`}>
              <ThoughtIcon status={s} size={18} />
            </button>
          ))}
        </div>
        <button className="sm:hidden self-center p-1" onClick={() => setStatus(nextStatus(status))} title={`New thoughts: ${STATUS_NAMES[status]}`}
          aria-label={`Icon for new thoughts: ${STATUS_NAMES[status]}, change`}>
          <ThoughtIcon status={status} size={22} />
        </button>
        <TopicPicker value={topic} topics={topics} onChange={setTopic} className="self-center max-w-[7.5rem]" />
        <button onClick={submit} disabled={!text.trim()} aria-label="Add"
          className="self-center w-8 h-8 shrink-0 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 grid place-items-center disabled:opacity-30">
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}

function ThoughtSheet({ thought, thoughts, topics, onClose, onOpen, onChanged, onAddUnder }: {
  thought: Thought; thoughts: Thought[]; topics: string[];
  onClose: () => void; onOpen: (id: string) => void; onChanged: () => void;
  onAddUnder: (lines: { text: string; status: ThoughtStatus; topic: string; parentId?: string | null }[]) => Promise<void>;
}) {
  const [text, setText] = useState(thought.text);
  const [note, setNote] = useState(thought.note || '');
  const [child, setChild] = useState('');
  useEffect(() => { setText(thought.text); setNote(thought.note || ''); setChild(''); }, [thought.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = statusOf(thought);
  const kids = thoughts.filter(t => t.parentId === thought.id);
  const parent = thought.parentId ? thoughts.find(t => t.id === thought.parentId) : null;
  // Anything but itself and what's already under it can be its parent.
  const below = new Set<string>([thought.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of thoughts) if (t.parentId && below.has(t.parentId) && !below.has(t.id)) { below.add(t.id); grew = true; }
  }
  const parents = thoughts.filter(t => !below.has(t.id));
  const save = async (updates: Parameters<typeof api.thoughts.update>[1]) => { await api.thoughts.update(thought.id, updates); onChanged(); };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Thought" onClick={e => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[88vh] overflow-y-auto custom-scrollbar bg-white dark:bg-[#1c1c1e] rounded-t-3xl md:rounded-3xl shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">
        <div className="md:hidden mx-auto -mt-2 w-10 h-1.5 rounded-full bg-black/10 dark:bg-white/20" />
        <div className="flex items-center gap-2 text-[12px] text-gray-400">
          <span>{formatShortDate(thought.createdAt.slice(0, 10))}, {timeOf(thought.createdAt)}</span>
          <span>· {thought.source === 'claude' ? 'from Claude' : 'by you'}</span>
          <span className="flex-1" />
          <button onClick={onClose} className="p-1 -m-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="Thought"
          onBlur={() => text.trim() && text.trim() !== thought.text && save({ text: text.trim().slice(0, 500) })}
          className="w-full resize-none bg-transparent outline-none text-xl font-bold leading-snug text-gray-900 dark:text-white" />

        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="How it stands">
          {STATUSES.map(x => (
            <button key={x} role="radio" aria-checked={s === x} onClick={() => save({ status: x })}
              className={`flex flex-col items-center gap-1.5 py-2.5 rounded-2xl text-[11.5px] font-semibold transition-colors ${s === x ? 'ring-2 bg-black/[0.03] dark:bg-white/[0.06]' : 'bg-black/[0.03] dark:bg-white/[0.06] opacity-70 hover:opacity-100'}`}
              style={s === x ? { ['--tw-ring-color' as any]: STATUS_COLORS[x] } : undefined}>
              <ThoughtIcon status={x} size={30} />
              <span className="text-gray-800 dark:text-gray-100 text-center leading-tight">{STATUS_NAMES[x]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-gray-500">Topic</span>
          <TopicPicker value={thought.topic || ''} topics={topics} onChange={v => save({ topic: v })} />
          <span className="text-gray-500 ml-2">Under</span>
          <Select value={thought.parentId || ''} aria-label="Under which thought" onChange={v => save({ parentId: v || null })}
            className="px-2 py-1.5 rounded-lg text-[12.5px] font-semibold bg-black/[0.04] dark:bg-white/10 max-w-[12rem]">
            <option value="">Nothing</option>
            {parents.map(p => <option key={p.id} value={p.id}>{p.text.length > 40 ? p.text.slice(0, 40) + '…' : p.text}</option>)}
          </Select>
        </div>
        {parent && (
          <button onClick={() => onOpen(parent.id)} className="flex items-center gap-2 text-[13px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <CornerDownRight size={13} /> under <ThoughtIcon status={statusOf(parent)} size={15} /> <span className="truncate">{parent.text}</span>
          </button>
        )}

        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Add a note: a source, a number, who to ask…"
          aria-label="Note" onBlur={() => note !== (thought.note || '') && save({ note: note.slice(0, 2000) })}
          className="w-full resize-none rounded-xl bg-black/[0.03] dark:bg-white/[0.06] px-3 py-2.5 text-[14px] outline-none dark:text-gray-100 placeholder:text-gray-400" />

        <div className="space-y-1">
          <div className="text-[13px] font-bold text-gray-800 dark:text-gray-100">Under it{kids.length ? ` · ${kids.length}` : ''}</div>
          {kids.map(k => (
            <button key={k.id} onClick={() => onOpen(k.id)} className="w-full flex items-center gap-2.5 py-2 border-b border-black/[0.05] dark:border-white/[0.06] text-left text-[14px]">
              <ThoughtIcon status={statusOf(k)} size={18} />
              <span className={`flex-1 min-w-0 truncate ${statusOf(k) === 'bad' ? 'line-through decoration-red-500/50' : ''} dark:text-gray-100`}>{k.text}</span>
              {k.source === 'claude' && <span className="px-1.5 rounded bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 font-bold uppercase text-[9.5px]">Claude</span>}
            </button>
          ))}
          <form className="flex items-center gap-2 pt-1" onSubmit={async e => {
            e.preventDefault();
            const p = parseThought(child, topics);
            if (!p.text) return;
            setChild('');
            await onAddUnder([{ text: p.text, status: p.status || 'open', topic: p.topic ?? (thought.topic || ''), parentId: thought.id }]);
          }}>
            <Plus size={15} className="text-gray-400 shrink-0" />
            <input value={child} onChange={e => setChild(e.target.value)} placeholder="Add a pro, con or question under it"
              aria-label="Add under it" className="flex-1 min-w-0 bg-transparent outline-none text-[14px] py-1.5 dark:text-white placeholder:text-gray-400" />
          </form>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[12px] text-gray-400">{isSettled(s) ? 'Settled' : 'Still open'}</span>
          <button onClick={async () => { await api.thoughts.delete(thought.id); onChanged(); onClose(); }}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
