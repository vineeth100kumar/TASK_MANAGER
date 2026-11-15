// The mic button: talk to Sage with the browser's own microphone (the phone's
// on a phone, the laptop's on a laptop; nothing to pick). Tap it and speak one
// command. Or switch on "Hey Sage" and just say "Sage, set a timer for ten
// minutes". Browsers that can't keep the mic open (iPhone Safari) get the tap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Ear, Loader2 } from 'lucide-react';
import { lumoAvailable, lumoApi } from '../../services/lumo';
import { afterWakeWord, parseVoice, runVoice } from '../../services/voiceCommands';

const Recognition: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
// iPhone and iPad Safari stop the mic when the screen locks or the page hides, and
// won't restart it without a tap, so an always-open mic can't work there.
const isApple = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const WAKE_KEY = 'sage:voice-wake';
const ARMED_MS = 8000;

type Phase = 'idle' | 'tap' | 'wake' | 'armed' | 'working';

export function VoiceAssistant() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [wake, setWake] = useState<boolean>(() => { try { return !isApple && localStorage.getItem(WAKE_KEY) === '1'; } catch { return false; } });
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState<{ ok: boolean; say: string } | null>(null);
  const rec = useRef<any>(null);
  const mode = useRef<'tap' | 'wake' | 'off'>('off');
  const armedUntil = useRef(0);
  const hour24 = useRef(false);
  const clearTimer = useRef<number | undefined>(undefined);

  useEffect(() => { lumoApi.settings().then(s => { hour24.current = s.clock.hour24; }).catch(() => {}); }, []);

  const show = useCallback((ok: boolean, say: string) => {
    setReply({ ok, say });
    window.clearTimeout(clearTimer.current);
    clearTimer.current = window.setTimeout(() => { setReply(null); setHeard(''); }, 6000);
    try {
      if (ok && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(say); u.rate = 1.05; window.speechSynthesis.speak(u); }
    } catch { /* speaking is a bonus */ }
  }, []);

  const handle = useCallback(async (text: string) => {
    setPhase('working');
    const cmd = parseVoice(text);
    const result = cmd ? await runVoice(cmd, hour24.current) : { ok: false, say: `I didn't get a command from "${text}". Try "set a timer for 10 minutes".` };
    show(result.ok, result.say);
  }, [show]);

  const stop = useCallback(() => {
    mode.current = 'off';
    try { rec.current?.abort(); } catch { /* already stopped */ }
    rec.current = null;
    setPhase('idle');
  }, []);

  const start = useCallback((m: 'tap' | 'wake') => {
    if (!Recognition) return;
    try { rec.current?.abort(); } catch { /* none running */ }
    const r = new Recognition();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = m === 'wake';
    mode.current = m;
    rec.current = r;
    armedUntil.current = 0;
    setPhase(m);
    r.onresult = (ev: any) => {
      let finalText = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      if (m === 'tap') {
        setHeard(finalText || interim);
        if (finalText) { const text = finalText; mode.current = 'off'; try { r.stop(); } catch { /* */ } handle(text); }
        return;
      }
      const text = (finalText || interim).trim();
      if (!text) return;
      if (Date.now() < armedUntil.current) {            // "Sage" came just before: this is the command
        setHeard(text);
        if (finalText) { armedUntil.current = 0; setPhase('wake'); handle(finalText.trim()).then(() => setPhase('wake')); }
        return;
      }
      const after = afterWakeWord(text);
      if (after === null) return;                       // not for Sage
      setHeard(text);
      if (!finalText) return;
      if (after === '') { armedUntil.current = Date.now() + ARMED_MS; setPhase('armed'); window.setTimeout(() => setPhase(p => (p === 'armed' ? 'wake' : p)), ARMED_MS); }
      else handle(after).then(() => setPhase('wake'));
    };
    r.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { mode.current = 'off'; setWake(false); show(false, 'The microphone is blocked. Allow it for this site in the browser, then try again.'); }
      else if (e.error === 'no-speech' && m === 'tap') show(false, 'I did not hear anything.');
    };
    r.onend = () => {
      if (rec.current !== r) return;
      if (mode.current === 'wake' && !document.hidden) { try { r.start(); } catch { /* the browser is busy; the next visibility change retries */ } }
      else if (mode.current !== 'wake') setPhase(p => (p === 'working' ? p : 'idle'));
    };
    try { r.start(); } catch { /* already started */ }
  }, [handle, show]);

  // Always-listening: on while the page is visible, resumed when you come back to it.
  useEffect(() => {
    if (!wake || !Recognition) return;
    const onVis = () => { if (!document.hidden && mode.current !== 'tap' && phase !== 'working') start('wake'); };
    start('wake');
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); if (mode.current === 'wake') stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wake]);

  if (!Recognition || !lumoAvailable()) return null;

  const tapDone = () => { if (wake) start('wake'); };
  const onMic = () => {
    if (phase === 'tap') { stop(); tapDone(); return; }
    start('tap');
  };
  const toggleWake = () => {
    if (isApple) { show(false, 'iPhone Safari only listens while you tap the mic, so "Hey Sage" works on a laptop or Android.'); return; }
    const next = !wake;
    setWake(next);
    try { localStorage.setItem(WAKE_KEY, next ? '1' : '0'); } catch { /* optional */ }
    if (!next) stop();
  };
  const listening = phase === 'tap' || phase === 'armed';
  const status = phase === 'armed' ? 'Listening…' : phase === 'tap' ? 'Listening…' : phase === 'working' ? 'On it…' : wake ? 'Say "Sage…"' : '';

  return (
    <div className="fixed right-4 z-40 flex flex-col items-end gap-2 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] md:bottom-6 md:right-6">
      {(heard || reply || (phase !== 'idle' && status)) && (
        <div role="status" className={`max-w-[18rem] rounded-2xl border px-3 py-2 text-sm shadow-lg backdrop-blur bg-white/90 dark:bg-[#18181b]/90 ${reply && !reply.ok ? 'border-red-500/30 text-red-700 dark:text-red-300' : 'border-black/10 dark:border-white/10 text-gray-800 dark:text-gray-100'}`}>
          {heard && <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">“{heard}”</div>}
          <div>{reply ? reply.say : status}</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        {!isApple && (
          <button type="button" onClick={toggleWake} aria-pressed={wake} aria-label={wake ? 'Stop listening for "Sage"' : 'Listen for "Sage"'} title={wake ? 'Listening for "Sage"' : 'Listen for "Sage"'}
            className={`h-10 w-10 rounded-full flex items-center justify-center border shadow-md transition-colors ${wake ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-[#18181b] text-gray-600 dark:text-gray-300 border-black/10 dark:border-white/10'}`}>
            <Ear size={18} />
          </button>
        )}
        <button type="button" onClick={onMic} aria-label={listening ? 'Stop listening' : 'Talk to Sage'} title="Talk to Sage"
          className={`h-12 w-12 rounded-full flex items-center justify-center shadow-lg transition-colors ${listening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
          {phase === 'working' ? <Loader2 size={22} className="animate-spin" /> : <Mic size={22} />}
        </button>
      </div>
    </div>
  );
}
