// LocationGuide - Settings > Shortcuts > "Where you are". Where Sage thinks you
// are now, your places, and how to set up the iPhone automations that tell it
// (raspberry_pi/location.py, services/location.ts).
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { loadWhere, removePlace, setPlaceKind, useWhere, type PlaceKind } from '../../services/location';

const KIND_LABEL: Record<PlaceKind, string> = { home: 'Home', work: 'Work', other: 'Other' };

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{children}</p>
);
const Ui = ({ children }: { children: React.ReactNode }) => <span className="font-semibold whitespace-nowrap">{children}</span>;

export function LocationGuide({ base, keyHint, sendsKey, children }: {
  base: string; keyHint: React.ReactNode; sendsKey: boolean; children?: React.ReactNode;
}) {
  const where = useWhere();
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadWhere(); }, []);

  const since = where?.here ? new Date(where.here.since * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const act = async (fn: () => Promise<boolean>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Sage thinks you are</div>
        <div className="text-base font-semibold text-gray-900 dark:text-white">
          {where ? where.label : 'Checking…'}
          {where?.here && <span className="text-xs font-normal text-gray-400"> since {since}</span>}
        </div>
      </div>

      {where && where.places.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Your places</div>
          <div className="flex flex-wrap gap-2">
            {where.places.map(p => (
              <span key={p.name} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-800 dark:text-gray-100">
                {p.name}
                <select
                  aria-label={`Kind of place for ${p.name}`}
                  value={p.kind}
                  disabled={busy}
                  onChange={e => act(() => setPlaceKind(p.name, e.target.value as PlaceKind))}
                  className="bg-transparent text-[11px] text-gray-500 outline-none"
                >
                  {(Object.keys(KIND_LABEL) as PlaceKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <button type="button" disabled={busy} aria-label={`Forget ${p.name}`} onClick={() => act(() => removePlace(p.name))} className="p-0.5 rounded-full text-gray-400 hover:text-red-500">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <Note>Places are added by themselves the first time you arrive. Tie a task to one with a label that starts with @, like <Ui>@Grocery</Ui>. Sage nudges you once a day when you get there.</Note>
        </div>
      )}

      <ol className="space-y-3 text-sm text-gray-900 dark:text-white">
        <li><Ui>1.</Ui> Open the <Ui>Shortcuts</Ui> app, tab <Ui>Automation</Ui>, <Ui>+</Ui>, then <Ui>Arrive</Ui>. Choose the place (for Home, your home address) and <Ui>Run Immediately</Ui>.</li>
        <li><Ui>2.</Ui> Add <Ui>Get Contents of URL</Ui> with this address, Method <Ui>POST</Ui>, Request Body <Ui>JSON</Ui>.
          <code className="block mt-1 px-3 py-2 rounded-xl bg-white dark:bg-black/30 border border-black/10 dark:border-white/10 text-xs font-mono break-all">{`${base}/api/presence/location`}</code></li>
        <li><Ui>3.</Ui> Add two Text fields: <Ui>place</Ui> = the name (Home), and <Ui>action</Ui> = <Ui>arrive</Ui>.</li>
        {sendsKey && <li><Ui>4.</Ui> Add a header <Ui>Authorization</Ui>. {keyHint}</li>}
        <li><Ui>{sendsKey ? '5' : '4'}.</Ui> Make a second automation with <Ui>Leave</Ui> for the same place. Same steps, but <Ui>action</Ui> = <Ui>leave</Ui>.</li>
        <li><Ui>{sendsKey ? '6' : '5'}.</Ui> Repeat for Work and any other place.</li>
      </ol>
      {children}
      <Note>
        Battery: iOS does this with geofencing (cell towers and Wi-Fi it already sees). Your phone isn't tracked all day, it only wakes when you cross the line.
        Location doesn't switch Work/Chill. Bluetooth still does that.
      </Note>
    </div>
  );
}
