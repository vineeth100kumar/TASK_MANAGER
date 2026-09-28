import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hourglass, UserCheck, Calendar, Plus, X, Check } from 'lucide-react';
import { api } from '../../services/api';
import { WorkItem, LifeContext } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { SnoozeMenu } from '../common/SnoozeMenu';

interface WaitingForViewProps {
  lifeContext: LifeContext;
  onSelectTask: (id: string) => void;
}

export function WaitingForView({ lifeContext, onSelectTask }: WaitingForViewProps) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [who, setWho] = useState('');
  const [about, setAbout] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const { showToast } = useToast();

  const loadWaiting = async () => {
    try {
      const waitingItems = await api.waitingFor.list(lifeContext);
      setItems(waitingItems);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadWaiting();
  }, [lifeContext]);
  useDataChanges(loadWaiting);

  const handleCreateWaiting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who.trim() || !about.trim()) return;

    try {
      await api.workItems.create({
        title: `Waiting for ${who.trim()}: ${about.trim()}`,
        lifeContext,
        entityType: 'task',
        type: 'task',
        priority: 'medium',
        status: 'blocked',
        blockedReason: `Waiting for ${who.trim()}`,
        waitingFor: {
          who: who.trim(),
          about: about.trim(),
          followUpDate: followUpDate || '',
          sinceDate: new Date().toISOString().split('T')[0]
        }
      });
      showToast('Delegated follow-up created');
      setWho('');
      setAbout('');
      setFollowUpDate('');
      setIsAddOpen(false);
      loadWaiting();
    } catch (err: any) {
      showToast('Creation failed: ' + err.message, 'error');
    }
  };

  const handleResolve = async (item: WorkItem) => {
    try {
      await api.waitingFor.set(item.id, null);
      showToast('Response received; moved to active tasks');
      loadWaiting();
    } catch (err) {
      console.error(err);
    }
  };

  const handleComplete = async (item: WorkItem) => {
    try {
      await api.workItems.transitionStatus(item.id, 'done', item.version);
      showToast('Completed');
      loadWaiting();
    } catch (err) {
      console.error(err);
    }
  };

  const calculateDaysSince = (sinceDate: string) => {
    const start = new Date(sinceDate).getTime();
    const now = Date.now();
    const diff = Math.floor((now - start) / 86400000);
    return Math.max(0, diff);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 font-sans">
      {/* Header Banner */}
      <div className="p-6 md:p-8 rounded-[32px] bg-[#f5f5f7] dark:bg-[#1c1c1e] border border-black/5 dark:border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-1">
            <Hourglass size={18} />
            <span>Waiting For & Delegations</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white">
            {items.length === 0 ? 'Nothing pending on others' : `${items.length} pending response${items.length === 1 ? '' : 's'}`}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Track questions asked, tasks delegated, and documents pending someone else's reply.
          </p>
        </div>

        <button 
          onClick={() => setIsAddOpen(true)}
          className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 active:scale-95 transition-transform"
        >
          <Plus size={14} /> New Follow-Up
        </button>
      </div>

      {/* Waiting Items List */}
      {items.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-[#1c1c1e] rounded-[32px] border border-black/5 dark:border-white/5 space-y-3">
          <div className="w-12 h-12 rounded-full bg-purple-50 dark:bg-purple-950/30 text-purple-500 mx-auto flex items-center justify-center">
            <UserCheck size={24} />
          </div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Nobody owes you a reply</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            When you email a professor, ask a colleague for a quote, or wait on a friend, track it here with an expected follow-up date.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const wf = item.waitingFor;
            const daysWaiting = wf?.sinceDate ? calculateDaysSince(wf.sinceDate) : 0;

            return (
              <motion.div
                key={item.id}
                layout
                className="p-5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-purple-500/20 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group"
              >
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-950/50 text-purple-600 dark:text-purple-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    {wf?.who ? wf.who[0].toUpperCase() : 'W'}
                  </div>

                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSelectTask(item.id)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-extrabold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
                        Waiting on {wf?.who || 'Someone'}
                      </span>
                      <span className="text-[11px] text-gray-400 font-medium">
                        · {daysWaiting === 0 ? 'Since today' : `${daysWaiting} day${daysWaiting === 1 ? '' : 's'} ago`}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors leading-snug">
                      {wf?.about || item.title}
                    </h4>

                    {wf?.followUpDate && (
                      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-500 dark:text-gray-400 font-semibold">
                        <Calendar size={12} className="text-purple-500" />
                        <span>Follow up by {wf.followUpDate}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <button
                    onClick={() => handleResolve(item)}
                    className="px-3.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                    title="Response received; clear waiting status"
                  >
                    <Check size={13} />
                    <span>Got Reply</span>
                  </button>

                  <button
                    onClick={() => handleComplete(item)}
                    className="px-3.5 py-1.5 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 font-bold text-xs rounded-xl transition-colors"
                  >
                    Mark Done
                  </button>

                  <SnoozeMenu itemId={item.id} onSnoozed={() => loadWaiting()} />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Modal: New Follow-up */}
      <AnimatePresence>
        {isAddOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsAddOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-[#1c1c1e] w-full max-w-md rounded-[32px] shadow-2xl p-6 relative z-10 border border-gray-100 dark:border-white/10 space-y-4"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  <Hourglass size={16} />
                  <span>Track Delegated Item</span>
                </div>
                <button onClick={() => setIsAddOpen(false)}><X size={18} className="text-gray-400" /></button>
              </div>

              <form onSubmit={handleCreateWaiting} className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Who are you waiting on?</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Professor Smith, PCB Supplier, Sarah" 
                    value={who} 
                    onChange={e => setWho(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/10 text-xs font-semibold outline-none dark:text-white"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">What did you ask for / delegate?</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Attendance confirmation letter, Quotation" 
                    value={about} 
                    onChange={e => setAbout(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/10 text-xs font-semibold outline-none dark:text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">When should you follow up if no reply?</label>
                  <input 
                    type="date" 
                    value={followUpDate} 
                    onChange={e => setFollowUpDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/10 text-xs font-semibold outline-none dark:text-white"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setIsAddOpen(false)} className="px-4 py-2 text-xs font-semibold text-gray-500">Cancel</button>
                  <button type="submit" disabled={!who.trim() || !about.trim()} className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md">
                    Track Item
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
