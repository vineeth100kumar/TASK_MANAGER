// The depth face: pick a photo, the Pi cuts out the person, and the time sits
// behind them as on an iPhone lock screen. The Pi draws it and sends it to
// LUMO when the face is on (firmware 2.9); the preview here is the same picture.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Layers, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { DepthFace, DepthPhotoPosition, DepthPlacement, LumoSettings, LumoSettingsUpdate, depthApi, shrinkPhoto } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, Row, Segmented, Toggle, btnPrimary, btnQuiet } from './parts';

type View = 'depth' | 'flat' | 'mask';

export function DepthFacePanel({ settings, save, supported }: { settings: LumoSettings; save: (u: LumoSettingsUpdate) => void; supported: boolean }) {
  const { showToast } = useToast();
  const [face, setFace] = useState<DepthFace | null>(null);
  const [busy, setBusy] = useState<'' | 'upload' | 'change' | 'remove' | 'retry'>('');
  const [view, setView] = useState<View>('depth');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    depthApi.get().then(setFace).catch(() => setFace(null));
  }, []);

  const run = async (kind: typeof busy, job: () => Promise<DepthFace>, failed: string) => {
    setBusy(kind);
    try {
      setFace(await job());
    } catch (e: any) {
      showToast(`${failed}: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    let image: string;
    try {
      image = await shrinkPhoto(file);
    } catch {
      showToast("That file isn't a photo this browser can open", 'error');
      return;
    }
    await run('upload', () => depthApi.upload(image), "Couldn't use that photo");
    setView('depth');
  };

  if (!face) return null;
  const p = face.preview;
  const covered = p ? Math.round(p.coverage * 100) : 0;
  const hard = p ? p.coverage > face.coverageWarn : false;
  const onLumo = settings.clock.style === 'depth';
  const note = onLumo ? (supported ? 'On LUMO now' : 'Needs firmware 2.9') : 'Preview';

  return (
    <Panel icon={<Layers size={16} className="text-pink-500" />} title="Depth photo" note={note}
      right={face.hasPhoto && (
        <button className={btnQuiet} disabled={!!busy} onClick={() => run('remove', depthApi.remove, "Couldn't remove the photo")}>
          <Trash2 size={14} /> Remove
        </button>
      )}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-4 md:gap-6 items-start">
        <div className="space-y-2">
          <div className="relative rounded-2xl overflow-hidden bg-black ring-1 ring-black/10 dark:ring-white/10 aspect-[320/216]">
            {p ? (
              <img src={view === 'mask' && p.mask ? p.mask : view === 'flat' ? p.flat : p.depth}
                alt="How the depth face would look on LUMO" className="w-full h-full object-cover [image-rendering:pixelated]" />
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={!!busy}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-white transition-colors">
                <ImagePlus size={28} />
                <span className="text-[13px] font-semibold">Pick a photo of someone</span>
              </button>
            )}
            {(busy === 'upload' || busy === 'retry') && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white text-center px-6">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-[13px] font-semibold">Finding the person…</span>
                <span className="text-[11.5px] text-white/70">This takes a few seconds on the Pi. The very first photo also downloads the cutout model, so give it a minute.</span>
              </div>
            )}
          </div>
          {p && (
            <Segmented<View> size="sm" value={view} onChange={setView} options={[
              { id: 'depth', label: 'Depth' },
              { id: 'flat', label: 'Without depth' },
              ...(p.mask ? [{ id: 'mask' as View, label: 'Cutout' }] : []),
            ]} />
          )}
        </div>

        <div className="space-y-3">
          {p && face.cutout && (
            <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] ${hard ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'}`}>
              {hard && <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
              <span>
                {hard
                  ? `The person hides ${covered}% of the time, so it's hard to read. Try moving the time or the photo.`
                  : `The person covers ${covered}% of the time, so it still reads well.`}
              </span>
            </div>
          )}
          {face.hasPhoto && !face.cutout && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] bg-amber-500/10 text-amber-800 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-1.5 min-w-0">
                <p>
                  {!face.cutoutAvailable
                    ? "The Pi's cutout tool won't load, so the time sits on top. Run sudo deploy/install_pi.sh on the Pi, then try the cutout again."
                    : face.cutoutError === 'no person found in this photo'
                      ? "The Pi couldn't find a person in this photo, so the time sits on top. Try a photo where one person stands out from the background."
                      : "The cutout didn't work on the Pi, so the time sits on top."}
                </p>
                {(face.cutoutError || face.cutoutProblem) && (
                  <p className="font-mono text-[11px] break-words opacity-80">{face.cutoutProblem || face.cutoutError}</p>
                )}
                <button className={btnQuiet} disabled={!!busy} onClick={() => run('retry', depthApi.retryCutout, "Couldn't redo the cutout")}>
                  <RotateCcw size={14} /> Try the cutout again
                </button>
              </div>
            </div>
          )}

          <Row title="Show on LUMO" hint={onLumo
            ? (face.hasPhoto ? 'This is the clock face now' : 'Pick a photo; LUMO shows Monolith until then')
            : 'Use this as the clock face'}>
            <Toggle on={onLumo} label="Show the depth photo on LUMO"
              onChange={on => save({ clock: { style: on ? 'depth' : 'monolith' } })} />
          </Row>
          {onLumo && !supported && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] bg-amber-500/10 text-amber-800 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>LUMO needs firmware 2.9 for this face. Until you flash it, LUMO keeps its last face.</span>
            </div>
          )}

          {face.hasPhoto && (
            <>
              <Row title="Ring light" hint={face.ringColor
                ? 'Match the photo\'s main colour'
                : 'This photo has no strong colour, so the ring stays warm white'}>
                <div className="flex items-center gap-2">
                  {face.ringColor && <span className="w-5 h-5 rounded-full ring-1 ring-black/10 dark:ring-white/20" style={{ background: face.ringColor }} />}
                  <Toggle on={settings.lights.mode === 'PHOTO'} label="Ring light matches the photo"
                    onChange={on => save({ lights: { mode: on ? 'PHOTO' : 'AUTO' } })} />
                </div>
              </Row>
              <Row title="Time" hint={face.placement === 'auto' && p ? `Auto put it at the ${p.placement}` : 'Where the time sits'}>
                <Segmented<DepthPlacement> size="sm" value={face.placement}
                  onChange={v => run('change', () => depthApi.update({ placement: v }), "Couldn't move the time")}
                  options={[{ id: 'auto', label: 'Auto' }, { id: 'top', label: 'Top' }, { id: 'middle', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]} />
              </Row>
              <Row title="Photo" hint={face.photoPosition === 'auto' ? 'Auto frames the person, head near the top' : 'Which part of a tall photo shows'}>
                <Segmented<DepthPhotoPosition> size="sm" value={face.photoPosition}
                  onChange={v => run('change', () => depthApi.update({ photoPosition: v }), "Couldn't move the photo")}
                  options={[{ id: 'auto', label: 'Auto' }, { id: 'top', label: 'Top' }, { id: 'center', label: 'Middle' }, { id: 'bottom', label: 'Bottom' }]} />
              </Row>
            </>
          )}

          <button className={face.hasPhoto ? btnQuiet : btnPrimary} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={15} /> {face.hasPhoto ? 'Try another photo' : 'Pick a photo'}
          </button>
          <p className="text-[12px] text-gray-400">
            Works best with one person who stands out from the background, head near the top. The preview uses LUMO's real screen size and colours, and the time on LUMO moves on every minute.
          </p>
        </div>
      </div>
    </Panel>
  );
}
