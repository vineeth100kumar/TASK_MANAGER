import React, { useState } from 'react';
import { Sparkles, ArrowRight, CheckCircle2, Radio, Loader2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useToast } from '../../context/ToastContext';
import { useCapture } from '../../hooks/useCapture';
import { CapturedItem } from '../../types';

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
  const [extractedItems, setExtractedItems] = useState<CapturedItem[] | null>(null);

  // One call does the whole job now: the Pi reads the note, creates the items
  // and logs any spend in a single transaction, then tells every device. The
  // old loop made a round trip per item while the Pi was at its busiest.
  const { capture, isCapturing, expectedSeconds, elapsedSeconds, usedFallback } = useCapture();

  const handleProcess = async () => {
    if (!text.trim()) return;
    setExtractedItems(null);

    try {
      const items = await capture(text);
      if (items.length) {
        setExtractedItems(items);
        toast.success(`Captured ${items.length} item${items.length === 1 ? '' : 's'}`);
        onItemsCreated();
      } else {
        toast.warning('Nothing to capture in that note.');
      }
    } catch (e: any) {
      console.error('Capture failed:', e);
      toast.error('Could not reach the Pi. Check the connection.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Quick capture"
      icon={<Radio className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-meta italic text-ink-muted dark:text-stone-300 leading-relaxed">
          Transmit raw dispatches, voice transcripts, or unformatted thoughts. Sage Intelligence on Raspberry Pi 5 will decode clippings, deadlines, priorities, and ledger disbursements automatically.
        </p>

        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. Pay the tax bill 2500 by UPI tomorrow !urgent, call the architect Friday…'
          className="w-full bg-paper-aged/50 dark:bg-[#0e0e11] border border-ink-base/20 dark:border-stone-700 rounded-lg p-3 text-meta text-ink-base dark:text-stone-100 placeholder-ink-muted/50 dark:placeholder-stone-600 focus:outline-none focus:border-amber-600 dark:focus:border-amber-500 shadow-inner"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-caption text-ink-muted dark:text-stone-500">
            Saved straight to your tasks
          </span>
          <Button
            onClick={handleProcess}
            isLoading={isCapturing}
            disabled={!text.trim() || isCapturing}
            variant="primary"
            size="sm"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Transmit & File
          </Button>
        </div>

        {/* While the model runs, the Pi is busy and slow to answer anything
            else. Say so plainly, with the time passing, rather than leaving a
            spinner that reads as a hang. */}
        {isCapturing && (
          <div className="flex items-center gap-2 text-xs text-ink-muted dark:text-stone-400 bg-paper-aged/40 dark:bg-[#0b0b0e] border border-ink-base/15 dark:border-stone-800 rounded-lg p-2.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>
              Reading your note on the Pi
              {elapsedSeconds > 0 && ` — ${elapsedSeconds}s`}
              {expectedSeconds ? `, usually about ${Math.round(expectedSeconds)}s` : ''}.
              The app may be slow to respond until it finishes.
            </span>
          </div>
        )}

        {usedFallback && extractedItems && (
          <div className="text-[10px] text-ink-muted dark:text-stone-500">
            The model was unavailable, so this was read without it. Dates and times are still exact.
          </div>
        )}

        {extractedItems && (
          <div className="bg-paper-aged/40 dark:bg-[#0b0b0e] border border-ink-base/15 dark:border-stone-800 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
            <div className="flex items-center space-x-1.5 text-meta text-emerald-600 dark:text-emerald-400 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Found {extractedItems.length} {extractedItems.length === 1 ? 'item' : 'items'}:</span>
            </div>
            {extractedItems.map((item, idx) => (
              <div key={idx} className="text-meta bg-paper-white dark:bg-surface p-2.5 rounded border border-ink-base/15 dark:border-stone-800 text-ink-base dark:text-stone-300 space-y-1 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-ink-base dark:text-stone-100">{item.title}</span>
                  <span className="text-caption px-1.5 py-0.5 rounded border bg-paper-aged dark:bg-stone-900 text-amber-700 dark:text-amber-400 border-amber-600/30">
                    {item.entity_type || 'task'}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-caption text-ink-muted dark:text-stone-400">
                  {item.due_date && <span>📅 {item.due_date}</span>}
                  {item.start_at && <span>🕒 {item.start_at.split('T')[1]?.substring(0, 5)}</span>}
                  {item.priority && <span className="font-bold text-ink-base dark:text-stone-300">• {item.priority}</span>}
                  {item.expense && <span className="text-emerald-600 dark:text-emerald-400 font-bold">💰 ₹{item.expense.amount} ({item.expense.payment_mode})</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
