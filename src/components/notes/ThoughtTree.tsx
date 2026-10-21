import { useMemo, useState, type ReactElement } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Thought, ThoughtStatus } from '../../services/types';
import { MAIN_COLOR, STATUS_NAMES, TreeNode, countStatuses, nextStatus, statusOf, thoughtTree } from './thoughtMap';

// One box in the chart: the map's question, a topic, or a thought.
interface Box {
  key: string;
  kind: 'root' | 'topic' | 'thought';
  label: string;
  color: string;
  thought?: Thought;
  settled?: string;          // "2/5" on topics
  children: Box[];
}

const COL_W = { root: 150, topic: 130, thought: 200 };
const GAP_X = 30;
const SLOT = 64;   // height each leaf takes
const BOX_H = 52;

interface Props {
  title: string;
  thoughts: Thought[];                        // what's shown (after filters)
  topics: { name: string; color: string }[];  // the whole map's, for colours
  rootTopic: Map<string, string>;             // thought id -> topic of the thought it grew from
  wide: boolean;
  Icon: (p: { status: ThoughtStatus; size?: number }) => ReactElement;
  onOpen: (id: string) => void;
  onCycle: (t: Thought) => void;
}

/**
 * The map as a tree that branches out: the question, then each topic, then
 * the thoughts in it with the points under each one. Siblings stay oldest
 * first. On a wide screen it's a left-to-right flowchart; on a phone, an
 * outline that indents each level.
 */
