// SpotifyCard - the Pi as a Spotify Connect speaker on the soundbar
// (raspberry_pi/spotify.py): sign in with a code at spotify.com/pair, then pick
// the Pi in the Spotify app. Now playing, controls and a few settings.

import { useState } from 'react';
import { Music2, Loader2, Play, Pause, SkipBack, SkipForward, Shuffle, ExternalLink, Copy, LogOut, RotateCw, Volume2 } from 'lucide-react';
import { Select } from '../common/Select';
import { useSpotify, type SpotifySettings } from '../../services/spotify';
import { useToast } from '../../context/ToastContext';
import { Switch } from './SpeakerCard';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const primaryButton = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const roundButton = 'w-9 h-9 rounded-full flex items-center justify-center text-gray-700 dark:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-white/10 disabled:opacity-40';
const field = 'px-2.5 py-1.5 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';

export function SpotifyCard() {
  const sp = useSpotify();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const s = sp.state;
  if (!s) return null;
  const set = s.settings;
  const player = s.player;
  const track = player?.track;
  const signedIn = !!s.user && !s.auth;

  const attempt = async (job: () => Promise<string | null>, done?: string) => {
    setBusy(true);
    const problem = await job();
    setBusy(false);
    if (problem) showToast(problem, 'error');
    else if (done) showToast(done, 'success');
  };
  const save = (update: Partial<SpotifySettings>) => attempt(() => sp.save(update));

  const status = !s.installed ? 'Not installed on the Pi yet'
    : !set.enabled ? 'Off'
    : !s.running || !s.ready ? 'Starting…'
    : s.auth ? 'Waiting for you to sign in'
    : !signedIn ? 'Signing in…'
    : player?.playing ? `Playing on ${s.soundbar.name || 'the Pi'}`
    : `Ready · pick “${set.name}” in Spotify`;

  return (
    <div className={card}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-green-600/10 text-green-600 dark:text-green-400 flex items-center justify-center shrink-0"><Music2 size={17} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">Spotify on the soundbar</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            {set.enabled && s.installed && (!s.ready || player?.buffering) && <Loader2 size={11} className="animate-spin" />}
            <span className="truncate">{status}</span>
          </div>
        </div>
        {s.installed && (
          <button role="switch" aria-checked={set.enabled} aria-label="Spotify on the Pi" disabled={busy} onClick={() => save({ enabled: !set.enabled })}
            className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${set.enabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-white/20'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${set.enabled ? 'translate-x-4' : ''}`} />
          </button>
        )}
      </div>

      {!s.installed && (
        <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
          The Spotify player (go-librespot) isn't on the Pi. Run once on the Pi: <code>cd ~/sage-os &amp;&amp; git pull &amp;&amp; sudo deploy/install_pi.sh --only audio,server,web</code>
        </div>
      )}
      {s.error && <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-300">{s.error.message}</div>}

      {set.enabled && s.installed && s.auth && (
        <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-200">Sign in with your normal Spotify account, the way you would on a TV. On your phone or laptop, open spotify.com/pair and enter this code:</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-bold tracking-[0.25em] text-gray-900 dark:text-white select-all">{s.auth.code}</span>
            <button className={smallButton} onClick={() => navigator.clipboard?.writeText(s.auth!.code).then(() => showToast('Code copied', 'success'))}><Copy size={13} />Copy</button>
            <a className={primaryButton} href={s.auth.url || 'https://www.spotify.com/pair'} target="_blank" rel="noreferrer"><ExternalLink size={13} />Open spotify.com/pair</a>
          </div>
          <p className="text-[11px] text-gray-400">Needs Spotify Premium. The Pi remembers you after this; the code changes if it runs out.</p>
        </div>
      )}

      {set.enabled && signedIn && (
        <>
          {!s.soundbar.address && (
            <p className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">Pick a soundbar in Sage's speaker above. Until then, music plays from the Pi's own audio output.</p>
          )}
          {track ? (
            <div className="flex items-center gap-3">
              {track.cover
                ? <img src={track.cover} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-200 dark:bg-white/10" />
                : <div className="w-14 h-14 rounded-lg bg-gray-200 dark:bg-white/10 shrink-0 flex items-center justify-center text-gray-400"><Music2 size={20} /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{track.name}</div>
                <div className="text-xs text-gray-500 truncate">{track.artists}</div>
                {player?.context && <div className="text-[11px] text-gray-400 truncate">from {player.context}</div>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button className={roundButton} aria-label="Previous" disabled={busy} onClick={() => attempt(() => sp.control('prev'))}><SkipBack size={16} /></button>
                <button className={`${roundButton} bg-green-600 hover:bg-green-700 text-white dark:text-white`} aria-label={player?.playing ? 'Pause' : 'Play'} disabled={busy}
                  onClick={() => attempt(() => sp.control('playpause'))}>{player?.playing ? <Pause size={16} /> : <Play size={16} />}</button>
                <button className={roundButton} aria-label="Next" disabled={busy} onClick={() => attempt(() => sp.control('next'))}><SkipForward size={16} /></button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">Open Spotify on your phone or laptop, tap the speaker icon and pick <b>“{set.name}”</b>. It works from anywhere, not only on home Wi-Fi.</p>
          )}
          {track && (
            <div className="flex items-center gap-3">
              <Volume2 size={14} className="text-gray-400 shrink-0" />
              <input type="range" min={0} max={100} step={2} key={player?.volume} defaultValue={player?.volume ?? 50} className="flex-1" aria-label="Spotify volume"
                onPointerUp={e => attempt(() => sp.volume(Number((e.target as HTMLInputElement).value)))}
                onKeyUp={e => attempt(() => sp.volume(Number((e.target as HTMLInputElement).value)))} />
              <button className={`${roundButton} ${player?.shuffle ? 'text-green-600 dark:text-green-400' : ''}`} aria-label="Shuffle" aria-pressed={!!player?.shuffle}
                disabled={busy} onClick={() => attempt(() => sp.shuffle(!player?.shuffle))}><Shuffle size={15} /></button>
            </div>
          )}
          <p className="text-[11px] text-gray-400">Signed in as {s.user}. Sage pauses the music for a moment when it speaks.</p>
        </>
      )}

      {set.enabled && s.installed && (
        <div className="space-y-4 pt-3 border-t border-black/5 dark:border-white/5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500 space-y-1"><span className="block">Name in Spotify</span>
              <input className={`${field} w-full`} defaultValue={set.name} maxLength={40} key={set.name}
                onBlur={e => e.target.value.trim() && e.target.value !== set.name && save({ name: e.target.value })} />
            </label>
            <label className="text-xs text-gray-500 space-y-1"><span className="block">Quality</span>
              <Select className={`${field} w-full`} value={String(set.quality)} aria-label="Quality" onChange={v => save({ quality: Number(v) as SpotifySettings['quality'] })}>
                <option value="320">Very high (320 kbps)</option>
                <option value="160">Normal (160 kbps)</option>
                <option value="96">Data saver (96 kbps)</option>
              </Select>
            </label>
          </div>
          <Switch on={set.normalise} onChange={on => save({ normalise: on })} label="Even out loudness" hint="Keeps quiet and loud songs at a similar volume, like Spotify's own setting." />
          <Switch on={set.autoplay} onChange={on => save({ autoplay: on })} label="Autoplay" hint="When an album or playlist ends, keep playing similar songs." />
          <div className="flex flex-wrap gap-2">
            {signedIn && <button className={smallButton} disabled={busy} onClick={() => attempt(() => sp.control('signout'), 'Signed out of Spotify')}><LogOut size={13} />Sign out</button>}
            <button className={smallButton} disabled={busy} onClick={() => attempt(() => sp.control('restart'), 'Restarting Spotify on the Pi…')}><RotateCw size={13} />Restart</button>
          </div>
        </div>
      )}
    </div>
  );
}
