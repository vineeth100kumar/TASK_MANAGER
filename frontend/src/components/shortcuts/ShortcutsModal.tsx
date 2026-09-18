import React, { useState, useEffect } from 'react';
import { Copy, Check, Bell, Home, RotateCw } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { api } from '../../services/api';

/* The three things the backend will do for a shortcut, and how to reach them. */
const ENDPOINTS = [
  { name: 'Add a task', method: 'POST', path: '/api/v1/shortcuts/quick-task' },
  { name: 'Log an expense', method: 'POST', path: '/api/v1/shortcuts/log-expense' },
  { name: 'Read the day back', method: 'GET', path: '/api/v1/shortcuts/status' },
];

export const ShortcutsModal: React.FC = () => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [testTaskText, setTestTaskText] = useState('Buy coffee beans tomorrow 10am');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Home Mode & Fan Quiet Hours state
  const [homeMode, setHomeMode] = useState<boolean>(true);
  const [isQuietHoursNow, setIsQuietHoursNow] = useState<boolean>(false);
  const [pendingBacklog, setPendingBacklog] = useState<{ tasks: number; projects: number }>({ tasks: 0, projects: 0 });
  const [isProcessingBacklog, setIsProcessingBacklog] = useState(false);
  const [backlogFeedback, setBacklogFeedback] = useState<string | null>(null);

  useEffect(() => {
    api.getHomeMode().then((res) => {
      if (res.success && res.data) {
        setHomeMode(res.data.home_mode);
        setIsQuietHoursNow(res.data.is_quiet_hours_now);
        setPendingBacklog({
          tasks: res.data.pending_tasks,
          projects: res.data.pending_projects,
        });
      }
    }).catch(() => {});
  }, []);

  const handleToggleHomeMode = async () => {
    try {
      const next = !homeMode;
      const res = await api.setHomeMode(next);
      if (res.success && res.data) {
        setHomeMode(res.data.home_mode);
        setIsQuietHoursNow(res.data.is_quiet_hours_now);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunBacklogNow = async () => {
    setIsProcessingBacklog(true);
    setBacklogFeedback(null);
    try {
      const res = await api.processBacklog(true);
      if (res.success && res.data) {
        setBacklogFeedback(
          `Processed ${res.data.processed_projects} projects and ${res.data.processed_tasks} tasks.`
        );
        setPendingBacklog({
          projects: res.data.pending_projects,
          tasks: res.data.pending_tasks,
        });
      }
    } catch (e) {
      setBacklogFeedback('Failed to process backlog.');
    } finally {
      setIsProcessingBacklog(false);
    }
  };

  const push = usePushNotifications();
  const currentHost = window.location.origin;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const runTestTask = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${currentHost}/api/v1/shortcuts/quick-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_text: testTaskText }),
      });
      const data = await res.json();
      setTestResult(data.spoken_response || 'Task created.');
    } catch (e: unknown) {
      setTestResult(e instanceof Error ? `Error: ${e.message}` : 'Something went wrong.');
    } finally {
      setIsTesting(false);
    }
  };

  /* What the reminders row says, which depends entirely on what the browser allows. */
  const pushCopy: Record<string, { body: string; action: string | null }> = {
    on: {
      body: 'This device will be notified when something falls due.',
      action: 'Turn off',
    },
    off: {
      body: 'Get told when something falls due, even with the app closed.',
      action: 'Turn on',
    },
    asking: { body: 'Waiting for the browser.', action: null },
    denied: {
      body: 'Your browser is blocking notifications for this site. It can only be undone in the browser’s own settings for this page.',
      action: null,
    },
    unsupported: {
      body: 'This browser cannot do notifications. On an iPhone, add Sage to the Home Screen first and open it from there.',
      action: null,
    },
    unconfigured: {
      body: 'The Pi has no notification keys yet. Run deploy/generate_vapid_keys.sh on it, add the two lines it prints to the backend environment, and restart sage-backend.',
      action: null,
    },
    error: { body: push.detail || 'Something went wrong.', action: 'Try again' },
  };

  const copy = pushCopy[push.state];

  return (
    <div className="mx-auto max-w-2xl px-5 pt-3 pb-40 md:pb-16">
      <header className="pt-2">
        <h1 className="screen-title">Settings</h1>
        <p className="text-meta text-ink-3 mt-0.5">Notifications, device settings, and talking to Sage from Siri.</p>
      </header>

      {/* ------------------- Home Mode & Fan Quiet Hours ------------------- */}
      <section className="mt-7">
        <h2 className="label mb-2">Raspberry Pi Quiet Mode</h2>

        <div className="surface px-4 py-3.5 flex flex-col gap-3">
          <div className="flex items-start gap-3.5">
            <Home
              className={`w-5 h-5 mt-0.5 shrink-0 ${
                homeMode ? 'text-accent-500' : 'text-ink-3'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-body font-medium text-ink">
                  {homeMode ? 'Home Mode is active' : 'Home Mode is off'}
                </p>
                {homeMode && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent-500/10 text-accent-600 dark:text-accent-400">
                    Quiet Fans
                  </span>
                )}
              </div>
              <p className="text-meta text-ink-2 mt-0.5 leading-relaxed">
                {homeMode
                  ? 'Defers background AI description sweeps for existing tasks until midnight (01:30 AM – 05:30 AM) to prevent fan noise while you are home. New tasks still generate descriptions immediately.'
                  : 'Background AI description generation runs automatically at any time.'}
              </p>
            </div>

            <button
              onClick={handleToggleHomeMode}
              className={`shrink-0 h-9 px-3.5 rounded-control text-meta font-medium
                          transition-all duration-200 ease-spring active:scale-[0.97] ${
                            homeMode
                              ? 'bg-sunken text-ink-2 hover:text-ink'
                              : 'bg-accent-500 hover:bg-accent-600 text-white'
                          }`}
            >
              {homeMode ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          <div className="border-t border-hairline pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-meta">
            <div className="text-ink-2">
              <span className="text-ink font-medium">
                {pendingBacklog.projects + pendingBacklog.tasks === 0
                  ? 'All tasks & projects have descriptions'
                  : `${pendingBacklog.projects} project${pendingBacklog.projects === 1 ? '' : 's'}, ${pendingBacklog.tasks} task${pendingBacklog.tasks === 1 ? '' : 's'} pending`}
              </span>
              <span className="text-ink-3 block text-caption mt-0.5">
                {isQuietHoursNow
                  ? '🌙 Quiet hours active now (01:30 – 05:30 AM)'
                  : homeMode
                  ? '⏰ Scheduled for quiet hours (01:30 – 05:30 AM)'
                  : '⚡ Runs anytime on background schedule'}
              </span>
            </div>

            <button
              onClick={handleRunBacklogNow}
              disabled={isProcessingBacklog || (pendingBacklog.projects === 0 && pendingBacklog.tasks === 0)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control text-meta font-medium
                         bg-surface-sunken hover:bg-hairline/60 text-ink-2 hover:text-ink transition-colors
                         disabled:opacity-40 disabled:pointer-events-none self-start sm:self-auto shrink-0"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isProcessingBacklog ? 'animate-spin text-accent-500' : ''}`} />
              {isProcessingBacklog ? 'Processing...' : 'Process backlog now'}
            </button>
          </div>

          {backlogFeedback && (
            <p className="text-caption text-accent-600 dark:text-accent-400 bg-accent-500/10 px-3 py-1.5 rounded-control">
              {backlogFeedback}
            </p>
          )}
        </div>
      </section>

      {/* ---------------------------- Reminders ---------------------------- */}
      <section className="mt-7">
        <h2 className="label mb-2">Reminders</h2>

        <div className="surface px-4 py-3.5 flex items-start gap-3.5">
          <Bell
            className={`w-5 h-5 mt-0.5 shrink-0 ${
              push.state === 'on' ? 'text-accent-500' : 'text-ink-3'
            }`}
          />

          <div className="min-w-0 flex-1">
            {/* Short by design: on a phone this line sits beside the button. */}
            <p className="text-body text-ink">
              {push.state === 'on' ? 'Reminders are on' : 'Reminders are off'}
            </p>
            <p className="text-meta text-ink-2 mt-0.5 leading-relaxed">{copy.body}</p>
          </div>

          {copy.action && (
            <button
              onClick={push.state === 'on' ? push.disable : push.enable}
              disabled={push.state === 'asking'}
              className={`shrink-0 h-9 px-3.5 rounded-control text-meta font-medium
                          transition-all duration-200 ease-spring active:scale-[0.97]
                          disabled:opacity-40 disabled:pointer-events-none ${
                            push.state === 'on'
                              ? 'bg-sunken text-ink-2 hover:text-ink'
                              : 'bg-accent-500 hover:bg-accent-600 text-white'
                          }`}
            >
              {copy.action}
            </button>
          )}
        </div>

        {/*
          The iPhone caveat is worth stating up front rather than leaving someone
          to discover that the button does nothing in a Safari tab.
        */}
        {(push.state === 'off' || push.state === 'unsupported') && (
          <p className="text-meta text-ink-3 mt-2 leading-relaxed">
            On an iPhone this only works once Sage is on the Home Screen: Share, then
            Add to Home Screen, then open it from there.
          </p>
        )}
      </section>

      {/* ------------------------------ Siri ------------------------------ */}
      <section className="mt-9">
        <h2 className="label mb-2">Siri</h2>
        <p className="text-meta text-ink-2 leading-relaxed">
          Three things Sage can do by voice, through the Shortcuts app: add a task from
          whatever you say, log an expense, and read the day back to you.
        </p>

        <div className="surface-sunken mt-3 divide-y divide-hairline">
          {ENDPOINTS.map((e) => (
            <div key={e.path} className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-meta text-ink">
                  {e.name} <span className="text-ink-3">· {e.method}</span>
                </div>
                <code className="block text-caption text-ink-2 font-mono truncate mt-0.5">
                  {currentHost}
                  {e.path}
                </code>
              </div>
              <button
                onClick={() => copyToClipboard(`${currentHost}${e.path}`, e.path)}
                aria-label={`Copy the ${e.name.toLowerCase()} address`}
                className="w-9 h-9 grid place-items-center rounded-control text-ink-3 hover:text-ink hover:bg-hairline/60 transition-colors shrink-0"
              >
                {copiedField === e.path ? (
                  <Check className="w-4 h-4 text-done-500 dark:text-done-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          ))}
        </div>

        <ol className="mt-4 space-y-2.5 text-meta text-ink-2 list-decimal pl-4 marker:text-ink-3">
          <li className="leading-relaxed pl-1">
            In Shortcuts, make a new shortcut called <span className="text-ink">Quick Task</span>.
          </li>
          <li className="leading-relaxed pl-1">
            Add <span className="text-ink">Ask for Input</span>, as text.
          </li>
          <li className="leading-relaxed pl-1">
            Add <span className="text-ink">Get Contents of URL</span> with the first address above,
            method POST, a JSON body, and one key called{' '}
            <span className="text-ink font-mono">input_text</span> set to that input.
          </li>
          <li className="leading-relaxed pl-1">
            Add <span className="text-ink">Speak Text</span> and pick{' '}
            <span className="text-ink font-mono">spoken_response</span>, so Siri answers you.
          </li>
        </ol>
      </section>

      {/* ------------------------------ Test ------------------------------ */}
      <section className="mt-9">
        <h2 className="label mb-2">Try it</h2>
        <p className="text-meta text-ink-2 leading-relaxed">
          Sends a line to the same endpoint Siri uses, so you can check it before
          building the shortcut.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <input
            type="text"
            id="sage-shortcut-test"
            value={testTaskText}
            onChange={(e) => setTestTaskText(e.target.value)}
            className="field flex-1"
            placeholder="Say something you would say to Siri"
          />
          <button
            onClick={runTestTask}
            disabled={isTesting}
            className="h-11 px-4 rounded-control bg-accent-500 hover:bg-accent-600 text-white
                       text-meta font-semibold shrink-0 transition-all duration-200 ease-spring
                       active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
          >
            {isTesting ? 'Sending' : 'Send'}
          </button>
        </div>

        {testResult && (
          <div className="surface-sunken mt-3 px-4 py-3.5">
            <div className="text-meta text-ink-3">Sage said</div>
            <p className="text-body text-ink mt-1">{testResult}</p>
          </div>
        )}
      </section>
    </div>
  );
};
