import { useCallback, useEffect, useMemo, useState } from 'react';
import { Radar, Newspaper, FlaskConical, Lightbulb, Archive, RefreshCw, AlertTriangle, Server } from 'lucide-react';
import { api } from '../../services/api';
import { Dossier, Idea } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { RADAR_EVENT, RadarSignal, RadarSummary, radarApi, radarAvailable } from '../../services/radar';
import { Ticker } from '../radar/parts';
import { SignalsTab } from '../radar/SignalsTab';
import { StudioTab } from '../radar/StudioTab';
import { IdeasTab } from '../radar/IdeasTab';
import { IdeaPage } from '../radar/IdeaPage';
import { VaultTab } from '../radar/VaultTab';

type Tab = 'signals' | 'studio' | 'ideas' | 'vault';

const TABS: { id: Tab; name: string; icon: typeof Newspaper }[] = [
  { id: 'signals', name: 'Signals', icon: Newspaper },
  { id: 'studio', name: 'Studio', icon: FlaskConical },
  { id: 'ideas', name: 'Ideas', icon: Lightbulb },
  { id: 'vault', name: 'Vault', icon: Archive },
];

const TAB_KEY = 'sage-radar-tab';

interface RadarViewProps {
  onOpenProject: (projectId: string) => void;
  onOpenNote: (noteId: string) => void;
}

