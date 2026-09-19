import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Names the part of the app that failed, e.g. "Tasks". */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken render from taking the whole app with it.
 *
 * Sage is installed to the Home Screen, so an uncaught render error showed a
 * white page and reloading served the same cached shell straight back: the app
 * looked bricked with no way in. A boundary turns that into one view saying
 * what happened, with everything else still usable.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Sage caught a render error', error, info);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { label } = this.props;

    return (
      <div role="alert" className="px-6 py-10 flex flex-col items-center text-center">
        <div className="w-11 h-11 rounded-control bg-sunken flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-ink-2" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-title text-ink">
          {label ? `${label} stopped working` : 'Something stopped working'}
        </h2>
        <p className="mt-1.5 text-meta text-ink-2 leading-relaxed max-w-xs">
          The rest of Sage is still fine. Your data is on the Pi and nothing was lost.
        </p>

        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={this.handleRetry}
            className="h-9 px-3.5 rounded-control bg-accent-500 hover:bg-accent-600 text-white
                       text-meta font-medium transition-all duration-200 ease-spring active:scale-[0.97]"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="h-9 px-3.5 rounded-control bg-sunken text-ink-2 hover:text-ink
                       text-meta font-medium transition-colors"
          >
            Reload Sage
          </button>
        </div>

        <details className="mt-5 max-w-xs w-full text-left">
          <summary className="text-caption text-ink-3 cursor-pointer select-none">
            Technical detail
          </summary>
          <pre className="mt-2 p-3 rounded-control bg-sunken text-caption text-ink-2 font-mono
                          whitespace-pre-wrap break-words overflow-x-auto">
            {error.message || String(error)}
          </pre>
        </details>
      </div>
    );
  }
}
