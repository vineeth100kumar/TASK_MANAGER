import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, Calendar, Download, Upload, X, Info, Sparkles, Trash2, AlertTriangle, Globe, Copy, ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import { NotificationSettings } from './NotificationSettings';
import { CaptureGuide } from './CaptureGuide';
import { BluetoothSettings } from './BluetoothSettings';
import { downloadICSFile } from '../../utils/calendarExport';
import { importCSVData } from '../../utils/dataImporter';
import { useToast } from '../../context/ToastContext';
import { LifeContext } from '../../services/types';
import { getPiApiKey, setPiApiKey, piBackendUrl, piHeaders } from '../../services/piBackend';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface SettingsModalProps {
  onClose: () => void;
  lifeContext?: LifeContext;
  onDataChanged?: () => void;
}

export function SettingsModal({ onClose, lifeContext, onDataChanged }: SettingsModalProps) {
  useEscapeKey(onClose);
  const [activeTab, setActiveTab] = useState<'attention' | 'capture' | 'bluetooth' | 'data' | 'system'>('attention');
  const [resurfacingDays, setResurfacingDays] = useState<number>(14);
  const [csvInput, setCsvInput] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(false);
  const [confirmText, setConfirmText] = useState<string>('');
  const [piKey, setPiKey] = useState<string>(() => getPiApiKey());
  // The Cloudflare Tunnel address, when the Pi has one. undefined = still asking.
  const [publicUrl, setPublicUrl] = useState<string | null | undefined>(undefined);
  const [publicKind, setPublicKind] = useState<string | null>(null);
  // Nightly copy of the Pi's database. undefined = still asking, null = Pi not reachable.
  const [backup, setBackup] = useState<{ lastBackupAt: string | null; count: number; time: string } | null | undefined>(undefined);
  const [backingUp, setBackingUp] = useState(false);
  const [groqStatus, setGroqStatus] = useState<{ set: boolean; source: string | null; last4: string | null } | null>(null);
  const [groqKey, setGroqKey] = useState('');
  const [savingGroq, setSavingGroq] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const base = piBackendUrl();
    if (!base) return;
    fetch(`${base}/api/settings/groq-key`, { headers: piHeaders() })
      .then(res => (res.ok ? res.json() : null))
      .then(json => json && setGroqStatus(json))
      .catch(() => {});
  }, []);

  const saveGroqKey = async (key: string) => {
    setSavingGroq(true);
    try {
      const res = await fetch(`${piBackendUrl()}/api/settings/groq-key`, {
        method: 'POST',
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || `The Pi said ${res.status}`);
      setGroqStatus(json);
      setGroqKey('');
      showToast(key ? 'Groq key saved on the Pi' : 'Groq key removed');
    } catch (err: any) {
      showToast(err.message || 'Could not save the key', 'error');
    } finally {
      setSavingGroq(false);
    }
  };

  useEffect(() => {
    const base = piBackendUrl();
    if (!base) { setPublicUrl(null); return; }
    fetch(`${base}/api/public-url`, { headers: piHeaders() })
      .then(res => (res.ok ? res.json() : { url: null }))
      .then(json => { setPublicUrl(json.url || null); setPublicKind(json.kind || null); })
      .catch(() => setPublicUrl(null));
  }, []);

  const loadBackup = () => {
    const base = piBackendUrl();
    if (!base) { setBackup(null); return; }
    fetch(`${base}/api/backup/status`, { headers: piHeaders() })
      .then(res => (res.ok ? res.json() : null))
      .then(json => setBackup(json?.success ? json : null))
      .catch(() => setBackup(null));
  };
  useEffect(loadBackup, []);

  const backUpNow = async () => {
    setBackingUp(true);
    try {
      const res = await fetch(`${piBackendUrl()}/api/backup/run`, { method: 'POST', headers: piHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Backup saved on the Pi');
      loadBackup();
    } catch (e: any) {
      showToast(`Backup failed: ${e.message}`, 'error');
    } finally {
      setBackingUp(false);
    }
  };

  useEffect(() => {
    api.getMeta('resurfacing_days').then(val => {
      if (val) setResurfacingDays(Number(val));
    });
  }, []);

  const handleSetResurfacingDays = async (days: number) => {
    setResurfacingDays(days);
    await api.setMeta('resurfacing_days', days);
    showToast(`Smart Resurfacing set to ${days} days`);
    if (onDataChanged) onDataChanged();
  };

  const handleExportICS = () => {
    const state = api.sync.getState();
    downloadICSFile(state.workItems);
    showToast('iCalendar (.ics) downloaded');
  };

  const handleImportCSV = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvInput.trim() || isImporting) return;
    setIsImporting(true);
    try {
      const result = await importCSVData(csvInput, lifeContext || 'work');
      showToast(`Imported ${result.imported} tasks from CSV!`);
      setCsvInput('');
      if (onDataChanged) onDataChanged();
    } catch (err: any) {
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearDatabase = async () => {
    if (confirmText !== 'CLEAR') return;
    try {
      await api.clearAllData();
      showToast('Database wiped successfully. Starting clean.');
      setIsConfirmingClear(false);
      if (onDataChanged) onDataChanged();
      onClose();
    } catch (err: any) {
      showToast('Failed to clear database: ' + err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans">
      <div className="absolute inset-0 scrim" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-[#1c1c1e] w-full max-w-2xl rounded-3xl shadow-2xl p-6 md:p-8 relative z-10 border border-gray-100 dark:border-white/10 space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            <Settings size={16} />
            <span>Sage System Settings</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto bg-gray-100 dark:bg-white/5 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('attention')}
            className={`flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
              activeTab === 'attention' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Notifications
          </button>
          <button
            onClick={() => setActiveTab('capture')}
            className={`flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
              activeTab === 'capture' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Shortcuts
          </button>
          <button
            onClick={() => setActiveTab('bluetooth')}
            className={`flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
              activeTab === 'bluetooth' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Bluetooth
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
              activeTab === 'data' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Data & Migration
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`flex-1 whitespace-nowrap px-3 py-2 text-xs font-semibold rounded-xl transition-all ${
              activeTab === 'system' ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            Server & Reset
          </button>
        </div>

        {/* Tab 1: Attention & Notifications */}
        {activeTab === 'attention' && (
          <div className="space-y-6">
            <NotificationSettings />

            {/* Smart Resurfacing Sensitivity */}
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-500" />
                <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Smart Resurfacing Threshold</h4>
              </div>
              <p className="text-xs text-gray-400">
                Gently suggest uncompleted items in your Today surface if you haven't opened or touched them in:
              </p>

              <div className="grid grid-cols-4 gap-2">
                {[7, 14, 21, 30].map(days => (
                  <button
                    key={days}
                    onClick={() => handleSetResurfacingDays(days)}
                    className={`py-2 text-xs font-semibold rounded-xl transition-all ${
                      resurfacingDays === days 
                        ? 'bg-amber-500 text-white shadow-sm' 
                        : 'bg-white dark:bg-white/5 border border-black/5 dark:border-white/5 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {days} Days
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Setup guide for Siri, Share Sheet, Home Screen and email capture */}
        {activeTab === 'capture' && <CaptureGuide publicUrl={publicUrl} />}

        {/* Bluetooth: connect, disconnect and pair devices on the Pi */}
        {activeTab === 'bluetooth' && <BluetoothSettings />}

        {/* Tab 3: Data Portability & Migration */}
        {activeTab === 'data' && (
          <div className="space-y-6">
            {/* Calendar Export */}
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600">
                  <Calendar size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-gray-900 dark:text-white">iCalendar (.ics) Export</h4>
                  <p className="text-xs text-gray-400">Export all time-bound tasks and events to Google/Apple Calendar.</p>
                </div>
              </div>

              <button
                onClick={handleExportICS}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs rounded-xl shadow-sm flex items-center gap-1.5 shrink-0"
              >
                <Download size={14} /> Export .ics
              </button>
            </div>

            {/* CSV / Todoist Importer */}
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3">
              <div className="flex items-center gap-2">
                <Upload size={16} className="text-blue-500" />
                <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Import from CSV / Todoist</h4>
              </div>
              <p className="text-xs text-gray-400">
                Paste raw CSV text or upload an export file from Todoist, Notion, or Google Tasks:
              </p>

              <form onSubmit={handleImportCSV} className="space-y-3">
                <textarea
                  value={csvInput}
                  onChange={e => setCsvInput(e.target.value)}
                  placeholder="Paste CSV contents here (Title, Due Date, Priority, Description)..."
                  rows={4}
                  className="w-full p-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono outline-none dark:text-white"
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!csvInput.trim() || isImporting}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-xs rounded-xl shadow-sm flex items-center gap-1.5"
                  >
                    <Upload size={13} /> {isImporting ? 'Importing...' : 'Run Import'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tab 4: Google Sheets Backend Specs & Clear Database */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-2">
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-xs uppercase tracking-wider">
                <Info size={16} />
                <span>Google Sheets Backend Constraints</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                Sage uses Google Sheets as a personal, zero-cost cloud replica. Below are the architectural bounds:
              </p>
              <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-1 pt-1">
                <li><strong>Capacity:</strong> Google Sheets supports up to 10 million cells (~100,000+ tasks).</li>
                <li><strong>Concurrency:</strong> Writes are serialized via a 15-second atomic mutex (`LockService`).</li>
                <li><strong>Bandwidth Optimization:</strong> Sage uses incremental pull (`getChangesSince`) to minimize data transfer.</li>
                <li><strong>Storage Safety:</strong> All mutations are persisted locally in IndexedDB first, guaranteeing offline durability.</li>
              </ul>
            </div>

            {/* Nightly copy of the Pi database */}
            {piBackendUrl() && backup !== undefined && (() => {
              const ageHours = backup?.lastBackupAt ? (Date.now() - new Date(backup.lastBackupAt).getTime()) / 3600000 : null;
              const state = ageHours === null ? 'bad' : ageHours <= 30 ? 'good' : ageHours <= 72 ? 'warn' : 'bad';
              const dot = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }[state];
              return (
                <div className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${backup ? dot : 'bg-gray-400'}`} aria-hidden="true" />
                    <span>Pi backup</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {backup === null
                      ? "Couldn't reach the Pi's backup service."
                      : backup.lastBackupAt
                        ? `Last copy ${new Date(backup.lastBackupAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Sage keeps ${backup.count} on the Pi and takes a new one every night at ${backup.time}.`
                        : `No copy yet. Sage takes one every night at ${backup.time}.`}
                  </p>
                  {backup && (
                    <button onClick={backUpNow} disabled={backingUp} className="px-3 py-2 rounded-xl bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-xs font-semibold disabled:opacity-50">
                      {backingUp ? 'Backing up…' : 'Back up now'}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Public link through the Cloudflare Tunnel */}
            <div className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                <Globe size={16} />
                <span>Your public link</span>
              </div>
              {publicUrl ? (
                <>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Open Sage from anywhere with this link. It asks for your password.
                    {publicKind === 'cloudflare-quick' && ' This free link changes when the Pi restarts, so check back here for the current one.'}
                  </p>
                  <div className="flex items-center gap-2">
                    <a href={publicUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline">
                      {publicUrl}
                    </a>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(publicUrl).then(() => showToast('Link copied'))}
                      className="px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5"
                    >
                      <Copy size={13} /> Copy
                    </button>
                    <a href={publicUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5">
                      <ExternalLink size={13} /> Open
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {publicUrl === undefined
                    ? 'Checking…'
                    : piBackendUrl()
                      ? 'No public link yet. To make a free one, run sudo deploy/setup_tunnel.sh on the Pi. No domain needed.'
                      : "This copy of the app isn't connected to your Pi."}
                </p>
              )}
            </div>

            {/* Groq key for Canvas's Think with me */}
            {piBackendUrl() && (
              <form
                onSubmit={e => { e.preventDefault(); if (groqKey.trim()) saveGroqKey(groqKey); }}
                className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3"
              >
                <label htmlFor="groq-api-key" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                  <Sparkles size={16} />
                  <span>Groq API key</span>
                </label>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Powers "Think with me" on the Canvas. Get a free key at console.groq.com. It's saved on your Pi, not in this browser.
                </p>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {groqStatus === null
                    ? 'Checking…'
                    : groqStatus.set
                      ? `In use: key ending in ${groqStatus.last4}${groqStatus.source === 'pi' ? ' (from the Pi\'s own settings)' : ''}.`
                      : 'No key yet, so Think with me uses the Pi\'s slow built-in model.'}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    id="groq-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder={groqStatus?.set ? 'Paste a new key to replace it' : 'gsk_…'}
                    value={groqKey}
                    onChange={e => setGroqKey(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono outline-none dark:text-white"
                  />
                  <button type="submit" disabled={savingGroq || !groqKey.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-sm">
                    {savingGroq ? 'Checking…' : 'Save'}
                  </button>
                </div>
                {groqStatus?.source === 'settings' && (
                  <button type="button" onClick={() => saveGroqKey('')} disabled={savingGroq} className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                    Remove saved key
                  </button>
                )}
              </form>
            )}

            {/* Raspberry Pi server key */}
            <form
              onSubmit={e => {
                e.preventDefault();
                setPiApiKey(piKey);
                showToast(piKey.trim() ? 'Pi server key saved on this device' : 'Pi server key removed');
                api.sync.forceSync();
              }}
              className="p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3"
            >
              <label htmlFor="pi-api-key" className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                Raspberry Pi server key
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                The API_SECRET from /etc/sage/sage.env on your Pi. It is stored in this browser only.
              </p>
              <div className="flex items-center gap-2">
                <input
                  id="pi-api-key"
                  type="password"
                  autoComplete="off"
                  value={piKey}
                  onChange={e => setPiKey(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono outline-none dark:text-white"
                />
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-sm">
                  Save
                </button>
              </div>
            </form>

            {/* DANGER ZONE: Clear Database */}
            <div className="p-5 rounded-2xl bg-red-50/60 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 space-y-3">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-semibold text-xs uppercase tracking-wider">
                <AlertTriangle size={16} />
                <span>Danger Zone · Clear Database</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Wipe all local IndexedDB stores, operations queue, and metadata. This resets Sage to a completely fresh installation.
              </p>

              {!isConfirmingClear ? (
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(true)}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-transform active:scale-95"
                >
                  <Trash2 size={14} /> Clear Local Database
                </button>
              ) : (
                <div className="p-4 rounded-xl bg-white dark:bg-[#2c2c2e] border border-red-200 dark:border-red-900/40 space-y-3">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                    Type <span className="font-mono bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded">CLEAR</span> to confirm wiping all local records:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Type CLEAR"
                      value={confirmText}
                      onChange={e => setConfirmText(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/5 border border-red-200 dark:border-red-800 text-xs font-mono font-bold outline-none dark:text-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={confirmText !== 'CLEAR'}
                      onClick={handleClearDatabase}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-30 text-white font-semibold text-xs rounded-xl shadow-sm"
                    >
                      Confirm Wipe
                    </button>
                    <button
                      type="button"
                      onClick={() => { setIsConfirmingClear(false); setConfirmText(''); }}
                      className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </motion.div>
    </div>
  );
}
