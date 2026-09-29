// Starting points for an empty board, drawn with the same edit operations the
// thinking partner uses, then tidied into a top-to-bottom layout.
import { EditOp } from './boardEdits';

export interface BoardTemplate {
  name: string;
  hint: string;
  ops: EditOp[];
}

const node = (ref: string, label: string, shape = 'box', near?: string): EditOp => ({ op: 'add_node', ref, label, shape, near });
const edge = (from: string, to: string, label?: string): EditOp => ({ op: 'add_edge', from, to, label });

export const TEMPLATES: BoardTemplate[] = [
  {
    name: 'Flowchart',
    hint: 'Steps with a yes/no check',
    ops: [
      node('a', 'Start', 'oval'),
      node('b', 'First step', 'box', 'a'),
      node('c', 'Did it work?', 'decision', 'b'),
      node('d', 'Next step', 'box', 'c'),
      node('e', 'Fix and retry', 'box', 'c'),
      node('f', 'Done', 'oval', 'd'),
      edge('a', 'b'), edge('b', 'c'), edge('c', 'd', 'Yes'), edge('c', 'e', 'No'), edge('e', 'b'), edge('d', 'f'),
      { op: 'tidy' },
    ],
  },
  {
    name: 'Project plan',
    hint: 'Goal, milestones, next actions',
    ops: [
      node('g', 'Goal: what done looks like', 'oval'),
      node('m1', 'Milestone 1', 'box', 'g'),
      node('m2', 'Milestone 2', 'box', 'g'),
      node('m3', 'Milestone 3', 'box', 'g'),
      node('a1', 'Next action', 'box', 'm1'),
      node('a2', 'Next action', 'box', 'm2'),
      node('a3', 'Next action', 'box', 'm3'),
      edge('g', 'm1'), edge('g', 'm2'), edge('g', 'm3'), edge('m1', 'a1'), edge('m2', 'a2'), edge('m3', 'a3'),
      { op: 'tidy' },
    ],
  },
  {
    name: 'Decision',
    hint: 'Weigh two options',
    ops: [
      node('q', 'What am I deciding?', 'decision'),
      node('o1', 'Option A', 'box', 'q'),
      node('o2', 'Option B', 'box', 'q'),
      node('p1', 'Pros and cons of A', 'box', 'o1'),
      node('p2', 'Pros and cons of B', 'box', 'o2'),
      node('c', 'Choice and why', 'oval', 'p1'),
      edge('q', 'o1'), edge('q', 'o2'), edge('o1', 'p1'), edge('o2', 'p2'), edge('p1', 'c'), edge('p2', 'c'),
      { op: 'tidy' },
    ],
  },
  {
    name: 'Brainstorm',
    hint: 'One idea, branches around it',
    ops: [
      node('c', 'Main idea', 'oval'),
      node('b1', 'Branch', 'box', 'c'),
      node('b2', 'Branch', 'box', 'c'),
      node('b3', 'Branch', 'box', 'c'),
      node('b4', 'Branch', 'box', 'c'),
      edge('c', 'b1'), edge('c', 'b2'), edge('c', 'b3'), edge('c', 'b4'),
      { op: 'tidy' },
    ],
  },
];
