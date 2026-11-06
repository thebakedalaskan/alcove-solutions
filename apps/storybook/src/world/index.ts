/*
 * The demo world: everything the stand-in API serves, in the contract's own types. A scenario (src/api/scenarios.ts) makes
 * one for each story, which the story can change as it's clicked through: confirming a decision changes the note here, and
 * every page reads it from here again.
 */
import type {
  Calendar, CreditBalance, DocRefusal, DocumentLibrary, IncomingRing, Meeting, MentionNotice, MoveIn, MoveMedia, Note, Person, PersonalEntry, Preferences, Session, ShareEntry, Team,
  WorkspaceMedia, WorkspaceSummary, WorkspaceTree
} from '@alcove/api';
import type * as Y from 'yjs';
import type { BlockJSON } from '~/features/workspace/editor/types';
import type { Troubles } from '../api/trouble';
import type { BrowserSetup } from '../browser';
import { ART, ME_ID } from './people';
import { iso } from './clock';

/** Words this browser wrote in a document that Alcove wouldn't take, as the story opens: on its page, and nowhere else. */
export interface Refused { why: Exclude<DocRefusal, 'trashed'>; words: string[] }
/**
 * A comment thread on a page: the words it hangs on (a `comment` mark with its `id`, in the block at index `on`) and what's
 * been said, the oldest first.
 */
export interface PageThread { id: string; on: number; quote: string; says: { who: Person; text: string; hoursAgo: number }[] }
/**
 * What a document says, in the editor's own blocks under its title; its comment threads; and what of it Alcove refused, if
 * anything. A tag on a page names someone by address (`@` and it, as a mention's `id`): the stand-in writes in the ID they
 * have in the document's workspace, as the app would.
 */
/**
 * A version History lists: when it was kept, who'd changed the page since the one before, and the call it was kept in, by
 * the call's ID, or null outside calls. What it says is what the page says.
 */
export interface PageVersion { at: string; by: Person[]; call: string | null; reason: 'edits' | 'call' }
export interface Page { blocks: BlockJSON[]; threads?: PageThread[] | undefined; refused?: Refused | undefined; versions?: PageVersion[] | undefined }

/**
 * A board as the story opens: what's on it (drawn with @alcove/board's own writers), who else has it open and where their
 * pointer is, and how it stands for this browser: no connection (`offline`), Alcove refusing what was added here (`failed`),
 * or taken from under you while it's open (`gone`).
 */
export interface BoardSpec {
  draw?: ((doc: Y.Doc) => void) | undefined;
  here?: { who: Person; x: number; y: number }[] | undefined;
  standing?: 'offline' | 'failed' | 'gone' | undefined;
}
/** A workspace as the world keeps it: its tree, and what the Drive says of it besides (when it was made, and its call). */
export type Space = WorkspaceTree & Pick<WorkspaceSummary, 'createdAt' | 'call'>;
/**
 * A file in a workspace: what the API says of it, and its bytes, made when they're first read (a picture is drawn). A photo
 * uploaded here keeps the small preview its browser made, as the API does; one the story starts with has none, as a photo
 * from before previews hasn't, so the picker makes its own.
 */
export interface Kept { workspace: string; media: WorkspaceMedia; body: () => Promise<Blob>; preview?: Blob | undefined }

/** A call on its way here from another device: the claim this device holds it by, and the move as it sees it. */
export interface MoveSpec {
  /** 22 letters, digits, `-` or `_`, as a claim is. */
  claim: string;
  title: string;
  organizerName: string;
  you: MoveIn['you'];
  /** The microphone and camera as they were on the other device. */
  media: MoveMedia;
  /** How long it has left before it runs out, in seconds: none, and it ran out already. */
  seconds?: number | undefined;
}

/**
 * A file in a workspace: what the API says of it, and its bytes, made when they're first read (a picture is drawn). A photo
 * uploaded here keeps the small preview its browser made, as the API does; one the story starts with has none, as a photo
 * from before previews hasn't, so the picker makes its own.
 */
export interface Kept { workspace: string; media: WorkspaceMedia; body: () => Promise<Blob>; preview?: Blob | undefined }

export interface World {
  /** Who's signed in, or nobody. */
  session: Session | null;
  prefs: Preferences;
  /** Your company, or null for someone on their own. */
  team: Team | null;
  /** Every note you have, newest first. */
  notes: Note[];
  /** Your own notes on a note, by its ID. */
  personal: Record<string, PersonalEntry[]>;
  /** Every Alcove call: the ones to come, and the ones that happened. */
  meetings: Meeting[];
  calendar: Calendar;
  credits: CreditBalance;
  documents: DocumentLibrary;
  /** The workspaces you're in, each with everything in it you can open, and what your Drive says of it. */
  workspaces: Space[];
  /** What each document says, by its ID. One without a page here is new: a title, and an empty line under it. */
  pages: Record<string, Page>;
  /** Who each document is shared with besides its workspace's own people, by its ID. */
  shares: Record<string, ShareEntry[]>;
  /** What each board holds and who's on it, by its ID. One without one here is blank. */
  boards: Record<string, BoardSpec>;
  /** Where you've been tagged and haven't said you've seen it, the newest first. */
  mentions: MentionNotice[];
  /** The files in your workspaces' documents. */
  media: Kept[];
  /** Who's ringing you as the story opens. */
  rings: IncomingRing[];
  /** A note being written: how long until it's done, and what it says then. */
  writing: { id: string; seconds: number; written: () => Note } | null;
  /** What goes wrong when the app asks for something: a part of Alcove that fails, can't be reached, or keeps it waiting. */
  trouble?: Troubles | undefined;
  /** A call being moved to this device, which this browser holds the claim to (/move). */
  move?: MoveSpec | undefined;
}

/** How a story's page opens: when on the demo day, what the browser is like, and what it remembers. */
export interface Opening {
  /** The moment the story starts at, on the demo clock. */
  now: Date;
  browser: Partial<BrowserSetup>;
  /** This browser remembers being signed in, so Alcove opens without a connection. */
  signedInHere: boolean;
  /** The tour of Home has been seen on this browser. */
  tourSeen: boolean;
  /** How long the stand-in takes to answer, in ms. */
  latency: number;
}

export const session = (over: Partial<Session> = {}): Session => ({
  user: ART, ownerId: ME_ID, provider: 'google', sample: false, sharedDemo: false, createdAt: iso(-40, 9, 0), expiresAt: iso(14, 9, 0), ...over
});

export const PREFS: Preferences = {
  notesDefault: 'on', notesLanguage: 'call', summaryLength: 'short', addToCalendar: true, showOtherMeetings: true, recordOffline: true,
  notifications: { beforeCall: 1, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: true, tagged: true },
  pinned: [], groups: []
};

/** Ten hours of notes this month: 3 h 34 min used, 6 h 26 min left, as the side panel and Settings say on the canvas. */
export const CREDITS: CreditBalance = { balance: 9650, granted: 15000, usedThisMonth: 5350, perMinute: 25 };
/** A new account's 10,000 credits, none used. */
export const WELCOME_CREDITS: CreditBalance = { balance: 10000, granted: 10000, usedThisMonth: 0, perMinute: 25 };
