// The drawing surface for one board. Loaded on demand by CanvasView, since
// Excalidraw is a large bundle that most visits to the app never need.
import { useEffect, useRef, useState } from 'react';
import { Excalidraw, FONT_FAMILY, MainMenu, getSceneVersion } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { api } from '../../services/api';
import { Board } from '../../services/types';
import { useDataChanges } from '../../hooks/useDataChanges';

// Fonts are copied into the build by vite.config.ts; Excalidraw falls back to
// its CDN for anything missing.
(window as any).EXCALIDRAW_ASSET_PATH = `${import.meta.env.BASE_URL}excalidraw-assets/`;

interface ExcalidrawBoardProps {
  board: Board;
  isDarkMode: boolean;
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

export default function ExcalidrawBoard({ board, isDarkMode }: ExcalidrawBoardProps) {
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

  return (
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
  );
}
