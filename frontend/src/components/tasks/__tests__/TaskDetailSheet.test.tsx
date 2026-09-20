import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskDetailSheet } from '../TaskDetailSheet';
import { WorkItem } from '../../../types';

const item: WorkItem = {
  id: 'task-1',
  title: 'Renew the car insurance',
  description: 'Before the 30th',
  entity_type: 'task',
  status: 'todo',
  priority: 'medium',
  energy: 'medium',
  due_date: '2026-09-30',
  depends_on: [],
  estimated_minutes: 30,
  actual_minutes: 0,
  is_completed: false,
  created_at: '2026-09-01T09:00:00',
  updated_at: '2026-09-01T09:00:00',
  subtasks: [],
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof TaskDetailSheet>> = {}) {
  const onUpdate = vi.fn();
  render(
    <TaskDetailSheet
      item={item}
      items={[item]}
      projects={[]}
      milestones={[]}
      onClose={vi.fn()}
      onUpdate={onUpdate}
      onDelete={vi.fn()}
      onAiAutoFill={vi.fn()}
      onToggleSubtask={vi.fn()}
      onAddSubtask={vi.fn()}
      onDeleteSubtask={vi.fn()}
      {...overrides}
    />
  );
  return { onUpdate };
}

describe('TaskDetailSheet', () => {
  it('saves a retitled task when the field is left', () => {
    const { onUpdate } = renderSheet();
    const title = screen.getByLabelText('Task title');

    fireEvent.change(title, { target: { value: 'Renew the car insurance online' } });
    fireEvent.blur(title);

    expect(onUpdate).toHaveBeenCalledWith({ title: 'Renew the car insurance online' });
  });

  it('keeps the old title when the field is emptied', () => {
    const { onUpdate } = renderSheet();
    const title = screen.getByLabelText('Task title');

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);

    expect(onUpdate).not.toHaveBeenCalled();
    expect((title as HTMLTextAreaElement).value).toBe(item.title);
  });

  it('saves notes on blur', () => {
    const { onUpdate } = renderSheet();
    const notes = screen.getByLabelText('Notes');

    fireEvent.change(notes, { target: { value: 'Quote from last year is in the drawer' } });
    fireEvent.blur(notes);

    expect(onUpdate).toHaveBeenCalledWith({ description: 'Quote from last year is in the drawer' });
  });

  it('changes priority from the segmented control', () => {
    const { onUpdate } = renderSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Urgent' }));

    expect(onUpdate).toHaveBeenCalledWith({ priority: 'urgent' });
  });

  it('completes the task from the checkbox', () => {
    const { onUpdate } = renderSheet();

    fireEvent.click(screen.getByLabelText('Mark as done'));

    expect(onUpdate).toHaveBeenCalledWith({ is_completed: true, status: 'done' });
  });

  it('adds a checklist step', () => {
    const onAddSubtask = vi.fn();
    renderSheet({ onAddSubtask });

    const field = screen.getByLabelText('Add a checklist step');
    fireEvent.change(field, { target: { value: 'Find the policy number' } });
    fireEvent.submit(field);

    expect(onAddSubtask).toHaveBeenCalledWith('Find the policy number');
  });

  it('changes the repeat rule', () => {
    const { onUpdate } = renderSheet();

    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly:mon' } });

    expect(onUpdate).toHaveBeenCalledWith({ repeat_rule: 'weekly:mon' });
  });
});
