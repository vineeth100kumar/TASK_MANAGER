import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  Clipping,
  ClipRule,
  SectionEyebrow,
  Hed,
  TapeStrip,
  TornEdge,
  Dateline,
  ScoreBar,
  TaskClipping,
  LedgerRow,
} from '../index';
import { WorkItem } from '../../../types';

describe('Newspaper Cutout UI Components', () => {
  describe('Clipping', () => {
    it('renders with default variant and children', () => {
      const { container } = render(
        <Clipping>
          <span>Story text</span>
        </Clipping>
      );
      expect(screen.getByText('Story text')).toBeTruthy();
      expect(container.firstChild).toHaveProperty('className');
      expect((container.firstChild as HTMLElement).className).toContain('clipping');
    });

    it('applies aged variant and rotation style', () => {
      const { container } = render(
        <Clipping variant="aged" rotate={1.5}>
          <span>Aged story</span>
        </Clipping>
      );
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain('clipping-aged');
      expect(el.style.transform).toContain('rotate');
    });
  });

  describe('ClipRule', () => {
    it('renders solid, thin, and double variants', () => {
      const { container: c1 } = render(<ClipRule variant="solid" />);
      expect((c1.firstChild as HTMLElement).className).toContain('clip-rule');

      const { container: c2 } = render(<ClipRule variant="thin" />);
      expect((c2.firstChild as HTMLElement).className).toContain('clip-rule-thin');

      const { container: c3 } = render(<ClipRule variant="double" />);
      expect((c3.firstChild as HTMLElement).className).toContain('clip-rule-double');
    });
  });

  describe('SectionEyebrow', () => {
    it('renders title and optional badge', () => {
      render(<SectionEyebrow badge="QUOTIENT">Daily Scorecard</SectionEyebrow>);
      expect(screen.getByText('Daily Scorecard')).toBeTruthy();
      expect(screen.getByText('QUOTIENT')).toBeTruthy();
    });
  });

  describe('Hed', () => {
    it('renders headline with requested level and size', () => {
      render(
        <Hed level={1} size="xl">
          Major Milestone Dispatched
        </Hed>
      );
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading.textContent).toBe('Major Milestone Dispatched');
      expect(heading.className).toContain('hed');
    });
  });

  describe('TapeStrip', () => {
    it('renders tape element with rotation', () => {
      const { container } = render(<TapeStrip rotate={-3} />);
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain('tape-strip');
      expect(el.style.transform).toBe('rotate(-3deg)');
    });
  });

  describe('TornEdge', () => {
    it('renders top and bottom torn classes', () => {
      const { container: topC } = render(<TornEdge position="top" />);
      expect((topC.firstChild as HTMLElement).className).toContain('torn-top');

      const { container: botC } = render(<TornEdge position="bottom" />);
      expect((botC.firstChild as HTMLElement).className).toContain('torn-bottom');
    });
  });

  describe('Dateline', () => {
    it('renders dateline metadata', () => {
      render(<Dateline>MON, SEP 14, 2026</Dateline>);
      expect(screen.getByText('MON, SEP 14, 2026')).toBeTruthy();
    });
  });

  describe('ScoreBar', () => {
    it('renders and clamps score to 100%', () => {
      const { container } = render(<ScoreBar value={120} showTicks={true} />);
      expect(screen.getByText('100%')).toBeTruthy();
      const fillBar = container.querySelector('.bg-ink-primary') as HTMLElement;
      expect(fillBar.style.width).toBe('100%');
    });
  });

  describe('TaskClipping', () => {
    const mockTask: WorkItem = {
      id: 'task-1',
      title: 'Deploy Sage OS update to Pi 5',
      entity_type: 'task',
      status: 'todo',
      priority: 'urgent',
      energy: 'high',
      estimated_minutes: 30,
      actual_minutes: 0,
      depends_on: [],
      is_completed: false,
      created_at: '2026-09-14T10:00:00Z',
      updated_at: '2026-09-14T10:00:00Z',
      subtasks: [],
    };

    it('renders task title, priority tag, and triggers onToggle', () => {
      const onToggle = vi.fn();
      render(<TaskClipping item={mockTask} onToggle={onToggle} />);

      expect(screen.getByText('Deploy Sage OS update to Pi 5')).toBeTruthy();
      expect(screen.getByText('Urgent')).toBeTruthy();

      const taskRow = screen.getByRole('button');
      fireEvent.click(taskRow);
      expect(onToggle).toHaveBeenCalledWith(mockTask);
    });
  });

  describe('LedgerRow', () => {
    it('renders financial row data with formatted values', () => {
      render(
        <LedgerRow
          label="Bank Reserves"
          value="₹ 1,50,000"
          sublabel="PRIMARY OPERATING"
          diff="BALANCED"
          isPositive={true}
        />
      );

      expect(screen.getByText('Bank Reserves')).toBeTruthy();
      expect(screen.getByText('PRIMARY OPERATING')).toBeTruthy();
      expect(screen.getByText('₹ 1,50,000')).toBeTruthy();
      expect(screen.getByText('BALANCED')).toBeTruthy();
    });
  });
});
