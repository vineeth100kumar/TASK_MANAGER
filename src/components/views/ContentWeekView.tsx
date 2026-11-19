// ContentWeekView - the week plan across every project: what is scheduled to post, and what is ready to schedule.
import { ContentCalendar } from './ContentCalendar';

export function ContentWeekView() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white">Content week</h2>
        <p className="text-[12.5px] text-gray-500">Every scheduled post and reel, across your content projects.</p>
      </div>
      <ContentCalendar />
    </div>
  );
}
