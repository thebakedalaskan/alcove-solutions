import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_SOUND_PREFERENCES } from '@alcove/api';
/*
 * The demo world: everything the stand-in API serves, in the contract's own types. A scenario (src/api/scenarios.ts) makes
 * one for each story, which the story can change as it's clicked through: confirming a decision changes the note here, and
 * every page reads it from here again.
 */
import type {
  Calendar, DocRefusal, DocumentLibrary, FeatureFlagName, IncomingRing, Meeting, MentionNotice, MoveIn, MoveMedia, Note, NoteLink, Person, PersonalEntry, Plan, Preferences, Session, ShareEntry, Team,
  WorkspaceMedia, WorkspaceSummary, WorkspaceTree
} from '@alcove/api';
import type { PaymentsWorld } from './payments';
import type { TeamInviteWorld, TeamWorld } from './teams';
import type { DriveWorld } from './drive-exports';
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
/** Someone else writing in a page as the story opens: who, and the words their caret is just after (src/api/writers.ts). */
export interface PageWriter { who: Person; after: string }
export interface Page {
  blocks: BlockJSON[]; threads?: PageThread[] | undefined; refused?: Refused | undefined; versions?: PageVersion[] | undefined;
  /** How it stands for this browser as it opens: its stream can't reach Alcove (`offline`), until Try now, online, brings it back. */
  standing?: 'offline' | undefined;
  /** Who else is writing in it, each with their caret on the page. */
  here?: PageWriter[] | undefined;
}

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
/**
 * A workspace as the world keeps it: its tree, and what the Drive says of it besides (when it was made, and its call), who's in
 * it besides you (`members`, or else everyone on the team who's on Alcove), the line on what it's for (`about`), and who pays
 * for it, where a story says (`paidBy`): its files count against their storage, so a call someone else organizes opens it only
 * to its own people. Without it, whoever organizes the call it's in is taken to pay, as for a call's home.
 */
export type Space = WorkspaceTree & Pick<WorkspaceSummary, 'createdAt' | 'call'> & { members?: Person[] | undefined; about?: string | undefined; paidBy?: Person | undefined };
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
  drive: DriveWorld;
  payments: PaymentsWorld;
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
  /** The plan Art is on, and what's left of it (src/world/plans.ts). */
  plan: Plan;
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
  /** The team you're on (src/world/teams.ts), if any: not `team`, which is your company's directory. */
  myTeam?: TeamWorld | null | undefined;
  /** Links to join a team that still work, by their secret. */
  teamInvites?: TeamInviteWorld[] | undefined;
  /** The feature flags on for whoever's here. None unless a scenario switches one on. */
  featureFlags?: FeatureFlagName[] | undefined;
  /** Links to notes that still work, with their secrets: none unless a story makes one. */
  noteLinks?: NoteLinkSpec[] | undefined;
  /**
   * Workspaces whose own stream can't reach Alcove as the story opens, though the browser's online, by ID: their list says
   * Reconnecting until Try now brings it back.
   */
  streamsDown?: string[] | undefined;
}

/**
 * A link to someone's notes: what everyone with them sees of it, its secret, and the note it's to. `note` is the note as
 * it would be yours, for a link to notes you don't have yet: opening the link puts it in your notes.
 */
export interface NoteLinkSpec { link: NoteLink; noteId: string; secret: string; note?: Note | undefined }

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
  sounds: DEFAULT_SOUND_PREFERENCES,
  notesDefault: 'on', notesLanguage: 'call', addToCalendar: true, showOtherMeetings: true, showSoloEvents: false, recordOffline: true,
  notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: true, beforeCall: 1, followUpDue: true },
  pinned: [], groups: [], model: null, notificationsPausedUntil: null
};
