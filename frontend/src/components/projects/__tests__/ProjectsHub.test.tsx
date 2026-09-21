import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProjectsHub } from '../ProjectsHub';
import { ToastProvider } from '../../../context/ToastContext';
import { Project, WorkItem, Milestone } from '../../../types';

const project: Project = {
  id: 'proj-1',
  name: 'Home network rebuild',
  description: 'Rewire the study',
  color: '#0A6CFF',
  created_at: '2026-09-01T09:00:00',
} as Project;

function renderHub(overrides: Partial<React.ComponentProps<typeof ProjectsHub>> = {}) {
  const onCreateProject = vi.fn();
  const onCreateMilestone = vi.fn();
  render(
    <ToastProvider>
      <ProjectsHub
        projects={[project]}
        milestones={[] as Milestone[]}
        items={[] as WorkItem[]}
        onCreateProject={onCreateProject}
        onDeleteProject={vi.fn()}
        onCreateMilestone={onCreateMilestone}
        onDeleteMilestone={vi.fn()}
        onSelectItem={vi.fn()}
        {...overrides}
      />
    </ToastProvider>
  );
  return { onCreateProject, onCreateMilestone };
}

const openCreate = () => {
  fireEvent.click(screen.getAllByRole('button', { name: /new project/i })[0]);
  return within(screen.getByRole('dialog'));
};

describe('creating a project', () => {
  it('will not submit an unnamed project', () => {
    renderHub();
    const form = openCreate();

    expect(form.getByRole('button', { name: 'Create project' })).toBeDisabled();
  });

  it('sends the name, the description and the chosen colour', () => {
    const { onCreateProject } = renderHub();
    const form = openCreate();

    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Kitchen rewire' } });
    fireEvent.change(form.getByLabelText('Description'), { target: { value: 'Before the rains' } });
    fireEvent.click(form.getByRole('radio', { name: 'Green' }));
    fireEvent.click(form.getByRole('button', { name: 'Create project' }));

    expect(onCreateProject).toHaveBeenCalledWith({
      name: 'Kitchen rewire',
      description: 'Before the rains',
      color: '#1C7A4A',
    });
  });

  it('trims what was typed rather than storing the spaces', () => {
    const { onCreateProject } = renderHub();
    const form = openCreate();

    fireEvent.change(form.getByLabelText('Name'), { target: { value: '  Kitchen rewire  ' } });
    fireEvent.click(form.getByRole('button', { name: 'Create project' }));

    expect(onCreateProject.mock.calls[0][0].name).toBe('Kitchen rewire');
  });

  it('leaves the description off entirely when it is blank, so the Pi writes one', () => {
    const { onCreateProject } = renderHub();
    const form = openCreate();

    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Kitchen rewire' } });
    fireEvent.click(form.getByRole('button', { name: 'Create project' }));

    expect(onCreateProject.mock.calls[0][0].description).toBeUndefined();
  });

  it('says so when the name is already taken, without blocking it', () => {
    renderHub();
    const form = openCreate();

    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Home network rebuild' } });

    expect(form.getByText('A project already has this name.')).toBeInTheDocument();
    expect(form.getByRole('button', { name: 'Create project' })).toBeEnabled();
  });

  it('offers only palette colours, each one named', () => {
    renderHub();
    const form = openCreate();

    const swatches = form.getAllByRole('radio');
    expect(swatches).toHaveLength(6);
    expect(swatches.map(s => s.getAttribute('aria-label'))).toEqual([
      'Blue', 'Green', 'Amber', 'Red', 'Indigo', 'Grey',
    ]);
  });
});

describe('the projects screen', () => {
  it('invites a first project when there are none', () => {
    renderHub({ projects: [] });
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });

  it('shows a project that exists', () => {
    renderHub();
    expect(screen.getByText('Home network rebuild')).toBeInTheDocument();
  });
});
