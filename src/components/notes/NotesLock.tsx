import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';

// Notes ask for the Sage password every time they are opened. The Pi checks
// it (with the same wrong-try limits as the login page), and the unlock lives
// only as long as Notes stays on screen. Without a Pi, or with no password
// set on it, there is nothing to check against and Notes open straight away.
export function NotesLock({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const server = piBackendUrl();
    if (!server) { setState('open'); return; }
    fetch(`${server}/api/health`)
      .then(res => res.json())
      .then(health => setState(health.passwordGate ? 'locked' : 'open'))
      // Can't tell whether a password is set, so stay locked; unlocking will say why it can't.
      .catch(() => setState('locked'));
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${piBackendUrl()}/api/unlock`, {
        method: 'POST',
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) setState('open');
      else setError(data.error || 'Wrong password.');
    } catch {
      setError("Can't reach Sage to check the password.");
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return <div className="skeleton h-[calc(100vh-8.5rem)] !rounded-3xl" aria-busy="true" />;

  return (
    <div className="h-[calc(100vh-8.5rem)] flex items-center justify-center bg-white dark:bg-[#1c1c1e] rounded-3xl border border-black/5 dark:border-white/5 shadow-sm p-4">
      <form onSubmit={unlock} key={error} className={`stagger w-full max-w-xs text-center ${error ? 'animate-[shake_400ms_cubic-bezier(.36,.07,.19,.97)_both]' : ''}`}>
        <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-gray-100 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center">
          <Lock size={22} className="text-gray-700 dark:text-gray-200" strokeWidth={2.2} />
        </div>
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Notes are locked</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter your password to open them.</p>
        </div>
        <div>
          <input type="password" inputMode="numeric" autoComplete="current-password" autoFocus required placeholder="••••"
            aria-label="Password" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full h-14 text-center text-2xl tracking-[0.5em] indent-[0.5em] rounded-2xl bg-[#f5f5f7] dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none transition-shadow focus:bg-white dark:focus:bg-white/10 focus:border-transparent focus:ring-[3px] focus:ring-gray-900/10 dark:focus:ring-white/20" />
          {error && <p className="mt-3 px-3 py-2 rounded-xl text-[13.5px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-400/10" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !password}
            className="mt-4 w-full h-11 rounded-2xl text-[15px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 bg-gradient-to-b from-gray-800 to-gray-950 hover:from-gray-700 hover:to-gray-900 dark:from-white dark:to-gray-200 dark:hover:from-white dark:hover:to-gray-100 text-white dark:text-black shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 dark:ring-black/5">
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
