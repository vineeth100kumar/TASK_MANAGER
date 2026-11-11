// SiriSetupDemo.tsx - an animated walkthrough at the top of Settings > Shortcuts.
// A mock of the iPhone Shortcuts editor builds the "Sage" shortcut one action at
// a time, then a second scene shows what saying something to it looks like.
// It only draws; the real steps with copy buttons are in CaptureGuide below it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Mic, Globe, Quote, BookOpenText, Volume2 } from 'lucide-react';

type Scene = { title: string; text: string };

const SCENES: Scene[] = [
  { title: 'Make a shortcut called Sage', text: 'In the Shortcuts app tap +, then name it Sage. The name is what you say to Siri.' },
  { title: 'Add Dictate Text', text: 'It listens to you. Set Stop Listening to After Pause.' },
  { title: 'Add Get Contents of URL', text: 'Paste your Sage address and set Method to POST.' },
  { title: 'Send what you said', text: 'Add the Authorization header, then a JSON body with text set to Dictated Text and source set to siri.' },
  { title: 'Pick out the answer', text: 'Add Get Dictionary Value for the key say. That is the sentence Sage sends back.' },
  { title: 'Add Speak Text', text: 'Siri reads the answer out loud. Tap Done.' },
  { title: 'Now just talk to it', text: 'Say "Hey Siri, Sage", then say it any way you like. Sage works out the rest.' },
];

const PHRASES: Array<{ said: string; chips: string[]; reply: string }> = [
  { said: '5pm tomorrow call mom urgent', chips: ['Task', 'Call mom', 'Tomorrow 5 pm', 'Urgent'], reply: 'Added Call mom tomorrow at 5 pm, marked urgent.' },
  { said: 'kal subah 6 baje gym', chips: ['Task', 'Gym', 'Tomorrow 6 am'], reply: 'Added Gym tomorrow at 6 am.' },
  { said: 'remind me in half an hour to stretch', chips: ['Reminder', 'Stretch', 'Today +30 min'], reply: "I'll remind you to Stretch today at 10:30 am." },
  { said: 'mark call mom as done', chips: ['Done', 'Call mom'], reply: 'Marked Call mom as done.' },
  { said: "what's on today", chips: ['Ask', 'Today'], reply: 'Today you have 3: Call mom, Pay rent and Buy milk.' },
];

const STEP_MS = 3200;

const row = 'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left';

