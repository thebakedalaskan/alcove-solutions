/*
 * Beside the list, from 1100px: what the lit row is. A moment: its call, what was made there (a decision still waiting
 * can be confirmed right here), the transcript around it, and Open at and Play from. Someone: your calls together and the
 * latest they said, with What they said and Calls with them. A note: its summary and what's waiting in it. Ask: what
 * asking does. See all: what Calls will show. The one filled button is what Enter does.
 */
import { errorCode, errorMessage, firstName, isBy, mayDecide, type DecisionPatch, type Note, type NoteAction, type NoteDecision, type NoteFound, type NoteReader, type Person, type Speaker } from '@alcove/api';
import {
  Button, Icon, PaletteAllPreview, PaletteAskPreview, PaletteExcerpt, PaletteExcerptLine, PaletteMade, PalettePersonPreview, PalettePreview, PalettePreviewHead,
  PaletteSummary, buttonClass, useToast
} from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useNoteReader } from '~/features/notes/entries';
import { marked } from '~/features/notes/highlight';
import { readerRole } from '~/features/notes/meta';
import { byTime, noSummary, othersIn } from '~/features/calls/list/said';
import { decisionLine, inNote, notDecided, playIn } from '~/features/notes/parts';
import { callName, spokenName } from '~/lib/people';
import { noteQueries, useUpdateDecision } from '~/features/notes/queries';
import { callLength, noteAt, pastDay, position } from '~/lib/time';
import { plural } from '~/lib/words';
import { keepInView } from './keepInView';
import { around, madeAt, together, type Counts, type Made, type Row } from './rows';
import type { Someone } from '~/features/team/data';

/** Lines of someone's that their preview shows. */
const LATEST = 3;
/** How long someone lit by typing or by the pointer stays lit before their lines are asked for, in ms. */
const LINGER = 250;

/** When a call was and how long it took: "Today at 09:00 · 20 min". */
const when = (n: NoteFound) => `${noteAt(n.startedAt)} · ${callLength(n.duration)}`;
/** A note that went meanwhile (deleted, or taken out of yours) isn't asked for again. */
const unlessGone = (tries: number, e: unknown) => errorCode(e) !== 'not-found' && tries < 2;
/** Who said a line, as an arch: their account's, or their name's when they have none. */
const archOf = (s: Speaker | undefined) => (s ? s.person ?? { name: s.name } : undefined);

export interface PreviewProps {
  row: Row;
  /** The keys lit the row (not typing, nor the pointer passing over it): what it needs is asked for at once. */
  byKeys: boolean;
  me: string | undefined;
  /** The words searched for, marked where they show. */
  terms: string[];
  /** What's in the line, for See all. */
  typed: string;
  /** Who the search is narrowed to: See all opens their calls with you in Calls. */
  token: Person | undefined;
  /** The token's first name when nothing's typed, for See all. */
  whose: string | undefined;
  /** What the search found, for See all. */
  counts: Counts;
  /** How many notes you have: an answer reads them all. */
  notes: number;
  /** Decisions in a note waiting for you to confirm them. */
  toConfirm: (noteId: string) => number;
  /** A link here was followed: the palette closes. */
  onOpen: () => void;
  onPick: (person: Person) => void;
  onAsk: () => void;
  onSeeAll: () => void;
  /** Something pressed here is done with: the caret goes back to the line. */
  onSettled: () => void;
}

export function Preview(p: PreviewProps) {
  const { row } = p;
  switch (row.kind) {
    case 'moment': return <MomentPreview key={row.key} {...p} row={row} />;
    // Its own for each person: one person's lines never stay under another's name while theirs are on the way.
    case 'person': return <PersonPreview key={row.key} {...p} someone={row.someone} />;
    case 'note': return <NotePreview {...p} note={row.note} enter />;
    // More opens the rest of a call in place: its preview is the call, which still opens from here.
    case 'more': return <NotePreview {...p} note={row.note} enter={false} />;
    case 'ask':
      return (
        <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={p.onAsk}>Ask</Button>}>
          <PaletteAskPreview question={row.text}>{reads(p.notes)}</PaletteAskPreview>
        </PalettePreview>
      );
    case 'all': {
      if (p.token) {
        const first = callName(p.token);
        const words = p.typed.trim();
        return (
          <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={p.onSeeAll}>Calls with {first}</Button>}>
            <PaletteAllPreview words={words || `Calls with ${first}`}>
              {words ? 'Calls lists the calls you’re both on with these words in them, whoever said them.' : 'Calls lists the calls you’re both on: coming up, then the ones you’ve had.'}
            </PaletteAllPreview>
          </PalettePreview>
        );
      }
      const found = [
        ...(p.counts.moments ? [`${plural(p.counts.moments, 'moment')} in ${plural(p.counts.calls, 'call')}`] : []),
        ...(p.counts.notes ? [plural(p.counts.notes, 'note')] : [])
      ].join(', ');
      return (
        <PalettePreview actions={<Button variant="primary" size="sm" kb="↵" onClick={p.onSeeAll}>See all in Calls</Button>}>
          <PaletteAllPreview words={p.typed.trim() || p.whose}>
            {found}, each under its note. Notes can narrow them to someone, or to calls, the room and what was shared with you.
          </PaletteAllPreview>
        </PalettePreview>
      );
    }
  }
}

