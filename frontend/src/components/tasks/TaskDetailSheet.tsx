import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Trash2, Lock, CheckCircle2, X, Clock, Folder, Tag, RotateCw } from 'lucide-react';
import {
  WorkItem,
  WorkItemUpdatePayload,
  Project,
  Milestone,
  TaskPriority,
  TaskStatus,
} from '../../types';
import { Modal } from '../common/Modal';
import { CONTEXT_TAGS } from './QuickAddBar';
import {
  formatDuration,
  formatWhen,
  getTodayDateString,
  itemMoment,
  timeInputValue,
  withTimeOfDay,
} from '../../utils/dateHelpers';

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'On hold' },
  { value: 'done', label: 'Done' },
];

const REPEAT_RULES: { value: string; label: string }[] = [
  { value: '', label: 'One-time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly:mon', label: 'Every Monday' },
  { value: 'monthly:1', label: 'Monthly' },
];

const ESTIMATES = [15, 30, 45, 60, 90, 120];

const ENTITY_TYPES: { value: WorkItem['entity_type']; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'event', label: 'Event' },
  { value: 'reminder', label: 'Reminder' },
];

/* HH:MM out of an ISO string, or empty. */
function clockOf(iso?: string | null): string {
  if (!iso) return '';
  const at = iso.includes('T') ? iso.split('T')[1] : '';
  return at ? at.slice(0, 5) : '';
}

export interface TaskDetailSheetProps {
  item: WorkItem;
  items: WorkItem[];
  projects: Project[];
  milestones: Milestone[];
  isAiExpanding?: boolean;
  onClose: () => void;
  onUpdate: (updates: WorkItemUpdatePayload) => void;
  onDelete: () => void;
  onAiAutoFill: () => void;
  onToggleSubtask: (subtaskId: string) => void;
  onAddSubtask: (title: string) => void;
  onDeleteSubtask: (subtaskId: string) => void;
}

/*
 * Everything a task is, in one sheet, and all of it editable.
 *
 * The title and the description are plain text you type into rather than
 * fields you have to go somewhere else to change, so nothing about a task is
 * fixed at the moment it was created. Each control saves as you leave it.
 */
