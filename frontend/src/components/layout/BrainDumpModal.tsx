import React, { useState } from 'react';
import { Sparkles, X, ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';

interface BrainDumpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onItemsCreated: () => void;
}

export const BrainDumpModal: React.FC<BrainDumpModalProps> = ({
  isOpen,
  onClose,
  onItemsCreated,
}) => {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedItems, setExtractedItems] = useState<any[] | null>(null);

  if (!isOpen) return null;

  const handleProcess = async () => {
    if (!text.trim()) return;
    setIsProcessing(true);
    setExtractedItems(null);

    try {
      const res = await api.parseBrainDump(text);
      if (res.success && res.items) {
        setExtractedItems(res.items);

        // Save each item
        for (const item of res.items) {
          await api.createItem({
            title: item.title,
            description: item.description,
            due_date: item.due_date,
            priority: item.priority || 'medium',
            entity_type: item.entity_type || 'task',
            status: 'todo',
          });

          // If an expense was detected in the brain dump, log it automatically!
          if (item.expense && item.expense.amount > 0) {
            try {
              const summary = await api.getFinanceSummary();
              const primaryAccount = summary.accounts[0];
              if (primaryAccount) {
                await api.createTransaction({
                  account_id: primaryAccount.id,
                  type: 'expense',
                  amount: item.expense.amount,
                  payment_mode: item.expense.payment_mode || 'upi',
                  description: item.title,
                  date: new Date().toISOString().split('T')[0],
                });
              }
            } catch (err) {
              console.error('Failed to auto-log detected expense', err);
            }
          }
        }

        onItemsCreated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-blue-400">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">AI Brain Dump Capture</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-zinc-400">
          Paste notes, thoughts, or voice dictations. Local AI on Raspberry Pi 5 will parse tasks, deadlines, priorities, and expenses automatically.
        </p>

        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Pay electricity bill 2500 via upi tomorrow high priority, call doctor on Friday..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-zinc-500">Pressing process saves items directly</span>
          <button
            onClick={handleProcess}
            disabled={isProcessing || !text.trim()}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 disabled:opacity-50"
          >
            <span>{isProcessing ? 'AI Processing...' : 'Process & Save'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {extractedItems && (
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Extracted & Added {extractedItems.length} items to Sage OS:</span>
            </div>
            {extractedItems.map((item, idx) => (
              <div key={idx} className="text-xs bg-zinc-900 p-2 rounded border border-zinc-800 text-zinc-300">
                <span className="font-semibold">{item.title}</span>
                {item.due_date && <span className="ml-2 text-zinc-400">📅 {item.due_date}</span>}
                {item.priority && <span className="ml-2 uppercase text-[10px] text-blue-400">{item.priority}</span>}
                {item.expense && <span className="ml-2 text-amber-400">₹{item.expense.amount} ({item.expense.payment_mode})</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