/** What an answer reads. */
const reads = (notes: number) => (notes === 1
  ? 'The answer reads your one note, and points to the moments it comes from.'
  : `The answer reads all ${notes} of your notes, and points to the moments it comes from.`);

/** The question being answered, beside the answer while it's read: nothing is lit yet, and the window keeps its size. */
export function Asking({ question, notes }: { question: string; notes: number }) {
  return <PalettePreview><PaletteAskPreview question={question}>{reads(notes)}</PaletteAskPreview></PalettePreview>;
}

/** Where a follow-up stands, briefly: whose it is and when it's due, or that it's done. */
function followUpState(a: NoteAction, me: string | undefined): string {
  if (a.done) return 'Done';
  if (!a.owner) return 'Nobody is on this yet';
  const yours = spokenName(a.owner, me) === 'You';
  const whose = a.takenOn ? (yours ? 'Yours' : `${firstName(a.owner.name)}’s`) : `Suggested for ${yours ? 'you' : firstName(a.owner.name)}`;
  return a.due ? `${whose}, due ${/^(today|tomorrow)$/i.test(a.due) ? a.due.toLowerCase() : a.due}` : whose;
}

/** What was made at a moment: a follow-up and where it stands, or a decision, with Confirm and It wasn't decided while it waits on you. */
function MadeTile({ made, me, reader, busy, onChange }: { made: Made; me: string | undefined; reader: NoteReader; busy: boolean; onChange: (d: NoteDecision, patch: DecisionPatch) => void }) {
  if (made.kind === 'follow-up') return <PaletteMade kind="follow-up" text={made.action.text} state={followUpState(made.action, me)} />;
  const d = made.decision;
  const mine = d.disputes.some((x) => isBy(x.by, reader));
  const yes = d.state === 'proposed' && mayDecide(d, 'confirmed', reader);
  const no = d.state === 'proposed' ? notDecided(d, reader) : undefined;
  const state = mine ? 'You said this wasn’t decided' : yes ? 'Waiting for you to confirm' : decisionLine(d, me);
  return (
    <PaletteMade kind="decision" text={d.text} state={state}>
      {!mine && (yes || no) && (
        <>
          {yes && <Button size="sm" disabled={busy} onClick={() => onChange(d, { state: 'confirmed', seen: { text: d.text } })}>Confirm</Button>}
          {no && <Button variant="quiet" size="sm" disabled={busy} onClick={() => onChange(d, no)}>It wasn’t decided</Button>}
        </>
      )}
    </PaletteMade>
  );
}

