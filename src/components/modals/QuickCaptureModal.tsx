import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, CornerDownLeft, Sparkles, Calendar, Clock, X, Check } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { LifeContext } from '../../services/types';

interface QuickCaptureModalProps {
  onClose: () => void;
  onCaptured?: () => void;
  lifeContext?: LifeContext;
}

export function QuickCaptureModal({ onClose, onCaptured, lifeContext = 'work' }: QuickCaptureModalProps) {
  const [text, setText] = useState('');
  const [detectedDate, setDetectedDate] = useState<{ label: string; date: string; time?: string } | null>(null);
  const [includeDate, setIncludeDate] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Simple heuristic natural language date extractor
  useEffect(() => {
    const lower = text.toLowerCase();
    const now = new Date();
    
    if (lower.includes('today')) {
      setDetectedDate({ label: 'Today', date: now.toISOString().split('T')[0] });
    } else if (lower.includes('tomorrow')) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      setDetectedDate({ label: 'Tomorrow', date: tomorrow.toISOString().split('T')[0] });
    } else if (lower.includes('next week') || lower.includes('monday')) {
      const d = new Date(now);
      const daysUntilMon = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMon);
      setDetectedDate({ label: 'Next Monday', date: d.toISOString().split('T')[0] });
    } else if (lower.includes('weekend') || lower.includes('saturday')) {
      const d = new Date(now);
      const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntilSat);
      setDetectedDate({ label: 'Saturday', date: d.toISOString().split('T')[0] });
    } else {
      setDetectedDate(null);
    }
  }, [text]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = text.trim();
    if (!cleanText || isSaving) return;

    setIsSaving(true);
    try {
      const payload: any = {
        title: cleanText,
        lifeContext,
        isInbox: true,
        entityType: 'task',
        type: 'task',
        priority: 'medium',
        status: 'todo'
      };

      if (detectedDate && includeDate) {
        payload.dueDate = detectedDate.date;
      }

      await api.workItems.create(payload);
      showToast('Captured to Inbox');
      if (onCaptured) onCaptured();
      onClose();
    } catch (err: any) {
      showToast('Capture failed: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 md:pt-32 p-4 font-sans">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: -20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden relative z-10 border border-gray-100 dark:border-white/10 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            <Zap size={15} className="text-amber-500" />
            <span>Quick Capture to Inbox</span>
          </div>
          <span className="text-[11px] font-mono text-gray-400">Esc to close</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="What do you need to remember? (e.g. Call electrician tomorrow, Buy HDMI cable)"
              value={text}
              onChange={e => setText(e.target.value)}
              className="w-full text-lg md:text-xl font-medium bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          {detectedDate && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIncludeDate(!includeDate)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  includeDate 
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-400 border-transparent'
                }`}
              >
                <Calendar size={13} />
                <span>Detected: {detectedDate.label}</span>
                {includeDate && <Check size={12} />}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-white/5">
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <span>Saved to</span>
              <strong className="text-gray-700 dark:text-gray-300 capitalize">{lifeContext} Inbox</strong>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!text.trim() || isSaving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
              >
                <span>Capture</span>
                <CornerDownLeft size={13} />
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
