import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Search, FileText, ChevronLeft, Network, Sparkles, FileCode } from 'lucide-react';
import { api } from '../../services/api';
import { Note, Thought } from '../../services/types';
import { formatDisplayDate } from '../../utils/dateUtils';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { RichNoteEditor } from '../notes/RichNoteEditor';
import { ThoughtMapView, StatusBar } from '../notes/ThoughtMapView';
import { countStatuses } from '../notes/thoughtMap';
import { ReportNoteView } from '../notes/ReportNoteView';

type Kind = 'all' | 'notes' | 'maps';
const KIND_KEY = 'sage.notesKind';
const isMap = (n: Note) => n.kind === 'map';
const isRaw = (n?: Note) => n?.kind === 'html' || n?.kind === 'code';
// A whole HTML page pasted or saved as a plain note (before reports existed, or by an AI using plain create).
const pageIn = (n?: Note) => (!n || n.kind ? null : /^\s*(<!doctype html|<html[\s>])/i.test(n.content || '') ? n.content : null);

interface NotesViewProps {
  lifeContext?: 'work' | 'personal';
  openNoteId?: string | null;  // open this note first (from Radar's Vault)
}

export function NotesView({ lifeContext, openNoteId }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(openNoteId || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [kind, setKindState] = useState<Kind>(() => {
    try { return (localStorage.getItem(KIND_KEY) as Kind) || 'all'; } catch { return 'all'; }
  });
  const setKind = (k: Kind) => { setKindState(k); try { localStorage.setItem(KIND_KEY, k); } catch { /* private window */ } };
  const [newMenu, setNewMenu] = useState(false);
  const [activeTitle, setActiveTitle] = useState('');
  const [activeContent, setActiveContent] = useState('');
  // On a phone the list and the open note take turns on screen.
  const [isEditorOpen, setIsEditorOpen] = useState(!!openNoteId);
  const { showToast } = useToast();
  // When this editor last changed the open note, so a sync arriving mid-typing
  // doesn't replace what is being typed.
  const lastTypedAt = useRef(0);
  const titleInput = useRef<HTMLInputElement>(null);

  const loadNotes = async () => {
    // Notes from before work/personal existed have no context and show under both.
    const list = (await api.notes.list()).filter(n => !lifeContext || !n.lifeContext || n.lifeContext === lifeContext);
    setNotes(list);
    setThoughts(await api.thoughts.list());
    const open = list.find(n => n.id === selectedNoteId);
    if (!open && list.length > 0) {
      setSelectedNoteId(list[0].id);
      setActiveTitle(list[0].title);
      setActiveContent(api.notes.getBody(list[0]));
    } else if (!open) {
      setSelectedNoteId(null);
      setActiveTitle('');
      setActiveContent('');
    } else if (Date.now() - lastTypedAt.current > 2000) {
      // Show edits made to this note on another device.
      setActiveTitle(open.title);
      setActiveContent(api.notes.getBody(open));
    }
  };

  useEffect(() => {
    loadNotes();
  }, [lifeContext]);
  useDataChanges(loadNotes);

  const selectedNote = notes.find(n => n.id === selectedNoteId);

  useEffect(() => {
    if (selectedNote) {
      setActiveTitle(selectedNote.title);
      setActiveContent(api.notes.getBody(selectedNote));
    }
  }, [selectedNoteId]);

  const handleCreateNote = async (as: boolean | 'html' | 'code' = false) => {
    setNewMenu(false);
    const asMap = as === true;
    const newNote = await api.notes.create({
      title: asMap ? 'What am I deciding?' : as === 'html' ? 'New report' : as === 'code' ? 'New snippet' : 'New Note',
      content: '',
      lifeContext,
      ...(asMap ? { kind: 'map' as const } : as ? { kind: as } : {})
    });
    setNotes(prev => [newNote, ...prev]);
    setSelectedNoteId(newNote.id);
    setActiveTitle(newNote.title);
    setActiveContent('');
    setIsEditorOpen(true);
    showToast(asMap ? 'New thought map' : 'New note created');
    // A map's title is the question it's about, so ask for it straight away.
    if (asMap) setTimeout(() => { titleInput.current?.focus(); titleInput.current?.select(); }, 50);
  };

  const handleTitleChange = (val: string) => {
    setActiveTitle(val);
    lastTypedAt.current = Date.now();
    if (selectedNoteId) {
      setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title: val } : n));
      api.notes.update(selectedNoteId, { title: val });
    }
  };

  const handleContentChange = (html: string, text: string) => {
    setActiveContent(html);
    lastTypedAt.current = Date.now();
    if (selectedNoteId) {
      setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, content: text } : n));
      api.notes.saveBody(selectedNoteId, html, text);
    }
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = notes.find(n => n.id === id);
    if (confirm(target && isMap(target) ? 'Delete this thought map and its thoughts?' : 'Delete this note?')) {
      await api.notes.delete(id);
      const remaining = notes.filter(n => n.id !== id);
      setNotes(remaining);
      if (selectedNoteId === id) {
        if (remaining.length > 0) {
          setSelectedNoteId(remaining[0].id);
          setActiveTitle(remaining[0].title);
          setActiveContent(api.notes.getBody(remaining[0]));
        } else {
          setSelectedNoteId(null);
          setActiveTitle('');
          setActiveContent('');
        }
      }
      showToast('Note deleted');
    }
  };

  // Old notes that hold a whole HTML page open as a report: the page text becomes the report's source.
  useEffect(() => {
    const page = pageIn(selectedNote);
    if (!selectedNote || !page) return;
    const text = (new DOMParser().parseFromString(page, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
    api.notes.update(selectedNote.id, { kind: 'html' }).then(() => api.notes.saveBody(selectedNote.id, page, text)).then(loadNotes);
  }, [selectedNote?.id, selectedNote?.kind]);

  const thoughtsOf = (id: string) => thoughts.filter(t => t.mapId === id);
  const q = searchQuery.toLowerCase();
  const filteredNotes = notes.filter(n =>
    (kind === 'all' || (kind === 'maps') === isMap(n)) && (
      n.title.toLowerCase().includes(q) ||
      (n.content && n.content.toLowerCase().includes(q)) ||
      (isMap(n) && q && thoughtsOf(n.id).some(t => t.text.toLowerCase().includes(q))))
  );

  return (
    <div className="h-[calc(100vh-8.5rem)] flex bg-white dark:bg-[#1c1c1e] rounded-3xl border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
      {/* Notes Sidebar */}
      <div className={`w-full md:w-80 border-r border-gray-100 dark:border-white/5 flex-col bg-[#f5f5f7]/60 dark:bg-black/20 shrink-0 ${isEditorOpen ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Header & Search */}
        <div className="p-4 border-b border-gray-100 dark:border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
              <FileText size={20} className="text-blue-500" />
              Notes & Docs
            </h2>
            <div className="relative">
              <button onClick={() => setNewMenu(m => !m)} aria-expanded={newMenu} aria-haspopup="menu"
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-transform active:scale-95 shadow-sm" title="New note or thought map">
                <Plus size={16} />
              </button>
              {newMenu && <button className="fixed inset-0 z-20 cursor-default" aria-label="Close menu" tabIndex={-1} onClick={() => setNewMenu(false)} />}
              {newMenu && (
                <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-56 p-1 rounded-xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/10 shadow-xl">
                  <button role="menuitem" onClick={() => handleCreateNote(false)} className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-left">
                    <FileText size={16} className="text-blue-500 mt-0.5 shrink-0" />
                    <span><span className="block text-sm font-semibold dark:text-white">Note</span><span className="block text-xs text-gray-500">Write freely</span></span>
                  </button>
                  <button role="menuitem" onClick={() => handleCreateNote(true)} className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-left">
                    <Network size={16} className="text-violet-500 mt-0.5 shrink-0" />
                    <span><span className="block text-sm font-semibold dark:text-white">Thought map</span><span className="block text-xs text-gray-500">Sort every thought on a decision</span></span>
                  </button>
                  <button role="menuitem" onClick={() => handleCreateNote('html')} className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-left">
                    <Sparkles size={16} className="text-blue-500 mt-0.5 shrink-0" />
                    <span><span className="block text-sm font-semibold dark:text-white">HTML report</span><span className="block text-xs text-gray-500">Paste a page from any AI</span></span>
                  </button>
                  <button role="menuitem" onClick={() => handleCreateNote('code')} className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-left">
                    <FileCode size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                    <span><span className="block text-sm font-semibold dark:text-white">Code</span><span className="block text-xs text-gray-500">Keep a snippet, highlighted</span></span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex p-0.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.06]" role="tablist" aria-label="Show">
            {(['all', 'notes', 'maps'] as Kind[]).map(k => (
              <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                className={`flex-1 py-1.5 rounded-[10px] text-xs font-semibold ${kind === k ? 'bg-white dark:bg-[#2c2c2e] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}>
                {k === 'all' ? 'All' : k === 'notes' ? 'Notes' : 'Maps'}
              </button>
            ))}
          </div>

          <div className="flex items-center px-3 py-1.5 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input type="text" placeholder="Search notes..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-none focus:ring-0 text-xs ml-2 outline-none dark:text-white font-medium" />
          </div>
        </div>

        {/* Note List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredNotes.map(note => {
            const isSelected = note.id === selectedNoteId;
            return (
              <div key={note.id} onClick={() => { setSelectedNoteId(note.id); setIsEditorOpen(true); }}
                className={`p-3.5 rounded-2xl cursor-pointer transition-all flex flex-col gap-1 group relative ${isSelected ? 'bg-white dark:bg-[#2c2c2e] shadow-sm border border-black/5 dark:border-white/5' : 'hover:bg-white/60 dark:hover:bg-white/5'}`}>
                <div className="flex items-center justify-between">
                  <h4 className={`text-[14px] font-bold truncate pr-6 flex items-center gap-1.5 ${isSelected ? (isMap(note) ? 'text-violet-600 dark:text-violet-400' : 'text-blue-600 dark:text-blue-400') : 'text-gray-900 dark:text-white'}`}>
                    {isMap(note) && <Network size={14} className="shrink-0 text-violet-500" aria-label="Thought map" />}
                    {note.kind === 'html' && <Sparkles size={14} className="shrink-0 text-blue-500" aria-label="HTML report" />}
                    {note.kind === 'code' && <FileCode size={14} className="shrink-0 text-emerald-500" aria-label="Code" />}
                    <span className="truncate">{note.title || 'Untitled Note'}</span>
                  </h4>
                  <button onClick={(e) => handleDeleteNote(note.id, e)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity p-1" title="Delete note">
                    <Trash2 size={13} />
                  </button>
                </div>
                {isMap(note) ? (() => {
                  const mine = thoughtsOf(note.id);
                  const c = countStatuses(mine);
                  return <>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {mine.length === 0 ? 'No thoughts yet' : `${mine.length} thought${mine.length === 1 ? '' : 's'} · ${c.open + c.unsure} still open`}
                    </p>
                    <StatusBar thoughts={mine} className="mt-1" />
                  </>;
                })() : (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate line-clamp-1">
                  {note.content ? note.content.replace(/[\n\r]+/g, ' ') : 'Empty note...'}
                </p>)}
                <div className="text-[10px] font-semibold text-gray-400 mt-1">
                  {formatDisplayDate(note.updatedAt || note.createdAt)}
                </div>
              </div>
            );
          })}

          {filteredNotes.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-xs font-medium">
              {kind === 'maps' ? <>No thought maps yet. Click <kbd>+</kbd> and pick Thought map.</> : <>No notes found. Click <kbd>+</kbd> to create one.</>}
            </div>
          )}
        </div>
      </div>

      {/* Note Editor Pane */}
      <div className={`flex-1 flex-col bg-white dark:bg-[#1c1c1e] min-w-0 ${isEditorOpen ? 'flex' : 'hidden md:flex'}`}>
        {selectedNoteId ? (
          <>
            <div className={`${selectedNote && isMap(selectedNote) ? 'p-3 md:p-4' : 'p-4 md:p-8 pb-3 md:pb-4'} border-b border-gray-100 dark:border-white/5 flex items-center gap-2`}>
              <button onClick={() => setIsEditorOpen(false)} className="md:hidden -ml-1 p-1.5 rounded-lg text-gray-500 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Back to notes">
                <ChevronLeft size={20} />
              </button>
              <input ref={titleInput} type="text" value={activeTitle} onChange={e => handleTitleChange(e.target.value)} placeholder="Note Title"
                className="text-2xl md:text-3xl font-bold tracking-tight bg-transparent outline-none text-gray-900 dark:text-white w-full tracking-tight" />
            </div>

            {selectedNote && isMap(selectedNote)
              ? <ThoughtMapView map={selectedNote} />
              : selectedNote && isRaw(selectedNote)
              ? <ReportNoteView note={selectedNote} body={activeContent} onChange={handleContentChange} />
              : <RichNoteEditor noteId={selectedNoteId} html={activeContent} onChange={handleContentChange} />}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
            <FileText size={48} className="mb-4 opacity-30 text-blue-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">No Note Selected</h3>
            <p className="text-sm text-gray-500 mb-4">Choose a note from the left or create a fresh one.</p>
            <button onClick={() => handleCreateNote(false)} className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md">
              Create Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
