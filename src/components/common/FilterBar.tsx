
interface FilterBarProps {
  filters: any;
  setFilters: (filters: any) => void;
  entityTypeCounts?: Record<string, number>;
}

export function FilterBar({ filters, setFilters, entityTypeCounts = {} }: FilterBarProps) {
  const currentType = filters.entityType || 'all';
  const currentPriority = filters.priority || 'all';
  const currentStatus = filters.status || 'all';

  const types = [
    { id: 'all', label: 'All Items' },
    { id: 'task', label: 'Tasks' },
    { id: 'event', label: 'Events' },
    { id: 'reminder', label: 'Reminders' },
    { id: 'milestone', label: 'Milestones' }
  ];

  const priorities = [
    { id: 'all', label: 'All Priorities' },
    { id: 'urgent', label: 'Urgent 🔥' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' }
  ];

  const statuses = [
    { id: 'all', label: 'All Status' },
    { id: 'open', label: 'Open' },
    { id: 'done', label: 'Completed' }
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 text-xs font-semibold">
      
      {/* Type Selector Pills */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/5 p-1 rounded-xl max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {types.map(t => (
          <button key={t.id} onClick={() => setFilters({ ...filters, entityType: t.id })}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 transition-all ${currentType === t.id ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm font-bold' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Priority Dropdown Filter */}
      <select value={currentPriority} onChange={e => setFilters({ ...filters, priority: e.target.value })}
        className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/5 text-gray-700 dark:text-gray-300 outline-none cursor-pointer focus:ring-2 focus:ring-blue-500 font-semibold">
        {priorities.map(p => <option key={p.id} value={p.id} className="text-gray-900">{p.label}</option>)}
      </select>

      {/* Status Dropdown Filter */}
      <select value={currentStatus} onChange={e => setFilters({ ...filters, status: e.target.value })}
        className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 border border-transparent dark:border-white/5 text-gray-700 dark:text-gray-300 outline-none cursor-pointer focus:ring-2 focus:ring-blue-500 font-semibold">
        {statuses.map(s => <option key={s.id} value={s.id} className="text-gray-900">{s.label}</option>)}
      </select>

      {/* Reset filters if any active */}
      {(currentType !== 'all' || currentPriority !== 'all' || currentStatus !== 'all' || filters.search) && (
        <button onClick={() => setFilters({ search: '', entityType: 'all', priority: 'all', status: 'all' })}
          className="text-blue-600 dark:text-blue-400 font-bold px-2 py-1 hover:underline">
          Reset Filters
        </button>
      )}
    </div>
  );
}
