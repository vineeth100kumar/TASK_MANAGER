import React, { useState, useEffect } from 'react';
import { 
  Sun, Moon, CheckCircle2, Target, ArrowRight, ArrowLeft, 
  RotateCcw, Sparkles, CloudSun, Calendar, X, ShieldAlert,
  Flame, Check
} from 'lucide-react';
import { api } from '../../services/api';
import { KickoffData, WorkItem, WeatherData } from '../../types';

interface MorningEveningWizardProps {
  isOpen: boolean;
  initialMode?: 'morning' | 'evening';
  onClose: () => void;
  onTasksUpdated?: () => void;
}

export const MorningEveningWizard: React.FC<MorningEveningWizardProps> = ({
  isOpen,
  initialMode = 'morning',
  onClose,
  onTasksUpdated
}) => {
  const [mode, setMode] = useState<'morning' | 'evening'>(initialMode);
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  
  // Morning Kickoff Data
  const [kickoffData, setKickoffData] = useState<KickoffData | null>(null);
  const [selectedBigRocks, setSelectedBigRocks] = useState<string[]>([]);
  
  // Evening Debrief Data
  const [reflectionText, setReflectionText] = useState<string>('');
  const [selectedMood, setSelectedMood] = useState<string>('satisfied');
  const [autoMigrate, setAutoMigrate] = useState<boolean>(true);
  const [debriefSummary, setDebriefSummary] = useState<{
    completed: number;
    planned: number;
    migrated: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setStep(1);
      fetchWizardData();

      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleEsc);
      return () => window.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, initialMode, onClose]);

  const fetchWizardData = async () => {
    setLoading(true);
    try {
      const data = await api.getKickoff();
      setKickoffData(data);
      
      // Auto-select suggestions if available
      if (data.existing_reflection?.big_rocks && data.existing_reflection.big_rocks.length > 0) {
        setSelectedBigRocks(data.existing_reflection.big_rocks);
        if (data.existing_reflection.reflection) {
          setReflectionText(data.existing_reflection.reflection);
        }
        if (data.existing_reflection.mood) {
          setSelectedMood(data.existing_reflection.mood);
        }
      } else if (data.big_rock_suggestions && data.big_rock_suggestions.length > 0) {
        setSelectedBigRocks(data.big_rock_suggestions.slice(0, 3).map(s => s.id));
      }
    } catch (err) {
      console.error('Failed to load wizard data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const toggleBigRock = (id: string) => {
    if (selectedBigRocks.includes(id)) {
      setSelectedBigRocks(selectedBigRocks.filter(x => x !== id));
    } else {
      if (selectedBigRocks.length < 3) {
        setSelectedBigRocks([...selectedBigRocks, id]);
      }
    }
  };

  const handleFinishMorning = async () => {
    setSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await api.submitDebrief({
        date: today,
        big_rocks: selectedBigRocks,
        reflection: reflectionText,
        mood: selectedMood,
      });
      localStorage.setItem(`sage_morning_done_${today}`, 'true');
      onTasksUpdated?.();
      onClose();
    } catch (err) {
      console.error('Failed to save morning kickoff:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishEvening = async () => {
    setSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await api.submitDebrief({
        date: today,
        big_rocks: selectedBigRocks,
        reflection: reflectionText,
        mood: selectedMood,
      });
      setDebriefSummary({
        completed: res.completed_today,
        planned: res.planned,
        migrated: res.migrated_to_tomorrow
      });
      localStorage.setItem(`sage_evening_done_${today}`, 'true');
      onTasksUpdated?.();
      setStep(3); // Result step
    } catch (err) {
      console.error('Failed to submit evening debrief:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const moods = [
    { id: 'energized', emoji: '⚡', label: 'Energized' },
    { id: 'satisfied', emoji: '😊', label: 'Satisfied' },
    { id: 'calm', emoji: '🧘', label: 'Calm' },
    { id: 'tired', emoji: '😴', label: 'Tired' },
    { id: 'stretched', emoji: '🤯', label: 'Stretched' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-surface rounded-control border border-ink-base/25 dark:border-paper-light/20 shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-base/15 dark:border-paper-light/15 bg-paper-aged dark:bg-sunken">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded border flex items-center justify-center ${
              mode === 'morning' 
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-600/30' 
                : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-600/30'
            }`}>
              {mode === 'morning' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </div>
            <div>
              <div className="text-caption text-ink-muted dark:text-stone-400">
                {mode === 'morning' ? 'Morning plan' : 'Evening review'}
              </div>
              <h2 className="text-lg font-bold text-ink-base dark:text-paper-light">
                {mode === 'morning' ? 'Morning Edition — Daily Kickoff' : 'Evening Edition — Debrief & Close'}
              </h2>
              <p className="text-meta italic text-ink-muted dark:text-stone-400">
                {mode === 'morning' ? 'Eliminate decision fatigue • 60-second clarity plan' : 'Celebrate wins • Zero-guilt night reset'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMode(mode === 'morning' ? 'evening' : 'morning');
                setStep(1);
              }}
              className="px-2.5 py-1 text-meta rounded border border-ink-base/20 dark:border-paper-light/20 bg-paper-white dark:bg-stone-800 hover:bg-paper-aged dark:hover:bg-stone-700 text-ink-base dark:text-paper-light transition-colors"
            >
              Switch to {mode === 'morning' ? 'Evening' : 'Morning'}
            </button>
            <button 
              onClick={onClose}
              aria-label="Close wizard"
              className="p-1.5 rounded text-ink-muted dark:text-stone-400 hover:text-ink-base dark:hover:text-paper-light transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-ink-muted dark:text-stone-400">
              <div className="w-8 h-8 border border-amber-600 dark:border-amber-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm italic">Synthesizing daily mission parameters...</p>
            </div>
          ) : mode === 'morning' ? (
            // ==========================================
            // MORNING WIZARD STEPS
            // ==========================================
            <div>
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="p-4 rounded border border-amber-600/30 bg-amber-500/10">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-caption font-bold text-amber-700 dark:text-amber-400">
                          EDITION HEADLINE
                        </span>
                        <h3 className="text-xl font-bold text-ink-base dark:text-paper-light mt-0.5">
                          Good Morning, Chief
                        </h3>
                        <p className="text-meta italic text-ink-muted dark:text-stone-300 mt-1">
                          Today is a fresh canvas. Win the morning, win the day.
                        </p>
                      </div>
                      {kickoffData?.streak_days ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-600/40 bg-amber-500/15 text-amber-800 dark:text-amber-300">
                          <Flame className="w-4 h-4 fill-amber-500 text-amber-600" />
                          <span className="text-meta font-bold">{kickoffData.streak_days} DAY STREAK</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Scheduled Events Today */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-caption font-bold text-ink-muted dark:text-stone-400 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        Today's Scheduled Events ({kickoffData?.today_events?.length || 0})
                      </h4>
                    </div>
                    {kickoffData?.today_events && kickoffData.today_events.length > 0 ? (
                      <div className="space-y-1.5">
                        {kickoffData.today_events.map(ev => (
                          <div key={ev.id} className="flex items-center justify-between p-2.5 rounded border border-ink-base/15 dark:border-stone-700 bg-paper-aged/50 dark:bg-stone-800/60 text-sm">
                            <span className="text-ink-base dark:text-stone-200 font-medium">{ev.title}</span>
                            <span className="text-meta text-amber-700 dark:text-amber-400 font-bold">
                              {ev.start_at ? new Date(ev.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All Day'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-meta italic text-ink-muted dark:text-stone-500 p-3 rounded border border-ink-base/10 dark:border-stone-800 bg-paper-aged/30 dark:bg-stone-800/30">
                        No calendar blocks scheduled yet. Open canvas for deep focus!
                      </p>
                    )}
                  </div>

                  {/* Step 1 Footer */}
                  <div className="pt-4 flex justify-end">
                    <button
                      onClick={() => setStep(2)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded bg-ink-base hover:bg-sunken text-paper-white dark:bg-paper-light dark:hover:bg-paper-aged dark:text-ink-base font-bold text-meta transition-all shadow-sm"
                    >
                      Pick Top 3 Big Rocks <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5 animate-in fade-in">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-ink-base dark:text-paper-light flex items-center gap-2">
                        <Target className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        Select Today's Top 3 "Big Rocks"
                      </h3>
                      <span className={`text-meta px-2 py-0.5 rounded font-bold ${
                        selectedBigRocks.length === 3 
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40' 
                          : 'bg-paper-aged dark:bg-stone-800 text-ink-muted dark:text-stone-400 border border-ink-base/15 dark:border-stone-700'
                      }`}>
                        {selectedBigRocks.length} / 3 selected
                      </span>
                    </div>
                    <p className="text-meta italic text-ink-muted dark:text-stone-400 mt-1">
                      If you only get these 3 things done today, your day will be an absolute triumph.
                    </p>
                  </div>

                  {/* Task Candidates */}
                  <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1 custom-scrollbar">
                    {kickoffData?.active_tasks && kickoffData.active_tasks.length > 0 ? (
                      kickoffData.active_tasks.map(task => {
                        const isSelected = selectedBigRocks.includes(task.id);
                        return (
                          <div
                            key={task.id}
                            onClick={() => toggleBigRock(task.id)}
                            className={`flex items-center justify-between p-3 rounded border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-amber-500/15 border-amber-600/50 text-ink-base dark:text-paper-light shadow-sm'
                                : 'bg-paper-aged/40 dark:bg-stone-800/40 border-ink-base/15 dark:border-stone-800 text-ink-muted dark:text-stone-300 hover:bg-paper-aged/70'
                            }`}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0 pr-3">
                              <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                isSelected 
                                  ? 'bg-amber-600 border-amber-600 text-white' 
                                  : 'border-ink-base/30 dark:border-zinc-600 bg-paper-white dark:bg-zinc-800'
                              }`}>
                                {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </div>
                              <span className="text-sm font-medium truncate">{task.title}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {task.priority === 'urgent' && (
                                <span className="text-caption px-2 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/30 font-bold">
                                  Urgent
                                </span>
                              )}
                              {task.priority === 'high' && (
                                <span className="text-caption px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-bold">
                                  High
                                </span>
                              )}
                              {task.due_date && (
                                <span className="text-caption text-ink-muted dark:text-stone-400">
                                  {task.due_date}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm italic text-ink-muted dark:text-stone-500 text-center py-6">
                        No pending tasks found. Add some tasks first!
                      </p>
                    )}
                  </div>

                  {/* Step 2 Footer */}
                  <div className="pt-3 flex items-center justify-between border-t border-ink-base/15 dark:border-stone-800">
                    <button
                      onClick={() => setStep(1)}
                      className="flex items-center gap-1.5 px-3 py-2 text-meta rounded text-ink-muted dark:text-stone-400 hover:text-ink-base dark:hover:text-stone-100 transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Back
                    </button>
                    <button
                      onClick={handleFinishMorning}
                      disabled={submitting}
                      className="flex items-center gap-2 px-6 py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-meta shadow-md transition-all disabled:opacity-50"
                    >
                      {submitting ? 'LOCKING IN...' : '🚀 LOCK IN & START DAY'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // ==========================================
            // EVENING DEBRIEF STEPS
            // ==========================================
            <div>
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="p-4 rounded border border-indigo-500/30 bg-indigo-500/10">
                    <span className="text-caption font-bold text-indigo-700 dark:text-indigo-400">
                      Evening review
                    </span>
                    <h3 className="text-xl font-bold text-ink-base dark:text-paper-light mt-0.5">
                      Closing the Loop
                    </h3>
                    <p className="text-meta italic text-ink-muted dark:text-stone-300 mt-1">
                      Check off your wins, leave nothing lingering in your head, and sleep peacefully.
                    </p>
                  </div>

                  {/* Mood Selector */}
                  <div>
                    <label className="block text-caption font-bold text-ink-muted dark:text-stone-400 mb-2">
                      HOW WAS YOUR ENERGY & FOCUS TODAY?
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {moods.map(m => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedMood(m.id)}
                          className={`p-3 rounded border flex flex-col items-center gap-1.5 transition-all ${
                            selectedMood === m.id
                              ? 'bg-indigo-500/20 border-indigo-500/50 text-ink-base dark:text-white shadow-sm'
                              : 'bg-paper-aged/40 dark:bg-stone-800/40 border-ink-base/15 dark:border-stone-800 text-ink-muted dark:text-stone-400 hover:bg-paper-aged/70'
                          }`}
                        >
                          <span className="text-2xl">{m.emoji}</span>
                          <span className="text-caption font-medium">{m.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* One-Line Reflection */}
                  <div>
                    <label className="block text-caption font-bold text-ink-muted dark:text-stone-400 mb-1.5">
                      1-LINE REFLECTION OR NOTEWORTHY WIN
                    </label>
                    <textarea
                      value={reflectionText}
                      onChange={e => setReflectionText(e.target.value)}
                      placeholder="e.g. Shipped the deployment pipeline, hit 5k run pacing target..."
                      rows={2}
                      className="w-full bg-paper-aged/50 dark:bg-stone-900 border border-ink-base/20 dark:border-stone-700 rounded p-3 text-meta text-ink-base dark:text-paper-light placeholder-ink-muted/50 dark:placeholder-stone-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none shadow-inner"
                    />
                  </div>

                  {/* Zero-Guilt Migration Toggle */}
                  <div className="p-4 rounded border border-ink-base/15 dark:border-stone-700/50 bg-paper-aged/40 dark:bg-stone-800/50 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold text-ink-base dark:text-paper-light flex items-center gap-1.5">
                        <RotateCcw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                        Zero-Guilt Task Migration
                      </span>
                      <p className="text-meta italic text-ink-muted dark:text-stone-400 mt-0.5">
                        Automatically roll all unfinished tasks due today into tomorrow's docket.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutoMigrate(!autoMigrate)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoMigrate ? 'bg-indigo-600' : 'bg-paper-aged dark:bg-zinc-700 border border-ink-base/20 dark:border-transparent'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoMigrate ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  {/* Step 1 Footer */}
                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={handleFinishEvening}
                      disabled={submitting}
                      className="flex items-center gap-2 px-6 py-2.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-meta shadow-md transition-all disabled:opacity-50"
                    >
                      {submitting ? 'SUBMITTING...' : 'COMPLETE DEBRIEF & REST 🌙'}
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="py-8 text-center space-y-5 animate-in zoom-in-95">
                  <div className="w-16 h-16 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-ink-base dark:text-paper-light">
                      Day Officially Closed
                    </h3>
                    <p className="text-meta italic text-ink-muted dark:text-stone-400 mt-1 max-w-sm mx-auto">
                      {debriefSummary?.migrated 
                        ? `${debriefSummary.migrated} tasks smoothly migrated to tomorrow. Zero guilt, full reset.`
                        : 'All clear! Outstanding work today.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
                    <div className="p-3 rounded border border-ink-base/15 dark:border-stone-700/50 bg-paper-aged/50 dark:bg-stone-800/80">
                      <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{debriefSummary?.completed || 0}</div>
                      <div className="text-caption text-ink-muted dark:text-stone-400">Completed Today</div>
                    </div>
                    <div className="p-3 rounded border border-ink-base/15 dark:border-stone-700/50 bg-paper-aged/50 dark:bg-stone-800/80">
                      <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{debriefSummary?.migrated || 0}</div>
                      <div className="text-caption text-ink-muted dark:text-stone-400">Migrated to Tomorrow</div>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="px-6 py-2 rounded bg-paper-aged dark:bg-stone-800 hover:bg-paper-white dark:hover:bg-stone-700 text-ink-base dark:text-paper-light text-meta font-bold border border-ink-base/20 dark:border-stone-700 transition-colors"
                  >
                    Close Survey
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
