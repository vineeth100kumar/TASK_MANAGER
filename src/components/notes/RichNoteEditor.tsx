import { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Image as ImageIcon,
  PenLine, Highlighter, Baseline, Undo2, Redo2, RemoveFormatting, Trash2, ChevronDown, CheckSquare,
} from 'lucide-react';
import { DrawingPad } from './DrawingPad';
import { imageFileToDataUrl, sanitizeNoteHtml } from './noteHtml';

const FONTS = [
  { label: 'Sans', value: 'Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, Cambria, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { label: 'Handwritten', value: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive' },
];
// execCommand sizes run 1-7; these are the useful ones.
const SIZES = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '6' },
];
const BLOCKS = [
  { label: 'Text', value: 'div' },
  { label: 'Heading', value: 'h1' },
  { label: 'Subheading', value: 'h2' },
  { label: 'Small heading', value: 'h3' },
];
const TEXT_COLORS = ['#ef4444', '#f97316', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#6b7280'];
// See-through so highlighted text stays readable in light and dark mode.
const HIGHLIGHTS = ['rgba(250, 204, 21, 0.45)', 'rgba(74, 222, 128, 0.4)', 'rgba(56, 189, 248, 0.4)', 'rgba(244, 114, 182, 0.4)', 'rgba(251, 146, 60, 0.45)', 'rgba(167, 139, 250, 0.45)'];

interface RichNoteEditorProps {
  noteId: string;
  html: string;
  onChange: (html: string, text: string) => void;
}

/**
 * The note body: a formatted editor with fonts, sizes, colours, highlights,
 * lists, checklists, images (picked, pasted or dropped) and drawings.
 */
export function RichNoteEditor({ noteId, html, onChange }: RichNoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const lastEmitted = useRef<string>('');
  const [openMenu, setOpenMenu] = useState<null | 'color' | 'highlight'>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgBar, setImgBar] = useState<{ top: number; left: number } | null>(null);
  const [drawing, setDrawing] = useState<null | { background: string | null; target: HTMLImageElement | null }>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // Load the note when it opens, and when it changes elsewhere (another device);
  // the editor's own edits come back through `html` and are left alone.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (html === lastEmitted.current && el.innerHTML) return;
    el.innerHTML = sanitizeNoteHtml(html);
    lastEmitted.current = html;
    setIsEmpty(!el.textContent?.trim() && !el.querySelector('img'));
    setSelectedImg(null);
  }, [noteId, html]);

  useEffect(() => {
    document.execCommand('styleWithCSS', false, 'true');
    const remember = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  }, []);

  const emit = () => {
    const el = editorRef.current;
    if (!el) return;
    const out = el.innerHTML;
    lastEmitted.current = out;
    setIsEmpty(!el.textContent?.trim() && !el.querySelector('img'));
    onChange(out, el.innerText.replace(/\n{3,}/g, '\n\n').trim());
    if (selectedImg) placeImageBar(selectedImg);
  };

  // Put the cursor back where it was before a toolbar control took focus.
  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const run = (command: string, value?: string) => {
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    setOpenMenu(null);
    emit();
  };

  const insertHtml = (markup: string) => {
    restoreSelection();
    if (!savedRange.current || !editorRef.current?.contains(savedRange.current.startContainer)) {
      // Nothing selected yet: add to the end.
      const range = document.createRange();
      range.selectNodeContents(editorRef.current!);
      range.collapse(false);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('insertHTML', false, markup);
    emit();
  };

  const insertImages = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const src = await imageFileToDataUrl(file);
      insertHtml(`<img src="${src}" alt="" style="width: 100%;"><div><br></div>`);
    }
  };

  const insertChecklist = () => {
    insertHtml('<ul class="note-checklist"><li data-checked="false">&#8203;</li></ul>');
  };

  const placeImageBar = (img: HTMLImageElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const a = img.getBoundingClientRect();
    const b = wrap.getBoundingClientRect();
    setImgBar({ top: a.top - b.top + wrap.scrollTop + 8, left: Math.max(8, a.left - b.left + 8) });
  };

  const onEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Ticking a checklist item: the box is drawn in the item's left padding.
    if (target.tagName === 'LI' && target.parentElement?.classList.contains('note-checklist')) {
      const rect = target.getBoundingClientRect();
      if (e.clientX - rect.left < 26) {
        e.preventDefault();
        target.dataset.checked = target.dataset.checked === 'true' ? 'false' : 'true';
        emit();
        return;
      }
    }
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      setSelectedImg(img);
      placeImageBar(img);
    } else {
      setSelectedImg(null);
    }
  };

  useEffect(() => {
    editorRef.current?.querySelectorAll('img.is-selected').forEach(i => i.classList.remove('is-selected'));
    selectedImg?.classList.add('is-selected');
  }, [selectedImg]);

  const resizeImage = (width: string) => {
    if (!selectedImg) return;
    selectedImg.style.width = width;
    emit();
    placeImageBar(selectedImg);
  };

  const removeImage = () => {
    selectedImg?.remove();
    setSelectedImg(null);
    emit();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      insertImages(files);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const range = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY) as Range | undefined;
    if (range) savedRange.current = range;
    insertImages(files);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 'h') { e.preventDefault(); run('hiliteColor', HIGHLIGHTS[0]); }
  };

  const finishDrawing = (dataUrl: string) => {
    if (drawing?.target) {
      drawing.target.src = dataUrl;
      emit();
    } else {
      insertHtml(`<img src="${dataUrl}" alt="Drawing" data-drawing="true" style="width: 100%;"><div><br></div>`);
    }
    setDrawing(null);
  };

  // Toolbar buttons keep the editor's selection by not taking focus.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const btn = 'shrink-0 p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors';
  const sep = <span className="shrink-0 w-px h-5 bg-black/10 dark:bg-white/10 mx-0.5" />;
  const selectCls = 'shrink-0 w-[5.6rem] h-8 rounded-lg bg-transparent hover:bg-black/5 dark:hover:bg-white/10 text-[13px] font-medium text-gray-700 dark:text-gray-200 px-1.5 outline-none cursor-pointer dark:[color-scheme:dark]';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div role="toolbar" aria-label="Formatting" className="relative border-b border-gray-100 dark:border-white/5 px-3 md:px-6 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          <button type="button" onMouseDown={keep} onClick={() => run('undo')} className={btn} title="Undo"><Undo2 size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => run('redo')} className={btn} title="Redo"><Redo2 size={16} /></button>
          {sep}
          <select aria-label="Text style" className={selectCls} defaultValue="" onChange={e => { run('formatBlock', e.target.value); e.target.value = ''; }}>
            <option value="" disabled>Style</option>
            {BLOCKS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
          <select aria-label="Font" className={selectCls} defaultValue="" onChange={e => { run('fontName', e.target.value); e.target.value = ''; }}>
            <option value="" disabled>Font</option>
            {FONTS.map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <select aria-label="Text size" className={selectCls} defaultValue="" onChange={e => { run('fontSize', e.target.value); e.target.value = ''; }}>
            <option value="" disabled>Size</option>
            {SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {sep}
          <button type="button" onMouseDown={keep} onClick={() => run('bold')} className={btn} title="Bold (Ctrl+B)"><Bold size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => run('italic')} className={btn} title="Italic (Ctrl+I)"><Italic size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => run('underline')} className={btn} title="Underline (Ctrl+U)"><Underline size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => run('strikeThrough')} className={btn} title="Strikethrough"><Strikethrough size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => setOpenMenu(m => m === 'color' ? null : 'color')} className={`${btn} flex items-center`} title="Text colour" aria-expanded={openMenu === 'color'}>
            <Baseline size={16} /><ChevronDown size={11} className="opacity-50" />
          </button>
          <button type="button" onMouseDown={keep} onClick={() => setOpenMenu(m => m === 'highlight' ? null : 'highlight')} className={`${btn} flex items-center`} title="Highlight (Ctrl+Shift+H)" aria-expanded={openMenu === 'highlight'}>
            <Highlighter size={16} /><ChevronDown size={11} className="opacity-50" />
          </button>
          {sep}
          <button type="button" onMouseDown={keep} onClick={() => run('insertUnorderedList')} className={btn} title="Bulleted list"><List size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => run('insertOrderedList')} className={btn} title="Numbered list"><ListOrdered size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={insertChecklist} className={btn} title="Checklist"><CheckSquare size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => run('formatBlock', 'blockquote')} className={btn} title="Quote"><Quote size={16} /></button>
          {sep}
          <button type="button" onMouseDown={keep} onClick={() => fileRef.current?.click()} className={btn} title="Add image"><ImageIcon size={16} /></button>
          <button type="button" onMouseDown={keep} onClick={() => setDrawing({ background: null, target: null })} className={btn} title="Draw"><PenLine size={16} /></button>
          {sep}
          <button type="button" onMouseDown={keep} onClick={() => { run('removeFormat'); run('formatBlock', 'div'); }} className={btn} title="Clear formatting"><RemoveFormatting size={16} /></button>
        </div>

        {openMenu && (
          <div className="absolute z-20 top-full mt-1 left-3 md:left-auto md:right-6 p-2 rounded-2xl bg-white dark:bg-[#2c2c2e] border border-black/5 dark:border-white/10 shadow-xl flex flex-wrap gap-1.5 max-w-[17rem]" onMouseDown={keep}>
            {(openMenu === 'color' ? TEXT_COLORS : HIGHLIGHTS).map(c => (
              <button key={c} type="button" aria-label={`${openMenu === 'color' ? 'Text colour' : 'Highlight'} ${c}`}
                onClick={() => run(openMenu === 'color' ? 'foreColor' : 'hiliteColor', c)}
                className="w-7 h-7 rounded-lg border border-black/10 dark:border-white/10 flex items-center justify-center text-[13px] font-bold"
                style={openMenu === 'color' ? { color: c } : { background: c }}>
                {openMenu === 'color' ? 'A' : ''}
              </button>
            ))}
            <button type="button" onClick={() => run(openMenu === 'color' ? 'foreColor' : 'hiliteColor', openMenu === 'color' ? 'inherit' : 'transparent')}
              className="h-7 px-2 rounded-lg text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10">
              {openMenu === 'color' ? 'Default' : 'None'}
            </button>
          </div>
        )}
      </div>

      <div ref={wrapRef} className="relative flex-1 overflow-y-auto custom-scrollbar" onScroll={() => selectedImg && placeImageBar(selectedImg)}>
        {isEmpty && (
          <div className="absolute top-6 md:top-8 left-6 md:left-8 text-[15px] text-gray-400 dark:text-gray-600 pointer-events-none select-none">
            Start typing, paste a picture, or draw something...
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Note"
          spellCheck
          onInput={emit}
          onClick={onEditorClick}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={e => { if (Array.from(e.dataTransfer.items).some(i => i.kind === 'file')) e.preventDefault(); }}
          onKeyDown={onKeyDown}
          className="note-body min-h-full p-6 md:p-8 outline-none text-[15px] leading-relaxed text-gray-800 dark:text-gray-200"
        />

        {selectedImg && imgBar && (
          <div className="absolute z-10 flex items-center gap-0.5 p-1 rounded-xl bg-gray-900/90 text-white shadow-lg backdrop-blur" style={{ top: imgBar.top, left: imgBar.left }}>
            {[['S', '33%'], ['M', '60%'], ['L', '100%']].map(([label, w]) => (
              <button key={label} type="button" onClick={() => resizeImage(w)} title={`Width ${w}`}
                className={`w-7 h-7 rounded-lg text-[12px] font-semibold hover:bg-white/15 ${selectedImg.style.width === w ? 'bg-white/20' : ''}`}>{label}</button>
            ))}
            <span className="w-px h-4 bg-white/20 mx-0.5" />
            <button type="button" onClick={() => setDrawing({ background: selectedImg.src, target: selectedImg })} className="h-7 px-2 rounded-lg text-[12px] font-semibold hover:bg-white/15 flex items-center gap-1" title="Draw on image">
              <PenLine size={13} /> Draw
            </button>
            <button type="button" onClick={removeImage} className="w-7 h-7 rounded-lg hover:bg-white/15 flex items-center justify-center" title="Remove image"><Trash2 size={13} /></button>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) insertImages(e.target.files); e.target.value = ''; }} />

      {drawing && <DrawingPad background={drawing.background} onCancel={() => setDrawing(null)} onDone={finishDrawing} />}
    </div>
  );
}
