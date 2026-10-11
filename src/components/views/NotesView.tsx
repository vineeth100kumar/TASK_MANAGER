import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Search, FileText, ChevronLeft } from 'lucide-react';
import { api } from '../../services/api';
import { Note } from '../../services/types';
import { formatDisplayDate } from '../../utils/dateUtils';
import { useToast } from '../../context/ToastContext';
import { useDataChanges } from '../../hooks/useDataChanges';
import { RichNoteEditor } from '../notes/RichNoteEditor';

interface NotesViewProps {
  lifeContext?: 'work' | 'personal';
}

export function NotesView({ lifeContext }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTitle, setActiveTitle] = useState('');
  const [activeContent, setActiveContent] = useState('');
  // On a phone the list and the open note take turns on screen.
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const { showToast } = useToast();
  // When this editor last changed the open note, so a sync arriving mid-typing
  // doesn't replace what is being typed.
  const lastTypedAt = useRef(0);

  const loadNotes = async () => {
    // Notes from before work/personal existed have no context and show under both.
    const list = (await api.notes.list()).filter(n => !lifeContext || !n.lifeContext || n.lifeContext === lifeContext);
    setNotes(list);
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

  const handleCreateNote = async () => {
    const newNote = await api.notes.create({
      title: 'New Note',
      content: '',
      lifeContext
    });
    setNotes(prev => [newNote, ...prev]);
    setSelectedNoteId(newNote.id);
    setActiveTitle(newNote.title);
    setActiveContent('');
    setIsEditorOpen(true);
    showToast('New note created');
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
    if (confirm('Delete this note?')) {
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

  const filteredNotes = notes.filter(n => 
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (n.content && n.content.toLowerCase().includes(searchQuery.toLowerCase()))
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
            <button onClick={handleCreateNote} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-transform active:scale-95 shadow-sm" title="New Note">
              <Plus size={16} />
            </button>
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
                  <h4 className={`text-[14px] font-bold truncate pr-6 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                    {note.title || 'Untitled Note'}
                  </h4>
                  <button onClick={(e) => handleDeleteNote(note.id, e)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity p-1" title="Delete note">
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate line-clamp-1">
                  {note.content ? note.content.replace(/[\n\r]+/g, ' ') : 'Empty note...'}
                </p>
                <div className="text-[10px] font-semibold text-gray-400 mt-1">
                  {formatDisplayDate(note.updatedAt || note.createdAt)}
                </div>
              </div>
            );
          })}

          {filteredNotes.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-xs font-medium">
              No notes found. Click <kbd>+</kbd> to create one.
            </div>
          )}
        </div>
      </div>

      {/* Note Editor Pane */}
      <div className={`flex-1 flex-col bg-white dark:bg-[#1c1c1e] min-w-0 ${isEditorOpen ? 'flex' : 'hidden md:flex'}`}>
        {selectedNoteId ? (
          <>
            <div className="p-4 md:p-8 pb-3 md:pb-4 border-b border-gray-100 dark:border-white/5 flex items-center gap-2">
              <button onClick={() => setIsEditorOpen(false)} className="md:hidden -ml-1 p-1.5 rounded-lg text-gray-500 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Back to notes">
                <ChevronLeft size={20} />
              </button>
              <input type="text" value={activeTitle} onChange={e => handleTitleChange(e.target.value)} placeholder="Note Title"
                className="text-2xl md:text-3xl font-bold tracking-tight bg-transparent outline-none text-gray-900 dark:text-white w-full tracking-tight" />
            </div>

            <RichNoteEditor noteId={selectedNoteId} html={activeContent} onChange={handleContentChange} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
            <FileText size={48} className="mb-4 opacity-30 text-blue-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">No Note Selected</h3>
            <p className="text-sm text-gray-500 mb-4">Choose a note from the left or create a fresh one.</p>
            <button onClick={handleCreateNote} className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md">
              Create Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
