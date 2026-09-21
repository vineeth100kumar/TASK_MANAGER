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

    // The item is due on Wednesday 30 September 2026, so choosing Weekly
    // should mean that Wednesday rather than a hardcoded Monday.
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });

    expect(onUpdate).toHaveBeenCalledWith({
      repeat_rule: 'weekly:wed',
      repeat_until: null,
      repeat_count: null,
    });
  });

  it('can say the repeat stops after a number of times', () => {
    const repeating: WorkItem = { ...item, repeat_rule: 'daily' };
    const { onUpdate } = renderSheet({ item: repeating, items: [repeating] });

    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: 'after' } });

    expect(onUpdate).toHaveBeenCalledWith({
      repeat_rule: 'daily',
      repeat_until: null,
      repeat_count: 10,
    });
  });

  it('records where an event happens', () => {
    const event: WorkItem = { ...item, entity_type: 'event' };
    const { onUpdate } = renderSheet({ item: event, items: [event] });

    const field = screen.getByLabelText('Location');
    fireEvent.change(field, { target: { value: "Dr Rao's clinic" } });
    fireEvent.blur(field);

    expect(onUpdate).toHaveBeenCalledWith({ location: "Dr Rao's clinic" });
  });

  it('shows no location on a task', () => {
    renderSheet();
    expect(screen.queryByLabelText('Location')).toBeNull();
  });

  it('clears the clock when an item is marked all day', () => {
    const timed: WorkItem = { ...item, start_at: '2026-09-30T14:00:00', remind_at: '2026-09-30T14:00:00' };
    const { onUpdate } = renderSheet({ item: timed, items: [timed] });

    fireEvent.click(screen.getByLabelText('All day'));

    expect(onUpdate).toHaveBeenCalledWith({
      is_all_day: true,
      start_at: null,
      end_at: null,
      remind_at: null,
    });
  });

  /*
   * An event runs between two times. The sheet only ever showed the one it
   * starts at, so a meeting's length was something you could set while
   * capturing it and never see again.
   */
  it('lets an event be given an end time', () => {
    const event: WorkItem = {
      ...item,
      entity_type: 'event',
      due_date: '2026-09-30',
      start_at: '2026-09-30T14:00:00',
    };
    const { onUpdate } = renderSheet({ item: event, items: [event] });

    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '15:30' } });
    expect(onUpdate).toHaveBeenCalledWith({ end_at: '2026-09-30T15:30:00' });
  });

  it('warns when an event ends before it starts', () => {
    const event: WorkItem = {
      ...item,
      entity_type: 'event',
      start_at: '2026-09-30T14:00:00',
      end_at: '2026-09-30T13:00:00',
    };
    renderSheet({ item: event, items: [event] });
    expect(screen.getByText('Ends before it starts')).toBeTruthy();
  });

  it('shows no end time on a task', () => {
    renderSheet();
    expect(screen.queryByLabelText('Ends at')).toBeNull();
  });

  /*
   * Things get captured as the wrong kind all the time — a note about a
   * meeting arrives as a task. Until now the only fix was to delete it and
   * write it again.
   */
  it('can turn a task into an event', () => {
    const { onUpdate } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Event' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].entity_type).toBe('event');
  });

  it('lets an estimate be taken back off', () => {
    const { onUpdate } = renderSheet();
    // The item already estimates 30 minutes; pressing it again clears it.
    fireEvent.click(screen.getByRole('button', { name: '30m' }));
    // Null, not zero: the column's CHECK allows NULL but rejects 0.
    expect(onUpdate).toHaveBeenCalledWith({ estimated_minutes: null });
  });
});
