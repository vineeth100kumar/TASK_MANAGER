import { useState } from 'react';
import { Archive, Search, Star, ChevronLeft, FileText, Trash2, AlertTriangle, Layers, MessageSquareWarning, Link2, ListChecks } from 'lucide-react';
import { api } from '../../services/api';
import { Dossier, Idea } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { Panel, ScoreRing, chipButton, eyebrow } from './parts';

const ENGINE: Record<string, string> = { groq: 'Groq', claude: 'Claude', local: 'the Pi' };
const KIND: Record<string, string> = { news: 'News', web: 'Web', hn: 'Hacker News' };

function DossierPage({ dossier, ideas, onBack, onOpenIdea, onOpenNote }: { dossier: Dossier; ideas: Idea[]; onBack: () => void; onOpenIdea: (id: string) => void; onOpenNote: (id: string) => void }) {
  const { showToast } = useToast();
  const src = dossier.sources;
  const noteExists = !!dossier.noteId && api.sync.getState().notes.some(n => n && n.id === dossier.noteId);

  const remove = async () => {
    if (!window.confirm(`Delete the research on “${dossier.theme}” and its ${ideas.length} ideas? Its note stays in Notes.`)) return;
    await api.dossiers.delete(dossier.id);
    showToast('Research deleted');
    onBack();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl space-y-3">
        <button onClick={onBack} className="eyebrow text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><ChevronLeft size={14} /> Vault</button>
        <h1 className="text-display text-[24px] md:text-[34px] font-semibold leading-[1.1]">{dossier.theme}</h1>
        <p className="text-[12.5px] text-gray-400">
          {new Date(dossier.createdAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {' · '}{dossier.depth === 'memo' ? 'Partner memo' : 'Brief'}
          {dossier.engine ? ` · ${dossier.engine.split(' + ').map(e => ENGINE[e] || e).join(' + ')}` : ''}
          {' · '}{src.length} sources
        </p>
        {dossier.summary && <p className="text-[15px] font-semibold text-gray-800 dark:text-gray-100 leading-snug">{dossier.summary}</p>}
        <div className="flex gap-2 flex-wrap pt-1">
          {noteExists && <button onClick={() => onOpenNote(dossier.noteId!)} className={chipButton}><FileText size={14} className="text-blue-500" /> Open note</button>}
          <button onClick={() => api.dossiers.update(dossier.id, { starred: !dossier.starred })} aria-pressed={dossier.starred} className={chipButton}>
            <Star size={14} className={`text-amber-500 ${dossier.starred ? 'fill-amber-500' : ''}`} /> {dossier.starred ? 'Starred' : 'Star'}
          </button>
          <button onClick={remove} className={chipButton}><Trash2 size={14} className="text-red-500" /> Delete</button>
        </div>
        {dossier.status === 'needs_review' && (
          <p className="text-[12.5px] text-amber-700 dark:text-amber-400 flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> Part of the AI's answer couldn't be read, so check this one.{dossier.error ? ` ${dossier.error}` : ''}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
        <div className="lg:col-span-7 space-y-4 md:space-y-6">
          <Panel title="Market">
            <p className="text-[13.5px] leading-relaxed text-gray-800 dark:text-gray-200">{dossier.macro}</p>
            {dossier.whyNow && <p className="text-[13.5px] leading-relaxed text-gray-800 dark:text-gray-200"><span className="font-semibold">Why now:</span> {dossier.whyNow}</p>}
            {dossier.claims.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {dossier.claims.map((c, i) => (
                  <li key={i} className="text-[13px] text-gray-700 dark:text-gray-300 flex gap-1.5">
                    <span className="text-gray-300 dark:text-white/30">•</span>
                    <span>{c.text}{c.source && src[c.source - 1] && (
                      <a href={src[c.source - 1].url} target="_blank" rel="noopener noreferrer" title={src[c.source - 1].title} className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline ml-1">[{c.source}]</a>
                    )}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {dossier.valueChain.length > 0 && (
            <Panel icon={<Layers size={18} className="text-purple-500" />} title="Value chain" note="who wins today, and the gap">
              <div className="space-y-2">
                {dossier.valueChain.map((l, i) => (
                  <div key={i} className="p-3 rounded-2xl surface-item grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3">
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{l.layer}</span>
                    <span className="text-[12.5px] text-gray-500 dark:text-gray-400">{l.players}</span>
                    <span className="text-[12.5px] text-emerald-700 dark:text-emerald-400">{l.gap}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {dossier.painPoints.length > 0 && (
            <Panel icon={<MessageSquareWarning size={18} className="text-amber-500" />} title="Pain points" note="what people complain about">
              {dossier.painPoints.map((p, i) => (
                <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block p-3 rounded-2xl surface-item text-[12.5px] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">“{p.text}”</a>
              ))}
            </Panel>
          )}
        </div>

        <div className="lg:col-span-5 space-y-4 md:space-y-6">
          {ideas.length > 0 && (
            <Panel title="Ideas">
              {ideas.map(i => (
                <button key={i.id} onClick={() => onOpenIdea(i.id)} className="w-full text-left p-3 rounded-2xl surface-item is-interactive flex items-center gap-3">
                  <ScoreRing score={i.score} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[13px] text-gray-900 dark:text-white">{i.name}</p>
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{i.oneLiner}</p>
                  </div>
                </button>
              ))}
            </Panel>
          )}
          <Panel icon={<Link2 size={18} className="text-gray-400" />} title="Sources">
            <ol className="space-y-1.5">
              {src.map((s, i) => (
                <li key={i} className="text-[12.5px] flex gap-1.5">
                  <span className="text-gray-400 tabular-nums shrink-0">[{i + 1}]</span>
                  <span className="min-w-0">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 break-words">{s.title}</a>
                    <span className="text-gray-400"> · {KIND[s.kind] || s.kind} · {s.site}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel icon={<ListChecks size={18} className="text-gray-400" />} title="How it was made">
            {dossier.steps.map((s, i) => (
              <div key={i} className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-gray-600 dark:text-gray-300"><span className="font-semibold">{s.name}</span>{s.detail ? ` · ${s.detail}` : ''}</span>
                {s.seconds !== null && <span className="text-gray-400 tabular-nums shrink-0">{s.seconds}s</span>}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

interface VaultTabProps {
  dossiers: Dossier[];
  ideas: Idea[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onOpenIdea: (id: string) => void;
  onOpenNote: (id: string) => void;
  onStudio: () => void;
}

export function VaultTab({ dossiers, ideas, openId, setOpenId, onOpenIdea, onOpenNote, onStudio }: VaultTabProps) {
  const [query, setQuery] = useState('');
  const open = dossiers.find(d => d.id === openId);
  if (open) {
    return <DossierPage dossier={open} ideas={ideas.filter(i => i.dossierId === open.id).sort((a, b) => b.score - a.score)} onBack={() => setOpenId(null)} onOpenIdea={onOpenIdea} onOpenNote={onOpenNote} />;
  }

  if (dossiers.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <div className="surface-item p-4 rounded-2xl inline-flex text-gray-500"><Archive size={28} /></div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">The Vault is empty</h3>
        <p className="text-[14px] text-gray-500">Every research run is kept here, with its sources, and as a Note.</p>
        <button onClick={onStudio} className="mt-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900">Go to Studio</button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = dossiers
    .filter(d => !q || `${d.theme} ${d.summary} ${d.macro}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl surface-item max-w-md">
        <Search size={16} className="text-gray-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your research" className="w-full bg-transparent outline-none text-[14px] text-gray-900 dark:text-white placeholder:text-gray-400" />
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 stagger">
        {shown.map(d => {
          const best = ideas.filter(i => i.dossierId === d.id).sort((a, b) => b.score - a.score)[0];
          return (
            <button key={d.id} onClick={() => setOpenId(d.id)} className="text-left p-4 rounded-3xl surface-item is-interactive space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-[14px] text-gray-900 dark:text-white leading-snug">{d.theme}</p>
                {d.starred && <Star size={14} className="text-amber-500 fill-amber-500 shrink-0 mt-0.5" />}
              </div>
              {d.summary && <p className="text-[12.5px] text-gray-500 dark:text-gray-400 line-clamp-2">{d.summary}</p>}
              <div className="flex items-center justify-between text-[11.5px] font-semibold text-gray-400 gap-2">
                <span>{new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {d.sources.length} sources{d.status === 'needs_review' ? ' · check' : ''}</span>
                {best && <span className="text-emerald-600 dark:text-emerald-400 truncate">Best: {best.name} {best.score}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-[13px] text-gray-400 text-center py-8">Nothing matches “{query}”.</p>}
      <p className={eyebrow + ' normal-case tracking-normal font-medium'}>Each dossier is also a Note, so it can be locked, exported and shared like any other.</p>
    </div>
  );
}
