import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickAddBar } from '../QuickAddBar';
import { Project } from '../../../types';

const projects: Project[] = [
  { id: 'p1', name: 'Finance', color: '#000', created_at: '2026-09-01' },
  { id: 'p2', name: 'Home repairs', color: '#000', created_at: '2026-09-01' },
];

function renderBar() {
  const onQuickAdd = vi.fn();
  render(<QuickAddBar projects={projects} onQuickAdd={onQuickAdd} onOpenAiBrainDump={vi.fn()} />);
  return { onQuickAdd, input: screen.getByLabelText('Quick add a task') as HTMLInputElement };
}

describe('QuickAddBar', () => {
  it('offers matching projects while a # token is being typed', () => {
    const { input } = renderBar();

    fireEvent.change(input, { target: { value: 'Pay the bill #fin' } });

    expect(screen.getByRole('option', { name: /Finance/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Home repairs/ })).not.toBeInTheDocument();
  });

  it('offers context tags while an @ token is being typed', () => {
    const { input } = renderBar();

    fireEvent.change(input, { target: { value: 'Call the plumber @ph' } });

    expect(screen.getByRole('option', { name: /@phone/ })).toBeInTheDocument();
  });

  it('completes the token on Enter without submitting', () => {
    const { input, onQuickAdd } = renderBar();

    fireEvent.change(input, { target: { value: 'Pay the bill #fin' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('Pay the bill #Finance ');
    expect(onQuickAdd).not.toHaveBeenCalled();
  });

  it('offers nothing once the token is finished', () => {
    const { input } = renderBar();

    fireEvent.change(input, { target: { value: 'Pay the bill #Finance tomorrow' } });

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('submits the parsed task', () => {
    const { input, onQuickAdd } = renderBar();

    fireEvent.change(input, { target: { value: 'Pay the bill #Finance !high ~45m' } });
    fireEvent.submit(input);

    expect(onQuickAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Pay the bill',
        priority: 'high',
        project_id: 'p1',
        estimated_minutes: 45,
      })
    );
    expect(input.value).toBe('');
  });

  it('clears the line on Escape', () => {
    const { input } = renderBar();

    fireEvent.change(input, { target: { value: 'Something half written' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('');
  });
});
