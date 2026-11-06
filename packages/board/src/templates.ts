/*
 * What a new board can start from. Sizes, positions, hints and colours are the design canvas's, and so are its words
 * wherever they suit any meeting. Where the canvas's were about its fictional launch, they're generic: Flow's shapes
 * read as what each kind is for. A template fills in one transaction, and the server makes that update, so everyone
 * gets the same frames and nobody's undo can take them away. The server writes it as one fixed Yjs client, and only as a
 * client the board's log hasn't had, so of two fills at once only one is ever written. Nothing in it is random: its ids
 * come from the board's id, so a template says the same thing on every try, and it only ever fills an empty board.
 */
import type * as Y from 'yjs';
import { sides } from './routes';
import { hasBox, idFrom, type NewObject, type ShapeKind, type StickyColour } from './shape';
import { insert, stack, viewOf, writing } from './write';

export const TEMPLATES = ['blank', 'retro', 'ideas', 'flow', 'what-why-next'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

type Piece = Extract<NewObject, { x: number }>;

interface Template {
  objects: readonly Piece[];
  /** Lines to draw, as pairs of positions in `objects`. */
  links: readonly (readonly [number, number])[];
}

const frame = (title: string, x: number, y: number, w: number, h: number, hint: string, c: StickyColour, role: '' | 'actions' = ''): Piece =>
  ({ k: 'frame', x, y, w, h, title, hint, sub: '', sorted: false, c, role });
const shape = (s: ShapeKind, t: string, x: number, y: number, w: number, h: number, c: StickyColour | '' = ''): Piece =>
  ({ k: 'shape', s, t, x, y, w, h, c });
const label = (t: string, x: number, y: number, w: number, h: number): Piece =>
  ({ k: 'text', size: 'heading', t, x, y, w, h });

const BOARDS: Record<TemplateName, Template> = {
  blank: { objects: [], links: [] },
  retro: {
    objects: [
      frame('Went well', 0, 0, 360, 530, 'What should we keep doing?', 'butter'),
      frame('Could improve', 400, 0, 360, 530, 'What got in the way?', 'rose'),
      frame('Actions', 800, 0, 360, 530, 'Who does what next?', 'sky', 'actions')
    ],
    links: []
  },
  ideas: { objects: [frame('Ideas', 0, 0, 1160, 530, '', 'butter')], links: [] },
  flow: {
    objects: [
      shape('pill', 'Start', 0, 130, 170, 76, 'sky'),
      shape('rect', 'Step', 240, 130, 170, 76),
      shape('diamond', 'Choice', 480, 88, 180, 160, 'butter'),
      shape('rect', 'Step', 740, 20, 190, 76),
      shape('rect', 'Step', 740, 240, 190, 76),
      shape('pill', 'Done', 1000, 240, 170, 76, 'sky'),
      label('Yes', 672, 96, 40, 24),
      label('No', 672, 226, 40, 24)
    ],
    links: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5]]
  },
  'what-why-next': {
    objects: [
      frame('What happened', 0, 0, 190, 360, '', 'rose'),
      frame('Why', 220, 0, 190, 360, '', 'peach'),
      frame('What next', 440, 0, 190, 360, '', 'sky', 'actions')
    ],
    links: []
  }
};

/**
 * Fills an empty board with a template, the same way every time for the same `seed`, which is the board's document id: each
 * id is made from the seed, the template and where the object comes in it. A board with anything on it is left as it is.
 */
export function fillTemplate(doc: Y.Doc, name: TemplateName, origin: unknown, seed: string): void {
  writing(doc, origin, undefined, (board) => {
    if (board.objects.size || board.places.length) return;
    const { objects: pieces, links } = BOARDS[name];
    const at = stack(viewOf(doc)), id = (index: number): string => idFrom(seed, name, String(index));
    const made = pieces.map((piece, index) => insert(board, { ...piece, id: id(index), at: at(piece.k), f: '' }));
    links.forEach(([from, to], index) => {
      const a = made[from], b = made[to];
      if (!a || !b || !hasBox(a) || !hasBox(b)) return;
      const [start, end] = sides(a, b);
      insert(board, { k: 'line', style: 'elbow', from: { on: a.id, side: start }, to: { on: b.id, side: end }, id: id(pieces.length + index), at: at('line'), f: '' });
    });
  });
}
