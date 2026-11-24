// ContentStats - the numbers block of the Content dashboard: Instagram numbers for the
// project picked in the dropdown (a content project is one Instagram page), or one line per
// connected page when the dropdown says All.
//
// Until a page has an account connected, it offers the connect flow, one step at a time like
// the Add flow. After that it is four tiles; "Details" opens the follower line Sage keeps
// itself and the posts table, each measured against the page's own average.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronDown, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert, Unlink } from 'lucide-react';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import {
  POST_KIND_LABELS, SocialOverview, SocialPosts, compact, metricLabel, metricValue,
  socialApi, socialAvailable,
} from '../../services/social';
import { openPosts } from '../../services/posts';
import { openReels } from '../../services/reels';
import { useToast } from '../../context/ToastContext';
import { StepBar } from '../content/StepBar';

const CONNECT_STEPS = ['App', 'Allow', 'Paste'];
const TILE_METRICS = ['reach', 'views', 'total_interactions'];

function FollowerLine({ daily }: { daily: SocialOverview['daily'] }) {
  const points = daily.map(d => Number(d.followers) || 0);
  if (points.length < 2) return null;
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  const path = points.map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - lo) / span) * 24}`).join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-gray-500">Followers</h3>
        <span className="text-[12px] tabular-nums text-gray-400">{lo.toLocaleString()} – {hi.toLocaleString()}</span>
      </div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img"
        aria-label={`Followers from ${lo} to ${hi} over ${points.length} days`}
        className={`w-full h-20 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="0.8"
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 text-[11.5px] text-gray-400">{points.length} days Sage has kept. Instagram itself forgets these.</p>
    </div>
  );
}

