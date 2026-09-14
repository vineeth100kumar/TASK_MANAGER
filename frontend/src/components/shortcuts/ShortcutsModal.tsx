import React, { useState } from 'react';
import { 
  Smartphone, 
  Mic, 
  Copy, 
  Check, 
  ExternalLink, 
  Play, 
  Sparkles,
  DollarSign,
  Radio
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
      {/* Broadsheet Section Header */}
      <div className="border-b-2 border-ink-base/80 dark:border-paper-light/80 pb-3 pt-1">
        <div className="flex items-center justify-between text-[10px] font-ledger uppercase tracking-widest text-ink-muted dark:text-stone-400 mb-1">
          <span>WIRE TRANSMISSION OFFICE • SEC. VI</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            PI-5 LOCAL BROADCAST ACTIVE
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-editorial font-bold text-ink-base dark:text-paper-light flex items-center space-x-2 tracking-tight">
          <Radio className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          <span>Telegraph Wire & Apple Siri Integration</span>
        </h1>
        <p className="text-xs font-editorial italic text-ink-muted dark:text-stone-400 mt-1">
          Direct telephone dispatch and voice telegraph line linking iPhone, Apple Watch, or HomePod to your Raspberry Pi 5.
        </p>
      </div>

      {/* Siri Capabilities Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="clipping clipping-white p-5 space-y-2.5 relative">
          <div className="w-8 h-8 rounded border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-ledger font-bold text-xs">
            <Mic className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-editorial font-bold text-ink-base dark:text-paper-light">"Hey Siri, Quick Task"</h3>
          <p className="text-xs font-editorial text-ink-muted dark:text-stone-400 leading-relaxed">
            Dictate anything naturally. Local AI parses dates, priorities, and checklist steps automatically.
          </p>
          <div className="pt-2 text-[9px] font-ledger uppercase tracking-wider text-ink-muted/70 dark:text-stone-500 border-t border-ink-base/10 dark:border-paper-light/10">
            DISPATCH CH. 01 • TASK INGESTION
          </div>
        </div>

        <div className="clipping clipping-white p-5 space-y-2.5 relative">
          <div className="w-8 h-8 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-ledger font-bold text-xs">
            <DollarSign className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-editorial font-bold text-ink-base dark:text-paper-light">"Hey Siri, Log Expense"</h3>
          <p className="text-xs font-editorial text-ink-muted dark:text-stone-400 leading-relaxed">
            Say "250 rupees for lunch via UPI". It logs the disbursement and adjusts your account ledger.
          </p>
          <div className="pt-2 text-[9px] font-ledger uppercase tracking-wider text-ink-muted/70 dark:text-stone-500 border-t border-ink-base/10 dark:border-paper-light/10">
            DISPATCH CH. 02 • LEDGER DISBURSEMENT
          </div>
        </div>

        <div className="clipping clipping-white p-5 space-y-2.5 relative">
          <div className="w-8 h-8 rounded border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-ledger font-bold text-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-editorial font-bold text-ink-base dark:text-paper-light">"Hey Siri, Daily Status"</h3>
          <p className="text-xs font-editorial text-ink-muted dark:text-stone-400 leading-relaxed">
            Siri reads aloud your productivity headline, pending urgent docket items, and current treasury balance.
          </p>
          <div className="pt-2 text-[9px] font-ledger uppercase tracking-wider text-ink-muted/70 dark:text-stone-500 border-t border-ink-base/10 dark:border-paper-light/10">
            DISPATCH CH. 03 • INTELLIGENCE BRIEF
          </div>
        </div>
      </div>

      {/* Setup Guide for iOS Shortcuts */}
      <div className="clipping clipping-cream p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-ink-base/15 dark:border-paper-light/15 pb-2">
          <h2 className="text-sm font-editorial font-bold text-ink-base dark:text-paper-light uppercase tracking-wider">
            OPERATING INSTRUCTIONS: 2-MINUTE iOS SHORTCUT SETUP
          </h2>
          <span className="text-[10px] font-ledger text-ink-muted dark:text-stone-400 uppercase">
            PROTOCOL REV 4.2
          </span>
        </div>

        <ol className="list-decimal list-inside space-y-3.5 text-xs font-editorial text-ink-base dark:text-stone-300">
          <li className="leading-relaxed">
            Open the <strong>Shortcuts</strong> application on your iPhone or iPad.
          </li>
          <li className="leading-relaxed">
            Tap <strong>+</strong> to create a new Shortcut and designate title: <code className="font-ledger bg-paper-aged dark:bg-stone-800 border border-ink-base/20 dark:border-stone-700 px-2 py-0.5 rounded text-amber-700 dark:text-amber-300 font-bold">Quick Task</code>
          </li>
          <li className="leading-relaxed">
            Add action: <strong>"Ask for Input"</strong> (Type: Text, Prompt: <em>"What task would you like to add?"</em>)
          </li>
          <li className="leading-relaxed">
            Add action: <strong>"Get Contents of URL"</strong>:
            <div className="mt-2.5 space-y-2 pl-4">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-ledger uppercase text-ink-muted dark:text-stone-400">ENDPOINT:</span>
                <code className="bg-paper-white dark:bg-stone-900 border border-ink-base/20 dark:border-stone-700 px-2.5 py-1.5 rounded text-ink-base dark:text-stone-200 font-ledger text-[11px] truncate flex-1 shadow-inner">
                  {currentHost}/api/v1/shortcuts/quick-task
                </code>
                <button
                  onClick={() => copyToClipboard(`${currentHost}/api/v1/shortcuts/quick-task`, 'task_url')}
                  className="p-1.5 bg-paper-aged dark:bg-stone-800 hover:bg-paper-white dark:hover:bg-stone-700 border border-ink-base/20 dark:border-stone-700 rounded text-ink-base dark:text-stone-200 transition-colors"
                  title="Copy URL"
                >
                  {copiedField === 'task_url' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-[11px] font-ledger text-ink-muted dark:text-stone-400">
                METHOD: <strong className="text-ink-base dark:text-stone-200">POST</strong> • BODY: <strong className="text-ink-base dark:text-stone-200">JSON</strong> with key: <code className="text-amber-700 dark:text-amber-400">input_text</code> = <em>Provided Input</em>
              </div>
            </div>
          </li>
          <li className="leading-relaxed">
            Add action: <strong>"Speak Text"</strong> (select <code>Contents of URL &gt; spoken_response</code>) so Siri confirms receipt verbally.
          </li>
        </ol>
      </div>

      {/* Live Voice Simulator / Endpoint Tester */}
      <div className="clipping clipping-white p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-ink-base/15 dark:border-paper-light/15 pb-2">
          <h2 className="text-sm font-editorial font-bold text-ink-base dark:text-paper-light flex items-center space-x-2">
            <Play className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>TRANSMITTER TEST TERMINAL (LIVE WIRE SIMULATION)</span>
          </h2>
          <span className="text-[10px] font-ledger text-ink-muted dark:text-stone-400 uppercase">
            STATION PI-5
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={testTaskText}
            onChange={(e) => setTestTaskText(e.target.value)}
            className="flex-1 bg-paper-aged/50 dark:bg-stone-900 border border-ink-base/20 dark:border-stone-700 rounded-lg px-3.5 py-2.5 text-xs font-ledger text-ink-base dark:text-stone-100 placeholder-ink-muted/60 dark:placeholder-stone-500 focus:outline-none focus:border-amber-600 dark:focus:border-amber-400"
            placeholder="Dictate simulated dispatch (e.g. Schedule meeting with counsel tomorrow 2pm)..."
          />
          <button
            onClick={runTestTask}
            disabled={isTesting}
            className="px-4 py-2.5 bg-ink-base hover:bg-stone-800 text-paper-white dark:bg-paper-light dark:hover:bg-paper-aged dark:text-ink-base text-xs font-ledger font-bold rounded-lg shrink-0 flex items-center justify-center space-x-1.5 transition-all shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isTesting ? 'TRANSMITTING...' : 'SIMULATE SIRI'}</span>
          </button>
        </div>

        {testResult && (
          <div className="p-3.5 bg-paper-aged dark:bg-stone-950 border border-ink-base/20 dark:border-stone-800 rounded-lg text-xs space-y-1">
            <span className="text-[10px] font-ledger uppercase font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
              TELEGRAPH RECEIPT & SPOKEN RESPONSE:
            </span>
            <p className="text-ink-base dark:text-stone-200 font-editorial font-medium italic text-sm">
              "{testResult}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
