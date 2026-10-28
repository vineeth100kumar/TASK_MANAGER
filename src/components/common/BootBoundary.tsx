import React from 'react';
import { SageLoader } from './SageLoader';

// If the app throws while starting (or later), show the loading screen's error
// face with a Reload button instead of a blank white window. This is the last
// line of defence; day-to-day failures are caught closer to where they happen.
interface State { error: Error | null }

export class BootBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Leave a trace for the Pi's logs / devtools without crashing the page.
    console.error('[Sage] crashed:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <SageLoader
          error="Something went wrong opening Sage. Reloading usually fixes it."
          onRetry={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