export function ThoughtTree({ title, thoughts, topics, rootTopic, wide, Icon, onOpen, onCycle }: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setClosed(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const root = useMemo<Box>(() => {
    const colorOf = (name: string) => topics.find(t => t.name.toLowerCase() === name.toLowerCase())?.color || MAIN_COLOR;
    const toBox = (n: TreeNode, color: string): Box => ({
      key: n.thought.id, kind: 'thought', label: n.thought.text, color, thought: n.thought,
      children: n.children.map(c => toBox(c, color)),
    });
    const all = (n: TreeNode): Thought[] => [n.thought, ...n.children.flatMap(all)];
    const main: Box[] = [];
    const groups = new Map<string, { name: string; nodes: TreeNode[] }>();
    for (const n of thoughtTree(thoughts)) {
      const topic = (rootTopic.get(n.thought.id) || '').trim();
      if (!topic) { main.push(toBox(n, MAIN_COLOR)); continue; }
      const k = topic.toLowerCase();
      if (!groups.has(k)) groups.set(k, { name: topics.find(t => t.name.toLowerCase() === k)?.name || topic, nodes: [] });
      groups.get(k)!.nodes.push(n);
    }
    const topicBoxes: Box[] = [...groups.values()].map(g => {
      const inside = g.nodes.flatMap(all);
      const c = countStatuses(inside);
      return {
        key: `topic:${g.name}`, kind: 'topic', label: g.name, color: colorOf(g.name),
        settled: `${c.good + c.bad}/${inside.length}`, children: g.nodes.map(n => toBox(n, colorOf(g.name))),
      };
    });
    return { key: 'root', kind: 'root', label: title || 'Untitled map', color: MAIN_COLOR, children: [...main, ...topicBoxes] };
  }, [thoughts, topics, rootTopic, title]);

  const node = (b: Box, extra = '') => <BoxView box={b} closed={closed.has(b.key)} onToggle={() => toggle(b.key)}
    Icon={Icon} onOpen={onOpen} onCycle={onCycle} className={extra} />;

  if (!wide) {
    const outline = (b: Box): ReactElement => (
      <li key={b.key}>
        {node(b)}
        {b.children.length > 0 && !closed.has(b.key) && (
          <ul className="ml-3 pl-3 border-l-2 space-y-1.5 mt-1.5" style={{ borderColor: `${b.kind === 'root' ? MAIN_COLOR : b.color}55` }}>
            {b.children.map(outline)}
          </ul>
        )}
      </li>
    );
    return <ul className="space-y-1.5 py-2 pr-1" aria-label={`${title} as a tree`}>{outline(root)}</ul>;
  }

  // Left to right: each leaf takes a row; a parent sits level with the middle of its children.
  const placed: Array<{ box: Box; x: number; y: number; w: number }> = [];
  const links: Array<{ x1: number; y1: number; x2: number; y2: number; color: string; dashed: boolean }> = [];
  let row = 0;
  const colX = [0];
  const widthAt = (depth: number) => (depth === 0 ? COL_W.root : depth === 1 ? Math.max(COL_W.topic, COL_W.thought) : COL_W.thought);
  for (let d = 1; d < 32; d++) colX[d] = colX[d - 1] + widthAt(d - 1) + GAP_X;
  const lay = (b: Box, depth: number): number => {
    const kids = closed.has(b.key) ? [] : b.children;
    let y: number;
    if (kids.length === 0) y = row++ * SLOT + SLOT / 2;
    else {
      const ys = kids.map(k => lay(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
      kids.forEach((k, i) => links.push({
        x1: colX[depth] + boxWidth(b), y1: y, x2: colX[depth + 1], y2: ys[i],
        color: k.kind === 'topic' ? k.color : b.kind === 'root' ? MAIN_COLOR : b.color,
        dashed: !!k.thought && statusOf(k.thought) === 'open',
      }));
    }
    placed.push({ box: b, x: colX[depth], y, w: boxWidth(b) });
    return y;
  };
  lay(root, 0);
  const width = Math.max(...placed.map(p => p.x + p.w)) + 8;
  const height = row * SLOT;

  return (
    <div className="overflow-x-auto custom-scrollbar py-3" aria-label={`${title} as a tree`}>
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0" aria-hidden>
          {links.map((l, i) => {
            const mx = (l.x1 + l.x2) / 2;
            return <path key={i} d={`M ${l.x1} ${l.y1} C ${mx} ${l.y1}, ${mx} ${l.y2}, ${l.x2} ${l.y2}`} fill="none"
              stroke={l.color} strokeWidth={2} strokeOpacity={0.55} strokeDasharray={l.dashed ? '5 4' : undefined} />;
          })}
        </svg>
        {placed.map(p => (
          <div key={p.box.key} className="absolute" style={{ left: p.x, top: p.y - BOX_H / 2, width: p.w, height: BOX_H }}>
            {node(p.box, 'h-full')}
          </div>
        ))}
      </div>
    </div>
  );
}

const boxWidth = (b: Box) => (b.kind === 'root' ? COL_W.root : b.kind === 'topic' ? COL_W.topic : COL_W.thought);

function BoxView({ box, closed, onToggle, Icon, onOpen, onCycle, className = '' }: {
  box: Box; closed: boolean; onToggle: () => void;
  Icon: Props['Icon']; onOpen: (id: string) => void; onCycle: (t: Thought) => void; className?: string;
}) {
  const hasKids = box.children.length > 0;
  const fold = hasKids && (
    <button onClick={e => { e.stopPropagation(); onToggle(); }} aria-expanded={!closed}
      aria-label={closed ? `Show ${countAll(box)} under it` : 'Hide what is under it'}
      className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md text-[11px] font-semibold text-gray-400 hover:bg-black/5 dark:hover:bg-white/10">
      {closed ? <><ChevronRight size={13} />{countAll(box)}</> : <ChevronDown size={13} />}
    </button>
  );

  if (box.kind === 'root') {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm ${className}`}>
        <span className="flex-1 min-w-0 text-[14px] font-bold leading-tight line-clamp-2">{box.label}</span>
        {fold}
      </div>
    );
  }
  if (box.kind === 'topic') {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-white shadow-sm ${className}`} style={{ background: box.color }}>
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] font-bold truncate">{box.label}</span>
          <span className="block text-[10.5px] font-semibold opacity-85">{box.settled} settled</span>
        </span>
        {hasKids && (
          <button onClick={e => { e.stopPropagation(); onToggle(); }} aria-expanded={!closed}
            aria-label={closed ? `Show ${box.label}` : `Hide ${box.label}`}
            className="shrink-0 p-0.5 rounded-md hover:bg-white/20">
            {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
    );
  }
  const t = box.thought!;
  const s = statusOf(t);
  return (
    <div onClick={() => onOpen(t.id)}
      className={`flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-xl bg-white dark:bg-[#2c2c2e] border cursor-pointer hover:shadow-sm transition-shadow ${s === 'open' ? 'border-dashed border-gray-300 dark:border-white/20' : 'border-black/[0.08] dark:border-white/10'} ${className}`}>
      <button onClick={e => { e.stopPropagation(); onCycle(t); }} className="p-0.5 -m-0.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
        title={`${STATUS_NAMES[s]}. Tap for ${STATUS_NAMES[nextStatus(s)]}`} aria-label={`${STATUS_NAMES[s]}, change`}>
        <Icon status={s} size={18} />
      </button>
      <span className={`flex-1 min-w-0 text-[13px] font-semibold leading-tight line-clamp-2 ${s === 'open' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'} ${s === 'bad' ? 'line-through decoration-red-500/50 opacity-75' : ''}`}>
        {box.label}
      </span>
      {t.source === 'claude' && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-400" title="From Claude" />}
      {fold}
    </div>
  );
}

const countAll = (b: Box): number => b.children.reduce((n, c) => n + 1 + countAll(c), 0);
