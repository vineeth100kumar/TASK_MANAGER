import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { AiBusyEvent, AiStatus, CapturedItem } from '../types';

/**
 * Natural-language capture, and an honest account of what the Pi is doing.
 *
 * Running the model pins the CPU on a Pi 5, so for a few seconds the whole box
 * is slow to answer anything. The point of this hook is that those seconds look
 * deliberate rather than broken: the caller always knows whether the Pi is
 * thinking, and roughly how long it expects to take.
 *
 * Three things keep the client in step with the backend:
 *
 *  - The wait is sized from the backend's own budget (`next_timeout_seconds`),
 *    not a number picked here. A cold model can legitimately take half a
 *    minute, and a client that gives up at fifteen seconds would report a
 *    failure for a request the Pi was still happily working on.
 *  - `AI_BUSY` arrives over the WebSocket, so a second device shows the same
 *    state as the one that started the capture.
 *  - If the model does time out, the same text is re-sent with `use_ai: false`.
 *    The deterministic parser answers in well under a millisecond, so a slow
 *    or stopped Ollama costs a pause, never the capture itself.
 */
export function useCapture(onItemsCreated?: (items: CapturedItem[]) => void) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [expectedSeconds, setExpectedSeconds] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [usedFallback, setUsedFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Tick a visible timer while the Pi is busy, so the wait has a pulse.
  useEffect(() => {
    if (!isCapturing) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [isCapturing]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const capture = useCallback(
    async (text: string): Promise<CapturedItem[]> => {
      const trimmed = text.trim();
      if (!trimmed) return [];

      setIsCapturing(true);
      setUsedFallback(false);
      setError(null);

      // Ask the Pi what to expect before committing to a wait. If it cannot
      // answer, fall back to a generous ceiling rather than a tight one.
      let budgetMs = 45000;
      try {
        const status: AiStatus = await api.getAiStatus();
        setExpectedSeconds(status.warm ? status.typical_seconds : status.next_timeout_seconds);
        budgetMs = Math.round(status.next_timeout_seconds * 1000) + 8000;
      } catch {
        setExpectedSeconds(null);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await api.capture(trimmed, {
          timeoutMs: budgetMs,
          signal: controller.signal,
        });
        return result.items ?? [];
      } catch (aiError) {
        // The model was too slow, or is not running. The parser still is.
        try {
          const result = await api.capture(trimmed, { useAi: false, timeoutMs: 15000 });
          setUsedFallback(true);
          return result.items ?? [];
        } catch (fallbackError: any) {
          setError(fallbackError?.message || 'Could not reach the Pi');
          throw fallbackError;
        }
      } finally {
        abortRef.current = null;
        setIsCapturing(false);
        setExpectedSeconds(null);
      }
    },
    []
  );

  const captureAndReport = useCallback(
    async (text: string) => {
      const items = await capture(text);
      if (items.length && onItemsCreated) onItemsCreated(items);
      return items;
    },
    [capture, onItemsCreated]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsCapturing(false);
  }, []);

  return {
    capture: captureAndReport,
    cancel,
    isCapturing,
    expectedSeconds,
    elapsedSeconds,
    usedFallback,
    error,
  };
}

/**
 * Whether the Pi is running the model, from whichever device started it.
 *
 * Feed it `AI_BUSY` events from the live-sync socket. On mount it also reads
 * `/api/v1/ai/status` once, because the socket only carries events that happen
 * after a client connects -- a phone unlocked mid-capture would otherwise show
 * nothing at all.
 */
export function useAiActivity(lastEvent?: { type: string; data: any } | null) {
  const [isBusy, setIsBusy] = useState(false);
  const [expectedSeconds, setExpectedSeconds] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAiStatus()
      .then((status) => {
        if (cancelled) return;
        setIsBusy(status.busy);
        setExpectedSeconds(status.typical_seconds ?? status.next_timeout_seconds);
      })
      .catch(() => {
        /* the badge simply stays quiet */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'AI_BUSY') return;
    const data = lastEvent.data as AiBusyEvent;
    setIsBusy(Boolean(data?.busy));
    if (typeof data?.expected_seconds === 'number') {
      setExpectedSeconds(data.expected_seconds);
    }
  }, [lastEvent]);

  return { isBusy, expectedSeconds };
}