function ActionCard({ icon, name, children, fresh }: { icon: React.ReactNode; name: string; children?: React.ReactNode; fresh: boolean }) {
  return (
    <div
      className={`${row} bg-white dark:bg-white/10 transition-colors ${fresh ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-black/10 dark:border-white/10'}`}
      style={fresh ? { animation: 'fade-in 0.4s ease-out' } : undefined}
    >
      <span className="w-7 h-7 shrink-0 rounded-lg bg-blue-600 text-white flex items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-white leading-tight">{name}</div>
        {children && <div className="mt-1 space-y-0.5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{children}</div>}
      </div>
    </div>
  );
}

const Chip = ({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'gray' }) => (
  <span className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] break-all ${tone === 'blue' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-gray-200'}`}>{children}</span>
);

function Editor({ scene, url }: { scene: number; url: string }) {
  const shown = Math.min(scene, 5);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">Cancel</span>
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
          {scene === 0 ? <span className="border-r-2 border-blue-500 pr-0.5" style={{ animation: 'fade-in 0.6s ease-out infinite alternate' }}>Sage</span> : 'Sage'}
        </span>
        <span className={`text-[11px] font-semibold ${scene >= 5 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>Done</span>
      </div>
      {scene >= 1 && (
        <ActionCard icon={<Mic size={14} />} name="Dictate Text" fresh={shown === 1}>
          <div>Stop Listening: <Chip tone="gray">After Pause</Chip></div>
        </ActionCard>
      )}
      {scene >= 2 && (
        <ActionCard icon={<Globe size={14} />} name="Get Contents of URL" fresh={shown === 2 || shown === 3}>
          <div className="break-all"><Chip>{url}</Chip></div>
          <div>Method: <Chip tone="gray">POST</Chip></div>
          {scene >= 3 && (
            <div style={{ animation: 'fade-in 0.4s ease-out' }} className="space-y-0.5">
              <div>Headers: <Chip tone="gray">Authorization</Chip> <Chip tone="gray">Bearer ••••</Chip></div>
              <div>Request Body: <Chip tone="gray">JSON</Chip></div>
              <div><Chip>text</Chip> = <Chip tone="gray">Dictated Text</Chip></div>
              <div><Chip>source</Chip> = <Chip tone="gray">siri</Chip></div>
            </div>
          )}
        </ActionCard>
      )}
      {scene >= 4 && (
        <ActionCard icon={<BookOpenText size={14} />} name="Get Dictionary Value" fresh={shown === 4}>
          <div>Get value for <Chip>say</Chip> in <Chip tone="gray">Contents of URL</Chip></div>
        </ActionCard>
      )}
      {scene >= 5 && (
        <ActionCard icon={<Volume2 size={14} />} name="Speak Text" fresh={shown === 5}>
          <div><Chip tone="gray">Dictionary Value</Chip></div>
        </ActionCard>
      )}
    </div>
  );
}

function Talk({ phrase, tick }: { phrase: (typeof PHRASES)[number]; tick: number }) {
  // tick counts 0..3 inside one phrase: listening, heard, understood, answered.
  return (
    <div className="space-y-2.5 text-[12px]">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <span className="relative flex w-7 h-7 items-center justify-center rounded-full bg-blue-600 text-white">
          <Mic size={14} />
          {tick === 0 && <span className="absolute inset-0 rounded-full bg-blue-500/50 animate-ping" aria-hidden="true" />}
        </span>
        <span>{tick === 0 ? 'Listening…' : 'Hey Siri, Sage'}</span>
      </div>
      {tick >= 1 && (
        <div className="ml-9 px-3 py-2 rounded-2xl rounded-tl-sm bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-900 dark:text-white" style={{ animation: 'fade-in 0.35s ease-out' }}>
          <Quote size={11} className="inline mr-1 -mt-0.5 text-gray-400" />{phrase.said}
        </div>
      )}
      {tick >= 2 && (
        <div className="ml-9 flex flex-wrap gap-1" style={{ animation: 'fade-in 0.35s ease-out' }}>
          <span className="text-[10px] uppercase tracking-wider text-gray-400 self-center mr-1">Sage read</span>
          {phrase.chips.map(c => <Chip key={c}>{c}</Chip>)}
        </div>
      )}
      {tick >= 3 && (
        <div className="ml-9 px-3 py-2 rounded-2xl rounded-tl-sm bg-blue-600 text-white flex items-start gap-1.5" style={{ animation: 'fade-in 0.35s ease-out' }}>
          <Volume2 size={13} className="mt-0.5 shrink-0" />{phrase.reply}
        </div>
      )}
    </div>
  );
}

export function SiriSetupDemo({ url }: { url: string }) {
  const reduced = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const last = SCENES.length - 1;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    const ms = scene === last ? 1100 : STEP_MS;
    timer.current = setInterval(() => {
      if (scene < last) { setScene(s => s + 1); return; }
      setTick(t => {
        if (t < 3) return t + 1;
        setPhraseIdx(i => (i + 1) % PHRASES.length);
        return 0;
      });
    }, ms);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, scene, last]);

  const go = (n: number) => { setScene(Math.max(0, Math.min(last, n))); setTick(0); };
  const phrase = PHRASES[phraseIdx];
  const current = SCENES[scene];

  return (
    <div className="rounded-2xl border border-black/5 dark:border-white/5 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-white/5 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-stretch">
        <div className="sm:w-[260px] shrink-0 mx-auto w-full max-w-[280px]">
          <div className="rounded-[26px] border-4 border-gray-800 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 p-3 min-h-[300px]" aria-hidden="true">
            <div className="mx-auto mb-3 w-14 h-1 rounded-full bg-gray-400/50" />
            {scene < last ? <Editor scene={scene} url={url} /> : <Talk phrase={phrase} tick={tick} />}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
          <div aria-live="polite">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {scene < last ? `Step ${scene + 1} of ${last}` : 'Then'}
            </div>
            <h4 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">{current.title}</h4>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{current.text}</p>
            {scene === last && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Tap a dot below the phone to replay a step. Any order works: the day and time can come first, last or in the middle.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause the demo' : 'Play the demo'}
              className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shrink-0">
              {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
            </button>
            <button type="button" onClick={() => go(scene - 1)} disabled={scene === 0} aria-label="Previous step"
              className="w-8 h-8 rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-white/10 text-gray-700 dark:text-gray-200 disabled:opacity-40 flex items-center justify-center shrink-0">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => go(scene + 1)} disabled={scene === last} aria-label="Next step"
              className="w-8 h-8 rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-white/10 text-gray-700 dark:text-gray-200 disabled:opacity-40 flex items-center justify-center shrink-0">
              <ChevronRight size={16} />
            </button>
            <div className="flex items-center gap-1.5 ml-1 flex-wrap">
              {SCENES.map((s, i) => (
                <button key={s.title} type="button" onClick={() => go(i)} aria-label={`Go to: ${s.title}`} aria-current={i === scene}
                  className={`h-2 rounded-full transition-all ${i === scene ? 'w-5 bg-blue-600' : 'w-2 bg-gray-300 dark:bg-white/20 hover:bg-gray-400'}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