function Connect({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(0);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [code, setCode] = useState('');
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [redirect, setRedirect] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    socialApi.app().then(a => {
      setAppId(a.appId || '');
      setAuthUrl(a.authorizeUrl);
      setRedirect(a.redirectUri);
      if (a.appReady) setStep(1);
    }).catch(() => undefined);
  }, []);

  const saveApp = async () => {
    setBusy(true);
    try {
      const a = await socialApi.saveApp(appId.trim(), appSecret.trim());
      setAuthUrl(a.authorizeUrl);
      setRedirect(a.redirectUri);
      setStep(1);
    } catch (e: any) {
      showToast(e.message || "Couldn't save that", 'error');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      await socialApi.connect(projectId, code.trim());
      showToast('Instagram connected');
      onDone();
    } catch (e: any) {
      showToast(e.message || "Instagram wouldn't accept that", 'error');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <h3 className="text-[17px] font-semibold mb-1">Connect this page's Instagram</h3>
      <p className="text-[13px] text-gray-500 mb-4">Free, and it stays on your Pi. No Facebook Page and no app review.</p>
      <StepBar steps={CONNECT_STEPS} current={step} />
      <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 md:p-5 space-y-4">
        {step === 0 && (
          <>
            <p className="text-[13px] text-gray-600 dark:text-gray-300">
              In your Meta app, open <b>Instagram &gt; API setup with Instagram login &gt; Business login settings</b> and
              copy the two values. Add <code className="text-[12px]">{redirect || 'the redirect below'}</code> as an
              OAuth redirect URI there.
            </p>
            <div>
              <label className="field-label mb-1.5" htmlFor="ig-app-id">Instagram App ID</label>
              <input id="ig-app-id" value={appId} onChange={e => setAppId(e.target.value)} className="field w-full" inputMode="numeric" />
            </div>
            <div>
              <label className="field-label mb-1.5" htmlFor="ig-app-secret">Instagram app secret</label>
              <input id="ig-app-secret" value={appSecret} onChange={e => setAppSecret(e.target.value)} className="field w-full" type="password" />
              <p className="mt-1 text-[11.5px] text-gray-400">Kept on the Pi only, never synced to your phone.</p>
            </div>
            <button type="button" disabled={!appId.trim() || !appSecret.trim() || busy} onClick={saveApp}
              className="h-11 w-full rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[14px] disabled:opacity-40">
              {busy ? 'Saving' : 'Next'}
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <p className="text-[13px] text-gray-600 dark:text-gray-300">
              Open this and allow access with the Instagram account for this page. It must be a
              <b> professional</b> account (Creator or Business).
            </p>
            {authUrl ? (
              <a href={authUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[14px]">
                Allow on Instagram <ExternalLink size={15} />
              </a>
            ) : <p className="text-[13px] text-amber-600">Save the app id and secret first.</p>}
            <p className="text-[12.5px] text-gray-500">
              Instagram then sends you to <code className="text-[11.5px]">{redirect}</code>, which won't load. That's
              fine: copy the <b>code</b> from the address bar.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(0)} className="h-10 px-4 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[14px] font-semibold">Back</button>
              <button type="button" onClick={() => setStep(2)} className="flex-1 h-10 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[14px] font-semibold">I have the code</button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div>
              <label className="field-label mb-1.5" htmlFor="ig-code">The code from the address bar</label>
              <textarea id="ig-code" value={code} onChange={e => setCode(e.target.value)} rows={3}
                placeholder="AQB... (everything after code= )" className="field w-full font-mono text-[12.5px]" />
              <p className="mt-1 text-[11.5px] text-gray-400">A code lasts an hour and works once. Sage swaps it for a 60-day token and keeps that fresh.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(1)} className="h-11 px-4 rounded-xl bg-black/[0.05] dark:bg-white/10 text-[14px] font-semibold">Back</button>
              <button type="button" disabled={!code.trim() || busy} onClick={connect}
                className="flex-1 h-11 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-[14px] disabled:opacity-40">
                {busy ? <LoaderCircle size={16} className="animate-spin mx-auto" /> : 'Connect'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ContentStats({ projectId }: { projectId: string }) {
  const { showToast } = useToast();
  const [data, setData] = useState<SocialOverview | null>(null);
  const [media, setMedia] = useState<SocialPosts | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(30);
  const [details, setDetails] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const over = await socialApi.overview(projectId, days);
      setData(over);
      setError('');
      setMedia(over.connected ? await socialApi.posts(projectId, 30) : null);
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, [projectId, days]);

  useEffect(() => { if (socialAvailable()) load(); }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      await socialApi.refresh(projectId);
      showToast('Pulled from Instagram');
      await load();
    } catch (e: any) {
      showToast(e.message || "Instagram didn't answer", 'error');
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    try {
      await socialApi.forget(projectId);
      showToast('Disconnected. The saved numbers are gone too.');
      await load();
    } catch (e: any) {
      showToast(e.message || "Couldn't disconnect", 'error');
    }
  };

  const best = useMemo(() => {
    const list = media?.posts || [];
    return list.reduce<typeof list[number] | null>((top, p) =>
      (p.metrics.reach || 0) > (top?.metrics.reach || 0) ? p : top, null);
  }, [media]);

  // Without a Pi there is nothing to show, and the rest of the dashboard says why.
  if (!socialAvailable()) return null;
  if (error) return <p className="text-[13px] text-red-600">{error}</p>;
  if (!data) {
    return <p className="flex items-center gap-2 text-[13.5px] text-gray-400"><LoaderCircle size={15} className="animate-spin" /> Reading the numbers</p>;
  }
  if (!data.connected) {
    if (connecting) return <Connect projectId={projectId} onDone={() => { setConnecting(false); load(); }} />;
    return (
      <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4 flex flex-wrap items-center gap-3">
        <BarChart3 size={18} className="text-sky-500 shrink-0" />
        <p className="flex-1 min-w-[12rem] text-[13.5px] text-gray-600 dark:text-gray-300">Connect this page's Instagram to see its numbers here. Free, and it stays on your Pi.</p>
        <button type="button" onClick={() => setConnecting(true)}
          className="h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[13px] font-semibold">Connect Instagram</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data.picture && <img src={data.picture} alt="" className="w-8 h-8 rounded-full" />}
        <div>
          <p className="text-[14px] font-semibold leading-tight">@{data.username}</p>
          <p className="text-[11.5px] text-gray-400">
            {data.lastPull ? `Pulled ${new Date(data.lastPull).toLocaleString()}` : 'Not pulled yet'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {[7, 30, 90].map(d => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
              className={`h-7 px-2.5 rounded-full text-[12px] font-semibold ${days === d ? 'bg-sky-600 text-white' : 'bg-black/[0.05] dark:bg-white/10 text-gray-600 dark:text-gray-300'}`}>
              {d}d
            </button>
          ))}
          <button type="button" onClick={refresh} disabled={busy}
            className="flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-black/[0.05] dark:bg-white/10 disabled:opacity-50">
            <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Pull now
          </button>
          <button type="button" onClick={forget} title="Disconnect this Instagram account"
            className="flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-gray-500 hover:bg-black/[0.05] dark:hover:bg-white/10">
            <Unlink size={12} />
          </button>
        </div>
      </div>

      {data.problem && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3.5 text-[13px] text-amber-900 dark:text-amber-200 flex gap-2.5">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <div><b>Instagram said:</b> {data.problem}</div>
        </div>
      )}
      {typeof data.tokenDaysLeft === 'number' && data.tokenDaysLeft < 7 && (
        <p className="text-[12.5px] text-amber-600">The Instagram token runs out in {data.tokenDaysLeft} days. Sage refreshes it by itself, but connect again if that banner stays.</p>
      )}
      {data.note && <p className="text-[13px] text-gray-500">{data.note}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4">
          <p className="text-[12px] font-semibold text-gray-500">Followers</p>
          <p className="text-[24px] font-semibold tabular-nums leading-tight">{compact(data.followers)}</p>
          <p className={`text-[12px] font-semibold tabular-nums ${data.followersChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {data.followersChange >= 0 ? '+' : ''}{data.followersChange} in {data.days}d
          </p>
        </div>
        {TILE_METRICS.map(key => (
          <div key={key} className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4">
            <p className="text-[12px] font-semibold text-gray-500">{metricLabel(key)}</p>
            <p className="text-[24px] font-semibold tabular-nums leading-tight">
              {typeof data.totals[key] === 'number' ? metricValue(key, data.totals[key]) : '-'}
            </p>
            <p className="text-[12px] text-gray-400">
              {key === 'total_interactions' && data.engagementRate !== null ? `${data.engagementRate}% of reach` : `last ${data.days}d`}
            </p>
          </div>
        ))}
      </div>

      <button type="button" onClick={() => setDetails(d => !d)} aria-expanded={details}
        className="flex items-center gap-1 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ChevronDown size={14} className={`transition-transform ${details ? 'rotate-180' : ''}`} /> {details ? 'Hide details' : 'Details: followers and every post'}
      </button>
      {details && (<>
      <FollowerLine daily={data.daily} />

      {best && (
        <div className="surface rounded-3xl border border-black/5 dark:border-white/5 p-4">
          <p className="text-[12px] font-semibold text-gray-500 mb-1">Best by reach</p>
          <p className="text-[14px] font-semibold leading-snug line-clamp-2">{best.caption.split('\n')[0] || 'Untitled'}</p>
          <p className="text-[12.5px] text-gray-500">{compact(best.metrics.reach || 0)} reach · {POST_KIND_LABELS[best.kind] || best.kind}</p>
        </div>
      )}

      <div className="surface rounded-3xl border border-black/5 dark:border-white/5 overflow-hidden">
        <div className="flex items-baseline justify-between p-4 pb-2">
          <h3 className="text-[14px] font-semibold">Posts and reels</h3>
          {media?.averageReach ? <span className="text-[12px] text-gray-400">average reach {compact(media.averageReach)}</span> : null}
        </div>
        {!media?.posts.length ? (
          <p className="px-4 pb-4 text-[13px] text-gray-500">Nothing pulled yet. Press <b>Pull now</b>, or wait for the morning pull.</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {media.posts.map(p => (
              <li key={p.id} className="p-3.5 flex items-start gap-3">
                {p.thumbnail
                  ? <img src={p.thumbnail} alt="" loading="lazy" className="w-11 h-11 rounded-xl object-cover shrink-0" />
                  : <div className="w-11 h-11 rounded-xl bg-black/[0.05] dark:bg-white/10 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold leading-snug line-clamp-2">{p.caption.split('\n')[0] || 'No caption'}</p>
                  <p className="text-[11.5px] text-gray-400">
                    {POST_KIND_LABELS[p.kind] || p.kind}
                    {p.postedAt ? ` · ${new Date(p.postedAt).toLocaleDateString()}` : ''}
                    {p.sageId ? ' · made in Sage' : ''}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-gray-500 tabular-nums">
                    {Object.entries(p.metrics).slice(0, 5).map(([key, value]) => (
                      <span key={key}>{metricLabel(key)} <b>{metricValue(key, value)}</b></span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {p.vsAverage !== null && (
                    <span className={`inline-block text-[11.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${p.vsAverage >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-black/[0.05] dark:bg-white/10 text-gray-500'}`}>
                      {p.vsAverage >= 0 ? '+' : ''}{p.vsAverage}%
                    </span>
                  )}
                  <div className="mt-1 flex flex-col items-end gap-1">
                    {p.sageId && (
                      <button type="button" onClick={() => (p.sageKind === 'reel' ? openReels({ reelId: p.sageId! }) : openPosts({ postId: p.sageId! }))}
                        className="text-[11.5px] font-semibold text-sky-600 dark:text-sky-400">Script</button>
                    )}
                    {p.permalink && (
                      <a href={p.permalink} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-gray-400 hover:text-gray-700 dark:hover:text-white">Instagram</a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.dropped && data.dropped.length > 0 && (
        <p className="text-[11.5px] text-gray-400 flex items-start gap-1.5">
          <BarChart3 size={13} className="shrink-0 mt-0.5" />
          Instagram no longer gives these, so they are left out: {data.dropped.join(', ')}.
        </p>
      )}
      </>)}
    </div>
  );
}

// All projects: one line per connected page; tap one to open that page's numbers.
export function AllPagesStats({ onPick }: { onPick: (projectId: string) => void }) {
  const [rows, setRows] = useState<SocialOverview[] | null>(null);

  useEffect(() => {
    if (!socialAvailable()) return;
    let live = true;
    socialApi.app().then(async a => {
      const connected = a.pages.filter(p => p.connected);
      const all = await Promise.all(connected.map(p => socialApi.overview(p.projectId, 30).catch(() => null)));
      if (live) setRows(all.filter((o): o is SocialOverview => Boolean(o)));
    }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  if (!rows || rows.length === 0) return null;
  const nameOf = (id: string) => ((api.sync.getState().projects.filter(Boolean) as Project[]).find(p => p.id === id)?.name) || id;
  return (
    <div className="surface rounded-3xl border border-black/5 dark:border-white/5 divide-y divide-black/5 dark:divide-white/5">
      {rows.map(o => (
        <button key={o.projectId} type="button" onClick={() => onPick(o.projectId)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] first:rounded-t-3xl last:rounded-b-3xl">
          {o.picture ? <img src={o.picture} alt="" className="w-8 h-8 rounded-full shrink-0" /> : <div className="w-8 h-8 rounded-full bg-black/[0.05] dark:bg-white/10 shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold truncate">{nameOf(o.projectId)}</span>
            <span className="block text-[12px] text-gray-400 truncate">@{o.username}</span>
          </span>
          <span className="text-right text-[12.5px] tabular-nums text-gray-500">
            <b className="text-gray-900 dark:text-white">{compact(o.followers)}</b> followers
            <span className={`ml-1 font-semibold ${o.followersChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{o.followersChange >= 0 ? '+' : ''}{o.followersChange}</span>
            <span className="hidden sm:inline"> · reach <b className="text-gray-900 dark:text-white">{typeof o.totals.reach === 'number' ? compact(o.totals.reach) : '-'}</b></span>
          </span>
        </button>
      ))}
    </div>
  );
}
