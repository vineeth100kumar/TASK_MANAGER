import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
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
});
