import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { setApiSecret } from '../../config';

interface ConnectScreenProps {
  /** Set when a key was already tried and the Pi rejected it. */
  wasRejected?: boolean;
  onConnected: () => void;
}

/**
 * The one screen shown before the app has a key.
 *
 * Sage used to ship with the key compiled into it, which meant anyone who
 * found the address was already inside. The key lives on the Pi now and gets
 * typed in here once per browser, so this is the first thing a new device
 * sees and the thing that appears again if the key is ever rotated.
 */
export const ConnectScreen: React.FC<ConnectScreenProps> = ({ wasRejected, onConnected }) => {
  const [value, setValue] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(
    wasRejected ? 'That key is no longer the one this Pi expects.' : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = value.trim();
    if (!candidate || isChecking) return;

    setIsChecking(true);
    setError(null);
    try {
      // Checked against a route that actually requires the key, so a typo is
      // caught here rather than becoming an app that loads nothing and says
      // nothing. /api/health would not do: it is deliberately unauthenticated
      // and answers anyone.
      const probe = await fetch('/api/v1/items?limit=1', {
        headers: { Authorization: `Bearer ${candidate}` },
      });

      if (probe.status === 401) {
        setError('That key was not accepted. Check it and try again.');
        return;
      }
      if (!probe.ok) {
        setError('The Pi answered, but not happily. Try again in a moment.');
        return;
      }

      setApiSecret(candidate);
      onConnected();
    } catch {
      setError('Could not reach the Pi. Is it on, and are you on the right address?');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-6 bg-ground">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="w-11 h-11 rounded-control bg-sunken flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-ink-2" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-title text-ink">Connect to your Pi</h1>
          <p className="mt-1.5 text-meta text-ink-2 leading-relaxed">
            Sage needs the key from your Raspberry Pi before it can show you anything.
            You only have to do this once on this device.
          </p>
        </div>

        <label htmlFor="sage-key" className="label block mt-7 mb-1.5">
          Access key
        </label>
        <input
          id="sage-key"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste the key"
          aria-invalid={!!error}
          aria-describedby={error ? 'sage-key-error' : 'sage-key-hint'}
          className="w-full h-11 px-3.5 rounded-control bg-surface border border-hairline
                     text-body text-ink placeholder:text-ink-3 font-mono
                     focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
        />

        {error ? (
          <p id="sage-key-error" role="alert" className="mt-2 text-meta text-red-500">
            {error}
          </p>
        ) : (
          <p id="sage-key-hint" className="mt-2 text-meta text-ink-3 leading-relaxed">
            It is the <code className="font-mono">API_SECRET</code> on the Pi. If you have
            not set one, the backend printed the key it generated into its log.
          </p>
        )}

        <button
          type="submit"
          disabled={!value.trim() || isChecking}
          className="w-full h-11 mt-4 rounded-control bg-accent-500 hover:bg-accent-600
                     text-white text-body font-medium transition-all duration-200 ease-spring
                     active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none
                     inline-flex items-center justify-center gap-2"
        >
          {isChecking && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {isChecking ? 'Checking' : 'Connect'}
        </button>
      </form>
    </div>
  );
};
