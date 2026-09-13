import { useEffect, useRef, useState } from 'react';

type MessageHandler = (event: { type: string; data: any }) => void;

export function useLiveSync(onMessage?: MessageHandler) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  useEffect(() => {
    let unmounted = false;

    let pingInterval: any = null;

    function connect() {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!unmounted) {
            setIsConnected(true);
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
            if (onMessage) onMessage(parsed);
          } catch {
            // ping or raw string
          }
        };

        ws.onclose = () => {
          clearInterval(pingInterval);
          if (!unmounted) {
            setIsConnected(false);
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connect, 2000);
          }
        };

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
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
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
