// ProjectLink - "which project is this post or reel in", with a picker to add or move it at any time.
// Only content projects with Use Auto Content on can take one (the same ones New Post lists).
import { useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { api } from '../../services/api';
import type { Project } from '../../services/types';
import { useToast } from '../../context/ToastContext';
import { Select } from './Select';

export function ProjectLink({ projectId, onChange }: { projectId: string | null; onChange: (projectId: string) => Promise<unknown> }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const projects = useMemo(
    () => (api.sync.getState().projects.filter(Boolean) as Project[]).filter(p => p.type === 'content' && p.autoContent),
    [],
  );
  const current = projects.find(p => p.id === projectId);
  if (projects.length === 0 && !current) return null;

  const pick = async (id: string) => {
    if (!id || id === projectId) return;
    setBusy(true);
    try {
      await onChange(id);
      showToast(`Now in ${projects.find(p => p.id === id)?.name || 'the project'}`);
    } catch (e: any) {
      showToast(e.message || "Couldn't change the project", 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex items-center gap-2 text-[12.5px]">
      <FolderPlus size={14} className={projectId ? 'text-gray-400' : 'text-amber-500'} />
      <span className="text-gray-500">{projectId ? 'Project' : 'Not in a project yet'}</span>
      <div className={busy ? 'opacity-50 pointer-events-none' : ''}>
        <Select value={projectId || ''} onChange={pick} className="field !h-8 !py-0 text-[12.5px]" aria-label="Project">
          {!projectId && <option value="">Add to a project…</option>}
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
    </div>
  );
}
