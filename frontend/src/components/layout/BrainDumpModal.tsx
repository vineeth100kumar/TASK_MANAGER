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
      title="The Wire & Intelligence Stream"
      icon={<Sparkles className="w-4 h-4 text-amber-500" />}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-xs font-editorial italic text-stone-300">
          Transmit raw dispatches, voice dictations, or unformatted thoughts. Sage Intelligence on Raspberry Pi 5 will decode clippings, deadlines, priorities, and ledger disbursements automatically.
        </p>

        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. Dispatched wire: Reconcile quarterly tax bill 2500 via UPI tomorrow !urgent, call architect on Friday...'
          className="w-full bg-[#0e0e11] border border-stone-700 rounded-none p-3 text-xs font-ledger text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] font-ledger uppercase text-stone-500">
            AUTO-FILED DIRECTLY TO SYSTEM RECORD
          </span>
          <Button
            onClick={handleProcess}
            isLoading={isProcessing}
            disabled={!text.trim()}
            variant="primary"
            size="sm"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Transmit & File
          </Button>
        </div>

        {extractedItems && (
          <div className="bg-[#0b0b0e] border border-stone-800 rounded-none p-3 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center space-x-1.5 text-xs font-ledger uppercase text-emerald-400 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Telegraph Decoded: {extractedItems.length} Item(s) Filed:</span>
            </div>
            {extractedItems.map((item, idx) => (
              <div key={idx} className="text-xs bg-[#131317] p-2.5 rounded-none border border-stone-800 text-stone-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-editorial font-bold text-stone-100">{item.title}</span>
                  <span className="text-[9px] font-ledger uppercase px-1.5 py-0.5 rounded-none border bg-stone-900 text-amber-400 border-amber-800">
                    {item.entity_type || 'task'}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[10px] font-ledger text-stone-400">
                  {item.due_date && <span>📅 {item.due_date}</span>}
                  {item.start_at && <span>🕒 {item.start_at.split('T')[1]?.substring(0, 5)}</span>}
                  {item.priority && <span className="uppercase font-bold text-stone-300">• {item.priority}</span>}
                  {item.expense && <span className="text-emerald-400 font-bold font-ledger">💰 ₹{item.expense.amount} ({item.expense.payment_mode})</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
