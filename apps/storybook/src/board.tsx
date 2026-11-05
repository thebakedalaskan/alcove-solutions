/*
 * What board stories share (stories/board/): the real `BoardSurface` on an in-memory Y.Doc from the demo world's boards
 * (src/world/boards.ts), with an awareness that hears the other people on it the way a provider would relay them. Nothing
 * here needs the stand-in API: a board is a plain Y.Doc and an awareness.
 *
 *   export const Busy: BoardStory = { args: { board: () => launchRetro(), mode: 'call', others: AROUND, talking: ['priya'] } };
 */
import { useTheme, type IconName } from '@alcove/ui';
import type { Decorator, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { BoardSurface, type BoardHandle, type BoardPerson } from '~/features/board/BoardSurface';
import type { BoardMode } from '~/features/board/state';
import './board.css';
import { did } from './component';
import { FOLK, type FolkId, type Presence } from './world/boards';

/** A board for a story: its doc, made fresh for each story, and the ids of what's on it by the canvas's names. */
export interface StoryBoard { doc: Y.Doc; ids?: ReadonlyMap<string, string> | undefined }

/** Someone on the board, as the surface is told about them: their face, name, colour and browser. */
const asPerson = (id: FolkId): BoardPerson => {
  const f = FOLK[id];
  return { id: f.id, person: f.person, name: f.name, colour: f.colour, clients: [f.client] };
};

/**
 * The other people on a board: each one's own awareness, on a browser of their own, whose updates reach this board's
 * awareness as a provider would bring them, renewals included, so their pointers stay for as long as the story is open.
 */
function useOthers(awareness: Awareness, others: readonly Presence[], ids: ReadonlyMap<string, string> | undefined): void {
  useEffect(() => {
    const stops = others.map((o) => {
      const theirs = new Y.Doc();
      theirs.clientID = FOLK[o.who].client;
      const aware = new Awareness(theirs);
      const editing = o.typing ? ids?.get(o.typing) ?? null : null;
      const send = (): void => applyAwarenessUpdate(awareness, encodeAwarenessUpdate(aware, [theirs.clientID]), 'wire');
      aware.on('update', send);
      aware.setLocalState({ at: o.at, view: o.view ?? null, sel: [], edit: editing, typing: editing !== null });
      return () => {
        aware.off('update', send);
        removeAwarenessStates(awareness, [theirs.clientID], 'wire');
        aware.destroy();
        theirs.destroy();
      };
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, [awareness, others, ids]);
}

export interface BoardSceneProps {
  /** Makes the board's doc. It's called once for each story, so what a story does to its board stays in that story. */
  board: () => StoryBoard;
  mode: BoardMode;
  name?: string | undefined;
  seal?: string | undefined;
  sealIcon?: IconName | undefined;
  acts?: boolean | undefined;
  others?: readonly Presence[] | undefined;
  /** Whoever is talking, which lights their pointer as it lights their tile. */
  talking?: readonly FolkId[] | undefined;
  /** Follows someone as soon as the board is open. */
  follow?: FolkId | undefined;
  /** Fills the sheet with this frame, by the canvas's name for it, as presenting or a phone's room does. */
  focus?: string | undefined;
  night?: boolean | undefined;
  /** Rises through the arch, as a board that has just opened. */
  fresh?: boolean | undefined;
  /** What the call puts over the sheet: its pill, its menus, ideas from the call. */
  children?: ReactNode;
}

const NOBODY: readonly Presence[] = [];

/** The real surface on a story's board. Everything outside the board (the bar's menus, Start a call here) says it was pressed. */
export function BoardScene({ board, mode, name = 'Launch retro', seal, sealIcon, acts, others = NOBODY, talking, follow, focus, night, fresh, children }: BoardSceneProps) {
  const made = useMemo(board, [board]);
  const awareness = useMemo(() => new Awareness(made.doc), [made]);
  const handle = useRef<BoardHandle>(null);
  const { resolved } = useTheme();
  const speaking = useMemo(() => new Set<string>(talking ?? []), [talking]);
  // Whoever is here: everyone on the board, and whoever is talking.
  const people = useMemo(() => [...new Set<FolkId>([...others.map((o) => o.who), ...(talking ?? [])])].map(asPerson), [others, talking]);
  useOthers(awareness, others, made.ids);
  useEffect(() => () => {
    awareness.destroy();
    made.doc.destroy();
  }, [awareness, made]);
  useEffect(() => {
    if (!follow) return undefined;
    // Once their view has come in on the awareness, which is the next turn of the event loop.
    const start = setTimeout(() => handle.current?.follow(follow), 50);
    return () => clearTimeout(start);
  }, [follow]);
  useEffect(() => {
    const frame = focus ? made.ids?.get(focus) : undefined;
    if (frame) handle.current?.focusFrame(frame);
  }, [focus, made]);
  return (
    <BoardSurface ref={handle} doc={made.doc} awareness={awareness} mode={mode} name={name} seal={seal} sealIcon={sealIcon} acts={acts}
      people={people} talking={speaking} theme={resolved} night={night} fresh={fresh}
      onName={did('name')} onSeal={did('seal')} onTimer={did('timer')} onVote={did('vote')} onPresent={did('present')} onMore={did('more')}
      onCall={did('start a call here')} onFollow={did('following')} onSay={did('tell')} onSort={did('sort into themes')}
      moreItems={{ image: did('image'), workspace: did('from your workspace'), table: did('table'), mindMap: did('mind map'), comment: did('comment'), templates: did('templates') }}>
      {children}
    </BoardSurface>
  );
}

/** Whether the toolbar's viewport is the phone's. */
const onAPhone = (viewport: unknown): boolean => typeof viewport === 'object' && viewport !== null && 'value' in viewport && viewport.value === 'phone';

/**
 * Where the board shows, by its mode. In a call it's on the stage, which is night whatever the theme, in the space the call
 * gives its main thing, while the sheet takes the person's theme. A tile stands on the stage in the middle. On its own page it
 * has the whole window, with day round it.
 */
export const whereItShows: Decorator = (Story, ctx) => {
  const mode: unknown = ctx.args['mode'];
  if (mode === 'page') return <div className="sbb-page"><Story /></div>;
  if (mode === 'tile') return <div className="stage sbc-stage"><Story /></div>;
  return (
    <div className="stage sbc-stage sbb-stage">
      <div className={onAPhone(ctx.globals['viewport']) ? 'sbb-call is-phone' : 'sbb-call'}><Story /></div>
    </div>
  );
};

/** A story of the board as the call shows it. */
export type BoardStory = StoryObj<BoardSceneProps>;
