import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TasksView } from '../TasksView';
import { WorkItem } from '../../../types';
import { getTodayDateString, getYesterdayDateString } from '../../../utils/dateHelpers';

vi.mock('../../../services/api', () => ({
  api: {
    improveTask: vi.fn(),
    organizeBoard: vi.fn(),
    autoFillTask: vi.fn(),
    updateItem: vi.fn(),
    createItem: vi.fn(),
    deleteItem: vi.fn(),
    addSubtask: vi.fn(),
    toggleSubtask: vi.fn(),
    deleteSubtask: vi.fn(),
  },
}));

function makeItem(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    description: null,
    entity_type: 'task',
    status: 'todo',
    priority: 'medium',
    energy: 'medium',
    due_date: null,
    depends_on: [],
    estimated_minutes: 30,
    actual_minutes: 0,
    is_completed: false,
    created_at: '2026-09-01T09:00:00',
    updated_at: '2026-09-01T09:00:00',
    subtasks: [],
    ...overrides,
  };
}

/*
 * Sorted alphabetically, "Apple" comes first; grouped by date, the overdue
 * "Zebra" is drawn first. The two orders disagree, which is the case the
 * keyboard used to get wrong.
 */
const zebra = makeItem({ id: 'z', title: 'Zebra', due_date: getYesterdayDateString() });
const apple = makeItem({ id: 'a', title: 'Apple' });
const done = makeItem({
  id: 'd',
  title: 'Already handled',
  is_completed: true,
  status: 'done',
  completed_at: '2026-09-19T10:00:00',
});

function renderView(props: Partial<React.ComponentProps<typeof TasksView>> = {}) {
  const handlers = {
    onRefresh: vi.fn(),
    onToggleComplete: vi.fn(),
    onUpdateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onCreateItem: vi.fn(),
  };
  render(
    <TasksView
      items={[zebra, apple, done]}
      projects={[]}
      milestones={[]}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe('TasksView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Sort by title, so the sorted order and the drawn order differ.
    window.localStorage.setItem('sage_tasks_sort_by', JSON.stringify('title'));
  });

  it('acts on the row the keyboard is actually pointing at', () => {
    const { onToggleComplete } = renderView();

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'x' });

    expect(onToggleComplete).toHaveBeenCalledTimes(1);
    expect(onToggleComplete.mock.calls[0][0].title).toBe('Zebra');
  });

  it('sets priority on the highlighted row with the number keys', () => {
    const { onUpdateItem } = renderView();

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: '1' });

    expect(onUpdateItem).toHaveBeenCalledWith('z', { priority: 'urgent' });
  });

  it('skips collapsed sections when navigating', () => {
    const { onToggleComplete } = renderView();

    fireEvent.click(screen.getByRole('button', { name: /Overdue/ }));
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'x' });

    expect(onToggleComplete.mock.calls[0][0].title).toBe('Apple');
  });

  it('renames a row in place with r', () => {
    const { onUpdateItem } = renderView();

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'r' });

    const field = screen.getByLabelText('Rename Zebra');
    fireEvent.change(field, { target: { value: 'Zebra crossing' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onUpdateItem).toHaveBeenCalledWith('z', { title: 'Zebra crossing' });
  });

  it('keeps finished work out of the list until it is asked for', () => {
    renderView();

    expect(screen.queryByText('Already handled')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('button', { name: /Show completed/ }));

    expect(screen.getByText('Already handled')).toBeInTheDocument();
  });

  it('offers a way out when the filters match nothing', () => {
    renderView({ items: [makeItem({ id: 'e', title: 'An event', entity_type: 'event' })] });

    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));

    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getByText('An event')).toBeInTheDocument();
  });

  it('invites the first task when there is nothing at all', () => {
    renderView({ items: [] });

    expect(screen.getByText('Nothing to do yet.')).toBeInTheDocument();
  });

  it('opens the shortcut list with ?', () => {
    renderView();

    fireEvent.keyDown(window, { key: '?' });

    expect(screen.getByRole('heading', { name: 'Keyboard' })).toBeInTheDocument();
  });

  it('keeps the view options behind one control', () => {
    renderView();

    expect(screen.queryByRole('button', { name: /Group by date/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View options' }));

    expect(screen.getByRole('button', { name: /Group by date/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Organize with AI/ })).toBeInTheDocument();
  });

  it('shows today under its own heading', () => {
    renderView({
      items: [makeItem({ id: 't', title: 'Due now', due_date: getTodayDateString() })],
    });

    const heading = screen
      .getAllByRole('button', { name: /Today/ })
      .find((el) => el.getAttribute('aria-expanded') === 'true')!;
    expect(heading).toBeInTheDocument();
    expect(within(heading).getByText('1')).toBeInTheDocument();
  });

  /*
   * The create form collected a date and nothing else, so anything made here
   * as an Event landed in the day with no clock on it and the calendar had
   * nowhere to draw it. An event needs a start, and it should be able to have
   * an end.
   */
  describe('the create form', () => {
    function openCreateForm() {
      const handlers = renderView();
      fireEvent.click(screen.getByRole('button', { name: /new task/i }));
      return handlers;
    }

    it('gives an event a start time and an end time', () => {
      const { onCreateItem } = openCreateForm();

      fireEvent.click(screen.getByRole('button', { name: 'Event' }));
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Dentist' },
      });
      fireEvent.change(screen.getByLabelText('Date'), {
        target: { value: '2026-10-02' },
      });
      fireEvent.change(screen.getByLabelText('Starts at'), {
        target: { value: '14:30' },
      });
      fireEvent.change(screen.getByLabelText('Ends at'), {
        target: { value: '15:15' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add event' }));

      expect(onCreateItem).toHaveBeenCalledTimes(1);
      const created = onCreateItem.mock.calls[0][0];
      expect(created.entity_type).toBe('event');
      expect(created.due_date).toBe('2026-10-02');
      expect(created.start_at).toBe('2026-10-02T14:30:00');
      expect(created.end_at).toBe('2026-10-02T15:15:00');
      // An event is reminded about before it starts, not as it starts.
      expect(created.remind_at).toBe('2026-10-02T14:15:00');
    });

    it('gives a dated task its time of day', () => {
      const { onCreateItem } = openCreateForm();

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Call the bank' },
      });
      fireEvent.change(screen.getByLabelText('Due date'), {
        target: { value: '2026-10-02' },
      });
      fireEvent.change(screen.getByLabelText('Time'), {
        target: { value: '09:00' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

      const created = onCreateItem.mock.calls[0][0];
      expect(created.start_at).toBe('2026-10-02T09:00:00');
      expect(created.end_at).toBeUndefined();
    });

    it('takes more than one context, the way the detail sheet does', () => {
      const { onCreateItem } = openCreateForm();

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Errand run' },
      });
      // The screen behind the sheet has context filter chips with the same
      // names, so ask the dialog for its own.
      const dialog = within(screen.getByRole('dialog'));
      fireEvent.click(dialog.getByRole('button', { name: '@errands' }));
      fireEvent.click(dialog.getByRole('button', { name: '@phone' }));
      fireEvent.click(dialog.getByRole('button', { name: 'Add task' }));

      expect(onCreateItem.mock.calls[0][0].context_tags).toBe('@errands @phone');
    });
  });
});
