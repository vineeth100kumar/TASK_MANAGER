import React, { useState } from 'react';
import { Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';

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
  const toast = useToast();
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedItems, setExtractedItems] = useState<any[] | null>(null);

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
            start_at: item.start_at,
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

        toast.success(`Extracted & created ${res.items.length} item(s)`);
        onItemsCreated();
      } else {
        toast.warning('No actionable items detected in the text.');
      }
    } catch (e: any) {
      console.error('Failed to parse brain dump:', e);
      toast.error('Failed to parse brain dump. Check connection to Raspberry Pi.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="AI Brain Dump Capture"
      icon={<Sparkles className="w-4 h-4 text-blue-400" />}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-xs text-zinc-400">
          Paste notes, thoughts, or voice dictations. Local AI on Raspberry Pi 5 will parse tasks, deadlines, priorities, and expenses automatically.
        </p>

        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Pay electricity bill 2500 via upi tomorrow high priority, call doctor on Friday..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-zinc-500">Pressing process saves items directly</span>
          <Button
            onClick={handleProcess}
            isLoading={isProcessing}
            disabled={!text.trim()}
            variant="primary"
            size="sm"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Process & Save
          </Button>
        </div>

        {extractedItems && (
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center space-x-1.5 text-xs text-emerald-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Extracted & Added {extractedItems.length} item(s) to Sage OS:</span>
            </div>
            {extractedItems.map((item, idx) => (
              <div key={idx} className="text-xs bg-zinc-900 p-2.5 rounded-lg border border-zinc-800 text-zinc-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-100">{item.title}</span>
                  <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                    item.entity_type === 'event'
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                      : item.entity_type === 'reminder'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {item.entity_type || 'task'}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[11px] text-zinc-400">
                  {item.due_date && <span>📅 {item.due_date}</span>}
                  {item.start_at && <span>🕒 {item.start_at.split('T')[1]?.substring(0, 5)}</span>}
                  {item.priority && <span className="uppercase text-[9px] font-mono text-zinc-400">• {item.priority}</span>}
                  {item.expense && <span className="text-amber-400 font-medium">💰 ₹{item.expense.amount} ({item.expense.payment_mode})</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
