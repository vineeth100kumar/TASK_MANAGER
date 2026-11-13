// SpeakerCard - pick a paired soundbar as Sage's speaker: the welcome-home
// greeting, spoken reminders and phone pass-through (raspberry_pi/speaker.py).
// Spotify plays on it too: see SpotifyCard.

import { Select } from '../common/Select';
import { useState } from 'react';
import { Speaker, Loader2, Volume2, Link2, Unplug, Moon, AudioWaveform } from 'lucide-react';
import { useSpeaker, type SpeakerSettings, type SurroundMode, type LatencyMode } from '../../services/speaker';
import type { BluetoothDevice } from '../../services/bluetooth';
import { useToast } from '../../context/ToastContext';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const primaryButton = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const field = 'px-2.5 py-1.5 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';

const VOICE_LABEL: Record<string, string> = {
  bm_george: 'George (British, the butler)', bm_lewis: 'Lewis (British)', bm_daniel: 'Daniel (British)',
  am_michael: 'Michael (American)', am_adam: 'Adam (American)', bf_emma: 'Emma (British)',
  bf_isabella: 'Isabella (British)', af_heart: 'Heart (American)', af_bella: 'Bella (American)',
};

const SURROUND_MODES: { mode: Exclude<SurroundMode, 'off'>; label: string; hint: string }[] = [
  { mode: 'music', label: 'Music', hint: 'Wider, with fuller bass, crisper highs and more detail in quiet parts. Loud parts never clip.' },
  { mode: 'movie', label: 'Movie', hint: 'Wide and roomy, with dialogue lifted and quiet scenes brought up so you hear every word.' },
  { mode: 'wide', label: 'Wide', hint: 'The biggest sound. Best for games and concerts; can feel hollow on talk.' },
];

const LATENCY_MODES: { mode: LatencyMode; label: string; hint: string }[] = [
  { mode: 'lowest', label: 'Lowest', hint: 'About 0.1 s of buffer on the Pi. Least lag; may crackle if Bluetooth is busy.' },
  { mode: 'low', label: 'Low', hint: 'About 0.2 s of buffer on the Pi. A good balance for videos.' },
  { mode: 'steady', label: 'Steady', hint: 'About 0.5 s of buffer (the old setting). Most lag, fewest dropouts.' },
];

