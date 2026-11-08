import { WorkItem } from '../../services/types';
import { formatMinutes } from '../../utils/taskLists';
import { api } from '../../services/api';
import { normalizeDoses } from '../../utils/doses';
import { CompleteButton } from './CompleteButton';
import { DoseChips } from './DoseChips';

interface UpNextProps {
  item: WorkItem;
  completing: boolean;
  saving: boolean;
  onComplete: () => void;
  onOpen: () => void;
  onChanged?: () => void;
}

// The one thing to do now. Shown only when there is something to do.
export function UpNextCard({ item, completing, saving, onComplete, onOpen, onChanged }: UpNextProps) {
  const home = item.project?.name || item.area?.name;
  const doses = normalizeDoses(item.doseTimes);
  const mins = item.estimatedMinutes ? formatMinutes(item.estimatedMinutes) : null;
  return (
    <section aria-label="Up next" className={`surface rounded-3xl p-5 md:p-6 border border-black/5 dark:border-white/5 ${completing ? 'is-completing' : ''}`}>
      <p className="eyebrow text-gray-400 mb-2">Up next</p>
      <div className="flex items-center gap-4">
        <CompleteButton checked={completing} saving={saving} onComplete={onComplete} />
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-[19px] md:text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white leading-snug">{item.title || 'Untitled'}</p>
          {(home || mins) && <p className="text-[12.5px] text-gray-400 mt-0.5">{[home, mins].filter(Boolean).join(' · ')}</p>}
        </button>
      </div>
      {doses.length > 1 && (
        <DoseChips className="mt-3 pl-[3.25rem]" times={doses} ticked={item.dosesDone} label={item.title || 'Task'}
          onToggle={async t => { await api.workItems.toggleDose(item.id, t); onChanged?.(); }} />
      )}
    </section>
  );
}
