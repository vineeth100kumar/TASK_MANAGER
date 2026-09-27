import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Search, FileText, Calendar, Sparkles, Folder } from 'lucide-react';
import { api } from '../../services/api';
import { Note } from '../../services/types';
import { formatDisplayDate } from '../../utils/dateUtils';
import { useToast } from '../../context/ToastContext';

interface NotesViewProps {
  lifeContext: 'work' | 'personal';
}

export function NotesView({ lifeContext }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTitle, setActiveTitle] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const { showToast } = useToast();

  const loadNotes = async () => {
    const list = await api.notes.list();
    setNotes(list);
    if (list.length > 0 && !selectedNoteId) {
      setSelectedNoteId(list[0].id);
      setActiveTitle(list[0].title);
      setActiveContent(list[0].content || '');
    }
  };

  useEffect(() => {
    loadNotes();
  }, []);

  const selectedNote = notes.find(n => n.id === selectedNoteId);

  useEffect(() => {
    if (selectedNote) {
      setActiveTitle(selectedNote.title);
      setActiveContent(selectedNote.content || '');
    }
  }, [selectedNoteId]);

  const handleCreateNote = async () => {
    const newNote = await api.notes.create({
      title: 'New Note',
      content: ''
    });
    setNotes(prev => [newNote, ...prev]);
    setSelectedNoteId(newNote.id);
    setActiveTitle(newNote.title);
    setActiveContent('');
    showToast('New note created');
  };

  const handleTitleChange = (val: string) => {
    setActiveTitle(val);
    if (selectedNoteId) {
      setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, title: val } : n));
      api.notes.update(selectedNoteId, { title: val });
    }
  };

  const handleContentChange = (val: string) => {
    setActiveContent(val);
    if (selectedNoteId) {
      setNotes(prev => prev.map(n => n.id === selectedNoteId ? { ...n, content: val } : n));
      api.notes.update(selectedNoteId, { content: val });
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
          setActiveContent(remaining[0].content || '');
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
    <div className="h-[calc(100vh-8.5rem)] flex bg-white dark:bg-[#1c1c1e] rounded-[32px] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
      {/* Notes Sidebar */}
      <div className="w-80 border-r border-gray-100 dark:border-white/5 flex flex-col bg-[#f5f5f7]/60 dark:bg-black/20 shrink-0">
        
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
              <div key={note.id} onClick={() => setSelectedNoteId(note.id)}
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
      <div className="flex-1 flex flex-col bg-white dark:bg-[#1c1c1e] min-w-0">
        {selectedNoteId ? (
          <>
            <div className="p-6 md:p-8 pb-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
              <input type="text" value={activeTitle} onChange={e => handleTitleChange(e.target.value)} placeholder="Note Title"
                className="text-2xl md:text-3xl font-extrabold bg-transparent outline-none text-gray-900 dark:text-white w-full tracking-tight" />
            </div>

            <div className="flex-1 p-6 md:p-8 overflow-y-auto custom-scrollbar">
              <textarea value={activeContent} onChange={e => handleContentChange(e.target.value)}
                placeholder="Start typing your note, meeting minutes, ideas, or markdown..."
                className="w-full h-full bg-transparent outline-none resize-none text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 font-sans" />
            </div>
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
