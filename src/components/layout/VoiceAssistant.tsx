// Push to talk, on a computer only: hold the ` key (or hold the mic button), say the
// command, let go. The browser's own microphone records while it is held and the Pi
// turns it into words with Groq Whisper. No "Sage" wake word, and nothing on phones.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { lumoAvailable, lumoApi } from '../../services/lumo';
import { askAssistant, heraldConfirms, heraldSays, parseVoice, runVoice, transcribeClip, VoiceCommand } from '../../services/voiceCommands';
import { VoiceListener, micAvailable } from '../../services/voiceListener';

const MUTE_AFTER_COMMAND_MS = 10000;   // Herald's confirmation is playing: don't talk over it
const SHORTCUT = 'Backquote';          // the ` key
const MAX_HOLD_MS = 30000;

// Phones and tablets are left out for now.
const isComputer = () => typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches && !/Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

type Phase = 'idle' | 'recording' | 'working';

export function VoiceAssistant() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState<{ ok: boolean; say: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const listener = useRef<VoiceListener | null>(null);
  const holding = useRef(false);
  const mutedUntil = useRef(0);
  const busy = useRef(false);
  const hour24 = useRef(false);
  const timers = useRef<{ reply?: number; heard?: number; max?: number }>({});

  useEffect(() => { lumoApi.settings().then(s => { hour24.current = s.clock.hour24; }).catch(() => {}); }, []);

  const show = useCallback((ok: boolean, say: string, spoken = false) => {
    setReply({ ok, say });
    window.clearTimeout(timers.current.reply);
    timers.current.reply = window.setTimeout(() => { setReply(null); setHeard(''); }, 6000);
    try {
      if (ok && spoken && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(say); u.rate = 1.05; window.speechSynthesis.speak(u); }
    } catch { /* speaking is a bonus */ }
  }, []);

  // Run an alarm or timer command the app does itself; Herald confirms it in Alfred/Jarvis words.
  const runLocal = useCallback(async (cmd: VoiceCommand) => {
    const result = await runVoice(cmd, hour24.current);
    if (!result.ok) { show(false, result.say); return result; }
    const herald = await heraldConfirms(result.say);
    show(true, herald ?? result.say, herald === null);
    mutedUntil.current = Date.now() + MUTE_AFTER_COMMAND_MS;
    return result;
  }, [show]);

  // The words to an action: the app's own alarm/timer rules first, then the Pi (tasks, music,
  // the clock's screens and lights, volume, modes, the briefing, and Groq for odd phrasings).
  const runCommand = useCallback(async (text: string, quiet: boolean) => {
    const local = parseVoice(text);
    if (local) {
      const result = await runLocal(local);
      if (!result.nothingRinging) return true;       // "stop" with nothing ringing: maybe the music
    }
    const reply = await askAssistant(text);
    if (reply.command) { await runLocal(reply.command); return true; }
    if (!reply.handled) { if (!quiet) show(false, reply.say || `I didn't get a command from "${text}".`); return false; }
    if (reply.ok === false) { show(false, reply.say || 'That did not work.'); return true; }
    const say = reply.say || 'Done, sir.';
    if (reply.spoken) show(true, say, false);
    else if (reply.answer) { const said = await heraldSays(say); show(true, say, !said); }
    else { const herald = await heraldConfirms(say); show(true, herald ?? say, herald === null); }
    mutedUntil.current = Date.now() + MUTE_AFTER_COMMAND_MS;
    return true;
  }, [runLocal, show]);

  // The held key or button was let go: the mic closes and what was said goes off to be understood.
  const release = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    window.clearTimeout(timers.current.max);
    setSpeaking(false);
    const l = listener.current;
    listener.current = null;
    if (!l) { setPhase('idle'); return; }
    if (!l.running) { setPhase('idle'); return; }
    setPhase('working');
    l.stop();                               // hands over the clip, if anything was said
    window.setTimeout(() => { if (!busy.current) { setPhase(p => (p === 'working' ? 'idle' : p)); show(false, 'I did not hear anything.'); } }, 500);
  }, [show]);

  const onClip = useCallback(async (wav: Blob, seconds: number) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setPhase('working');
      const text = await transcribeClip(wav, seconds, false);
      if (!text) { show(false, 'I did not catch that.'); return; }
      setHeard(text);
      window.clearTimeout(timers.current.heard);
      timers.current.heard = window.setTimeout(() => setHeard(''), 5000);
      await runCommand(text, false);
    } catch (e: any) {
      show(false, e?.message || 'Voice failed.');
    } finally {
      busy.current = false;
      setPhase('idle');
    }
  }, [runCommand, show]);

  const press = useCallback(async () => {
    if (holding.current || busy.current) return;
    if (Date.now() < mutedUntil.current) return;     // Herald is still talking
    holding.current = true;
    setPhase('recording');
    // Hold as long as you like: only the release ends the clip.
    const l = new VoiceListener({
      clip: (wav, seconds) => { void onClip(wav, seconds); },
      level: setSpeaking,
      error: msg => { holding.current = false; listener.current = null; setPhase('idle'); show(false, msg); },
    }, { endSilenceMs: 600000, maxMs: MAX_HOLD_MS, minSpeechMs: 250 });
    listener.current = l;
    await l.start();
    if (!holding.current) { l.stop(); return; }      // let go before the mic was ready
    timers.current.max = window.setTimeout(release, MAX_HOLD_MS);
  }, [onClip, release, show]);

  // The shortcut: hold ` anywhere except while typing.
  useEffect(() => {
    if (!isComputer() || !micAvailable()) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== SHORTCUT || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      void press();
    };
    const up = (e: KeyboardEvent) => { if (e.code === SHORTCUT) release(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
  }, [press, release]);

  if (!isComputer() || !micAvailable() || !lumoAvailable()) return null;

  const recording = phase === 'recording';
  const status = recording ? (speaking ? 'Listening…' : 'Go ahead…') : phase === 'working' ? 'On it…' : '';

  return (
    <div className="fixed right-6 bottom-6 z-40 flex flex-col items-end gap-2">
      {(heard || reply || status) && (
        <div role="status" className={`max-w-[18rem] rounded-2xl border px-3 py-2 text-sm shadow-lg backdrop-blur bg-white/90 dark:bg-[#18181b]/90 ${reply && !reply.ok ? 'border-red-500/30 text-red-700 dark:text-red-300' : 'border-black/10 dark:border-white/10 text-gray-800 dark:text-gray-100'}`}>
          {heard && <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">“{heard}”</div>}
          <div>{reply ? reply.say : status}</div>
        </div>
      )}
      <button type="button" aria-label="Hold to talk to Sage" title="Hold to talk (or hold the ` key)"
        onPointerDown={e => { e.preventDefault(); void press(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
        className={`h-12 w-12 rounded-full flex items-center justify-center shadow-lg transition-colors select-none touch-none ${recording ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
        {phase === 'working' ? <Loader2 size={22} className="animate-spin" /> : <Mic size={22} />}
      </button>
    </div>
  );
}
