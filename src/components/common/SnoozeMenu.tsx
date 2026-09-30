import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Sun, Moon, Calendar, ArrowRight, X } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';

interface SnoozeMenuProps {
  itemId: string;
  onSnoozed?: (untilIso: string) => void;
  className?: string;
}

export function SnoozeMenu({ itemId, onSnoozed, className = '' }: SnoozeMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const { showToast } = useToast();

  const applySnooze = async (targetDate: Date, label: string) => {
    const iso = targetDate.toISOString();
    try {
      await api.snooze.snoozeItem(itemId, iso);
      showToast(`Snoozed until ${label}`);
      setIsOpen(false);
      setIsCustomOpen(false);
      if (onSnoozed) onSnoozed(iso);
    } catch (e: any) {
      showToast('Snooze failed: ' + e.message, 'error');
    }
  };

  const handlePreset = (preset: 'later_today' | 'tonight' | 'tomorrow' | 'weekend' | 'next_week') => {
    const now = new Date();
    if (preset === 'later_today') {
      const d = new Date(now.getTime() + 3 * 3600 * 1000);
      applySnooze(d, 'later today');
    } else if (preset === 'tonight') {
      const d = new Date(now);
      d.setHours(20, 0, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      applySnooze(d, 'tonight 8:00 PM');
    } else if (preset === 'tomorrow') {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      applySnooze(d, 'tomorrow 9:00 AM');
    } else if (preset === 'weekend') {
      const d = new Date(now);
      const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntilSat);
      d.setHours(9, 0, 0, 0);
      applySnooze(d, 'Saturday 9:00 AM');
    } else if (preset === 'next_week') {
      const d = new Date(now);
      const daysUntilMon = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMon);
      d.setHours(9, 0, 0, 0);
      applySnooze(d, 'next Monday 9:00 AM');
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDate) return;
    const d = new Date(customDate);
    applySnooze(d, d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  };

  return (
    <div className={`relative inline-block ${className}`} onClick={(e) => e.stopPropagation()}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
        title="Snooze item"
      >
        <Clock size={15} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 5 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              className="absolute right-0 mt-2 w-56 surface-float rounded-2xl z-50 p-1.5 overflow-hidden text-xs"
            >
              {!isCustomOpen ? (
                <div className="space-y-0.5">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Snooze Until
                  </div>
                  <button onClick={() => handlePreset('later_today')} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200">
                    <span className="flex items-center gap-2"><Sun size={14} className="text-amber-500"/> Later Today</span>
                    <span className="text-[10px] text-gray-400 font-semibold">+3h</span>
                  </button>
                  <button onClick={() => handlePreset('tonight')} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200">
                    <span className="flex items-center gap-2"><Moon size={14} className="text-indigo-500"/> Tonight</span>
                    <span className="text-[10px] text-gray-400 font-semibold">8 PM</span>
                  </button>
                  <button onClick={() => handlePreset('tomorrow')} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200">
                    <span className="flex items-center gap-2"><Calendar size={14} className="text-blue-500"/> Tomorrow</span>
                    <span className="text-[10px] text-gray-400 font-semibold">9 AM</span>
                  </button>
                  <button onClick={() => handlePreset('weekend')} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200">
                    <span className="flex items-center gap-2"><Calendar size={14} className="text-purple-500"/> This Weekend</span>
                    <span className="text-[10px] text-gray-400 font-semibold">Sat</span>
                  </button>
                  <button onClick={() => handlePreset('next_week')} className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200">
                    <span className="flex items-center gap-2"><ArrowRight size={14} className="text-emerald-500"/> Next Week</span>
                    <span className="text-[10px] text-gray-400 font-semibold">Mon</span>
                  </button>
                  
                  <div className="pt-1 border-t border-gray-100 dark:border-white/5">
                    <button onClick={() => setIsCustomOpen(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-500 font-semibold">
                      <Clock size={14}/> Pick Date & Time...
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCustomSubmit} className="p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-gray-400">Custom Snooze</span>
                    <button type="button" onClick={() => setIsCustomOpen(false)}><X size={13} className="text-gray-400"/></button>
                  </div>
                  <input 
                    type="datetime-local" 
                    value={customDate} 
                    onChange={e => setCustomDate(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10 outline-none"
                    autoFocus
                  />
                  <button 
                    type="submit" 
                    disabled={!customDate}
                    className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs"
                  >
                    Set Snooze
                  </button>
                </form>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
