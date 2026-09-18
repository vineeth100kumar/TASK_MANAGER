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

  const card =
    'p-4 rounded-surface bg-sunken';

  const primary =
    'flex items-center justify-center gap-2 h-11 px-5 rounded-control bg-accent-500 ' +
    'hover:bg-accent-600 text-white text-meta font-semibold ' +
    'active:scale-[0.98] transition-all duration-200 ease-spring ' +
    'disabled:opacity-40 disabled:pointer-events-none';

  const quiet =
    'flex items-center gap-1.5 h-11 px-3 rounded-control text-meta text-ink-2 ' +
    'hover:text-ink hover:bg-sunken transition-colors duration-150';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4">
      <div className="relative w-full sm:max-w-lg bg-surface rounded-t-surface sm:rounded-surface shadow-lift-3 overflow-hidden flex flex-col max-h-[92vh] pb-safe sm:pb-0">
        {/* Handle, so the sheet reads as a sheet on a phone */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <span className="w-9 h-1 rounded-full bg-hairline" />
        </div>

        <header className="flex items-start justify-between gap-3 px-5 pt-4 sm:pt-5 pb-4 shrink-0">
          <div className="min-w-0">
            <span className="label flex items-center gap-1.5">
              {mode === 'morning' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {mode === 'morning' ? 'Morning plan' : 'Evening review'}
            </span>
            <h2 className="text-title font-semibold text-ink mt-1">
              {mode === 'morning' ? 'Plan the day' : 'Close the day'}
            </h2>
            <p className="text-meta text-ink-2 mt-1">
              {mode === 'morning'
                ? 'Three things worth doing. A minute, at most.'
                : 'What landed, and what moves to tomorrow.'}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                setMode(mode === 'morning' ? 'evening' : 'morning');
                setStep(1);
              }}
              className="px-2.5 h-8 rounded-control text-meta text-ink-2 hover:text-ink hover:bg-sunken transition-colors duration-150"
            >
              {mode === 'morning' ? 'Evening' : 'Morning'}
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 grid place-items-center rounded-control text-ink-3 hover:text-ink hover:bg-sunken transition-colors duration-150"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </header>

        <div className="px-5 pb-5 overflow-y-auto flex-1 no-scrollbar">
          {loading ? (
            /* The Pi takes a moment. Say what is happening rather than spinning silently. */
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <span className="w-6 h-6 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
              <p className="text-meta text-ink-3">Reading your day</p>
            </div>
          ) : mode === 'morning' ? (
            <div className="enter">
              {step === 1 && (
                <div className="space-y-5">
                  {kickoffData?.streak_days ? (
                    <div className={`${card} flex items-center gap-3`} style={{ ['--i' as string]: 0 }}>
                      <Flame className="w-5 h-5 text-late-500 dark:text-late-400 shrink-0" />
                      <div>
                        <p className="text-body text-ink">
                          {kickoffData.streak_days} days in a row
                        </p>
                        <p className="text-meta text-ink-3 mt-0.5">Worth keeping.</p>
                      </div>
                    </div>
                  ) : null}

                  <div style={{ ['--i' as string]: 1 }}>
                    <h3 className="label mb-2 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {kickoffData?.today_events?.length
                        ? `${kickoffData.today_events.length} scheduled`
                        : 'Nothing scheduled'}
                    </h3>

                    {kickoffData?.today_events && kickoffData.today_events.length > 0 ? (
                      <div>
                        {kickoffData.today_events.map((ev) => (
                          <div key={ev.id} className="row">
                            <span className="text-body text-ink flex-1 min-w-0">{ev.title}</span>
                            <span className="text-meta text-ink-2 tabular shrink-0">
                              {ev.start_at
                                ? new Date(ev.start_at).toLocaleTimeString([], {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })
                                : 'All day'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-meta text-ink-3">
                        The day is yours to shape.
                      </p>
                    )}
                  </div>

                  <div className="pt-1 flex justify-end" style={{ ['--i' as string]: 2 }}>
                    <button onClick={() => setStep(2)} className={primary}>
                      Pick your three <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div style={{ ['--i' as string]: 0 }}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-lead font-semibold text-ink">
                        Three things
                      </h3>
                      <span className="text-meta text-ink-3 tabular shrink-0">
                        {selectedBigRocks.length} of 3
                      </span>
                    </div>
                    <p className="text-meta text-ink-2 mt-1">
                      If only these get done, the day still counts.
                    </p>
                  </div>

                  <div className="max-h-[46vh] overflow-y-auto no-scrollbar" style={{ ['--i' as string]: 1 }}>
                    {kickoffData?.active_tasks && kickoffData.active_tasks.length > 0 ? (
                      kickoffData.active_tasks.map((task) => {
                        const isSelected = selectedBigRocks.includes(task.id);
                        const full = selectedBigRocks.length >= 3 && !isSelected;
                        return (
                          <button
                            key={task.id}
                            onClick={() => toggleBigRock(task.id)}
                            disabled={full}
                            className={`row row-interactive w-full text-left px-1 ${
                              full ? 'opacity-40 cursor-not-allowed' : ''
                            }`}
                          >
                            <span
                              role="checkbox"
                              aria-checked={isSelected}
                              data-checked={isSelected}
                              className="check mt-0.5"
                            />
                            <span className="min-w-0 flex-1">
                              <span className={`block text-body ${isSelected ? 'text-ink' : 'text-ink-2'}`}>
                                {task.title}
                              </span>
                              {task.priority === 'urgent' && (
                                <span className="block text-meta text-late-500 dark:text-late-400 mt-0.5">
                                  Urgent
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="text-meta text-ink-3 py-6 text-center">
                        Nothing to choose from yet. Add a task first.
                      </p>
                    )}
                  </div>

                  <div className="pt-3 flex items-center justify-between border-t border-hairline">
                    <button onClick={() => setStep(1)} className={quiet}>
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button onClick={handleFinishMorning} disabled={submitting} className={primary}>
                      {submitting ? 'Saving' : 'Start the day'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="enter">
              {step === 1 && (
                <div className="space-y-6">
                  <div style={{ ['--i' as string]: 0 }}>
                    <label className="label block mb-2">How did today feel?</label>
                    <div className="grid grid-cols-5 gap-2">
                      {moods.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedMood(m.id)}
                          aria-pressed={selectedMood === m.id}
                          className={`py-2.5 rounded-control flex flex-col items-center gap-1.5 border transition-all duration-200 ease-spring ${
                            selectedMood === m.id
                              ? 'bg-accent-500/10 border-accent-500/40 scale-[1.03]'
                              : 'bg-sunken border-transparent hover:bg-hairline/60'
                          }`}
                        >
                          <span className="text-xl leading-none">{m.emoji}</span>
                          <span
                            className={`text-caption ${
                              selectedMood === m.id ? 'text-ink' : 'text-ink-3'
                            }`}
                          >
                            {m.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ ['--i' as string]: 1 }}>
                    <label htmlFor="sage-reflection" className="label block mb-1.5">
                      Anything worth remembering?
                    </label>
                    <textarea
                      id="sage-reflection"
                      value={reflectionText}
                      onChange={(e) => setReflectionText(e.target.value)}
                      placeholder="Optional. One line is plenty."
                      rows={2}
                      className="field resize-none"
                    />
                  </div>

                  <div className={`${card} flex items-center justify-between gap-4`} style={{ ['--i' as string]: 2 }}>
                    <div className="min-w-0">
                      <span className="text-body text-ink flex items-center gap-1.5">
                        <RotateCcw className="w-4 h-4 text-ink-3 shrink-0" />
                        Move what is left to tomorrow
                      </span>
                      <p className="text-meta text-ink-2 mt-0.5">
                        Nothing is lost, and nothing stays overdue.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoMigrate}
                      aria-label="Move unfinished tasks to tomorrow"
                      onClick={() => setAutoMigrate(!autoMigrate)}
                      className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-200 ease-settle ${
                        autoMigrate ? 'bg-accent-500' : 'bg-hairline'
                      }`}
                    >
                      <span
                        className={`inline-block h-[27px] w-[27px] transform rounded-full bg-white shadow-lift-1 transition-transform duration-300 ease-spring ${
                          autoMigrate ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex justify-end" style={{ ['--i' as string]: 3 }}>
                    <button onClick={handleFinishEvening} disabled={submitting} className={primary}>
                      {submitting ? 'Saving' : 'Close the day'}
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="py-8 text-center space-y-6">
                  <div className="w-14 h-14 rounded-full bg-done-500/12 text-done-500 dark:text-done-400 grid place-items-center mx-auto">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>

                  <div>
                    <h3 className="text-title font-semibold text-ink">That is the day</h3>
                    <p className="text-meta text-ink-2 mt-1.5 max-w-xs mx-auto">
                      {debriefSummary?.migrated
                        ? `${debriefSummary.migrated} ${
                            debriefSummary.migrated === 1 ? 'task moves' : 'tasks move'
                          } to tomorrow.`
                        : 'Nothing left over.'}
                    </p>
                  </div>

                  <div className="flex justify-center gap-10">
                    <div>
                      <div className="text-display font-bold text-ink tabular leading-none">
                        {debriefSummary?.completed || 0}
                      </div>
                      <div className="text-meta text-ink-3 mt-1.5">Done today</div>
                    </div>
                    <div>
                      <div className="text-display font-bold text-ink tabular leading-none">
                        {debriefSummary?.migrated || 0}
                      </div>
                      <div className="text-meta text-ink-3 mt-1.5">Tomorrow</div>
                    </div>
                  </div>

                  <button onClick={onClose} className={`${primary} mx-auto`}>
                    Good night
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
