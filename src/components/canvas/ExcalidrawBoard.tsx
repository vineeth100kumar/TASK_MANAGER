// The drawing surface for one board. Loaded on demand by CanvasView, since
// Excalidraw is a large bundle that most visits to the app never need.
import { useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, MainMenu, exportToBlob, getSceneVersion } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { api } from '../../services/api';
import { Board } from '../../services/types';
import { useDataChanges } from '../../hooks/useDataChanges';
import { ThinkPanel } from './ThinkPanel';
import { boardOutline } from './boardOutline';
import { EditOp, RefMap, applyOps, boardGraph, describeOps, newIds } from './boardEdits';
import { TEMPLATES } from './boardTemplates';
import { useToast } from '../../context/ToastContext';
import { Inbox } from 'lucide-react';

// Fonts are copied into the build by vite.config.ts; Excalidraw falls back to
// its CDN for anything missing.
(window as any).EXCALIDRAW_ASSET_PATH = `${import.meta.env.BASE_URL}excalidraw-assets/`;

interface ExcalidrawBoardProps {
  board: Board;
  isDarkMode: boolean;
  thinkOpen: boolean;
  onCloseThink: () => void;
  onSaveState?: (state: 'saving' | 'saved' | 'error') => void;
}

const SHAPE_TYPES = new Set(['rectangle', 'diamond', 'ellipse']);

// Shapes in the selection that have a label and aren't tasks yet.
function taskCandidates(elements: readonly any[], selectedIds: Record<string, boolean>) {
  const live = elements.filter(el => !el.isDeleted);
  const labelOf = new Map(live.filter(el => el.type === 'text' && el.containerId).map(el => [el.containerId, String(el.text).replace(/\s+/g, ' ').trim()]));
  const picked = new Set<string>();
  for (const id of Object.keys(selectedIds || {})) {
    const el = live.find(e => e.id === id);
    if (!el) continue;
    picked.add(el.type === 'text' && el.containerId ? el.containerId : el.id);
  }
  const shapes = live.filter(el => picked.has(el.id) && SHAPE_TYPES.has(el.type) && labelOf.get(el.id));
  // In a bigger selection only boxes count: ovals are usually Start/End and
  // diamonds are questions, not things to do. One shape on its own always counts.
  return shapes.filter(el => (shapes.length === 1 || el.type === 'rectangle') && !el.customData?.sageTaskId)
    .map(el => ({ id: el.id, title: labelOf.get(el.id)! }));
}

