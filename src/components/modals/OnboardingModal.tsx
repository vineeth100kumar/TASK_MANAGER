import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Zap, CheckCircle2, ArrowRight, CornerDownLeft, Target, Bell, Calendar, X } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { LifeContext } from '../../services/types';

interface OnboardingModalProps {
  onClose: () => void;
  onComplete: () => void;
  lifeContext: LifeContext;
}

export function OnboardingModal({ onClose, onComplete, lifeContext }: OnboardingModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [openLoops, setOpenLoops] = useState(['', '', '']);
  const [capturedIds, setCapturedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const { showToast } = useToast();

  const handleBrainDump = async (e: React.FormEvent) => {
    e.preventDefault();
    const validLoops = openLoops.filter(l => l.trim().length > 0);
    if (validLoops.length === 0) return;

    setIsProcessing(true);
    const ids: string[] = [];
    try {
      for (const text of validLoops) {
        const item = await api.workItems.create({
          title: text.trim(),
          lifeContext,
          isInbox: true,
          entityType: 'task',
          type: 'task',
          priority: 'medium',
          status: 'todo'
        });
        ids.push(item.id);
      }
      setCapturedIds(ids);
      setStep(2);
    } catch (e: any) {
      showToast('Error saving: ' + e.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinish = async () => {
    await api.setMeta('onboarding_completed', true);
    showToast('Welcome to Sage!');
    onComplete();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-xl rounded-[32px] shadow-2xl p-8 relative z-10 border border-gray-100 dark:border-white/10 space-y-6"
      >
        {/* Step Indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${step === 1 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>1</span>
            <div className="w-8 h-0.5 bg-gray-200 dark:bg-white/10" />
            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${step === 2 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>2</span>
            <div className="w-8 h-0.5 bg-gray-200 dark:bg-white/10" />
            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${step === 3 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>3</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                <Sparkles size={16} />
                <span>Step 1 · The 60-Second Brain Dump</span>
              </div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white">What's on your mind right now?</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Don't organize or format them. Just type 3 open loops you need to remember.
              </p>
            </div>

            <form onSubmit={handleBrainDump} className="space-y-3">
              {openLoops.map((val, idx) => (
                <input
                  key={idx}
                  type="text"
                  placeholder={`Open loop #${idx + 1} (e.g. ${idx === 0 ? 'Email landlord about lease' : idx === 1 ? 'Buy new charging cable' : 'Prepare slides for Friday'})`}
                  value={val}
                  onChange={e => {
                    const copy = [...openLoops];
                    copy[idx] = e.target.value;
                    setOpenLoops(copy);
                  }}
                  className="w-full px-4 py-3 rounded-2xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/10 text-sm font-medium outline-none dark:text-white"
                  autoFocus={idx === 0}
                />
              ))}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={!openLoops.some(l => l.trim().length > 0) || isProcessing}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-md transition-all"
                >
                  <span>Capture to Inbox</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
                <CheckCircle2 size={16} />
                <span>Step 2 · 1-Click Clarify</span>
              </div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white">Thoughts captured into Inbox</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                In Sage, you never waste cognitive energy formatting at capture time. You triage them when you have a free minute.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30 text-xs text-blue-900 dark:text-blue-300 space-y-2">
              <p className="font-semibold">💡 What happens next:</p>
              <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                <li>Items in your <strong>Inbox</strong> stay calm until you're ready.</li>
                <li>Pin up to 5 items to your <strong>Focus Space</strong> to execute.</li>
                <li>Snooze anything with 1-click presets whenever plans shift.</li>
              </ul>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-md"
              >
                <span>Next: The Power Key</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5 text-center py-2">
            <div className="w-14 h-14 rounded-3xl bg-amber-50 dark:bg-amber-950/30 text-amber-500 mx-auto flex items-center justify-center">
              <Zap size={28} />
            </div>

            <div>
              <h2 className="text-2xl font-black text-gray-900 dark:text-white">Press C anywhere</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
                Anytime a thought pops into your head, hit <strong>C</strong> on your keyboard to instantly capture it in under 50ms.
              </p>
            </div>

            <button
              onClick={handleFinish}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-2xl shadow-lg active:scale-95 transition-transform"
            >
              Start Using Sage
            </button>
          </div>
        )}

      </motion.div>
    </div>
  );
}
