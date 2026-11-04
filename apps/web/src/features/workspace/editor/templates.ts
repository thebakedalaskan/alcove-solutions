/* What a new document can start from. They're only blocks: put them in with `insertBlocks(t.blocks, 'all')`. */
import type { IconName } from '@alcove/ui';
import type { BlockJSON } from './types';

export interface Template { id: string; name: string; sub: string; icon: IconName; blocks: BlockJSON[] }

const text = (s: string) => [{ type: 'text', text: s }];
const h2 = (s: string): BlockJSON => ({ type: 'heading', attrs: { level: 2 }, content: text(s) });
const todo: BlockJSON = { type: 'todo' };
const bullet: BlockJSON = { type: 'bullet' };
const numbered: BlockJSON = { type: 'numbered' };
const paragraph: BlockJSON = { type: 'paragraph' };

export const TEMPLATES: readonly Template[] = [
  { id: 'agenda', name: 'Agenda', sub: 'Topics, owners, what carried over', icon: 'listOrdered', blocks: [h2('From last time'), todo, h2('Today'), numbered, h2('Notes'), paragraph] },
  { id: 'decisions', name: 'Decision log', sub: 'What was decided, by whom, and why', icon: 'circleCheck', blocks: [h2('Decided'), bullet, h2('Still open'), todo] },
  { id: 'retro', name: 'Retro', sub: 'Went well, could improve, actions', icon: 'history', blocks: [h2('Went well'), bullet, h2('Could improve'), bullet, h2('Actions'), todo] },
  { id: 'brief', name: 'Project brief', sub: 'Goal, people, dates, risks', icon: 'fileText', blocks: [h2('Goal'), paragraph, h2('People'), bullet, h2('Dates'), bullet, h2('Risks'), bullet] }
];
