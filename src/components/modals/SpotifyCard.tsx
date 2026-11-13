// SpotifyCard - the Pi as a Spotify Connect speaker on the soundbar, via Spotify
// Soloist (raspberry_pi/spotify.py). Paste a Soloist API key, then pick "Sage"
// in the Spotify app. Now playing, controls and a few settings.

import { useState } from 'react';
import { Music2, Loader2, Play, Pause, SkipBack, SkipForward, Shuffle, ExternalLink, LogOut, RotateCw, Volume2, KeyRound } from 'lucide-react';
import { useSpotify, type SpotifySettings } from '../../services/spotify';
import { useToast } from '../../context/ToastContext';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const primaryButton = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const roundButton = 'w-9 h-9 rounded-full flex items-center justify-center text-gray-700 dark:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-white/10 disabled:opacity-40';
const field = 'px-2.5 py-1.5 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';

export function SpotifyCard() {
  const sp = useSpotify();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const s = sp.state;
  if (!s) return null;
  const set = s.settings;
  const player = s.player;
  const track = player?.track;

  const attempt = async (job: () => Promise<string | null>, done?: string) => {
    setBusy(true);
    const problem = await job();
    setBusy(false);
    if (problem) showToast(problem, 'error');
    else if (done) showToast(done, 'success');
  };
  const save = (update: Partial<SpotifySettings> & { apiKey?: string }) => attempt(() => sp.save(update));

  const status = !s.installed ? 'Not installed on the Pi yet'
    : !set.enabled ? 'Off'
    : !set.hasKey ? 'Add your Soloist key below'
    : s.expired ? 'Spotify player expired · needs updating'
    : !s.running || !s.ready ? 'Starting…'
    : s.loggedIn ? (player?.playing ? `Playing on ${s.soundbar.name || 'the Pi'}` : `Ready · pick “${set.name}” in Spotify`)
    : `Pick “${set.name}” in the Spotify app to sign in`;

  return (
    <div className={card}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-green-600/10 text-green-600 dark:text-green-400 flex items-center justify-center shrink-0"><Music2 size={17} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">Spotify on the soundbar</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            {set.enabled && s.installed && set.hasKey && !s.expired && (!s.ready || player?.buffering) && <Loader2 size={11} className="animate-spin" />}
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
          Spotify's player (Soloist) isn't on the Pi. Run once on the Pi: <code>cd ~/sage-os &amp;&amp; git pull &amp;&amp; sudo deploy/install_pi.sh --only audio,server,web</code>
        </div>
      )}
      {s.expired && s.installed && (
        <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
          Spotify's player expired (Soloist builds last 90 days). Update it on the Pi: <code>sudo deploy/install_pi.sh --only audio</code>
        </div>
      )}
      {s.error && <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-300">{s.error.message}</div>}

      {set.enabled && s.installed && (
        <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white"><KeyRound size={14} />Spotify Soloist key</div>
          <p className="text-xs text-gray-500">
            Spotify needs its own small key for this (no developer app). Make one for free, signed in with your Premium account, then paste it here. It stays on the Pi.
          </p>
          <a className={`${smallButton} w-fit`} href="https://developer.spotify.com/dashboard/soloist" target="_blank" rel="noreferrer"><ExternalLink size={13} />Get a key</a>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input type="password" className={`${field} flex-1 min-w-[12rem] font-mono`} value={key} placeholder={set.hasKey ? '•••••• saved — paste to replace' : 'Paste your Soloist key'}
              autoComplete="off" onChange={e => setKey(e.target.value)} />
            <button className={primaryButton} disabled={busy || !key.trim()} onClick={() => attempt(async () => { const p = await sp.save({ apiKey: key.trim() }); if (!p) setKey(''); return p; }, 'Key saved')}>Save key</button>
          </div>
          {set.hasKey && <p className="text-[11px] text-gray-400">A key is saved. Each key works on one device; if songs won't play, make a fresh one and paste it.</p>}
        </div>
      )}

      {set.enabled && s.installed && set.hasKey && !s.expired && (
        <>
          {!s.soundbar.address && (
            <p className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">Pick a soundbar in Sage's speaker above. Until then, music plays from the Pi's own audio output.</p>
          )}
          {!s.loggedIn ? (
            <p className="text-xs text-gray-500">On your phone or laptop, open Spotify, tap the speaker icon and pick <b>“{set.name}”</b>. It signs in by itself and remembers you. Works from anywhere, not only home Wi-Fi.</p>
          ) : track ? (
            <div className="flex items-center gap-3">
              {track.cover
                ? <img src={track.cover} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-200 dark:bg-white/10" />
                : <div className="w-14 h-14 rounded-lg bg-gray-200 dark:bg-white/10 shrink-0 flex items-center justify-center text-gray-400"><Music2 size={20} /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">{track.name || 'Spotify'}</div>
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
            <p className="text-xs text-gray-500">Signed in. Start a song in the Spotify app and it plays here.</p>
          )}
          {s.loggedIn && track && (
            <div className="flex items-center gap-3">
              <Volume2 size={14} className="text-gray-400 shrink-0" />
              <input type="range" min={0} max={100} step={2} key={player?.volume} defaultValue={player?.volume ?? 50} className="flex-1" aria-label="Spotify volume"
                onPointerUp={e => attempt(() => sp.volume(Number((e.target as HTMLInputElement).value)))}
                onKeyUp={e => attempt(() => sp.volume(Number((e.target as HTMLInputElement).value)))} />
              <button className={`${roundButton} ${player?.shuffle ? 'text-green-600 dark:text-green-400' : ''}`} aria-label="Shuffle" aria-pressed={!!player?.shuffle}
                disabled={busy} onClick={() => attempt(() => sp.shuffle(!player?.shuffle))}><Shuffle size={15} /></button>
            </div>
          )}
        </>
      )}

      {set.enabled && s.installed && (
        <div className="space-y-4 pt-3 border-t border-black/5 dark:border-white/5">
          <label className="text-xs text-gray-500 space-y-1 block max-w-xs"><span className="block">Name in Spotify</span>
            <input className={`${field} w-full`} defaultValue={set.name} maxLength={40} key={set.name}
              onBlur={e => e.target.value.trim() && e.target.value !== set.name && save({ name: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            {s.loggedIn && <button className={smallButton} disabled={busy} onClick={() => attempt(() => sp.control('signout'), 'Signed out of Spotify')}><LogOut size={13} />Sign out</button>}
            <button className={smallButton} disabled={busy} onClick={() => attempt(() => sp.control('restart'), 'Restarting Spotify on the Pi…')}><RotateCw size={13} />Restart</button>
          </div>
        </div>
      )}
    </div>
  );
}
