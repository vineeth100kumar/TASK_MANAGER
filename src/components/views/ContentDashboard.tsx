// ContentDashboard - the front of the Content section: the numbers and the calendar in one view,
// for whatever the project dropdown says (every project, one project, or none).
import { NO_PROJECT } from '../../services/contentPieces';
import { AllPagesStats, ContentStats } from './ContentStats';
import { ContentCalendar } from './ContentCalendar';

export function ContentDashboard({ scope, onScope }: { scope: string; onScope: (scope: string) => void }) {
  return (
    <div className="space-y-5">
      {scope === '' && <AllPagesStats onPick={onScope} />}
      {scope !== '' && scope !== NO_PROJECT && <ContentStats key={scope} projectId={scope} />}
      <ContentCalendar projectId={scope} />
    </div>
  );
}