const parseScene = (json: string): any[] => {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// A pull from another device can land while strokes made here are still
// waiting to save; drawing it then would erase them.
const QUIET_MS = 3000;

export default function ExcalidrawBoard({ board, isDarkMode, thinkOpen, onCloseThink, onSaveState }: ExcalidrawBoardProps) {
  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSceneJson = useRef(api.boards.getScene(board));
  const lastVersion = useRef<number | null>(null);
  const lastLocalEdit = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJson = useRef<string | null>(null);
  // Excalidraw reads this once, on mount. Clean lines and a plain font by default,
  // to sit with the rest of the app; the hand-drawn style is one click away.
  const [initialData] = useState(() => ({
    elements: parseScene(lastSceneJson.current),
    appState: { currentItemFontFamily: FONT_FAMILY.Nunito, currentItemRoughness: 0 },
    scrollToContent: true,
  }));
  const [isEmpty, setIsEmpty] = useState(() => initialData.elements.length === 0);
  // The template picker and the Inbox button step aside while you draw (so a
  // stroke that starts over them draws) and while one of Excalidraw's own
  // panels is open, such as the library, a menu or a dialog, so they never
  // sit on top of it.
  const [busyCanvas, setBusyCanvas] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ id: string; title: string }>>([]);
  const { showToast } = useToast();

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pendingJson.current === null) return;
    const json = pendingJson.current;
    pendingJson.current = null;
    api.boards.saveScene(board.id, json)
      .then(() => { if (pendingJson.current === null) onSaveState?.('saved'); })
      .catch(err => { console.warn('[Canvas] Save failed:', err); onSaveState?.('error'); });
  };

  // Save what's on screen when leaving the board (CanvasView remounts this per board).
  useEffect(() => flush, []);

  const handleChange = (elements: readonly any[], appState: any) => {
    const tool = appState?.activeTool?.type;
    const drawing = Boolean(tool && tool !== 'selection' && tool !== 'hand');
    setBusyCanvas(drawing || Boolean(appState?.openSidebar || appState?.openMenu || appState?.openDialog || appState?.openPopup));
    // What the "Add to Inbox" button offers follows the selection.
    const next = taskCandidates(elements, appState?.selectedElementIds);
    setCandidates(prev => (prev.map(c => c.id).join() === next.map(c => c.id).join() ? prev : next));
    // onChange also fires for selection, scrolling and zoom; only the elements matter.
    const version = getSceneVersion(elements);
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    const json = JSON.stringify(elements.filter(el => !el.isDeleted));
    if (json === lastSceneJson.current) return;
    lastSceneJson.current = json;
    lastLocalEdit.current = Date.now();
    pendingJson.current = json;
    setIsEmpty(json === '[]');
    onSaveState?.('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  };

  // Turns the selected boxes into Inbox tasks, and marks them so they aren't
  // added twice.
  const addToInbox = async () => {
    const canvas = excalidrawRef.current;
    if (!canvas || !candidates.length) return;
    const made = new Map<string, string>();
    for (const c of candidates) {
      const item = await api.workItems.create({ title: c.title, description: `From the "${board.title}" board`, lifeContext: board.lifeContext, isInbox: true });
      made.set(c.id, item.id);
    }
    canvas.updateScene({
      elements: canvas.getSceneElementsIncludingDeleted().map(el => made.has(el.id)
        ? { ...el, customData: { ...(el.customData || {}), sageTaskId: made.get(el.id) }, version: el.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) }
        : el),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setCandidates([]);
    showToast(made.size === 1 ? 'Added to your Inbox' : `${made.size} tasks added to your Inbox`);
  };

  const startFromTemplate = (ops: EditOp[]) => {
    const canvas = excalidrawRef.current;
    if (!canvas) return;
    const after = applyOps(canvas.getSceneElementsIncludingDeleted(), ops, {});
    canvas.updateScene({ elements: after, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    canvas.scrollToContent(after.filter(el => !el.isDeleted), { fitToViewport: true, viewportZoomFactor: 0.8, animate: true } as any);
  };

  // Opening a board shows all of it: a board bigger than the screen is zoomed
  // out to fit, a small one stays at normal size.
  const fitted = useRef(false);
  const fitOnOpen = (canvas: ExcalidrawImperativeAPI) => {
    if (fitted.current) return;
    fitted.current = true;
    setTimeout(() => {
      const live = canvas.getSceneElements();
      if (!live.length) return;
      const { width, height } = canvas.getAppState();
      const xs = live.flatMap(el => [el.x, el.x + el.width]), ys = live.flatMap(el => [el.y, el.y + el.height]);
      const tooBig = Math.max(...xs) - Math.min(...xs) > width * 0.9 || Math.max(...ys) - Math.min(...ys) > height * 0.85;
      // 0.8 leaves room for the toolbar floating over the top of the board.
      if (tooBig) canvas.scrollToContent(live, { fitToViewport: true, viewportZoomFactor: 0.8 } as any);
    }, 50);
  };

  // Show edits made on another device.
  useDataChanges(() => {
    const canvas = excalidrawRef.current;
    if (!canvas || pendingJson.current !== null || Date.now() - lastLocalEdit.current < QUIET_MS) return;
    const latest = api.sync.getState().boards.find(b => b.id === board.id);
    if (!latest) return;
    const json = api.boards.getScene(latest);
    if (json === lastSceneJson.current) return;
    lastSceneJson.current = json;
    canvas.updateScene({ elements: parseScene(json) });
  });

  // What the thinking partner reads: an outline of the board plus a picture of
  // it. To change the board it gets numbered shapes instead, and the refs that
  // map those numbers back to elements.
  const getSnapshot = async (forEdit = false) => {
    const canvas = excalidrawRef.current;
    const elements = canvas ? canvas.getSceneElements() : parseScene(lastSceneJson.current);
    const selected = canvas ? Object.keys(canvas.getAppState().selectedElementIds || {}) : [];
    const { text, refs } = forEdit ? boardGraph(elements, selected) : { text: boardOutline(elements), refs: undefined };
    if (!elements.length) return { outline: text, imagePng: null, refs };
    let imagePng: string | null = null;
    try {
      const blob = await exportToBlob({
        elements,
        appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
        files: canvas?.getFiles() || null,
        mimeType: 'image/png',
        maxWidthOrHeight: 1568,
      });
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      imagePng = dataUrl.split(',')[1] || null;
    } catch (err) {
      console.warn('[Canvas] Snapshot failed; sending the outline only:', err);
    }
    return { outline: text, imagePng, refs };
  };

  const describeEdits = (ops: EditOp[], refs: RefMap) =>
    describeOps(ops, excalidrawRef.current?.getSceneElements() || [], refs);

  // Puts the AI's changes on the board as one step (Ctrl+Z takes it back) and
  // returns a function that restores the board as it was.
  const applyEdits = (ops: EditOp[], refs: RefMap) => {
    const canvas = excalidrawRef.current;
    if (!canvas) return null;
    const before = canvas.getSceneElementsIncludingDeleted();
    const after = applyOps(before, ops, refs);
    const added = newIds(before, after);
    canvas.updateScene({
      elements: after,
      appState: { selectedElementIds: Object.fromEntries(added.map(id => [id, true])) } as any,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const shown = after.filter(el => added.includes(el.id));
    if (shown.length) canvas.scrollToContent(shown, { animate: true });
    return () => canvas.updateScene({ elements: before, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };

  return (
    <div className="relative h-full flex">
      <div className="relative flex-1 min-w-0 h-full">
        <Excalidraw
          excalidrawAPI={(a) => { excalidrawRef.current = a; fitOnOpen(a); }}
          initialData={initialData}
          onChange={handleChange}
          theme={isDarkMode ? 'dark' : 'light'}
          // Images would be stored inline and overflow the sync payload, so they're off for now.
          UIOptions={{
            tools: { image: false },
            canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } },
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
        {isEmpty && !busyCanvas && (
          // Clicks pass through to the canvas except on the buttons. On a
          // phone the Think with me sheet covers the canvas, so it hides then.
          <div className={`pointer-events-none absolute inset-0 z-[5] items-center justify-center p-6 pr-16 md:pr-6 ${thinkOpen ? 'hidden md:flex' : 'flex'}`}>
            <div className="pointer-events-auto max-w-md text-center space-y-3">
              <p className="text-[13px] font-semibold text-gray-500 dark:text-gray-400">Start from a template, or just start drawing</p>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.name} onClick={() => startFromTemplate(t.ops)} className="text-left px-3 py-2.5 rounded-xl bg-white dark:bg-[#1c1c1e] ring-1 ring-gray-200 dark:ring-white/10 hover:ring-violet-400 hover:bg-violet-50/60 dark:hover:bg-violet-500/10 transition-colors">
                    <span className="block text-[13px] font-semibold text-gray-900 dark:text-gray-100">{t.name}</span>
                    <span className="block text-[11.5px] text-gray-500">{t.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-gray-400">Or open Think with me and describe your plan. It'll draw it for you.</p>
            </div>
          </div>
        )}
        {candidates.length > 0 && !busyCanvas && (
          <button
            onClick={addToInbox}
            className="absolute left-1/2 -translate-x-1/2 bottom-20 z-[5] flex items-center gap-1.5 h-9 px-4 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-[13px] font-semibold shadow-lg hover:scale-[1.02] transition-transform"
          >
            <Inbox size={14} /> {candidates.length === 1 ? 'Add to Inbox as a task' : `Add ${candidates.length} tasks to Inbox`}
          </button>
        )}
      </div>
      {thinkOpen && (
        // A side column on wider screens, a sheet over the bottom of the canvas on phones.
        <div className="absolute inset-x-0 bottom-0 h-[60%] z-10 border-t md:static md:h-full md:w-[22rem] md:border-t-0 md:border-l border-gray-200/70 dark:border-white/[0.08] shadow-2xl md:shadow-none rounded-t-3xl md:rounded-none overflow-hidden">
          <ThinkPanel boardId={board.id} boardTitle={board.title} getSnapshot={getSnapshot} describeEdits={describeEdits} applyEdits={applyEdits} onClose={onCloseThink} />
        </div>
      )}
    </div>
  );
}
