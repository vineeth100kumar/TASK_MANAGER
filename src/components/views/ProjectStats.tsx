// ProjectStats - the Stats tab of a content page: that page's Instagram numbers.
// Placeholder until the Social dashboard (S-196) lands; it will read this project's account.
import { BarChart3 } from 'lucide-react';

export function ProjectStats() {
  return (
    <div className="max-w-xl mx-auto text-center py-16 text-gray-500">
      <div className="surface-item inline-flex p-4 rounded-2xl mb-4"><BarChart3 size={28} /></div>
      <h3 className="text-[16px] font-semibold text-gray-900 dark:text-white mb-1">Stats are coming</h3>
      <p className="text-[13.5px] leading-relaxed">This page's Instagram numbers (followers, reach, best posts) will show here once the account is connected.</p>
    </div>
  );
}
