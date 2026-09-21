import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, onUnauthorized } from '../api';
import { setApiSecret, clearApiSecret } from '../../config';

/*
 * Every write in the app goes through this file, so the things it promises
 * are worth pinning down: the key on each request, the 401 that asks for a
 * new one, a timeout that is distinguishable from a cancellation, and errors
 * that carry their status so callers can tell a 404 from a dead Pi.
 */

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

const mockFetch = () => {
  const fn = vi.fn().mockResolvedValue(jsonResponse([]));
  vi.stubGlobal('fetch', fn);
  return fn;
};

const lastCall = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls[fn.mock.calls.length - 1];

describe('the API layer', () => {
  beforeEach(() => {
    localStorage.clear();
    clearApiSecret();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends the access key when there is one', async () => {
    const fetchMock = mockFetch();
    setApiSecret('a-real-key');

    await api.getItems();

    const [, init] = lastCall(fetchMock);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a-real-key');
  });

  it('sends no Authorization header at all when there is no key', async () => {
    const fetchMock = mockFetch();

    await api.getItems();

    const [, init] = lastCall(fetchMock);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('tells the app to ask for the key again on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('unauthorized', 401)));
    const listener = vi.fn();
    const stop = onUnauthorized(listener);

    await expect(api.getItems()).rejects.toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops telling a listener that has unsubscribed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('unauthorized', 401)));
    const listener = vi.fn();
    onUnauthorized(listener)();

    await expect(api.getItems()).rejects.toThrow();

    expect(listener).not.toHaveBeenCalled();
  });

  it('puts the status on the error, so a 404 is not a dead Pi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('no such item', 404)));

    await expect(api.getItems()).rejects.toMatchObject({ status: 404 });
  });

  it('builds a query only when there is something to filter by', async () => {
    const fetchMock = mockFetch();

    await api.getItems();
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/items');

    await api.getItems({ status: 'todo' });
    expect(lastCall(fetchMock)[0]).toBe('/api/v1/items?status=todo');
  });

  it('describes a drop by its neighbours, not by an index', async () => {
    const fetchMock = mockFetch();

    await api.reorderItem('item-2', { before_id: 'item-1', after_id: 'item-3' });

    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/v1/items/item-2/reorder');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ before_id: 'item-1', after_id: 'item-3' });
  });

  it('marks a timeout as a timeout', async () => {
    // A request that never settles: the built-in ceiling has to end it.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
    ));
    vi.useFakeTimers();

    const pending = api.getItems();
    const assertion = expect(pending).rejects.toMatchObject({ timedOut: true });
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });

  it('marks a caller-cancelled request as cancelled, not as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
    ));

    const controller = new AbortController();
    const pending = api.capture('dinner with amma tomorrow at 8', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ cancelled: true });
  });
});
