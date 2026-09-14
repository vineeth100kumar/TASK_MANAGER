import { useEffect, useRef, useState } from 'react';
import { getApiSecret } from '../config';

type MessageHandler = (event: { type: string; data: any }) => void;

export function useLiveSync(onMessage?: MessageHandler) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const onMessageRef = useRef<MessageHandler | undefined>(onMessage);

  // Keep latest onMessage callback without re-triggering effect
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let unmounted = false;
    let pingInterval: any = null;
    let retryDelay = 1000; // start with 1s, backoff up to 30s

    function connect() {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const token = getApiSecret();
      const query = token ? `?token=${encodeURIComponent(token)}` : '';
      const wsUrl = `${protocol}//${host}/ws${query}`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!unmounted) {
            setIsConnected(true);
            retryDelay = 1000; // Reset backoff on successful connection

            // Periodic keep-alive ping every 25 seconds
            clearInterval(pingInterval);
            pingInterval = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send('ping');
                } catch {
                  // ignore
                }
              }
            }, 25000);
          }
        };

        ws.onmessage = (event) => {
          try {
            if (event.data === 'pong') return;
            const parsed = JSON.parse(event.data);
            if (onMessageRef.current) onMessageRef.current(parsed);
          } catch {
            // ping or raw string
          }
        };

        const handleDisconnect = () => {
          clearInterval(pingInterval);
          if (!unmounted) {
            setIsConnected(false);
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30000);
          }
        };

        ws.onclose = handleDisconnect;
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        };
      } catch {
        if (!unmounted) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      }
    }

    connect();

    return () => {
      unmounted = true;
      clearInterval(pingInterval);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  return { isConnected };
}
