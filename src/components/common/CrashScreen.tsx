// CrashScreen - Catches an error that would otherwise unmount the whole app
// and leave a blank white window. Shows what broke and a way back in, so a
// bad record or a half-updated app never looks like Sage is simply gone.

import React from 'react';

interface State {
  error: Error | null;
}

export class CrashScreen extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Sage crashed while drawing the page:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A chunk from before the Pi rebuilt the app: a reload fetches the new one.
    const stale = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <div className="max-w-lg w-full space-y-4">
          <h1 className="text-lg font-semibold">
            {stale ? 'Sage was updated while this window was open' : 'Something went wrong drawing this page'}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {stale ? 'Reload to get the new version.' : 'Your data is safe on the Pi. Reload to try again; if it keeps happening, send this message to Claude.'}
          </p>
          <pre className="text-xs whitespace-pre-wrap break-words rounded-lg bg-gray-100 dark:bg-gray-900 p-3 max-h-60 overflow-auto">
            {error.message}
            {error.stack ? `\n\n${error.stack.split('\n').slice(1, 6).join('\n')}` : ''}
          </pre>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-sm font-medium">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
