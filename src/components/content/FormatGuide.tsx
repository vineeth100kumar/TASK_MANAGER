// FormatGuide - the script format guide for a post or a reel, shown inside the app
// (it used to be a file download). Read from the Pi; "Download" still gives the .md file.
import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { downloadPostFormat, fetchPostFormat } from '../../services/posts';
import { downloadReelFormat, fetchReelFormat } from '../../services/reels';

export function FormatGuide({ kind }: { kind: 'post' | 'reel' }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setText(null); setError('');
    (kind === 'post' ? fetchPostFormat() : fetchReelFormat())
      .then(t => { if (live) setText(t); })
      .catch(e => { if (live) setError(e.message || "Can't reach the Pi"); });
    return () => { live = false; };
  }, [kind]);

  const download = () => (kind === 'post' ? downloadPostFormat() : downloadReelFormat()).catch(() => setError("Couldn't download the guide."));

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[12.5px] text-gray-500">How a {kind} script is written. Give this to any AI, or follow it by hand.</p>
        <button type="button" onClick={download} className="flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-black/[0.05] dark:bg-white/10 shrink-0"><Download size={12} /> .md</button>
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {!error && text === null && <p className="flex items-center gap-1.5 text-[13px] text-gray-400"><LoaderCircle size={14} className="animate-spin" /> Loading the guide</p>}
      {text !== null && (
        <pre className="max-h-[48vh] overflow-auto rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] p-3.5 text-[12px] leading-relaxed whitespace-pre-wrap font-mono">{text}</pre>
      )}
    </div>
  );
}
