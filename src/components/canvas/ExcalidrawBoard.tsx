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

// Fonts are copied into the build by vite.config.ts; Excalidraw falls back to
// its CDN for anything missing.
(window as any).EXCALIDRAW_ASSET_PATH = `${import.meta.env.BASE_URL}excalidraw-assets/`;

interface ExcalidrawBoardProps {
  board: Board;
  isDarkMode: boolean;
  thinkOpen: boolean;
  onCloseThink: () => void;
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

export default function ExcalidrawBoard({ board, isDarkMode, thinkOpen, onCloseThink }: ExcalidrawBoardProps) {
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

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pendingJson.current === null) return;
    const json = pendingJson.current;
    pendingJson.current = null;
    api.boards.saveScene(board.id, json).catch(err => console.warn('[Canvas] Save failed:', err));
  };

  // Save what's on screen when leaving the board (CanvasView remounts this per board).
  useEffect(() => flush, []);

  const handleChange = (elements: readonly any[]) => {
    // onChange also fires for selection, scrolling and zoom; only the elements matter.
    const version = getSceneVersion(elements);
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    const json = JSON.stringify(elements.filter(el => !el.isDeleted));
    if (json === lastSceneJson.current) return;
    lastSceneJson.current = json;
    lastLocalEdit.current = Date.now();
    pendingJson.current = json;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
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
    const { text, refs } = forEdit ? boardGraph(elements) : { text: boardOutline(elements), refs: undefined };
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
      <div className="flex-1 min-w-0 h-full">
        <Excalidraw
          excalidrawAPI={(a) => { excalidrawRef.current = a; }}
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
      </div>
      {thinkOpen && (
        // A side column on wider screens, a sheet over the bottom of the canvas on phones.
        <div className="absolute inset-x-0 bottom-0 h-[60%] z-10 border-t md:static md:h-full md:w-[22rem] md:border-t-0 md:border-l border-gray-200/70 dark:border-white/[0.08] shadow-2xl md:shadow-none rounded-t-3xl md:rounded-none overflow-hidden">
          <ThinkPanel boardTitle={board.title} getSnapshot={getSnapshot} describeEdits={describeEdits} applyEdits={applyEdits} onClose={onCloseThink} />
        </div>
      )}
    </div>
  );
}
