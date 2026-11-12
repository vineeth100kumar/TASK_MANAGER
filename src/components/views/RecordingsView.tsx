// RecordingsView - Record audio from the Pi's USB microphone, play back and
// transcribe with Groq Whisper.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Circle, Copy, FileText, Loader2, Mic, MicOff, Pause, Play, Square, Trash2, Type } from 'lucide-react';
import { Recording, CaptureDevice, RecordingStatus, recordingsApi, formatDuration, formatFileSize } from '../../services/recordings';
import { useToast } from '../../context/ToastContext';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function RecordingsView() {
  const { showToast } = useToast();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [devices, setDevices] = useState<CaptureDevice[]>([]);
  const [status, setStatus] = useState<RecordingStatus>({ recording: false });
  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Currently playing
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Editing title
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Transcribing
  const [transcribingIds, setTranscribingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await recordingsApi.list();
      setRecordings(data.recordings);
      setDevices(data.devices);
      setStatus(data.status);
      setHasGroqKey(data.groqKey);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll status while recording
  useEffect(() => {
    if (status.recording) {
      setElapsed(status.elapsed || 0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
      return () => clearInterval(timerRef.current);
    } else {
      clearInterval(timerRef.current);
    }
  }, [status.recording, status.elapsed]);

  const startRecording = async () => {
    try {
      const device = devices.length > 0 ? devices[0].plughw : '';
      const r = await recordingsApi.start(device);
      if (r.success) {
        setStatus({ recording: true, id: r.id, elapsed: 0 });
        setElapsed(0);
        showToast('Recording started');
      } else {
        showToast(r.error || 'Failed to start recording');
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    try {
      const r = await recordingsApi.stop();
      setStatus({ recording: false });
      clearInterval(timerRef.current);
      if (r.success) {
        showToast(`Saved (${formatDuration(r.duration)})`);
        load();
      } else {
        showToast(r.error || 'Failed to stop recording');
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to stop recording');
    }
  };

  const playAudio = (rec: Recording) => {
    if (playingId === rec.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(recordingsApi.audioUrl(rec.id));
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => { setPlayingId(null); showToast('Failed to play audio'); };
    audio.play();
    audioRef.current = audio;
    setPlayingId(rec.id);
  };

  const transcribeRecording = async (id: string) => {
    setTranscribingIds(prev => new Set([...prev, id]));
    try {
      const r = await recordingsApi.transcribe(id);
      if (r.success) {
        showToast('Transcription complete');
        load();
      } else {
        showToast(r.error || 'Transcription failed');
      }
    } catch (e: any) {
      showToast(e.message || 'Transcription failed');
    } finally {
      setTranscribingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const saveTitle = async (id: string) => {
    if (!editTitle.trim()) return;
    try {
      await recordingsApi.rename(id, editTitle.trim());
      setEditingId(null);
      load();
    } catch (e: any) {
      showToast(e.message || 'Failed to rename');
    }
  };

  const deleteRecording = async (id: string) => {
    try {
      await recordingsApi.delete(id);
      showToast('Recording deleted');
      if (playingId === id) { audioRef.current?.pause(); setPlayingId(null); }
      load();
    } catch (e: any) {
      showToast(e.message || 'Failed to delete');
    }
  };

  const copyTranscript = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Mic size={22} className="text-red-500" /> Recordings
        </h1>
        {devices.length > 0 && (
          <span className="text-xs text-gray-400 truncate max-w-[200px]" title={devices[0].cardName}>
            {devices[0].cardName}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* No devices */}
      {!error && devices.length === 0 && (
        <div className="text-center py-8 text-gray-400 space-y-2">
          <MicOff size={40} className="mx-auto opacity-50" />
          <p>No microphone found.</p>
          <p className="text-xs">Plug in a USB microphone and refresh.</p>
        </div>
      )}

      {/* Record button */}
      {devices.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          {status.recording ? (
            <>
              <button
                onClick={stopRecording}
                className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors active:scale-95"
              >
                <Square size={28} fill="white" />
              </button>
              <div className="flex items-center gap-2 text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-lg font-mono tabular-nums">{formatDuration(elapsed)}</span>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={startRecording}
                className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors active:scale-95"
              >
                <Mic size={28} />
              </button>
              <span className="text-sm text-gray-400">Tap to record</span>
            </>
          )}
        </div>
      )}

      {/* Recordings list */}
      {recordings.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Recordings ({recordings.length})
          </h2>
          <div className="space-y-2">
            {recordings.map(rec => (
              <div
                key={rec.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2"
              >
                {/* Title + metadata row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {editingId === rec.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveTitle(rec.id); if (e.key === 'Escape') setEditingId(null); }}
                          onBlur={() => saveTitle(rec.id)}
                          className="flex-1 text-sm bg-transparent border-b border-blue-400 outline-none py-0.5"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingId(rec.id); setEditTitle(rec.title); }}
                        className="text-sm font-medium truncate block text-left hover:text-blue-500 transition-colors"
                        title="Click to rename"
                      >
                        {rec.title}
                      </button>
                    )}
                    <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                      <span>{formatDuration(rec.duration_s)}</span>
                      <span>·</span>
                      <span>{formatFileSize(rec.file_size)}</span>
                      <span>·</span>
                      <span>{timeAgo(rec.created_at)}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Play/Pause */}
                    <button
                      onClick={() => playAudio(rec)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        playingId === rec.id
                          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500'
                      }`}
                      title={playingId === rec.id ? 'Pause' : 'Play'}
                    >
                      {playingId === rec.id ? <Pause size={16} /> : <Play size={16} />}
                    </button>

                    {/* Transcribe */}
                    {hasGroqKey && (
                      <button
                        onClick={() => transcribeRecording(rec.id)}
                        disabled={transcribingIds.has(rec.id) || !!rec.transcribing}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 disabled:opacity-40 transition-colors"
                        title={rec.transcript ? 'Re-transcribe' : 'Transcribe with Groq Whisper'}
                      >
                        {transcribingIds.has(rec.id) || rec.transcribing
                          ? <Loader2 size={16} className="animate-spin" />
                          : <Type size={16} />}
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={() => deleteRecording(rec.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Transcript */}
                {rec.transcript && (
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 relative group">
                    <p className="whitespace-pre-wrap">{rec.transcript}</p>
                    <button
                      onClick={() => copyTranscript(rec.transcript)}
                      className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 transition-opacity"
                      title="Copy transcript"
                    >
                      <Copy size={14} className="text-gray-400" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {recordings.length === 0 && !error && devices.length > 0 && !status.recording && (
        <div className="text-center py-8 text-gray-400">
          <p>No recordings yet. Tap the button above to start.</p>
        </div>
      )}
    </div>
  );
}
