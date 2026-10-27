import { use, type ComponentProps, type ComponentType } from 'react';

// Pages and dialogs most visits never open load on their own, so the app
// starts with less to download and parse. They are fetched in the background
// once the first screen is up (prefetchViews), and when you point at their
// link (prefetchView), so opening one is still instant.
const loaders = {
  notes: () => import('./NotesView'),
  notesLock: () => import('../notes/NotesLock'),
  canvas: () => import('./CanvasView'),
  radar: () => import('./RadarView'),
  lumo: () => import('./LumoView'),
  drop: () => import('./DropView'),
  branches: () => import('../branches/ProjectBranchesView'),
  calendar: () => import('./CalendarView'),
  timeline: () => import('./TimelineView'),
  table: () => import('./TableView'),
  settings: () => import('../modals/SettingsModal'),
  diagnostics: () => import('../modals/SyncDiagnosticsModal'),
  trash: () => import('../modals/TrashModal'),
  shortcuts: () => import('../modals/ShortcutSheet'),
  morning: () => import('../modals/MorningPickThree'),
  evening: () => import('../modals/EveningShutdown'),
  weekly: () => import('../modals/WeeklyReview'),
};

// Like React.lazy, but once the code has arrived (say from a prefetch) the
// page renders straight away instead of showing the Suspense fallback first.
const preloads: Record<string, () => Promise<unknown>> = {};
function named<M extends { [P in K]: ComponentType<any> }, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  let Loaded: M[K] | null = null;
  let pending: Promise<void> | null = null;
  const start = () => (pending ??= load().then(m => { Loaded = m[name]; }, e => { pending = null; throw e; }));
  preloads[name] = start;
  function LazyView(props: ComponentProps<M[K]>) {
    if (!Loaded) use(start());
    const View = Loaded as unknown as ComponentType<any>;
    return <View {...props} />;
  }
  LazyView.displayName = `Lazy(${name})`;
  return LazyView;
}

export const NotesView = named(loaders.notes, 'NotesView');
export const NotesLock = named(loaders.notesLock, 'NotesLock');
export const CanvasView = named(loaders.canvas, 'CanvasView');
export const RadarView = named(loaders.radar, 'RadarView');
export const LumoView = named(loaders.lumo, 'LumoView');
export const DropView = named(loaders.drop, 'DropView');
export const ProjectBranchesView = named(loaders.branches, 'ProjectBranchesView');
export const CalendarView = named(loaders.calendar, 'CalendarView');
export const TimelineView = named(loaders.timeline, 'TimelineView');
export const TableView = named(loaders.table, 'TableView');
export const SettingsModal = named(loaders.settings, 'SettingsModal');
export const SyncDiagnosticsModal = named(loaders.diagnostics, 'SyncDiagnosticsModal');
export const TrashModal = named(loaders.trash, 'TrashModal');
export const ShortcutSheet = named(loaders.shortcuts, 'ShortcutSheet');
export const MorningPickThree = named(loaders.morning, 'MorningPickThree');
export const EveningShutdown = named(loaders.evening, 'EveningShutdown');
export const WeeklyReview = named(loaders.weekly, 'WeeklyReview');

// Sidebar ids to the pages they open. The drawing engine behind Canvas is
// several MB, so it is only fetched when you head for Canvas, never in the
// background.
const forSidebar: Record<string, () => Promise<unknown>> = {
  notes: () => Promise.all([preloads.NotesLock(), preloads.NotesView()]),
  canvas: () => Promise.all([preloads.CanvasView(), import('../canvas/ExcalidrawBoard')]),
  radar: () => preloads.RadarView(),
  lumo: () => preloads.LumoView(),
  drop: () => preloads.DropView(),
};

/** Starts loading a page's code (sidebar ids: notes, canvas, radar, lumo, drop). */
export function prefetchView(id: string) {
  forSidebar[id]?.().catch(() => {});
}

/** Fetches every lazy page and dialog once the browser has nothing else to do. */
export function prefetchViews() {
  const run = () => Object.values(preloads).forEach(load => load().catch(() => {}));
  const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => number) | undefined;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
