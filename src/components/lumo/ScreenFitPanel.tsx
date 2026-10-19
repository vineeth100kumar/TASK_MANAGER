// The LUMO page's screen fit: which columns and rows of the panel the case
// hides, the Fit test pattern to line them up by, and the Even Frame (the
// clock faces on a square card inside a black frame, with an island on the
// right edge for the alarm, music and timers). Firmware 2.15 and later.
import { useState } from 'react';
import { Frame, ScanLine } from 'lucide-react';
import { LumoSettings, LumoSettingsUpdate, lumoApi } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, Row, Slider, Toggle, btnPrimary, btnQuiet } from './parts';

// Keep these in step with lumo/esp32_client/config.h.
const FRAME_SIDE = 18;
const FRAME_VERT = 20;
const STRIP = 18; // the bare glass past the panel's last column, as measured

const SIDES: { id: 'left' | 'right' | 'top' | 'bottom'; name: string }[] = [
  { id: 'left', name: 'Left' },
  { id: 'right', name: 'Right' },
  { id: 'top', name: 'Top' },
  { id: 'bottom', name: 'Bottom' },
];

export function ScreenFitPanel({ settings, save, supported, testing, connected }: {
  settings: LumoSettings; save: (u: LumoSettingsUpdate) => void; supported: boolean; testing: boolean; connected: boolean;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const f = settings.screen;

  const test = async (on: boolean) => {
    setBusy(true);
    try {
      await lumoApi.device(on ? 'fit_test' : 'fit_test_off');
      if (on) showToast('The Fit test is on LUMO for a few minutes', 'success');
    } catch (e: any) {
      showToast(`Couldn't ${on ? 'start' : 'stop'} the Fit test: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel icon={<Frame size={16} className="text-amber-500" />} title="Screen fit" note={supported ? 'Matches the clock to its case' : 'Needs firmware 2.15'}
      right={
        <button onClick={() => test(!testing)} disabled={busy || !connected || !supported} className={testing ? btnPrimary : btnQuiet}>
          <ScanLine size={15} /> {testing ? 'Stop the Fit test' : 'Show the Fit test'}
        </button>
      }>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr] gap-5 items-start">
        <FitPreview f={f} />
        <div className="space-y-3">
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
            Show the Fit test, then raise each number until the white line just touches the case on that side and none of it is hidden. Numbers are pixels the case covers.
          </p>
          {SIDES.map(s => (
            <div key={s.id} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <div className="text-[13px] font-medium text-gray-500">{s.name}</div>
              <Slider label={`${s.name} pixels hidden`} value={f[s.id]} min={0} max={40} format={v => `${v} px`}
                onCommit={v => save({ screen: { [s.id]: v } })} />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 pt-1">
        <Row title="Even Frame" hint="Faces on a square card in an even black frame">
          <Toggle on={f.frame} onChange={on => save({ screen: { frame: on } })} label="Even Frame" disabled={!supported} />
        </Row>
        <Row title="Island" hint={f.frame ? 'Alarm, music and timers dock on the right edge' : 'Needs the Even Frame'}>
          <Toggle on={f.island} onChange={on => save({ screen: { island: on } })} label="Island" disabled={!supported || !f.frame} />
        </Row>
      </div>
      <p className="text-[12px] text-gray-400">
        The frame is for the clock faces; menus and the other screens stay full-bleed. Stacked and Dial grow the island for music and timers; Monolith shows a dot, and Nightstand stays dark.
      </p>
    </Panel>
  );
}

// The panel to scale: what the case hides, the Even Frame's card, and the strip of bare glass.
function FitPreview({ f }: { f: LumoSettings['screen'] }) {
  const W = 320, H = 240;
  const x0 = f.left, x1 = W - f.right, y0 = f.top, y1 = H - f.bottom;
  const cx = x0 + FRAME_SIDE, cy = y0 + FRAME_VERT, cw = x1 - cx, ch = y1 - FRAME_VERT - cy;
  const mid = cy + ch / 2;
  return (
    <svg viewBox={`-6 -6 ${W + STRIP + 12} ${H + 12}`} role="img" aria-label="The panel, what the case hides, and the Even Frame's card" className="w-full rounded-xl bg-black/[0.04] dark:bg-white/5">
      <rect x={0} y={0} width={W} height={H} fill="#16181d" />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={f.frame ? '#050506' : '#1c1f26'} />
      {f.frame && <rect x={cx} y={cy} width={cw} height={ch} fill="#1c1e24" stroke="#ff9f43" strokeWidth={1.5} />}
      <rect x={W} y={0} width={STRIP} height={H} fill="#030304" />
      {f.frame && f.island && <rect x={x1 - 24} y={mid - 16} width={24 + 14} height={32} rx={16} fill="#000" />}
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="#fff" strokeWidth={1.5} />
      <text x={W + STRIP / 2} y={H / 2} fill="#7a7f8a" fontSize={9} textAnchor="middle" transform={`rotate(90 ${W + STRIP / 2} ${H / 2})`}>bare glass</text>
    </svg>
  );
}
