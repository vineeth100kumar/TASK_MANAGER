import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('renders children when isOpen is true', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Dialog">
        <div>Modal Body Content</div>
      </Modal>
    );

    expect(screen.getByText('Test Dialog')).toBeTruthy();
    expect(screen.getByText('Modal Body Content')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Dialog">
        <div>Content</div>
      </Modal>
    );

    const closeBtn = screen.getByLabelText('Close modal');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={vi.fn()} title="Closed Dialog">
        <div>Hidden Content</div>
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  /*
   * The Escape handler used to be re-installed whenever `hasUnsavedChanges`
   * flipped, and its cleanup restored focus to whatever opened the modal. So
   * the first character typed into a new task threw the caret out of the
   * field, and everything after it was typed into the page behind.
   */
  it('keeps focus in the field when the form becomes dirty', () => {
    const Harness = () => {
      const [value, setValue] = useState('');
      return (
        <Modal isOpen onClose={vi.fn()} title="New task" hasUnsavedChanges={!!value.trim()}>
          <input
            aria-label="Title"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        </Modal>
      );
    };

    render(<Harness />);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    act(() => input.focus());
    expect(document.activeElement).toBe(input);

    // The keystroke that takes the form from clean to dirty.
    fireEvent.change(input, { target: { value: 'B' } });
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'Buy milk' } });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Buy milk');
  });

  it('asks before discarding a dirty form, and not otherwise', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal isOpen onClose={onClose} title="New task" hasUnsavedChanges={false}>
        <div>Body</div>
      </Modal>
    );

    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Modal isOpen onClose={onClose} title="New task" hasUnsavedChanges={true}>
        <div>Body</div>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
  });

  it('keeps Tab inside the dialog', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Trapped" hideCloseButton>
        <button>First</button>
        <button>Last</button>
      </Modal>
    );

    const first = screen.getByText('First');
    const last = screen.getByText('Last');

    act(() => last.focus());
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    act(() => first.focus());
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('marks the panel as the dialog, not the backdrop', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="Labelled">
        <div>Body</div>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Body');
  });
});