export function RadarView({ onOpenProject, onOpenNote }: RadarViewProps) {
  const { showToast } = useToast();
  const [tab, setTabState] = useState<Tab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'signals'; } catch { return 'signals'; }
  });
  const [ideaId, setIdeaId] = useState<string | null>(null);
  const [vaultOpenId, setVaultOpenId] = useState<string | null>(null);
  const [seedTheme, setSeedTheme] = useState('');
  const [summary, setSummary] = useState<RadarSummary | null>(null);
  const [signals, setSignals] = useState<RadarSignal[]>([]);
  const [region, setRegion] = useState('Global');
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);

  const setTab = (t: Tab) => {
    setTabState(t);
    setIdeaId(null);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
  };

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([radarApi.summary(), radarApi.signals(region, tag)]);
      setSummary(s);
      setSignals(list);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [region, tag]);

  useEffect(() => { if (radarAvailable()) load(); }, [load]);
  useEffect(() => {
    const onRadar = (e: Event) => { if ((e as CustomEvent).detail?.type === 'RADAR_UPDATED') load(); };
    window.addEventListener(RADAR_EVENT, onRadar);
    // Headlines age while the page is open; recheck every few minutes too.
    const timer = setInterval(load, 5 * 60000);
    return () => { window.removeEventListener(RADAR_EVENT, onRadar); clearInterval(timer); };
  }, [load]);

  // Synced records: research, ideas, and which headlines are already in the Inbox.
  const loadLocal = useCallback(async () => {
    const [d, i] = await Promise.all([api.dossiers.list(), api.ideas.list()]);
    setDossiers(d);
    setIdeas(i);
    const ids = new Set<string>();
    for (const item of api.sync.getState().workItems) {
      const id = item && !item.deletedAt && (item.customFields as any)?.radarSignalId;
      if (id) ids.add(id);
    }
    setSentIds(ids);
  }, []);
  useEffect(() => { loadLocal(); }, [loadLocal]);
  useDataChanges(loadLocal);

  const sendToInbox = async (signal: RadarSignal) => {
    try {
      const created = await api.workItems.create({
        title: signal.title,
        description: `${signal.link}\n\nFrom ${signal.source}, via Radar.`,
        lifeContext: 'work',
        isInbox: true,
        labels: ['radar', ...signal.tags.map(t => t.toLowerCase().replace(/\s+/g, '-'))],
        customFields: { radarSignalId: signal.id, sourceUrl: signal.link },
      });
      setSentIds(prev => new Set(prev).add(signal.id));
      showToast('Added to Inbox', 'success', { label: 'Undo', group: 'radar-inbox', onAction: async () => { await api.workItems.softDelete(created.id); loadLocal(); } });
    } catch (e: any) {
      showToast(e.message || "Couldn't add it", 'error');
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const s = await radarApi.refresh();
      if (!s.refreshed) showToast('Refreshed under a minute ago, showing that');
      await load();
    } catch (e: any) {
      showToast(e.message || "Couldn't refresh", 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const research = (theme: string) => { setSeedTheme(theme); setTab('studio'); };
  const openIdea = (id: string) => { setTabState('ideas'); setIdeaId(id); };
  const openDossier = (id: string) => { setTab('vault'); setVaultOpenId(id); };

  const today = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), []);

  if (!radarAvailable()) {
    return (
      <div className="max-w-md mx-auto text-center py-20 space-y-3">
        <div className="surface-item p-4 rounded-2xl inline-flex text-gray-500"><Server size={28} /></div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Radar runs on the Pi</h3>
        <p className="text-[14px] text-gray-500">It reads the news and prices, and runs research, on Sage's Pi server, so it shows when the app is opened from the Pi.</p>
      </div>
    );
  }

  const idea = ideaId ? ideas.find(i => i.id === ideaId) : undefined;
  if (idea) {
    return (
      <div className="max-w-6xl mx-auto">
        <IdeaPage idea={idea} dossier={dossiers.find(d => d.id === idea.dossierId)} onBack={() => setIdeaId(null)} onOpenProject={onOpenProject} onOpenDossier={openDossier} />
      </div>
    );
  }

  // An open dossier has its own header, like an idea page.
  if (tab === 'vault' && vaultOpenId && dossiers.some(d => d.id === vaultOpenId)) {
    return (
      <div className="max-w-6xl mx-auto">
        <VaultTab dossiers={dossiers} ideas={ideas} openId={vaultOpenId} setOpenId={setVaultOpenId} onOpenIdea={openIdea} onOpenNote={onOpenNote} onStudio={() => setTab('studio')} />
      </div>
    );
  }

  const down = summary?.sources.filter(s => !s.ok) || [];
  const tagline = error ? `Can't reach the Pi right now (${error}).`
    : tab === 'signals' ? (summary ? summary.headline : 'Loading the latest signals…')
    : tab === 'studio' ? 'Give it a theme. It reads the news, the web and Hacker News, then drafts and red-teams three ideas.'
    : tab === 'ideas' ? `${ideas.length} idea${ideas.length === 1 ? '' : 's'}, best first. Numbers are AI estimates.`
    : `${dossiers.length} dossier${dossiers.length === 1 ? '' : 's'}, starred first.`;

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2">
              <Radar size={14} className="text-purple-500" />
              <span>{today}{summary?.updatedAt ? ` · updated ${new Date(summary.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
            </div>
            <h1 className="text-display text-[28px] md:text-[44px] font-semibold leading-[1.05] pb-1">Radar</h1>
            <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1">{tagline}</p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="flex p-1 rounded-xl bg-black/[0.04] dark:bg-white/5 flex-1 md:flex-none" role="tablist">
              {TABS.map(t => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={`flex-1 md:flex-none flex items-center justify-center gap-1 md:gap-1.5 px-1.5 md:px-3 py-1.5 rounded-lg text-[12.5px] md:text-[13px] font-semibold transition-colors ${tab === t.id ? 'bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                  <t.icon size={14} />{t.name}
                </button>
              ))}
            </div>
            {tab === 'signals' && (
              <button onClick={refresh} disabled={refreshing} title="Fetch headlines and prices now" aria-label="Refresh"
                className="shrink-0 p-2.5 rounded-xl surface-item text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-60 active:scale-95 transition-transform">
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
        </div>
        {tab === 'signals' && summary && <Ticker quotes={summary.ticker} />}
        {tab === 'signals' && down.length > 0 && (
          <p className="text-[12px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Down: {down.map(s => s.name).join(', ')}
          </p>
        )}
      </div>

      {tab === 'signals' && (!summary && !error ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6" aria-busy="true">
          <div className="lg:col-span-7 skeleton h-96" />
          <div className="lg:col-span-5 skeleton h-64" />
        </div>
      ) : summary && (
        <SignalsTab summary={summary} signals={signals} region={region} setRegion={setRegion} tag={tag} setTag={setTag}
          sentIds={sentIds} onInbox={sendToInbox} onResearch={research}
          topIdeas={ideas.slice(0, 3)} onOpenIdea={openIdea} onAllIdeas={() => setTab('ideas')} />
      ))}
      {tab === 'studio' && <StudioTab seedTheme={seedTheme} signals={signals} dossiers={dossiers} ideas={ideas} onOpenIdea={openIdea} onOpenDossier={openDossier} />}
      {tab === 'ideas' && <IdeasTab ideas={ideas} dossiers={dossiers} onOpenIdea={openIdea} onStudio={() => setTab('studio')} />}
      {tab === 'vault' && <VaultTab dossiers={dossiers} ideas={ideas} openId={vaultOpenId} setOpenId={setVaultOpenId} onOpenIdea={openIdea} onOpenNote={onOpenNote} onStudio={() => setTab('studio')} />}
    </div>
  );
}
