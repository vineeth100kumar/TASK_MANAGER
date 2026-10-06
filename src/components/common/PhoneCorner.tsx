// PhoneCorner - The iPhone's notifications, now playing and home/away, in the
// corner of the screen: top-right on a phone, bottom-right on a desktop so it
// stays clear of the header buttons.
//
// The Pi reads them from the phone over Bluetooth (raspberry_pi/phone_link.py)
// and sends changes on its live stream. A new notification slides in and folds
// away after a few seconds; the small pill keeps the rest one tap away. Shows
// nothing unless the app talks to a Pi with the phone link on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Smartphone, X, Play, Pause, SkipForward, SkipBack, Music2 } from 'lucide-react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';
import { PHONE_EVENT } from '../../services/liveStream';

interface PhoneNotification {
  id: string;
  app: string;
  title: string;
  message: string;
  category: string;
  at: number;
}

interface PhoneMedia {
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  app: string;
}

interface PhoneStatus {
  available: boolean;
  connected: boolean;
  home: boolean;
  deviceName: string;
}

const PEEK_MS = 6000;

const timeAgo = (at: number): string => {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

const NotificationCard = ({ item, onDismiss }: { item: PhoneNotification; onDismiss: () => void }) => (
  <div className="group flex gap-3 items-start px-3.5 py-3">
    <div className="mt-0.5 w-7 h-7 shrink-0 rounded-lg bg-gray-900/[0.06] dark:bg-white/10 flex items-center justify-center text-[11px] font-semibold text-gray-600 dark:text-gray-300">
      {item.app.slice(0, 1).toUpperCase()}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 truncate">{item.app}</span>
        <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500 shrink-0">{timeAgo(item.at)}</span>
      </div>
      {item.title && <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate">{item.title}</p>}
      {item.message && <p className="text-[13px] leading-snug text-gray-600 dark:text-gray-300 line-clamp-2 break-words">{item.message}</p>}
    </div>
    <button onClick={onDismiss} aria-label="Dismiss notification"
      className="-mr-1 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-900/5 dark:hover:text-gray-200 dark:hover:bg-white/10 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition">
      <X size={14} />
    </button>
  </div>
);

export const PhoneCorner = () => {
  const baseUrl = piBackendUrl();
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [media, setMedia] = useState<PhoneMedia | null>(null);
  const [peek, setPeek] = useState<PhoneNotification | null>(null);
  const [open, setOpen] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const res = await fetch(`${baseUrl}/api/phone`, { headers: piHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setStatus({ available: data.available, connected: data.connected, home: data.home, deviceName: data.deviceName });
      setNotifications(data.notifications || []);
      setMedia(data.media || null);
    } catch {
      // The Pi is unreachable; the live stream will catch up later.
    }
  }, [baseUrl]);

  useEffect(() => {
    load();
    const onPhone = (e: Event) => {
      const event = (e as CustomEvent).detail;
      if (event.type === 'PHONE_NOTIFICATION') {
        const item: PhoneNotification = event.notification;
        setNotifications(prev => [item, ...prev.filter(n => n.id !== item.id)].slice(0, 20));
        setPeek(item);
        if (peekTimer.current) clearTimeout(peekTimer.current);
        peekTimer.current = setTimeout(() => setPeek(null), PEEK_MS);
      } else if (event.type === 'PHONE_NOTIFICATION_REMOVED') {
        setNotifications(prev => (event.id === '*' ? [] : prev.filter(n => n.id !== event.id)));
        setPeek(prev => (prev && (event.id === '*' || prev.id === event.id) ? null : prev));
      } else if (event.type === 'PHONE_MEDIA') {
        setMedia(event.media);
      } else if (event.type === 'PHONE_STATUS') {
        setStatus({ available: event.available, connected: event.connected, home: event.home, deviceName: event.deviceName });
        if (event.media) setMedia(event.media);
      }
    };
    window.addEventListener(PHONE_EVENT, onPhone);
    // A reconnect may have missed events, so refresh when the tab comes back.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(PHONE_EVENT, onPhone);
      document.removeEventListener('visibilitychange', onVisible);
      if (peekTimer.current) clearTimeout(peekTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dismiss = (id: string) => {
    setNotifications(prev => (id === 'all' ? [] : prev.filter(n => n.id !== id)));
    if (peek && (id === 'all' || peek.id === id)) setPeek(null);
    fetch(`${baseUrl}/api/phone/notifications/${encodeURIComponent(id)}`, { method: 'DELETE', headers: piHeaders() }).catch(() => {});
  };

  const command = (cmd: string) => {
    if (cmd === 'toggle' && media) setMedia({ ...media, playing: !media.playing });
    fetch(`${baseUrl}/api/phone/media`, {
      method: 'POST',
      headers: piHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ command: cmd }),
    }).catch(() => {});
  };

  const hasMedia = !!media?.title;
  if (!baseUrl || (!status?.available && notifications.length === 0)) return null;

  const dot = status?.connected ? 'bg-emerald-500' : status?.home ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600';
  const presence = status?.connected ? 'Home · phone connected' : status?.home ? 'Home · phone just left range' : 'Away';

  return (
    <div ref={panelRef} className="fixed z-[90] right-3 md:right-4 top-[calc(0.75rem+env(safe-area-inset-top))] md:top-auto md:bottom-4 flex flex-col md:flex-col-reverse items-end gap-2 w-[min(22rem,calc(100vw-1.5rem))] pointer-events-none">
      <button onClick={() => { setOpen(o => !o); setPeek(null); }} aria-expanded={open} aria-label={`Phone: ${presence}, ${notifications.length} notifications`}
        className="pointer-events-auto h-8 pl-2 pr-2.5 rounded-full flex items-center gap-1.5 bg-white/80 dark:bg-[#1c1c1f]/80 backdrop-blur-xl backdrop-saturate-150 ring-1 ring-black/[0.06] dark:ring-white/10 shadow-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
        <span className="relative">
          <Smartphone size={15} />
          <span className={`absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-[#1c1c1f] ${dot}`} />
        </span>
        {hasMedia && media!.playing && <Music2 size={13} className="text-gray-400" />}
        {notifications.length > 0 && (
          <span className="min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10.5px] font-semibold flex items-center justify-center">
            {notifications.length}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {peek && !open && (
          <motion.div key={peek.id} initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            className="pointer-events-auto w-full rounded-2xl bg-white/90 dark:bg-[#1c1c1f]/90 backdrop-blur-xl backdrop-saturate-150 ring-1 ring-black/[0.06] dark:ring-white/10 shadow-xl shadow-black/10 overflow-hidden">
            <NotificationCard item={peek} onDismiss={() => dismiss(peek.id)} />
          </motion.div>
        )}

        {open && (
          <motion.div key="panel" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.14 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}
            className="pointer-events-auto w-full rounded-2xl bg-white/95 dark:bg-[#1c1c1f]/95 backdrop-blur-xl backdrop-saturate-150 ring-1 ring-black/[0.06] dark:ring-white/10 shadow-xl shadow-black/10 overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400 truncate">{status?.deviceName || 'iPhone'} · {presence}</span>
              {notifications.length > 0 && (
                <button onClick={() => dismiss('all')} className="ml-auto text-[12px] font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Clear all</button>
              )}
            </div>

            {hasMedia && (
              <div className="mx-2 mb-1 px-2.5 py-2 rounded-xl bg-gray-900/[0.04] dark:bg-white/[0.06] flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-900/[0.06] dark:bg-white/10 flex items-center justify-center text-gray-500"><Music2 size={15} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate">{media!.title}</p>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{media!.artist || media!.app}</p>
                </div>
                <div className="flex items-center text-gray-600 dark:text-gray-300">
                  <button onClick={() => command('previous')} aria-label="Previous track" className="p-1.5 rounded-md hover:bg-gray-900/5 dark:hover:bg-white/10"><SkipBack size={14} /></button>
                  <button onClick={() => command('toggle')} aria-label={media!.playing ? 'Pause' : 'Play'} className="p-1.5 rounded-md hover:bg-gray-900/5 dark:hover:bg-white/10">
                    {media!.playing ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button onClick={() => command('next')} aria-label="Next track" className="p-1.5 rounded-md hover:bg-gray-900/5 dark:hover:bg-white/10"><SkipForward size={14} /></button>
                </div>
              </div>
            )}

            <div className="max-h-[min(24rem,60vh)] overflow-y-auto divide-y divide-gray-900/[0.05] dark:divide-white/[0.06]">
              {notifications.length === 0 ? (
                <p className="px-3.5 py-5 text-center text-[13px] text-gray-400 dark:text-gray-500">No phone notifications</p>
              ) : (
                notifications.map(n => <NotificationCard key={n.id} item={n} onDismiss={() => dismiss(n.id)} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
