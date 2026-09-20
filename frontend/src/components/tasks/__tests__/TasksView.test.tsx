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
});
