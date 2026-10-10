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
      <form onSubmit={unlock} className="w-full max-w-xs text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
          <Lock size={22} className="text-blue-500" />
        </div>
        <div>
          <h2 className="font-bold text-lg text-gray-900 dark:text-white">Notes are locked</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Enter your password to open them.</p>
        </div>
        <input type="password" inputMode="numeric" autoComplete="current-password" autoFocus required
          aria-label="Password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full text-center text-2xl tracking-[0.4em] px-3 py-2.5 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
        {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !password}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl transition-transform active:scale-95 shadow-sm">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