/** A moment: its call, what was made there, the transcript around it, and Open at and, with a recording, Play from. */
function MomentPreview({ row, me, terms, onOpen, onSettled }: PreviewProps & { row: Extract<Row, { kind: 'moment' }> }) {
  const { note: n, line } = row;
  const toast = useToast();
  const decide = useUpdateDecision();
  const readerOf = useNoteReader();
  const note: Note | undefined = useQuery({ ...noteQueries.note(n.id), retry: unlessGone }).data;
  /* A decision said here not to be decided stays, saying so, while this moment is lit. */
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const made = note ? madeAt(note, line, kept) : undefined;
  const near = note ? around(note, line) : undefined;
  const lines: { id: string; at: number; text: string; speaker?: Speaker | undefined }[] = near?.lines.length ? near.lines : [line];
  const lit = near?.lit ?? line.id;
  /* The lit line stays in view, in a short window or under a long decision. */
  const excerpt = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = excerpt.current?.querySelector('[aria-current="true"]');
    if (at instanceof HTMLElement) keepInView(at, false);
  }, [lit, lines.length]);
  const time = position(line.at);
  const plays = !!note && note.kept.recording && note.audio.length > 0;
  const change = async (d: NoteDecision, patch: DecisionPatch) => {
    if (patch.state === 'rejected' || patch.dispute) setKept((k) => new Set(k).add(d.id));
    try { await decide.mutateAsync({ noteId: n.id, decisionId: d.id, patch }); } catch (e) { toast(errorMessage(e), { icon: 'x' }); }
    onSettled();
  };
  return (
    <PalettePreview actions={(
      <>
        <Link to="/calls/$noteId" params={{ noteId: n.id }} {...inNote(line.at, line.room)} className={buttonClass({ variant: 'primary', size: 'sm' })} onClick={onOpen}>
          Open at {time}<span className="kb">↵</span>
        </Link>
        {plays && (
          <Link to="/calls/$noteId" params={{ noteId: n.id }} {...playIn(line.at, line.room)} className={buttonClass({ size: 'sm' })} onClick={onOpen}>
            <Icon name="play" size={14} />Play from {time}
          </Link>
        )}
      </>
    )}>
      <PalettePreviewHead title={n.title} meta={line.room ? `${when(n)} · ${line.room.name}` : when(n)} people={othersIn(n.people, me)} />
      {made && note && <MadeTile made={made} me={me} reader={readerOf(readerRole(note.received))} busy={decide.isPending} onChange={(d, patch) => void change(d, patch)} />}
      <div ref={excerpt}>
        <PaletteExcerpt>
          {lines.map((l) => (
            <PaletteExcerptLine key={l.id} time={position(l.at)} person={archOf(l.speaker)} name={l.speaker ? spokenName(l.speaker, me) : ''} lit={l.id === lit}>
              {marked(l.text, terms)}
            </PaletteExcerptLine>
          ))}
        </PaletteExcerpt>
      </div>
    </PalettePreview>
  );
}

/**
 * Someone: your calls together, the latest they said, and What they said (the token) and Calls with them (on the Calls page). Lit by
 * typing a name or by the pointer passing over, what they said is asked for once they've stayed lit a moment; lit with the
 * keys, at once. Until it's there, nothing: never the lines of whoever was lit before.
 */
function PersonPreview({ someone, byKeys, onOpen, onPick }: PreviewProps & { someone: Someone }) {
  const { person } = someone;
  const first = callName(person);
  const [asking, setAsking] = useState(byKeys);
  useEffect(() => {
    if (asking) return;
    const t = setTimeout(() => setAsking(true), LINGER);
    return () => clearTimeout(t);
  }, [asking]);
  const theirs = useQuery({ ...noteQueries.notes(undefined, undefined, person.email), enabled: asking, placeholderData: () => undefined }).data ?? [];
  // The search lists their notes newest first, and each note's lines as they were said.
  const latest = theirs.flatMap((n) => byTime(n.said).map((l) => ({ key: `${n.id}:${l.id}`, call: n.title, time: position(l.at), text: l.text }))).slice(0, LATEST);
  return (
    <PalettePreview actions={(
      <>
        <Button variant="primary" size="sm" kb="↵" onClick={() => onPick(person)}>What {first} said</Button>
        <Link to="/calls" hash={`with=${encodeURIComponent(person.email)}`} hashScrollIntoView={false} className={buttonClass({ size: 'sm' })} onClick={onOpen}>Calls with {first}</Link>
      </>
    )}>
      <PalettePersonPreview person={person} title={someone.title ?? person.email} saidLabel={`Latest from ${first}`} said={latest}
        meta={someone.last ? `${together(someone)}, most recently ${pastDay(someone.last)}` : together(someone)} />
    </PalettePreview>
  );
}

/** A note: when, who, its summary and what's waiting in it. `enter`: Enter opens it (not so on More, which opens the rest in place). */
function NotePreview({ note: n, enter, me, toConfirm, onOpen }: PreviewProps & { note: NoteFound; enter: boolean }) {
  const note = useQuery({ ...noteQueries.note(n.id), retry: unlessGone }).data;
  return (
    <PalettePreview actions={(
      <Link to="/calls/$noteId" params={{ noteId: n.id }} className={buttonClass({ variant: enter ? 'primary' : 'secondary', size: 'sm' })} onClick={onOpen}>
        Open notes{enter && <span className="kb">↵</span>}
      </Link>
    )}>
      <PalettePreviewHead title={n.title} meta={when(n)} people={othersIn(n.people, me)} />
      <PaletteSummary confirm={toConfirm(n.id)} followUps={n.openActions}>{note?.summary.trim() || n.excerpt || noSummary(n)}</PaletteSummary>
    </PalettePreview>
  );
}
