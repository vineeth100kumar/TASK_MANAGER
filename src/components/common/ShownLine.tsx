import { Eye, EyeOff } from 'lucide-react';
import type { LifeContext } from '../../services/types';
import { describeShown, type Shown } from '../../services/items';

// One line under the filter bar, the same on Board, List, Table, Branches,
// Calendar and Timeline: how many of the page's items are on screen, and what
// hides the rest, with a tap to bring them back. Hidden never means lost.
export function ShownLine({ count, lifeContext, onShowBoth, onShowList }: {
  count: Shown;
  lifeContext?: LifeContext;
  onShowBoth: () => void;
  onShowList?: () => void;
}) {
  const hiding = count.shown < count.total;
  const link = 'font-semibold text-blue-600 dark:text-blue-400 hover:underline';
  return (
    <p data-testid="shown-line" className="-mt-3 mb-5 px-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-500 tabular-nums">
      <span className="flex items-center gap-1.5">
        {hiding ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />}
        {describeShown(count, lifeContext)}
      </span>
      {!!count.hidden.otherContext && <button type="button" className={link} onClick={onShowBoth}>Show Work and Personal</button>}
      {!!count.hidden.noDate && onShowList && <button type="button" className={link} onClick={onShowList}>See them in List</button>}
    </p>
  );
}
