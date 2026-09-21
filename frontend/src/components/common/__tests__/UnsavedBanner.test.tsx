import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SaveStateProvider, useSaveState } from '../../../context/SaveStateContext';
import { UnsavedBanner } from '../UnsavedBanner';

/*
 * The promise this makes to the user is narrow and worth testing exactly: a
 * write that did not land is named, stays named, and can be run again from
 * the screen it failed on.
 */

const Harness: React.FC<{ retry: () => Promise<unknown>; description?: string }> = ({
  retry,
  description = 'Renaming the car insurance',
}) => {
  const { recordFailure } = useSaveState();
  return (
    <>
      <button onClick={() => recordFailure({ description, retry })}>fail a write</button>
      <UnsavedBanner />
    </>
  );
};

const renderBanner = (retry: () => Promise<unknown>, description?: string) =>
  render(
    <SaveStateProvider>
      <Harness retry={retry} description={description} />
    </SaveStateProvider>
  );

describe('UnsavedBanner', () => {
  it('shows nothing while every write is landing', () => {
    renderBanner(() => Promise.resolve());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the write that did not save, and keeps naming it', async () => {
    renderBanner(() => Promise.resolve());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'fail a write' })); });

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('One change did not save');
    expect(banner).toHaveTextContent('Renaming the car insurance');

    // Nothing takes it away on its own: a toast would have gone by now.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('counts several failures and names the first', async () => {
    renderBanner(() => Promise.resolve());

    const trigger = screen.getByRole('button', { name: 'fail a write' });
    await act(async () => { fireEvent.click(trigger); });
    await act(async () => { fireEvent.click(trigger); });
    await act(async () => { fireEvent.click(trigger); });

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('3 changes did not save');
    expect(banner).toHaveTextContent('and 2 more');
  });

  it('runs the write again and clears itself when it lands', async () => {
    const retry = vi.fn(() => Promise.resolve('ok'));
    renderBanner(retry);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'fail a write' })); });
    await screen.findByRole('alert');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });

    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('stays put when the retry fails again', async () => {
    // A retry that rejects must leave the failure on screen rather than
    // quietly swallowing it, which is exactly what the toast used to do.
    const Recording: React.FC = () => {
      const { recordFailure } = useSaveState();
      const attempt = (): Promise<unknown> =>
        Promise.reject(new Error('still down')).catch(() => {
          recordFailure({ description: 'Renaming the car insurance', retry: attempt });
        });
      return (
        <>
          <button onClick={() => { void attempt(); }}>fail a write</button>
          <UnsavedBanner />
        </>
      );
    };

    render(
      <SaveStateProvider>
        <Recording />
      </SaveStateProvider>
    );

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'fail a write' })); });
    await screen.findByRole('alert');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('did not save'));
  });

  it('can be dismissed deliberately', async () => {
    renderBanner(() => Promise.resolve());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'fail a write' })); });
    await screen.findByRole('alert');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })); });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
