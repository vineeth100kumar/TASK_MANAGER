import React, { useState } from 'react';
import { 
  Smartphone, 
  Mic, 
  Copy, 
  Check, 
  ExternalLink, 
  Play, 
  Sparkles,
  DollarSign
} from 'lucide-react';
import { api } from '../../services/api';

export const ShortcutsModal: React.FC = () => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [testTaskText, setTestTaskText] = useState('Buy organic coffee beans tomorrow 10am');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

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
      setTestResult(data.spoken_response || 'Task successfully created via Siri API!');
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-24 md:pb-12">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center space-x-2">
          <Smartphone className="w-5 h-5 text-blue-400" />
          <span>iOS Siri & Apple Shortcuts Integration</span>
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          Turn your iPhone, Apple Watch, or HomePod into a voice controller for your Raspberry Pi 5.
        </p>
      </div>

      {/* Siri Capabilities Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl space-y-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <Mic className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-200">"Hey Siri, Quick Task"</h3>
          <p className="text-xs text-zinc-400">
            Dictate anything naturally. Local AI parses dates, priorities, and checklist steps automatically.
          </p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl space-y-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <DollarSign className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-200">"Hey Siri, Log Expense"</h3>
          <p className="text-xs text-zinc-400">
            Say "250 rupees for lunch via UPI". It logs the expense and deducts from your bank account.
          </p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl space-y-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-200">"Hey Siri, Daily Status"</h3>
          <p className="text-xs text-zinc-400">
            Siri reads aloud your productivity score, pending urgent tasks, and current bank balance.
          </p>
        </div>
      </div>

      {/* Setup Guide for iOS Shortcuts */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-100">Quick 2-Minute iOS Setup:</h2>

        <ol className="list-decimal list-inside space-y-3 text-xs text-zinc-300">
          <li>
            Open the <strong>Shortcuts</strong> app on your iPhone or iPad.
          </li>
          <li>
            Tap <strong>+</strong> to create a new Shortcut and rename it: <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-blue-300">Quick Task</code>
          </li>
          <li>
            Add action: <strong>"Ask for Input"</strong> (Type: Text, Prompt: <em>"What task would you like to add?"</em>)
          </li>
          <li>
            Add action: <strong>"Get Contents of URL"</strong>:
            <div className="mt-2 space-y-2 pl-4">
              <div className="flex items-center space-x-2">
                <span className="text-zinc-400">URL:</span>
                <code className="bg-zinc-800 px-2 py-1 rounded text-zinc-200 font-mono text-[11px] truncate flex-1">
                  {currentHost}/api/v1/shortcuts/quick-task
                </code>
                <button
                  onClick={() => copyToClipboard(`${currentHost}/api/v1/shortcuts/quick-task`, 'task_url')}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
                >
                  {copiedField === 'task_url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-[11px] text-zinc-400">
                Method: <strong className="text-zinc-200">POST</strong> • Request Body: <strong className="text-zinc-200">JSON</strong> with key: <code className="text-blue-400">input_text</code> = <em>Provided Input</em>
              </div>
            </div>
          </li>
          <li>
            Add action: <strong>"Speak Text"</strong> (select <code>Contents of URL &gt; spoken_response</code>) so Siri responds verbally!
          </li>
        </ol>
      </div>

      {/* Live Voice Simulator / Endpoint Tester */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-100 flex items-center space-x-2">
          <Play className="w-4 h-4 text-blue-400" />
          <span>Test Siri Voice Endpoint Live</span>
        </h2>

        <div className="flex gap-2">
          <input
            type="text"
            value={testTaskText}
            onChange={(e) => setTestTaskText(e.target.value)}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
            placeholder="Type what you would say to Siri..."
          />
          <button
            onClick={runTestTask}
            disabled={isTesting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shrink-0 flex items-center space-x-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isTesting ? 'Sending to Pi...' : 'Simulate Siri'}</span>
          </button>
        </div>

        {testResult && (
          <div className="p-3 bg-zinc-950/80 border border-zinc-800 rounded-xl text-xs space-y-1">
            <span className="text-[10px] uppercase font-bold text-emerald-400">Siri Spoken Response:</span>
            <p className="text-zinc-200 font-medium">"{testResult}"</p>
          </div>
        )}
      </div>
    </div>
  );
};
