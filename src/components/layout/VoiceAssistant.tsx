// The mic button: talk to Sage with the browser's own microphone (the phone's
// on a phone, the laptop's on a laptop; nothing to pick). Tap it and say one
// command. Or switch on the ear and just say "Sage, set a timer for ten minutes".
//
// The browser only listens: it cuts out each spoken clip (silence is never sent)
// and the Pi turns it into words with Groq Whisper, so it works the same on a
// laptop, Android and iPhone Safari.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Ear, Loader2 } from 'lucide-react';
import { lumoAvailable, lumoApi } from '../../services/lumo';
import { afterWakeWord, askAssistant, heraldConfirms, heraldSays, parseVoice, runVoice, transcribeClip, VoiceCommand } from '../../services/voiceCommands';
import { VoiceListener, micAvailable } from '../../services/voiceListener';

const WAKE_KEY = 'sage:voice-wake';
const ARMED_MS = 8000;
const MUTE_AFTER_COMMAND_MS = 10000;   // Herald's confirmation is playing: don't hear it as speech
const TAP_GIVE_UP_MS = 9000;

type Phase = 'idle' | 'tap' | 'wake' | 'armed' | 'working';

export function VoiceAssistant() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [wake, setWake] = useState<boolean>(() => { try { return localStorage.getItem(WAKE_KEY) === '1'; } catch { return false; } });
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState<{ ok: boolean; say: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const listener = useRef<VoiceListener | null>(null);
  const mode = useRef<'tap' | 'wake' | 'off'>('off');
  const armedUntil = useRef(0);
  const mutedUntil = useRef(0);
  const busy = useRef(false);
  const hour24 = useRef(false);
  const timers = useRef<{ reply?: number; heard?: number; tap?: number }>({});

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

  const stop = useCallback(() => {
    mode.current = 'off';
    window.clearTimeout(timers.current.tap);
    listener.current?.stop();
    listener.current = null;
    setSpeaking(false);
    setPhase('idle');
  }, []);

  // A clip of speech arrived: to words, then to a command.
  const onClip = useCallback(async (wav: Blob, seconds: number) => {
    const m = mode.current;
    if (m === 'off' || Date.now() < mutedUntil.current) return;
    if (busy.current) return;               // one at a time; the next clip is heard once this one is done
    busy.current = true;
    const back: Phase = m === 'wake' ? 'wake' : 'working';
    try {
      setPhase('working');
      const text = await transcribeClip(wav, seconds, m === 'wake');
      if (!text) { setPhase(m === 'wake' ? 'wake' : 'idle'); return; }
      setHeard(text);
      window.clearTimeout(timers.current.heard);
      timers.current.heard = window.setTimeout(() => setHeard(''), 5000);
      if (m === 'tap') { stop(); await runCommand(text, false); return; }
      const after = afterWakeWord(text);
      const armed = Date.now() < armedUntil.current;
      if (after === null && !armed) { setPhase('wake'); return; }       // not for Sage
      const command = (after ?? text).trim();
      if (!command) {                                                     // "Sage" alone: the command comes next
        armedUntil.current = Date.now() + ARMED_MS;
        setPhase('armed');
        window.setTimeout(() => setPhase(p => (p === 'armed' ? 'wake' : p)), ARMED_MS);
        return;
      }
      armedUntil.current = 0;
      await runCommand(command, !/\bsage\b/i.test(text));
      setPhase(back);
    } catch (e: any) {
      show(false, e?.message || 'Voice failed.');
      setPhase(mode.current === 'wake' ? 'wake' : 'idle');
    } finally {
      busy.current = false;
    }
  }, [runCommand, show, stop]);

  const begin = useCallback(async (m: 'tap' | 'wake') => {
    if (listener.current) { listener.current.stop(); listener.current = null; }
    mode.current = m;
    const l = new VoiceListener({
      clip: (wav, seconds) => { void onClip(wav, seconds); },
      level: setSpeaking,
      error: msg => { mode.current = 'off'; setPhase('idle'); if (m === 'wake') { setWake(false); try { localStorage.setItem(WAKE_KEY, '0'); } catch { /* optional */ } } show(false, msg); },
    });
    listener.current = l;
    setPhase(m);
    await l.start();
    if (!l.running) return;
    if (m === 'tap') {
      window.clearTimeout(timers.current.tap);
      timers.current.tap = window.setTimeout(() => {
        if (mode.current === 'tap' && !busy.current) { stop(); show(false, 'I did not hear anything.'); }
      }, TAP_GIVE_UP_MS);
    }
  }, [onClip, show, stop]);

  // Always-listening: on while the page is visible, picked up again when you come back to it.
  useEffect(() => {
    if (!wake || !micAvailable()) return;
    const onVis = () => {
      if (document.hidden) { if (mode.current === 'wake') { listener.current?.stop(); listener.current = null; } }
      else if (mode.current !== 'tap') void begin('wake');
    };
    void begin('wake');
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); if (mode.current === 'wake') stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wake]);

  if (!micAvailable() || !lumoAvailable()) return null;

  const onMic = () => {
    if (phase === 'tap') { stop(); if (wake) void begin('wake'); return; }
    void begin('tap');
  };
  const toggleWake = () => {
    const next = !wake;
    setWake(next);
    try { localStorage.setItem(WAKE_KEY, next ? '1' : '0'); } catch { /* optional */ }
    if (!next) stop();
  };
  const listening = phase === 'tap' || phase === 'armed';
  const status = phase === 'armed' ? 'Listening…' : phase === 'tap' ? (speaking ? 'Listening…' : 'Go ahead…') : phase === 'working' ? 'On it…' : wake ? 'Say "Sage…"' : '';

  return (
    <div className="fixed right-4 z-40 flex flex-col items-end gap-2 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-6 md:right-6">
      {(heard || reply || (phase !== 'idle' && status)) && (
        <div role="status" className={`max-w-[18rem] rounded-2xl border px-3 py-2 text-sm shadow-lg backdrop-blur bg-white/90 dark:bg-[#18181b]/90 ${reply && !reply.ok ? 'border-red-500/30 text-red-700 dark:text-red-300' : 'border-black/10 dark:border-white/10 text-gray-800 dark:text-gray-100'}`}>
          {heard && <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">“{heard}”</div>}
          <div>{reply ? reply.say : status}</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggleWake} aria-pressed={wake} aria-label={wake ? 'Stop listening for "Sage"' : 'Listen for "Sage"'} title={wake ? 'Listening for "Sage"' : 'Listen for "Sage"'}
          className={`h-10 w-10 rounded-full flex items-center justify-center border shadow-md transition-colors ${wake ? (speaking ? 'bg-blue-500 text-white border-blue-500 animate-pulse' : 'bg-blue-600 text-white border-blue-600') : 'bg-white dark:bg-[#18181b] text-gray-600 dark:text-gray-300 border-black/10 dark:border-white/10'}`}>
          <Ear size={18} />
        </button>
        <button type="button" onClick={onMic} aria-label={listening ? 'Stop listening' : 'Talk to Sage'} title="Talk to Sage"
          className={`h-12 w-12 rounded-full flex items-center justify-center shadow-lg transition-colors ${listening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
          {phase === 'working' ? <Loader2 size={22} className="animate-spin" /> : <Mic size={22} />}
        </button>
      </div>
    </div>
  );
}
