import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BulkActionBar } from '../BulkActionBar';

describe('BulkActionBar', () => {
  it('renders nothing when selectedCount is 0', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={0}
        onClearSelection={vi.fn()}
        onBulkComplete={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkPriority={vi.fn()}
        onBulkReschedule={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders counter and fires bulk action callbacks', () => {
    const onComplete = vi.fn();
    const onDelete = vi.fn();
    const onClear = vi.fn();

    render(
      <BulkActionBar
        selectedCount={3}
        onClearSelection={onClear}
        onBulkComplete={onComplete}
        onBulkDelete={onDelete}
        onBulkPriority={vi.fn()}
        onBulkReschedule={vi.fn()}
      />
    );

    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Selected')).toBeTruthy();

    const doneBtn = screen.getByText('Done');
    fireEvent.click(doneBtn);
    expect(onComplete).toHaveBeenCalled();

    const deleteBtn = screen.getByText('Delete');
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalled();
  });
});