export function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (on: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className={`relative mt-0.5 w-10 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900 dark:text-white">{label}</span>
        <span className="block text-xs text-gray-400">{hint}</span>
      </span>
    </label>
  );
}

export function SpeakerCard({ devices }: { devices: BluetoothDevice[] }) {
  const sp = useSpeaker();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [lastMode, setLastMode] = useState<Exclude<SurroundMode, 'off'>>('movie');
  const s = sp.state;
  if (!s) return null;
  const set = s.settings;

  const attempt = async (job: () => Promise<string | null>, done?: string) => {
    setBusy(true);
    const problem = await job();
    setBusy(false);
    if (problem) showToast(problem, 'error');
    else if (done) showToast(done, 'success');
  };
  const save = (update: Partial<SpeakerSettings>) => attempt(() => sp.save(update));

  const candidates = devices.filter(d => d.paired && d.kind !== 'phone');
  const missing = [!s.tools.bluealsa && 'bluez-alsa', !s.tools.aplay && 'aplay', !s.tools.voice && 'the Kokoro voice'].filter(Boolean);
  const usbOn = !!s.usb?.on;
  const active = usbOn || !!set.address;
  const status = !active ? 'Off'
    : s.speaking ? 'Speaking…'
    : usbOn ? `USB sound card · ${s.usb?.card}` + (s.passing ? ' · playing your phone' : '')
    : s.soundbar.connected ? (s.passing ? 'Connected · playing your phone' : 'Connected') + (s.surroundOn ? ' · surround' : '')
    : 'Not connected · connects when you get home';

  return (
    <div className={card}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0"><Speaker size={17} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">Sage's speaker</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            {s.speaking && <Loader2 size={11} className="animate-spin" />}
            <span className="truncate">{status}{s.quietNow && active ? ' · quiet hours now' : ''}</span>
          </div>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
          The Pi is missing {missing.join(', ')}. Run once on the Pi: <code>sudo deploy/install_pi.sh --only audio,packages,server,web</code>
        </div>
      )}
      {s.error && <div className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-xs text-red-700 dark:text-red-300">{s.error.message}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <Select className={`${field} min-w-[12rem]`} value={set.output || 'auto'} disabled={busy} aria-label="Output"
          onChange={v => save({ output: v as 'auto' | 'usb' | 'bluetooth' })}>
          <option value="auto">Output: automatic (USB card if plugged in)</option>
          <option value="usb">Output: USB sound card</option>
          <option value="bluetooth">Output: Bluetooth soundbar</option>
        </Select>
        {!usbOn && set.output === 'usb' && <span className="text-xs text-amber-600">No USB sound card found. Plug it in.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className={`${field} flex-1 min-w-[12rem]`} value={set.address} disabled={busy} aria-label="Speaker"
          onChange={v => {
            const d = candidates.find(c => c.address === v);
            save({ address: v, name: d?.name || '' });
          }}>
          <option value="">No speaker</option>
          {candidates.map(d => <option key={d.address} value={d.address}>{d.name}</option>)}
          {set.address && !candidates.some(d => d.address === set.address) && <option value={set.address}>{set.name || set.address}</option>}
        </Select>
        {set.address && (s.soundbar.connected
          ? <button className={smallButton} disabled={busy} onClick={() => attempt(sp.disconnect)}><Unplug size={13} />Disconnect</button>
          : <button className={smallButton} disabled={busy} onClick={() => attempt(sp.connect)}><Link2 size={13} />Connect</button>)}
        {active && <button className={primaryButton} disabled={busy || !!s.speaking} onClick={() => attempt(sp.sayHello, 'Saying hello on the soundbar…')}><Volume2 size={14} />Say hello now</button>}
      </div>
      {!usbOn && candidates.length === 0 && <p className="text-xs text-gray-400">Pair your soundbar first: put it in Bluetooth pairing mode, tap Scan above, then Pair.</p>}

      {active && (
        <div className="space-y-4 pt-3 border-t border-black/5 dark:border-white/5">
          <Switch on={set.greet} onChange={on => save({ greet: on })} label="Welcome me home"
            hint="When your phone gets home, connect and greet you with the time, the weather and what's left today. At most once every 6 hours." />
          <Switch on={set.witty} onChange={on => save({ witty: on })} label="Butler-style wording"
            hint="Groq writes a fresh line each time, in the voice of an old-school English butler. Without a Groq key, a plain greeting is used." />
          <Switch on={set.chimes !== false} onChange={on => save({ chimes: on })} label="Little responses"
            hint="A few quiet words when things happen: the soundbar connects, you're back home, Spotify picks the Pi. Music fades down under the voice and back up." />
          <Switch on={set.reminders} onChange={on => save({ reminders: on })} label="Speak reminders" hint="While you're home, reminders are also said out loud." />
          <Switch on={set.phoneSpeaker} onChange={on => save({ phoneSpeaker: on })} label="Be a speaker for my phone"
            hint="Optional. Your phone sees the Pi as a Bluetooth speaker and its sound plays on the soundbar. Laggier than Spotify below; it steps aside while Spotify plays." />

          {set.phoneSpeaker && (
            <div className="pl-[3.25rem] space-y-1.5 -mt-2">
              <span className="block text-xs text-gray-500">Phone audio delay</span>
              <div className="inline-flex rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-0.5" role="radiogroup" aria-label="Phone audio delay">
                {LATENCY_MODES.map(m => (
                  <button key={m.mode} role="radio" aria-checked={(set.latency || 'low') === m.mode} disabled={busy}
                    onClick={() => save({ latency: m.mode })}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${(set.latency || 'low') === m.mode ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400">{LATENCY_MODES.find(m => m.mode === (set.latency || 'low'))?.hint}</p>
            </div>
          )}

          <div className="space-y-2">
            <Switch on={(set.surround || 'off') !== 'off'} onChange={on => save({ surround: on ? lastMode : 'off' })}
              label="Surround sound"
              hint="Makes the soundbar sound wider and roomier, for Spotify, the phone's audio and Sage's voice. Open-source virtual surround, not real Dolby Atmos." />
            {(set.surround || 'off') !== 'off' && (
              <div className="pl-[3.25rem] space-y-1.5">
                <div className="inline-flex rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 p-0.5" role="radiogroup" aria-label="Surround mode">
                  {SURROUND_MODES.map(m => (
                    <button key={m.mode} role="radio" aria-checked={set.surround === m.mode} disabled={busy}
                      onClick={() => { setLastMode(m.mode); save({ surround: m.mode }); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 ${set.surround === m.mode ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
                      {set.surround === m.mode && <AudioWaveform size={12} />}{m.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400">{SURROUND_MODES.find(m => m.mode === set.surround)?.hint}</p>
                {s.tools.surround === false && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">The surround plugin isn't on the Pi yet. Run once: <code>sudo deploy/install_pi.sh --only audio,server,web</code></p>
                )}
              </div>
            )}
          </div>

          {s.wifi?.available && (
            <div>
              <Switch on={!!s.wifi.on} onChange={on => attempt(() => sp.setWifi(on))} label="Pi Wi-Fi"
                hint={s.wifi.ethernet
                  ? 'The Pi is on Ethernet, so Wi-Fi can be off. That leaves the radio to Bluetooth for cleaner sound.'
                  : 'No Ethernet cable is connected, so Wi-Fi has to stay on.'} />
              <p className="pl-[3.25rem] text-[11px] text-gray-400">If the cable is unplugged, the Pi turns Wi-Fi back on by itself.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500 space-y-1"><span className="block">Voice</span>
              <Select className={`${field} w-full`} value={set.voice} aria-label="Voice" onChange={v => save({ voice: v })}>
                {s.voices.map(v => <option key={v} value={v}>{VOICE_LABEL[v] || v}</option>)}
              </Select>
            </label>
            <label className="text-xs text-gray-500 space-y-1"><span className="block">Call me</span>
              <input className={`${field} w-full`} defaultValue={set.callMe} placeholder="sir, Vineeth, or leave empty" maxLength={30}
                onBlur={e => e.target.value !== set.callMe && save({ callMe: e.target.value })} />
            </label>
            <label className="text-xs text-gray-500 space-y-1"><span className="block">Volume of the voice · {set.volume}%</span>
              <input type="range" min={10} max={100} step={5} defaultValue={set.volume} className="w-full"
                onPointerUp={e => save({ volume: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={e => save({ volume: Number((e.target as HTMLInputElement).value) })} />
            </label>
            <label className="text-xs text-gray-500 space-y-1"><span className="block flex items-center gap-1"><Moon size={11} />Quiet hours</span>
              <span className="flex items-center gap-2">
                <input type="time" className={field} defaultValue={set.quietStart} onBlur={e => e.target.value && e.target.value !== set.quietStart && save({ quietStart: e.target.value })} />
                <span>to</span>
                <input type="time" className={field} defaultValue={set.quietEnd} onBlur={e => e.target.value && e.target.value !== set.quietEnd && save({ quietEnd: e.target.value })} />
              </span>
            </label>
          </div>
          {s.last && <p className="text-xs text-gray-400">Last said: “{s.last.text}”</p>}
        </div>
      )}
    </div>
  );
}