export const TaskDetailSheet: React.FC<TaskDetailSheetProps> = ({
  item,
  items,
  projects,
  milestones,
  isAiExpanding = false,
  onClose,
  onUpdate,
  onDelete,
  onAiAutoFill,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
}) => {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description || '');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // The sheet stays open while background refreshes land, so track the item.
  useEffect(() => setTitle(item.title), [item.id, item.title]);
  useEffect(() => setDescription(item.description || ''), [item.id, item.description]);

  // A title that wraps should grow rather than scroll.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const commitTitle = () => {
    const next = title.trim();
    if (!next) {
      setTitle(item.title);
      return;
    }
    if (next !== item.title) onUpdate({ title: next });
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next !== (item.description || '')) onUpdate({ description: next });
  };

  const blockers = (item.depends_on || [])
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is WorkItem => !!i);
  const openBlockers = blockers.filter((b) => !b.is_completed);

  const doneSubtasks = item.subtasks.filter((s) => s.is_completed).length;

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    const value = newSubtaskTitle.trim();
    if (!value) return;
    onAddSubtask(value);
    setNewSubtaskTitle('');
  };

  return (
    <Modal isOpen onClose={onClose} maxWidth="lg" hideCloseButton>
      <div className="space-y-6">
        {/* Title, editable in place */}
        <div className="flex items-start gap-3">
          <button
            role="checkbox"
            aria-checked={item.is_completed}
            aria-label={item.is_completed ? 'Mark as not done' : 'Mark as done'}
            data-checked={item.is_completed}
            onClick={() =>
              onUpdate({ is_completed: !item.is_completed, status: item.is_completed ? 'todo' : 'done' })
            }
            className="check mt-1"
          />

          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            aria-label="Task title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className={`flex-1 min-w-0 bg-transparent text-title font-semibold resize-none overflow-hidden border-b border-transparent hover:border-hairline focus:border-accent-500 focus:outline-none pb-1 ${
              item.is_completed ? 'text-ink-3 line-through' : 'text-ink'
            }`}
          />

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onDelete}
              aria-label={`Delete ${item.title}`}
              title="Delete"
              className="w-9 h-9 grid place-items-center rounded-control text-ink-3 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-sunken transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              aria-label="Close task details"
              className="w-9 h-9 grid place-items-center rounded-control text-ink-3 hover:text-ink hover:bg-sunken transition-colors"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {openBlockers.length > 0 && (
          <p className="flex items-center gap-2 text-meta text-late-500 dark:text-late-400">
            <Lock className="w-4 h-4 shrink-0" />
            Waiting on {openBlockers.map((b) => b.title).join(', ')}
          </p>
        )}

        {/* Priority and status, the two things most often changed */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <span className="label">Priority</span>
            <div className="bg-sunken rounded-control p-0.5 flex items-center">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={item.priority === p.value}
                  onClick={() => onUpdate({ priority: p.value })}
                  className={`flex-1 px-2 py-1.5 rounded-control text-meta transition-colors ${
                    item.priority === p.value
                      ? 'bg-surface text-ink font-medium shadow-sm'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="label">Status</span>
            <select
              value={item.status}
              aria-label="Status"
              onChange={(e) => {
                const status = e.target.value as TaskStatus;
                onUpdate({ status, is_completed: status === 'done' });
              }}
              className="field"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* When */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="label">When</span>
            <span className="text-meta text-ink-3">{formatWhen(item)}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Due date"
              value={item.due_date ? item.due_date.slice(0, 10) : ''}
              onChange={(e) => {
                const next = withTimeOfDay(
                  item.entity_type,
                  e.target.value || null,
                  timeInputValue(itemMoment(item)) || null
                );
                onUpdate(next);
              }}
              className="field flex-1"
            />
            <input
              type="time"
              aria-label="Time"
              value={timeInputValue(itemMoment(item))}
              onChange={(e) => {
                const next = withTimeOfDay(
                  item.entity_type,
                  item.due_date || getTodayDateString(),
                  e.target.value || null
                );
                onUpdate(next);
              }}
              className="field w-32"
            />
          </div>
          {/* An event runs between two times. Until now the sheet only ever
              showed the one it starts at, so a meeting's length was something
              you could set when capturing it and never see again. */}
          {item.entity_type === 'event' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-meta text-ink-2 shrink-0 w-10">Ends</span>
              <input
                type="time"
                aria-label="Ends at"
                value={clockOf(item.end_at)}
                disabled={!item.start_at}
                onChange={(e) => {
                  const day = (item.start_at || item.due_date || '').slice(0, 10);
                  onUpdate({ end_at: e.target.value && day ? `${day}T${e.target.value}:00` : null });
                }}
                className="field w-32 disabled:opacity-40"
              />
              {item.end_at && item.start_at && clockOf(item.end_at) <= clockOf(item.start_at) && (
                <span className="text-caption text-late-500 dark:text-late-400">
                  Ends before it starts
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <RotateCw className="w-3.5 h-3.5 text-ink-3 shrink-0" />
            <select
              value={item.repeat_rule || ''}
              aria-label="Repeat"
              onChange={(e) => onUpdate({ repeat_rule: e.target.value || null })}
              className="field"
            >
              {REPEAT_RULES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Type. Things get captured as the wrong kind all the time — a note
            about a meeting arrives as a task — and until now the only way to
            correct it was to delete it and write it again. */}
        <div className="space-y-1.5">
          <span className="label">Type</span>
          <div className="bg-sunken rounded-control p-0.5 flex items-center" role="group" aria-label="Type">
            {ENTITY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={item.entity_type === t.value}
                onClick={() => {
                  if (item.entity_type === t.value) return;
                  // Re-derive the moment, because the three kinds put their
                  // reminder in different places.
                  const clock = timeInputValue(itemMoment(item));
                  onUpdate({
                    entity_type: t.value,
                    ...withTimeOfDay(t.value, item.due_date ? item.due_date.slice(0, 10) : null, clock || null),
                    ...(t.value === 'event' ? {} : { end_at: null }),
                  });
                }}
                className={`flex-1 px-2 py-1.5 rounded-control text-meta transition-colors ${
                  item.entity_type === t.value
                    ? 'bg-surface text-ink font-medium shadow-sm'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="label">Notes</span>
            <button
              type="button"
              onClick={onAiAutoFill}
              disabled={isAiExpanding}
              className="flex items-center gap-1.5 text-meta text-ink-2 hover:text-ink disabled:opacity-40 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isAiExpanding ? 'Writing…' : 'Draft with AI'}
            </button>
          </div>
          <textarea
            rows={3}
            value={description}
            aria-label="Notes"
            placeholder="Anything worth remembering about this"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
            className="field resize-y"
          />
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          <span className="label">
            Checklist{item.subtasks.length > 0 && ` · ${doneSubtasks}/${item.subtasks.length}`}
          </span>

          {item.subtasks.map((st) => (
            <div key={st.id} className="group flex items-center gap-3 py-1">
              <button
                role="checkbox"
                aria-checked={st.is_completed}
                aria-label={st.is_completed ? `Mark ${st.title} as not done` : `Mark ${st.title} as done`}
                data-checked={st.is_completed}
                onClick={() => onToggleSubtask(st.id)}
                className="check scale-[0.8] origin-left"
              />
              <span className={`flex-1 min-w-0 text-meta truncate ${st.is_completed ? 'line-through text-ink-3' : 'text-ink'}`}>
                {st.title}
              </span>
              <button
                type="button"
                onClick={() => onDeleteSubtask(st.id)}
                aria-label={`Delete ${st.title}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-8 h-8 grid place-items-center text-ink-3 hover:text-danger-600 dark:hover:text-danger-400 rounded-control transition-opacity"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          <form onSubmit={handleAddSubtask}>
            <input
              type="text"
              value={newSubtaskTitle}
              aria-label="Add a checklist step"
              placeholder="Add a step"
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              className="field"
            />
          </form>
        </div>

        {/* Where it belongs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <span className="label flex items-center gap-1.5"><Folder className="w-3.5 h-3.5" /> Project</span>
            <select
              value={item.project_id || ''}
              aria-label="Project"
              onChange={(e) =>
                onUpdate({ project_id: (e.target.value || null) as any, milestone_id: null as any })
              }
              className="field"
            >
              <option value="">Inbox</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="label">Milestone</span>
            <select
              value={item.milestone_id || ''}
              aria-label="Milestone"
              disabled={!item.project_id}
              onChange={(e) => onUpdate({ milestone_id: (e.target.value || null) as any })}
              className="field disabled:opacity-40"
            >
              <option value="">None</option>
              {milestones
                .filter((m) => m.project_id === item.project_id)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
            </select>
          </div>
        </div>

        {/* Context tags */}
        <div className="space-y-1.5">
          <span className="label flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Context</span>
          <div className="flex flex-wrap gap-1.5">
            {CONTEXT_TAGS.map((tag) => {
              const isActive = !!item.context_tags?.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    const current = item.context_tags ? item.context_tags.split(' ').filter(Boolean) : [];
                    const next = isActive ? current.filter((t) => t !== tag) : [...current, tag];
                    onUpdate({ context_tags: next.join(' ') });
                  }}
                  className={`px-2.5 py-1 rounded-control text-meta transition-colors ${
                    isActive ? 'bg-accent-500 text-white' : 'bg-sunken text-ink-2 hover:text-ink'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Estimate */}
        {item.entity_type !== 'event' && (
        <div className="space-y-1.5">
          <span className="label flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Estimate</span>
          <div className="flex flex-wrap gap-1.5">
            {ESTIMATES.map((mins) => (
              <button
                key={mins}
                type="button"
                aria-pressed={item.estimated_minutes === mins}
                onClick={() => onUpdate({ estimated_minutes: item.estimated_minutes === mins ? 0 : mins })}
                className={`px-2.5 py-1 rounded-control text-meta tabular transition-colors ${
                  item.estimated_minutes === mins
                    ? 'bg-accent-500 text-white'
                    : 'bg-sunken text-ink-2 hover:text-ink'
                }`}
              >
                {formatDuration(mins)}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Dependencies */}
        <div className="space-y-2">
          <span className="label">Waiting on</span>

          {blockers.length > 0 ? (
            <div className="space-y-1">
              {blockers.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 py-1 text-meta">
                  {dep.is_completed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-done-500 dark:text-done-400 shrink-0" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                  )}
                  <span className={`flex-1 min-w-0 truncate ${dep.is_completed ? 'line-through text-ink-3' : 'text-ink'}`}>
                    {dep.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Stop waiting on ${dep.title}`}
                    onClick={() => onUpdate({ depends_on: item.depends_on.filter((d) => d !== dep.id) })}
                    className="w-8 h-8 grid place-items-center text-ink-3 hover:text-ink rounded-control"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-meta text-ink-3">Nothing. This can be started now.</p>
          )}

          <select
            value=""
            aria-label="Add something this is waiting on"
            onChange={(e) => {
              const addId = e.target.value;
              if (!addId) return;
              const current = item.depends_on || [];
              if (!current.includes(addId)) onUpdate({ depends_on: [...current, addId] });
            }}
            className="field"
          >
            <option value="">Add something this waits on…</option>
            {items
              .filter((i) => i.id !== item.id && !i.is_completed && !item.depends_on?.includes(i.id))
              .map((i) => (
                <option key={i.id} value={i.id}>{i.title}</option>
              ))}
          </select>
        </div>
      </div>
    </Modal>
  );
};
