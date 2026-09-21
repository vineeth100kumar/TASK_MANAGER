import React, { useState } from 'react';
import { ArrowRight, Calendar, CheckCircle2, Clock, Loader2 } from 'lucide-react';
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
  const { capture, isCapturing, expectedSeconds, elapsedSeconds, usedFallback, error } = useCapture();

  const handleProcess = async () => {
    if (!text.trim() || isCapturing) return;
    setExtractedItems(null);

    try {
      const items = await capture(text);
      if (items.length) {
        setExtractedItems(items);
        // Clear the note once it has been filed. The items below are the
        // receipt, and an empty box makes filing the same note twice by
        // accident impossible.
        setText('');
        toast.success(`Captured ${items.length} item${items.length === 1 ? '' : 's'}`);
        onItemsCreated();
      } else {
        toast.warning('Nothing to capture in that note.');
      }
    } catch (e: any) {
      // The note stays in the box, so nothing typed is ever lost to a failure.
      console.error('Capture failed:', e);
      toast.error('Could not reach the Pi. Check the connection.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Quick capture"
      maxWidth="lg"
      hasUnsavedChanges={!!text.trim()}
    >
      <div className="space-y-4">
        <p className="text-meta text-ink-2 leading-relaxed">
          Write it however it comes out. Sage reads the note on the Pi and files
          whatever it finds — tasks, times, priorities, money spent.
        </p>

        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Your note"
          placeholder="e.g. Pay the tax bill 2500 by UPI tomorrow !urgent, call the architect Friday…"
          className="field resize-y"
        />

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-caption text-ink-3">Saved straight to your tasks</span>
          <Button
            onClick={handleProcess}
            isLoading={isCapturing}
            disabled={!text.trim() || isCapturing}
            variant="primary"
            size="md"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            {isCapturing ? 'Reading' : 'Capture'}
          </Button>
        </div>

        {/* While the model runs, the Pi is busy and slow to answer anything
            else. Say so plainly, with the time passing, rather than leaving a
            spinner that reads as a hang. */}
        {isCapturing && (
          <div className="flex items-center gap-2 text-meta text-ink-2 surface-sunken px-3 py-2.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            <span>
              Reading your note on the Pi
              {elapsedSeconds > 0 && ` — ${elapsedSeconds}s`}
              {expectedSeconds ? `, usually about ${Math.round(expectedSeconds)}s` : ''}.
              The app may be slow to respond until it finishes.
            </span>
          </div>
        )}

        {error && !isCapturing && (
          <p role="alert" className="text-meta text-danger-600 dark:text-danger-400">
            {error}. Your note is still here; try again when the Pi is back.
          </p>
        )}

        {usedFallback && extractedItems && (
          <p className="text-caption text-ink-3">
            The model was unavailable, so this was read without it. Dates and times are still exact.
          </p>
        )}

        {extractedItems && (
          <div className="surface-sunken px-3.5 py-3 space-y-2.5 max-h-56 overflow-y-auto">
            <div className="flex items-center gap-1.5 text-meta text-done-500 dark:text-done-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                Filed {extractedItems.length} {extractedItems.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            {extractedItems.map((item, idx) => (
              <div key={idx} className="bg-surface rounded-control px-3 py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-meta font-medium text-ink min-w-0">{item.title}</span>
                  <span className="text-caption text-ink-3 shrink-0 capitalize">
                    {item.entity_type || 'task'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-ink-3 tabular">
                  {item.due_date && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {item.due_date}
                    </span>
                  )}
                  {item.start_at && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                      {item.start_at.split('T')[1]?.substring(0, 5)}
                    </span>
                  )}
                  {item.priority && <span className="capitalize">{item.priority}</span>}
                  {item.expense && (
                    <span className="text-done-500 dark:text-done-400">
                      ₹{item.expense.amount.toLocaleString('en-IN')} · {item.expense.payment_mode}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
