import React from 'react';
import { Modal } from '../common/Modal';
import { SHORTCUT_HELP } from '../../hooks/useKeyboardShortcuts';

interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/* The whole shortcut set on one screen, reachable with ?. */
export const KeyboardHelpModal: React.FC<KeyboardHelpModalProps> = ({ isOpen, onClose }) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Keyboard"
    description="In the list, with nothing selected in a field."
    maxWidth="md"
  >
    <dl className="divide-y divide-hairline">
      {SHORTCUT_HELP.map((shortcut) => (
        <div key={shortcut.description} className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-meta text-ink">{shortcut.description}</dt>
          <dd className="flex items-center gap-1 shrink-0">
            {shortcut.keys.map((key) => (
              <kbd
                key={key}
                className="px-1.5 py-0.5 rounded-control bg-sunken text-caption text-ink-2 font-mono"
              >
                {key}
              </kbd>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  </Modal>
);
