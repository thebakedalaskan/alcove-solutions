/* Query keys, fetchers and mutations. Screens read data through these, never through `api` directly. */
import type { AgentDecisionInput, AgentTokenInput, AgentUpdateInput, Attestation, Calendar, DriveExportInput, FollowUpReview, Trust } from '@alcove/api';
import { AlcoveApiError, MAX_SORT_STICKIES, MAX_SORT_STICKY, SORT_TOO_FEW, SORT_TOO_MANY, errorCode, type ActionProposal, type ChangeScope, type DecisionProposal, type DemoProvider, type DocumentRole, type FeatureFlagName, type Group, type PresenterFrameNotes, type InstantCallInput, type ISODate, type ItemInput, type ItemPlace, type LinePatch, type MeetingInput, type MentionBody, type NoteKind, type NotesSetting, type Patch, type PersonalInput, type PersonalNotes, type PromoteBody, type QuestionPatch, type TopUp, type RingReply, type Series, type SharedWrite, type ShareTarget, type DocumentLibrary, type WorkspaceRole, type WorkspaceSummary, type WorkspaceTree } from '@alcove/api';
import { infiniteQueryOptions, queryOptions, useIsMutating, useMutation, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { forgetAccount } from '~/features/record/offline';
import { forgetNotified } from '~/features/shell/notified';
import { announceMentionsRead } from '~/features/shell/attentionChannel';
import { forgetEdits } from '~/features/workspace/keep';
import { forgetPictures, readSessionWithPictureAccess } from '~/features/call/media/backgrounds/backgrounds';
import { forgetPlaces } from '~/features/workspace/places';
import { forgetWords } from '~/features/workspace/words';
import { accountGeneration, announceSignIn, announceSignOut } from './signedOut';
import { announceNotificationPreferences, settleNotificationPreferences } from './notification-preference-channel';
import { api, checkServer } from './api';
import { log } from './log';
import { weekOn } from './time';
import { openGoogleSignIn, waitForGoogleReturn } from './googleSignIn';
import { answerCallOptions, preferenceOptions, readMeeting, readPreferences, readWorkspaces, readNote, readInbox, refreshChangedNote, renameWorkspaceOptions, updateActionOptions, updateDecisionOptions, type PreferenceChange } from './queryWrites';
import type { CalendarRange, CallAheadMake, ProposalAnswer } from '@alcove/api';

export const qk = {
  drive: ['google-drive'] as const,
  driveFolders: ['google-drive', 'folders'] as const,
  driveJobs: ['google-drive', 'jobs'] as const,
  driveNote: (id: string) => ['google-drive', 'note', id] as const,
  agents: ['agents'] as const,
  /** What your agents did: a list of its own, read again only when it changes (disconnecting deletes what an agent did). */
  agentActivity: ['agent-activity'] as const,
  agentEndpoint: ['agent-endpoint'] as const,
  agentAuthorization: (id: string, ownerId: string) => ['agent-authorization', id, ownerId] as const,
  session: ['session'] as const,
  prefs: ['prefs'] as const,
  team: ['team'] as const,
  workspaces: ['workspaces'] as const,
  people: (query: string) => ['people', query] as const,
  meetings: ['meetings'] as const,
  upcoming: ['meetings', 'upcoming'] as const,
  byCode: (code: string) => ['meetings', 'code', code] as const,
  card: (code: string) => ['calls', 'card', code] as const,
  calendar: ['meetings', 'calendar'] as const,
  meeting: (id: string) => ['meetings', 'one', id] as const,
  busy: (emails: readonly string[], from: ISODate, to: ISODate) => ['meetings', 'busy', from, to, ...emails] as const,
  documents: ['documents'] as const,
  notes: ['notes'] as const,
  /** A list of notes, or a search of them: its words, and whose lines it looks in (`by`, an address, which stays in memory). */
  noteList: (kind?: NoteKind, text?: string, by?: string) => ['notes', 'list', kind ?? 'all', text ?? '', by?.toLowerCase() ?? ''] as const,
  note: (id: string) => ['notes', 'one', id] as const,
  /** Your own notes on a note: never anyone else's, so nothing here is ever shown to someone who signs in after you (signing in starts the cache over). */
  personal: (id: string) => ['notes', 'personal', id] as const,
  addition: (id: string, entryId: string) => ['notes', 'addition', id, entryId] as const,
  sharedAudience: (id: string) => ['notes', 'shared-audience', id] as const,
  noteLinks: (id: string) => ['notes', 'links', id] as const,
  inbox: ['notes', 'inbox'] as const,
  /** Everything about series: what carries over changes whenever a note or a call in one does. */
  allSeries: ['series'] as const,
  series: (id: string) => ['series', id] as const,
  callSeries: (code: string) => ['series', 'call', code] as const,
  balance: ['credits'] as const,
  topUpRoutes: ['top-ups', 'routes'] as const,
  topUps: ['top-ups', 'list'] as const,
  topUp: (id: string) => ['top-ups', 'one', id] as const,
  trust: ['trust'] as const,
  featureFlags: ['feature-flags'] as const,
  workspacePeople: (id: string) => ['workspaces', id, 'people'] as const,
  personIds: (id: string, emails: readonly string[]) => ['workspaces', id, 'ids', ...emails] as const,
  workspaceMedia: (id: string) => ['workspaces', id, 'media'] as const,
  mentions: ['workspaces', 'mentions'] as const,
  documentShare: (id: string, documentId: string) => ['workspaces', id, 'share', documentId] as const,
  documentVersions: (id: string, documentId: string) => ['workspaces', id, 'versions', documentId] as const,
  documentVersion: (id: string, documentId: string, version: string) => ['workspaces', id, 'versions', documentId, version] as const,
  /** Your own notes beside a board's frames: never anyone else's, and gone with the cache when someone else signs in. */
  presenterFrameNotes: (id: string, boardId: string) => ['workspaces', id, 'presenter-notes', boardId, 'frames'] as const,
  workspaceItem: (id: string, itemId: string) => ['workspaces', id, 'items', itemId] as const,
  workspaceTree: (id: string) => ['workspaces', id, 'tree'] as const,
  boardsToBring: ['workspaces', 'boards'] as const,
  visionModels: ['models', 'vision'] as const,

  calendarRange: (from: ISODate, to: ISODate) => ['meetings', 'calendar', from, to] as const,

  /** What documents say at the top, for the Drive's cards: the IDs asked about, in the order asked. */
  previews: (id: string, ids: readonly string[]) => ['workspaces', id, 'previews', ...ids] as const,
  /** What's in Trash in every workspace, for the Drive's Trash. */
  trashed: ['workspaces', 'trashed'] as const,

  /** What the documents on a workspace's Home say at the top, for their cards. */
  workspacePreviews: (id: string, items: readonly string[]) => ['workspaces', id, 'previews', items.join(',')] as const,
  /** The line on what a workspace is for. */
  workspaceAbout: (id: string) => ['workspaces', id, 'about'] as const,
};

/**
 * Whether a list of notes' key (`qk.noteList`) is a search: it has words, or someone whose lines it looks in. The plain
 * list of your notes isn't one, so it's never what a search shows while its answer is on the way.
 */
export const isNoteSearch = (key: ReturnType<typeof qk.noteList>): boolean => key[3] !== '' || key[4] !== '';

/** A saved board someone could bring to a call: where it is, what it's called, whose it is, and when it was last changed. */
export interface BoardToBring { workspaceId: string; workspace: string | null; id: string; name: string; by: string | null; editedAt: ISODate }
/** How many of the newest workspaces the board picker looks in: a call's home is new, so what a team has is across the Drive. */
const BOARD_SPACES = 12;
/**
 * Every board you could bring from the newest of `spaces` (your Drive, as `q.workspaces` lists it), the most recently changed
 * first. One that can't be read now is left out.
 */
async function boardsToBring(spaces: readonly WorkspaceSummary[]): Promise<BoardToBring[]> {
  const trees = await Promise.all(spaces.slice(0, BOARD_SPACES).map((w) => api.workspaces.get(w.id).catch((e: unknown) => {
    log.child({ component: 'boards' }).info('a workspace’s boards couldn’t be read for the board picker', { workspaceId: w.id, code: errorCode(e) });
    return null;
  })));
  return trees.flatMap((t) => (t ? t.items.flatMap((i): BoardToBring[] => (i.kind === 'board' && i.trashedAt === null && i.role === 'edit'
    ? [{ workspaceId: t.id, workspace: t.name, id: i.id, name: i.name, by: i.by?.name ?? null, editedAt: i.editedAt }] : [])) : []))
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
}

const trustLog = log.child({ component: 'trust' });
/** Why a server that couldn't be asked isn't verified: whatever it said before no longer counts. */
const UNASKED = 'Alcove’s server couldn’t be asked what it runs on.';
/** What the API says it runs on, asked twice before giving up, a second apart: one dropped request doesn't count against it. */
async function attestation(): Promise<Attestation | undefined> {
  for (let tries = 1; ; tries++) {
    try {
      return await api.trust.attestation();
    } catch (e) {
      if (tries >= 2) {
        trustLog.warn('the server couldn’t be asked what it runs on', { code: errorCode(e) });
        return undefined;
      }
      await new Promise((go) => { setTimeout(go, 1000); });
    }
  }
}
/**
 * What the API says it runs on, checked in this browser (`checkServer`: its token, then its release in Sigstore's public
 * log, as the server hands it on). A check that doesn't pass blocks nothing; it's logged with its reason, so the server's log
 * shows it too. A server that can't be asked isn't verified, so a check that passed before never stays on screen for it.
 */
async function checkTrust(): Promise<Trust> {
  const a = await attestation();
  if (!a) return { state: 'unverified', reason: UNASKED, commit: 'unknown', at: Date.now() };
  const t = await checkServer(a);
  if (t.state === 'unverified') trustLog.warn('the server’s attestation didn’t check out', { reason: t.reason, commit: t.commit, digest: t.digest ?? null });
  return t;
}
/** When this browser's check of the server passed, or null: only then is it verified. */
export const verifiedAt = (t: Trust | undefined): number | null => (t?.state === 'verified' ? t.at : null);
/** Why this browser's check of a server in a TEE didn't pass, or null: it passed, it's still to come, or there's no TEE. */
export const unverifiedBecause = (t: Trust | undefined): string | null => (t?.state === 'unverified' ? `Not verified. ${t.reason}` : null);
/**
 * The promise in the product's own words, verified only when this browser's check of the server passes. No caveats
 * (docs/design/principles.md › Copy): the engineering docs say what's built, and a check that fails says why only where
 * the check's details are (`unverifiedBecause`).
 */
export const trustLine = (t: Trust | undefined): string => (verifiedAt(t) === null ? 'Confidential compute' : 'Confidential compute · verified');

/** How much of what your agents did a page of it holds, and where the first page starts (nowhere before it). */
const ACTIVITY_PAGE = 12;
const newest = (): string | null => null;

/** Whether money can still arrive for a top-up: it's waiting, arriving or short. */
export const topUpOpen = (t: TopUp): boolean => t.state === 'waiting' || t.state === 'arriving' || t.state === 'short';

/** The top-ups list's key, carrying its type, for reading what it held before. */
const topUpsKey = queryOptions({ queryKey: qk.topUps, queryFn: (): Promise<TopUp[]> => api.credits.topUps() }).queryKey;

export const q = {
  drive: () => queryOptions({ queryKey: qk.drive, queryFn: () => api.drive.get(), retry: false }),
  driveFolders: () => queryOptions({ queryKey: qk.driveFolders, queryFn: () => api.drive.folders(), staleTime: 0, retry: false }),
  driveJobs: () => queryOptions({ queryKey: qk.driveJobs, queryFn: () => api.drive.jobs(), refetchInterval: 10_000, retry: false }),
  // Read again every 10 s, and every 2 s while a file is on its way, so a press shows Uploading, then its link, within seconds.
  driveNote: (id: string) => queryOptions({
    queryKey: qk.driveNote(id), queryFn: () => api.drive.forNote(id), retry: false,
    refetchInterval: (query) => (query.state.data?.jobs.some((job) => job.status === 'uploading' || (job.status === 'pending' && job.reason === null)) ? 2_000 : 10_000)
  }),
  agents: () => queryOptions({ queryKey: qk.agents, queryFn: () => api.agents.list() }),
  /**
   * What your agents did, newest first, a page at a time: Show more reads the page after the last one. Read again every
   * minute while only the first page is open; once more are, reading again would read them all, so it waits to be asked.
   */
  agentActivity: () => infiniteQueryOptions({
    queryKey: qk.agentActivity,
    queryFn: ({ pageParam }) => api.agents.activity(pageParam === null ? { limit: ACTIVITY_PAGE } : { limit: ACTIVITY_PAGE, before: pageParam }),
    initialPageParam: newest(),
    getNextPageParam: (page) => page.next,
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 1) > 1 ? false : 60_000)
  }),
  /** The MCP address agents connect to: it stays the same while the app is open. */
  agentEndpoint: () => queryOptions({ queryKey: qk.agentEndpoint, queryFn: () => api.agents.endpoint(), staleTime: Infinity }),
  agentAuthorization: (id: string, ownerId: string) => queryOptions({ queryKey: qk.agentAuthorization(id, ownerId), queryFn: () => api.agents.authorization(id), retry: false, staleTime: 0 }),
  session: () => queryOptions({ queryKey: qk.session, queryFn: () => readSessionWithPictureAccess(() => api.auth.getSession()), staleTime: 60_000 }),
  prefs: () => queryOptions({ queryKey: qk.prefs, queryFn: ({ client }) => readPreferences(api, client), refetchInterval: 30_000, refetchIntervalInBackground: true }),
  team: () => queryOptions({ queryKey: qk.team, queryFn: () => api.people.team(), staleTime: 5 * 60_000 }),
  workspaces: () => queryOptions({ queryKey: qk.workspaces, queryFn: ({ client }) => readWorkspaces(api, client) }),
  people: (query: string) => queryOptions({ queryKey: qk.people(query), queryFn: () => api.people.search(query), staleTime: 30_000, placeholderData: (prev) => prev }),
  upcoming: () => queryOptions({ queryKey: qk.upcoming, queryFn: () => api.meetings.upcoming(), refetchInterval: 60_000 }),
  byCode: (code: string) => queryOptions({ queryKey: qk.byCode(code), queryFn: () => api.meetings.byCode(code) }),
  /**
   * A call link's title and organizer, what the call captures and whether it can be joined yet, for anyone (no
   * account needed), and for someone signed in where they stand (signing in starts the cache over, so it's read again).
   * Read again every 3 to 5 seconds while waiting for the organizer, so joining opens soon after they arrive, and now
   * and then after that (capture changing, a lock); a little apart, so many people waiting don't read it in step. After
   * a refusal (too many reads from one address) or a failed read it waits 20 seconds or more; a code that leads nowhere
   * isn't asked again.
   */
  card: (code: string) => queryOptions({
    queryKey: qk.card(code), queryFn: () => api.calls.card(code),
    refetchInterval: (query) => {
      const failed = query.state.error ? errorCode(query.state.error) : null;
      if (failed === 'not-found') return false;
      const d = query.state.data;
      const base = failed ? 20_000 : d?.ended ? 30_000 : d?.hostHere ? 10_000 : 3_000;
      // How far apart from other browsers, by the milliseconds of when this one last heard back. It's asked for on every
      // render and must stay the same until the next answer: a new value restarts the wait, so a random one never ends.
      const apart = ((query.state.dataUpdatedAt + query.state.errorUpdatedAt) % 997) / 997;
      return Math.round(base * (1 + apart / 1.5));
    }
  }),
  /** Someone's other calendar events; refreshed every few minutes, since they change outside Alcove. */
  calendar: () => queryOptions({ queryKey: qk.calendar, queryFn: () => api.calendar.get(), staleTime: 60_000, refetchInterval: 3 * 60_000, retry: false }),
  /**
   * Your notes, newest first, or what a search finds: notes with the words, and the lines that have them. `by` is someone's
   * address: only what they said counts. The words and the address travel in the request's body, never its address.
   */
  notes: (kind?: NoteKind, text?: string, by?: string) => queryOptions({ queryKey: qk.noteList(kind, text, by), queryFn: () => api.notes.list({ kind, text, by }), placeholderData: (prev) => prev }),
  note: (id: string) => queryOptions({ queryKey: qk.note(id), queryFn: ({ client }) => readNote(api, client, id) }),
  personal: (id: string) => queryOptions({ queryKey: qk.personal(id), queryFn: () => api.notes.personal(id).get(), retry: false }),
  /** What adding an entry to the shared notes would do, read fresh each time it's opened: the people who'd get it can change. */
  addition: (id: string, entryId: string) => queryOptions({ queryKey: qk.addition(id, entryId), queryFn: () => api.notes.previewAddition(id, entryId), staleTime: 0, gcTime: 0, retry: false }),
  /** Who reads what's written straight into the shared notes, and the seal that holds it to them: read fresh each time the box shows. */
  sharedAudience: (id: string) => queryOptions({ queryKey: qk.sharedAudience(id), queryFn: () => api.notes.sharedAudience(id), staleTime: 0, gcTime: 0, retry: false }),
  /** The links to a note that still work, read fresh whenever Share opens. */
  noteLinks: (id: string) => queryOptions({ queryKey: qk.noteLinks(id), queryFn: () => api.notes.links(id), staleTime: 0, retry: false }),
  inbox: () => queryOptions({ queryKey: qk.inbox, queryFn: ({ client }) => readInbox(api, client) }),
  /** What carries over in a series, from the notes you have; put together fresh each time it's asked for. */
  series: (id: string) => queryOptions({ queryKey: qk.series(id), queryFn: () => api.series.get(id), retry: false }),
  /**
   * What carries over into a call, for someone signed in, by its link: null when nothing can. Read again every minute
   * while it's on screen, and whenever the page comes back into view: a note someone stops having goes from here too,
   * however long the call has been open. A session that ended elsewhere is just another way of having nothing here:
   * thrown, it would send them out of their call to sign in, and a call doesn't need one.
   */
  callSeries: (code: string) => queryOptions({
    queryKey: qk.callSeries(code),
    queryFn: () => api.calls.series(code).catch((e: unknown) => { if (errorCode(e) === 'unauthenticated') return null; throw e; }),
    retry: false, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true
  }),
  balance: () => queryOptions({ queryKey: qk.balance, queryFn: () => api.credits.balance() }),
  /**
   * The ways to pay for credits. A server that can't take payments answers unavailable: nothing says so, the way to
   * add credits just isn't there, and it isn't asked again for a while.
   */
  topUpRoutes: () => queryOptions({ queryKey: qk.topUpRoutes, queryFn: () => api.credits.routes(), staleTime: 10 * 60_000, retry: false }),
  /**
   * Top-ups still open, and the last few finished; read again every 30 seconds while one is open, so a payment that
   * settles with the sheet closed shows on Plan and credits. A server that can't take payments answers unavailable:
   * there's nothing to show.
   */
  topUps: () => queryOptions({
    queryKey: qk.topUps,
    queryFn: async ({ client }) => {
      const was = client.getQueryData(topUpsKey)?.filter(topUpOpen) ?? [];
      const list = await api.credits.topUps();
      // One that was on its way has been credited since: the balance catches up.
      if (list.some((t) => t.state === 'credited' && was.some((w) => w.id === t.id))) void client.invalidateQueries({ queryKey: qk.balance });
      return list;
    },
    refetchInterval: (query) => (query.state.data?.some(topUpOpen) ? 30_000 : false),
    retry: false
  }),
  /**
   * One top-up, read again every 5 seconds while money can still arrive. Once it has finished, the list catches up,
   * and the balance too when credits were added.
   */
  topUp: (id: string) => queryOptions({
    queryKey: qk.topUp(id),
    queryFn: async ({ client }) => {
      const t = await api.credits.topUp(id);
      if (!topUpOpen(t)) void client.invalidateQueries({ queryKey: qk.topUps });
      if (t.state === 'credited') void client.invalidateQueries({ queryKey: qk.balance });
      return t;
    },
    refetchInterval: (query) => (query.state.data && topUpOpen(query.state.data) ? 5000 : false)
  }),
  /** Checked when the app opens (the side panel and the call both show it), then every ten minutes. */
  trust: () => queryOptions({ queryKey: qk.trust, queryFn: checkTrust, staleTime: 10 * 60_000, refetchInterval: 10 * 60_000 }),
  /** The feature flags on for whoever's here. Signing in or out clears the cache, so they're asked again for the new session. */
  featureFlags: () => queryOptions({ queryKey: qk.featureFlags, queryFn: () => api.featureFlags.on(), staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true }),

  /* Starting and scheduling calls. */
  /** One call as it is now, for its card: the answers people have given change while it's open. */
  meeting: (id: string) => queryOptions({ queryKey: qk.meeting(id), queryFn: ({ client }) => readMeeting(api, client, id), retry: false }),
  /** When you and these people are busy. Nothing is kept: it's read when it's asked for, and a failed read is said plainly, not retried. */
  busy: (emails: readonly string[], range: { from: ISODate; to: ISODate }) => queryOptions({
    queryKey: qk.busy(emails, range.from, range.to), queryFn: () => api.calendar.busy([...emails], range), staleTime: 60_000, retry: false
  }),
  /** What you can bring to a call. */
  documents: () => queryOptions({ queryKey: qk.documents, queryFn: () => api.documents.list(), staleTime: 60_000, retry: false }),
  /** Who's in a workspace, for anyone in it. */
  workspacePeople: (id: string) => queryOptions({ queryKey: qk.workspacePeople(id), queryFn: () => api.workspaces.people(id) }),
  /** The IDs a workspace's documents know these people by (features/workspace/ids.ts). An ID never changes. */
  personIds: (id: string, emails: readonly string[], pass?: string | undefined) => queryOptions({ queryKey: qk.personIds(id, emails), queryFn: () => api.workspaces.ids(id, [...emails], pass ? { pass } : undefined), staleTime: Infinity }),
  /** What you've been tagged in and haven't seen, anywhere. */
  mentions: () => queryOptions({ queryKey: qk.mentions, queryFn: () => api.workspaces.mentions() }),
  /** The tab indicator never uses a previous account's cached notices or a result arriving after a switch. */
  attentionMentions: (owner: string) => queryOptions({
    queryKey: [...qk.mentions, owner],
    queryFn: async () => {
      if ((await api.auth.getSession())?.ownerId !== owner) return [];
      const notices = await api.workspaces.mentions();
      return (await api.auth.getSession())?.ownerId === owner ? notices : [];
    },
    retry: false, refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 0
  }),
  /** Who has a document, for the Share sheet. Someone else may have changed it, so it's read each time the sheet opens. */
  documentShare: (id: string, documentId: string, pass?: string | undefined) => queryOptions({ queryKey: qk.documentShare(id, documentId), queryFn: () => api.workspaces.share.list(id, documentId, pass ? { pass } : undefined), staleTime: 0 }),
  /** What History lists, read afresh each time it opens. `pass`: a guest's. */
  documentVersions: (id: string, documentId: string, pass?: string | undefined) => queryOptions({ queryKey: qk.documentVersions(id, documentId), queryFn: () => api.workspaces.versions(id, documentId, pass ? { pass } : undefined), staleTime: 0 }),
  /** A version never changes, so what's read stays good for as long as it's being looked at, and goes soon after. */
  documentVersion: (id: string, documentId: string, version: string, pass?: string | undefined) => queryOptions({ queryKey: qk.documentVersion(id, documentId, version), queryFn: () => api.workspaces.version(id, documentId, version, pass ? { pass } : undefined), staleTime: Infinity, gcTime: 60_000 }),
  /** Your notes beside each frame of a board, by frame. */
  presenterFrameNotes: (id: string, boardId: string, pass?: string | undefined) => queryOptions({ queryKey: qk.presenterFrameNotes(id, boardId), queryFn: () => api.workspaces.presenterNotes.frames(id, boardId, pass ? { pass } : undefined), staleTime: Infinity }),
  /** One document or folder as you see it: what it's called now, and what you can do with it. */
  workspaceItem: (id: string, itemId: string) => queryOptions({ queryKey: qk.workspaceItem(id, itemId), queryFn: () => api.workspaces.items.get(id, itemId), retry: false }),
  /**
   * A workspace as you see it: what's in it that you can open, by your own name for each. What a board links to is named from
   * it, and what you can link to is listed from it. Someone else may rename or move something, so it's good for half a minute.
   * `pass`: in a call, the call's.
   */
  workspaceTree: (id: string, pass?: string | undefined) => queryOptions({ queryKey: qk.workspaceTree(id), queryFn: () => api.workspaces.get(id, pass ? { pass } : undefined), staleTime: 30_000, retry: false }),
  /**
   * Every file you can reach in a workspace, the newest first, with the documents you reach each through: what the picker
   * offers to reuse, and how a file block knows its file was deleted for good. A guest reads it with their pass.
   */
  workspaceMedia: (id: string, pass?: string | undefined) => queryOptions({ queryKey: qk.workspaceMedia(id), queryFn: () => api.workspaces.media.list(id, { pass }), staleTime: 30_000 }),
  /**
   * The boards the board picker offers to bring from `spaces`, your Drive's workspaces as `workspaces` reads them: the boards in
   * the newest, read as it opens, and good for half a minute.
   */
  boardsToBring: (spaces: readonly WorkspaceSummary[]) => queryOptions({
    queryKey: [...qk.boardsToBring, spaces.slice(0, BOARD_SPACES).map((w) => w.id).join(' ')], queryFn: () => boardsToBring(spaces), staleTime: 30_000
  }),

  /** Your other calendar events between two times, at most 31 days apart: any week the Calls page or scheduling shows. */
  calendarRange: (range: CalendarRange) => queryOptions({
    queryKey: qk.calendarRange(range.from, range.to), queryFn: () => api.calendar.get(range), staleTime: 60_000, retry: false, placeholderData: (prev) => prev
  }),

  /** What documents say at the top, for their cards in the Drive: read from each as it is, and kept only in this tab's memory. */
  previews: (id: string, ids: readonly string[]) => queryOptions({ queryKey: qk.previews(id, ids), queryFn: () => api.workspaces.previews(id, [...ids]), staleTime: 30_000, enabled: ids.length > 0 }),
  /** One Trash for every workspace you can open something in. */
  trashed: () => queryOptions({ queryKey: qk.trashed, queryFn: () => api.workspaces.trashed() }),

  /** Read from each document as it is, for whoever can open it: a few at a time, for the cards on a workspace's Home. */
  workspacePreviews: (id: string, items: readonly string[]) => queryOptions({ queryKey: qk.workspacePreviews(id, items), queryFn: () => api.workspaces.previews(id, [...items]), staleTime: 30_000 }),
  workspaceAbout: (id: string) => queryOptions({ queryKey: qk.workspaceAbout(id), queryFn: () => api.workspaces.about(id) }),
};

/**
 * Whether a feature flag is on for whoever's here: undefined until the server has said, so a flagged page or control waits
 * rather than showing and then vanishing (docs: engineering/feature-flags.md). If it can't say, the flag is off, so nothing
 * waits for good; the next refresh asks again. The server checks it too.
 */
export function useFeatureFlag(name: FeatureFlagName): boolean | undefined {
  const { data, isError } = useQuery(q.featureFlags());
  if (data) return data.includes(name);
  return isError ? false : undefined;
}

/**
 * What carries over into a call, while `on`. A read that fails keeps the last answer, as queries do, which would keep
 * showing what someone may not read any more: once the server says so, there's nothing. A dropped connection changes nothing.
 */
export function useCallSeries(code: string, on: boolean): Series | null {
  const r = useQuery({ ...q.callSeries(code), enabled: on });
  const refused = r.error !== null && ['forbidden', 'not-found'].includes(errorCode(r.error));
  return refused ? null : r.data ?? null;
}

/* ---------- account ---------- */

/** Google signs in in a popup; the API, rather than its completion message, confirms the session. */
export function useGoogleSignIn() {
  const qc = useQueryClient();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const mutation = useMutation({
    mutationFn: async ({ finished, signal }: { finished: ReturnType<typeof openGoogleSignIn>; signal: AbortSignal }) => {
      try {
        const result = await finished;
        if (signal.aborted) return null;
        if (!result || result === 'redirecting' || result.type !== 'complete') return result;
        await waitForGoogleReturn(signal);
        if (signal.aborted) return null;
        const session = await api.auth.getSession();
        if (signal.aborted) return null;
        if (!session) throw new AlcoveApiError('unauthenticated', 'Google sign-in didn’t open a session. Try again.');
        return { next: result.next, session };
      } catch (e) {
        if (signal.aborted) return null;
        throw e;
      }
    },
    onSuccess: (r, { signal }) => {
      if (signal.aborted || !r || r === 'redirecting' || !('session' in r)) return;
      forgetWords();
      announceSignIn(r.session.ownerId);
      qc.clear();
      qc.setQueryData(qk.session, r.session);
      // Signing in rotates background access; refresh through the session query to reopen its picture fence.
      void qc.fetchQuery({ ...q.session(), staleTime: 0 }).catch((e: unknown) => {
        log.child({ component: 'account' }).warn('session could not be refreshed after sign-in', { err: e });
      });
    }
  });
  return {
    start: async (next?: '/move') => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      // Open before handing the promise to the mutation, while the browser still has the button press.
      const finished = openGoogleSignIn((popup) => api.auth.signInUrl('google', { next, popup }), controller.signal);
      const result = await mutation.mutateAsync({ finished, signal: controller.signal });
      return controller.signal.aborted ? null : result;
    },
    cancel: () => pending.current?.abort()
  };
}

/** Signing in or out changes whose data everything is, so the cache starts over. */
export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { provider: DemoProvider; email?: string | undefined }) => api.auth.signIn(v.provider, { email: v.email }),
    onSuccess: (r) => {
      forgetWords();
      if (r.session) announceSignIn(r.session.ownerId);
      qc.clear();
      qc.setQueryData(qk.session, r.session);
      // Cached sign-in data is fresh for a minute. Read the authenticated session now to reopen the picture fence.
      if (r.session) void qc.fetchQuery({ ...q.session(), staleTime: 0 }).catch((e: unknown) => {
        log.child({ component: 'account' }).warn('session could not be refreshed after sign-in', { err: e });
      });
    }
  });
}
/**
 * Signed out (or the account deleted) on this device: whatever it kept for the account goes too, the recordings
 * waiting to upload among it (features/record/offline.ts; anyone else's stay), its notifications, those showing too, and
 * the words of its workspaces this tab held for Find.
 */
async function forgetHere(owner: string | undefined, deleted: boolean) {
  forgetWords();
  // The mutation captured this account before its request. A session refresh may already have cleared the cache.
  if (owner) {
    announceSignOut(owner, deleted);
    forgetPlaces(owner);
  }
  await forgetNotified();
  if (!owner) return;
  try { await forgetAccount(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete what this device kept for the account', { err: e }); }
  try { await forgetEdits(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete the edits this device kept for the account', { err: e }); }
  try { await forgetPictures(owner); } catch (e) { log.child({ component: 'account' }).error('couldn’t delete the backgrounds this device kept for the account', { err: e }); }
}
/**
 * The account's session ended here (signed out, or the account deleted): what this device kept goes, `leave` takes the
 * screen to the welcome page, and only once the welcome page has replaced the app is what the app read for the account
 * forgotten. Emptied first, the app would change under the person while the welcome page loaded. The guards count the
 * account as signed out meanwhile (lib/guards.ts). `leave` runs even if the screen that asked has gone.
 */
async function endHere(qc: QueryClient, owner: string | undefined, deleted: boolean, leave: () => Promise<void>) {
  await forgetHere(owner, deleted);
  try { await leave(); } finally { qc.clear(); qc.setQueryData(qk.session, null); }
}
/** Signs out of this device, then `leave` takes the screen to the welcome page (`endHere`). */
export function useSignOut(leave: () => Promise<void>) {
  const qc = useQueryClient();
  // With no connection it fails now. Queued, it would happen by itself at some moment nobody chose.
  return useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const owner = qc.getQueryData(q.session().queryKey)?.ownerId;
      await api.auth.signOut();
      return owner;
    },
    onSuccess: (owner) => endHere(qc, owner, false, leave)
  });
}
/**
 * Deletes the account for good. Every browser it was signed in on is signed out, this one included. `onDeleted` then
 * takes the screen to the welcome page (`endHere`), even if the screen that asked has gone meanwhile. It's never queued
 * for later, as signing out isn't. The cookie decides whose account goes and another tab can have changed it since this
 * page was drawn, so it first asks who's signed in, and goes ahead only for the account on this screen.
 */
export function useDeleteAccount(onDeleted: () => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const here = qc.getQueryData(q.session().queryKey)?.ownerId;
      const now = await api.auth.getSession();
      if (!here || now?.ownerId !== here) throw new AlcoveApiError('forbidden', 'Who’s signed in here changed in another tab, so nothing was deleted. Reload this page.');
      await api.account.delete();
      return here;
    },
    onSuccess: (owner) => endHere(qc, owner, true, onDeleted)
  });
}
/** Each channel hint belongs to its exact immutable query command, including after this hook re-renders. */
const notificationWrites = new WeakMap<object, { owner: string; generation: string; nonce: string }>();
/** Reversible preference fields show at once; the same query owner reconciles serial writes and current reads. */
export function usePreferences() {
  const qc = useQueryClient();
  const options = preferenceOptions(api, qc, qk, (p: PreferenceChange) => p);
  return useMutation({
    ...options,
    onMutate: async (patch, context) => {
      const session = qc.getQueryData(q.session().queryKey);
      const generation = session ? accountGeneration(session.ownerId) : null;
      const owned = await options.onMutate?.(patch, context);
      if (!owned) throw new AlcoveApiError('unauthenticated', 'Sign in again to save your preferences.');
      const changes = owned.fields.notifications;
      if (session && generation !== null && owned.account.valid() && accountGeneration(session.ownerId) === generation && changes && Object.keys(changes).length) {
        notificationWrites.set(owned.entry, { owner: session.ownerId, generation, nonce: announceNotificationPreferences(session.ownerId, changes) });
      }
      return owned;
    },
    onError: (error, patch, ctx, context) => {
      options.onError?.(error, patch, ctx, context);
      const intent = ctx ? notificationWrites.get(ctx.entry) : undefined;
      if (!ctx?.account.valid() || !intent || accountGeneration(intent.owner) !== intent.generation) return;
      const current = qc.getQueryData(q.prefs().queryKey);
      if (current) settleNotificationPreferences(intent.owner, intent.nonce, current.notifications, 'rollback');
    },
    onSuccess: (data, patch, ctx, context) => {
      options.onSuccess?.(data, patch, ctx, context);
      const intent = notificationWrites.get(ctx.entry);
      if (!ctx.account.valid() || !intent || accountGeneration(intent.owner) !== intent.generation) return;
      const current = qc.getQueryData(q.prefs().queryKey);
      if (current) settleNotificationPreferences(intent.owner, intent.nonce, current.notifications, 'confirmed');
    }
  });
}
/** Pinning is a preference change too, in the same ordered queue as Settings and groups. */
export function usePins() {
  const qc = useQueryClient();
  const options = preferenceOptions(api, qc, qk, (pinned: string[]) => ({ pinned }));
  return useMutation({ ...options, onError: (e, pinned, ctx, context) => {
    options.onError?.(e, pinned, ctx, context);
    if (errorCode(e) === 'not-found') void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  } });
}
/** Groups share that queue, including changes made from another component while one is pending. */
export function useGroups() {
  return useMutation(preferenceOptions(api, useQueryClient(), qk, (groups: Group[]) => ({ groups })));
}
/**
 * Pausing notifications until a time (an ISO date-time), or resuming them (`until: null`), shares that queue too: shown at
 * once, and put back if it's refused. features/shell/pause.ts's `usePause` is how the app asks.
 */
export function usePauseNotifications() {
  return useMutation(preferenceOptions(api, useQueryClient(), qk, ({ until }: { until: string | null }) => ({ notificationsPausedUntil: until })));
}
export function useInviteTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (emails: string[]) => api.people.inviteToTeam(emails), onSuccess: (t) => qc.setQueryData(qk.team, t) });
}

/* ---------- credits ---------- */

/** Opens a top-up on a route: the address to pay to. It joins the open ones on Plan and credits. */
export function useStartTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, credits }: { routeId: string; credits: number }) => api.credits.startTopUp(routeId, credits),
    onSuccess: (t) => { qc.setQueryData(q.topUp(t.id).queryKey, t); void qc.invalidateQueries({ queryKey: qk.topUps }); }
  });
}

/** Cancels a top-up nothing has reached: it leaves the open ones on Plan and credits. */
export function useCancelTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.credits.cancelTopUp(id),
    onSuccess: (t) => {
      qc.setQueryData(q.topUp(t.id).queryKey, t);
      // It leaves the open ones at once, before the list is read again.
      qc.setQueryData(topUpsKey, (list) => list?.map((x) => (x.id === t.id ? t : x)));
      void qc.invalidateQueries({ queryKey: qk.topUps });
      void qc.invalidateQueries({ queryKey: qk.balance });
    },
    // Refused because a payment just reached it, say: read it again, so the address goes now.
    onError: (_e, id) => { void qc.invalidateQueries({ queryKey: qk.topUp(id) }); void qc.invalidateQueries({ queryKey: qk.topUps }); }
  });
}

/* ---------- calls ---------- */

export function useScheduleCall() {
  const qc = useQueryClient();
  return useMutation({ networkMode: 'always', mutationFn: (input: MeetingInput) => api.meetings.create(input), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
/** A call changed or went: Home's calls, and any series it's the next call of, catch up. */
const callsChanged = (qc: QueryClient) => { void qc.invalidateQueries({ queryKey: qk.meetings }); void qc.invalidateQueries({ queryKey: qk.allSeries }); };
/** Changes a call. In a series, `scope: 'following'` changes this call and every later one. */
export function useUpdateCall() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; input: Patch<MeetingInput>; scope?: ChangeScope | undefined }) => api.meetings.update(v.id, v.input, { scope: v.scope }), onSuccess: () => callsChanged(qc) });
}
/**
 * Makes one of your own calendar events an Alcove call; an occurrence of a recurring event joins its series. The meeting
 * leaves the calendar's list at once, so it isn't listed beside its new call; the calendar is read again with the calls
 * (its key is under theirs), with the meeting's Alcove link.
 */
export function useAdoptEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { eventId: string; notes?: NotesSetting | undefined }) => api.calendar.adopt(v.eventId, v.notes),
    onSuccess: (_m, v) => {
      qc.setQueryData<Calendar>(qk.calendar, (c) => (c ? { ...c, events: c.events.filter((e) => e.id !== v.eventId) } : c));
      callsChanged(qc);
    }
  });
}
/** Where the browser goes to give Alcove access to Google Calendar; Google sends it back to Settings, or to Home. */
export const calendarConnectUrl = (opts?: { back?: '/home' | undefined }) => api.calendar.connectUrl(opts);
/** Forgets the Google connection; the calendar then asks for access again. */
export function useDisconnectCalendar() {
  const qc = useQueryClient();
  return useMutation({ networkMode: 'always', mutationFn: () => api.calendar.disconnect(), onSuccess: (cal) => { qc.setQueryData(qk.calendar, cal); } });
}
/**
 * Cancels a call. In a series, `scope: 'following'` cancels this call and every later one. Its link leads nowhere now, so
 * what's cached of the link goes with it: coming Back to it reads that first, and opens no lobby or camera on the way.
 */
export function useCancelCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; code: string; scope?: ChangeScope | undefined }) => api.meetings.cancel(v.id, { scope: v.scope }),
    onSuccess: (_r, v) => {
      qc.removeQueries({ queryKey: qk.byCode(v.code) });
      qc.removeQueries({ queryKey: qk.card(v.code) });
      callsChanged(qc);
    }
  });
}
/** Says whether you're coming to a call you're invited to. The card shows the answer at once, and goes back if it's refused. */
export function useAnswerCall() {
  const qc = useQueryClient();
  return useMutation(answerCallOptions(api, qc, qk));
}
export function usePendingRsvp(id: string) {
  return useIsMutating({ mutationKey: ['meetings', 'answer'], predicate: (mutation) => {
    const v = mutation.state.variables;
    return !!v && typeof v === 'object' && 'id' in v && v.id === id;
  } }) > 0;
}
export function useStartNow() {
  const qc = useQueryClient();
  return useMutation({ networkMode: 'always', mutationFn: (input: InstantCallInput) => api.calls.startNow(input), onSuccess: () => qc.invalidateQueries({ queryKey: qk.meetings }) });
}
/** Schedules the next call after a call (starting its series if it isn't in one): the same clock time here, a week on. */
export function useScheduleNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { meetingId: string }) => api.meetings.scheduleNext(v.meetingId, weekOn((await api.meetings.get(v.meetingId)).startsAt)),
    // The call's notes say which series they're in now.
    onSuccess: () => { callsChanged(qc); void qc.invalidateQueries({ queryKey: qk.notes }); }
  });
}

/* ---------- notes ---------- */

/** A write's whole-note answer may predate a newer command. Read it afresh through the projection owner. */
function changed(qc: QueryClient, n: { id: string }) {
  return refreshChangedNote(api, qc, qk, n.id);
}
/**
 * A note that was deleted or removed meanwhile: its notes and inbox items go from the lists. One that changed since it
 * was read refused what was asked of it, so it's read again, and the person sees what it says now.
 */
const gone = (qc: QueryClient, e: unknown) => {
  const code = errorCode(e);
  if (code === 'conflict') for (const queryKey of [qk.notes, qk.allSeries]) void qc.invalidateQueries({ queryKey });
  if (code !== 'not-found') return;
  void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  void qc.invalidateQueries({ queryKey: qk.inbox });
};
/** Adds a decision the notes didn't hear, in the reader's words; the answer is the note as it is now. */
export function useProposeDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; proposal: DecisionProposal }) => api.notes.proposeDecision(v.noteId, v.proposal),
    onSuccess: (n) => changed(qc, n),
    onError: (e) => gone(qc, e)
  });
}
/** Adds a follow-up the notes didn't hear; the answer is the note as it is now. */
export function useProposeAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; proposal: ActionProposal }) => api.notes.proposeAction(v.noteId, v.proposal),
    onSuccess: (n) => changed(qc, n),
    onError: (e) => gone(qc, e)
  });
}
/** Adds or dismisses precisely the conversation suggestion the reader reviewed. */
export function useReviewAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; review: FollowUpReview }) => api.notes.reviewAction(v.noteId, v.review),
    onSuccess: (n) => changed(qc, n),
    onError: (e) => gone(qc, e)
  });
}
/** Confirms, rejects, disputes, reopens, rewords or supersedes a decision; the answer is the note as it is now. */
export function useUpdateDecision() {
  const qc = useQueryClient();
  return useMutation({
    ...updateDecisionOptions(api, qc, qk),
    onError: (e) => gone(qc, e)
  });
}
/** Says an open question was answered, reopens or rewords it; the answer is the note as it is now. */
export function useUpdateQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; questionId: string; patch: QuestionPatch }) => api.notes.updateQuestion(v.noteId, v.questionId, v.patch),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Says the notes got it wrong, a later call didn't replace that decision or answer that question, or takes that back. */
export function useUpdateRevisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; revisitId: string; dismissed: boolean }) => api.notes.updateRevisit(v.noteId, v.revisitId, { dismissed: v.dismissed }),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Takes on, turns down, gives, dates, rewords or ticks a follow-up; the answer is the note as it is now. */
export function useUpdateAction() {
  const qc = useQueryClient();
  const options = updateActionOptions(api, qc, qk);
  return useMutation({ ...options, onError: (e, v, ctx, context) => {
    options.onError?.(e, v, ctx, context);
    gone(qc, e);
  } });
}
/** Pending checkboxes are announced by their own row, including writes started from another view. */
export function usePendingActions() {
  const pending = useMutationState({ filters: { mutationKey: ['notes', 'action'], status: 'pending' }, select: (mutation) => {
    const v = mutation.state.variables;
    return v && typeof v === 'object' && 'noteId' in v && typeof v.noteId === 'string' && 'actionId' in v && typeof v.actionId === 'string' ? `${v.noteId}:${v.actionId}` : null;
  } });
  return new Set(pending.filter((key) => key !== null));
}
/** Corrects a transcript line's words or speaker, or says it's right as heard; the answer is the note as it is now. */
export function useCorrectLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; lineId: string; patch: LinePatch }) => api.notes.correctLine(v.noteId, v.lineId, v.patch),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Changes your own notes on a note; the answer is all of them as they are now. */
export function useOwnNotes(noteId: string) {
  const qc = useQueryClient();
  const own = api.notes.personal(noteId);
  const done = { onSuccess: (p: PersonalNotes) => { qc.setQueryData(qk.personal(noteId), p); }, onError: (e: unknown) => gone(qc, e) };
  return {
    add: useMutation({ mutationFn: (input: PersonalInput) => own.add(input), ...done }),
    edit: useMutation({ mutationFn: (v: { entryId: string; text: string }) => own.edit(v.entryId, v.text), ...done }),
    remove: useMutation({ mutationFn: (entryId: string) => own.remove(entryId), ...done })
  };
}
/** Adds one of your own entries to the shared notes, as previewed. The answer is the note, for everyone; your own notes say where the copy is. */
export function useAddToShared(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { entryId: string; body: PromoteBody }) => api.notes.addToShared(noteId, v.entryId, v.body),
    onSuccess: (n) => Promise.all([changed(qc, n), qc.invalidateQueries({ queryKey: qk.personal(noteId) })]),
    onError: (e) => gone(qc, e)
  });
}
/** Writes straight into the shared notes, for everyone with them, with the seal of who the box said reads it. The answer is the note. */
export function useWriteShared(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SharedWrite) => api.notes.writeShared(noteId, body),
    onSuccess: (n) => changed(qc, n),
    onError: (e) => gone(qc, e)
  });
}
/** Makes a link to a note. Its secret is in the answer, said once, for showing where it was made; the list is read again. */
export function useCreateNoteLink(noteId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.notes.createLink(noteId), onSuccess: () => qc.invalidateQueries({ queryKey: qk.noteLinks(noteId) }), onError: (e) => gone(qc, e) });
}
/** Revokes a link to a note: the answer is the links that still work. */
export function useRevokeNoteLink(noteId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (linkId: string) => api.notes.revokeLink(noteId, linkId), onSuccess: (links) => qc.setQueryData(qk.noteLinks(noteId), links), onError: (e) => gone(qc, e) });
}
/**
 * Opens a link for the account signed in, only once they've pressed Open the notes on the link's page (it names the
 * account, since everyone with the notes will see it): its notes join theirs, so the lists are read again.
 */
export function useClaimNoteLink() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (secret: string) => api.notes.claimLink(secret), onSuccess: () => qc.invalidateQueries({ queryKey: qk.notes }) });
}
/** Takes something out of the shared notes, for everyone. */
export function useTakeBack(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (additionId: string) => api.notes.takeBack(noteId, additionId),
    onSuccess: (n) => Promise.all([changed(qc, n), qc.invalidateQueries({ queryKey: qk.personal(noteId) })]),
    onError: (e) => gone(qc, e)
  });
}
/** The organizer has the notes written again from the transcript as it is now; the note answers pending until they are. */
export function useRewriteNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { noteId: string; model?: string | null | undefined }) => api.notes.rewrite(v.noteId, { model: v.model }),
    onSuccess: (n) => changed(qc, n)
  });
}
/** Stops writing the notes again: they stay as they were. */
export function useCancelRewrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.notes.cancelRewrite(noteId),
    onSuccess: (n) => changed(qc, n)
  });
}
/**
 * The models to choose from for a call's notes or as your default, and the default one. They change rarely.
 */
export function useAiModels(enabled = true) {
  return useQuery({ queryKey: qk.visionModels, queryFn: () => api.models.list(), staleTime: 10 * 60_000, enabled });
}
/**
 * Shares a note with people, by address, and with one of your groups, under its name (everyone it reaches sees that
 * it came to them as that group): the group first, then anyone else. The answer is the note as it is now.
 */
export function useShareNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; emails: string[]; group?: Group | undefined }) => {
      const viaGroup = v.group && await api.notes.share(v.id, { emails: v.group.emails, group: v.group.name });
      return viaGroup && !v.emails.length ? viaGroup : api.notes.share(v.id, { emails: v.emails });
    },
    onSuccess: (n) => changed(qc, n),
    // A group's share may have gone through before the rest failed: the note is read again either way.
    onError: (_e, v) => { void qc.invalidateQueries({ queryKey: qk.note(v.id) }); }
  });
}
/**
 * Reads a note again, for what can't ask through here: the browser's audio element fetches for itself and can't say
 * why it failed, or how much more has been recorded. A session that's over shows up here, where the query layer deals
 * with it. Gives back the note as it is now.
 */
export function useRecheckNote(id: string) {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.refetchQueries({ queryKey: qk.note(id), exact: true }, { throwOnError: true });
    return qc.getQueryData(q.note(id).queryKey);
  }, [qc, id]);
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notes.delete(id),
    // The note itself stays cached until its page lets go of it, so the page can say what was deleted.
    onSuccess: () => {
      for (const key of [['notes', 'list'], qk.inbox, qk.meetings, qk.allSeries]) void qc.invalidateQueries({ queryKey: key });
    }
  });
}

/* ---------- ringing, and picking a time ---------- */

/**
 * Which of these people are busy right now, by lowercase address, as far as their calendars can be read: nobody is
 * "busy" whose calendar can't be. Read when it's asked for; a failed read just says nobody is.
 */
export const busyNow = (emails: string[]) => queryOptions({
  queryKey: ['calendar', 'busy-now', emails],
  queryFn: async (): Promise<ReadonlySet<string>> => {
    const now = new Date();
    const b = await api.calendar.busy(emails, { from: now.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() });
    return new Set(b.people.filter((p) => p.busy?.some((i) => new Date(i.from) <= now && now < new Date(i.to))).map((p) => p.email.toLowerCase()));
  },
  staleTime: 60_000, retry: false, enabled: emails.length > 0
});
/** Answers a ring. */
export function useRingAnswer() {
  return useMutation({ mutationFn: (v: { id: string; reply: RingReply }) => api.rings.answer(v.id, v.reply) });
}
/** Settles a call that offers times on one of them. When someone got there first, the link's card is read again before this finishes: it says the time they took. */
export function usePickTime(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (at: string) => api.calls.pick(code, at),
    onError: (e) => (errorCode(e) === 'conflict' ? qc.invalidateQueries({ queryKey: qk.card(code) }) : undefined)
  });
}

/* ---------- workspaces ---------- */

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api.workspaces.create(name), onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces, exact: true }) });
}
export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation(renameWorkspaceOptions(api, qc, qk));
}
/**
 * Only the requested name overlays the live tree. Once that stream acknowledges it, later people’s renames own it. The list of
 * workspaces is read only while a rename of this one is on its way, so somewhere that only shows the name, such as a call
 * screen, never lists them all.
 */
export function useWorkspaceName(id: string, liveName: string, signedIn: boolean) {
  const changes = useMutationState({ filters: { mutationKey: ['workspaces', 'rename'] }, select: (mutation) => {
    const v = mutation.state.variables;
    return v && typeof v === 'object' && 'id' in v && v.id === id && 'name' in v && typeof v.name === 'string'
      ? { name: v.name, status: mutation.state.status, n: mutation.mutationId } : null;
  } }).filter((change) => change !== null);
  const latest = changes.at(-1);
  const caught = useRef(0);
  useEffect(() => { if (latest?.status === 'success' && latest.name === liveName) caught.current = latest.n; }, [latest?.n, latest?.name, latest?.status, liveName]);
  const pending = changes.some((change) => change.status === 'pending');
  const waiting = latest?.status === 'success' && latest.n > caught.current && latest.name !== liveName;
  const list = useQuery({ ...q.workspaces(), enabled: signedIn && (pending || waiting) }).data;
  const name = (pending || waiting) ? list?.find((space) => space.id === id)?.name ?? liveName : liveName;
  return { name, state: pending ? 'saving' : latest?.status === 'error' ? 'failed' : latest?.status === 'success' ? 'saved' : 'quiet' } as const;
}
/**
 * Renames a board open in a call, for anyone who can change it: the call reads its new name from the workspace. What names
 * boards outside the call takes the new name at once, so nothing brings the old one back: the board's workspace as the call
 * reads it (which a saved board open just for you is named from), the item, the board picker's Your team's boards and the
 * Drive's library, each read again too. `pass`: the call's.
 */
export function useRenameBoard(pass: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; id: string; name: string }) => api.workspaces.items.rename(v.workspaceId, v.id, v.name, pass ? { pass } : undefined),
    onSuccess: (_, v) => {
      qc.setQueryData<WorkspaceTree>(qk.workspaceTree(v.workspaceId), (t) => t && { ...t, items: t.items.map((i) => (i.id === v.id ? { ...i, name: v.name } : i)) });
      qc.setQueriesData<BoardToBring[]>({ queryKey: qk.boardsToBring }, (list) => list?.map((b) => (b.workspaceId === v.workspaceId && b.id === v.id ? { ...b, name: v.name } : b)));
      qc.setQueryData<DocumentLibrary>(qk.documents, (lib) => lib && { workspaces: lib.workspaces.map((w) => (w.id !== v.workspaceId ? w : { ...w, documents: w.documents.map((d) => (d.id === v.id ? { ...d, name: v.name } : d)) })) });
      for (const queryKey of [qk.workspaceTree(v.workspaceId), qk.workspaceItem(v.workspaceId, v.id), qk.boardsToBring, qk.documents]) void qc.invalidateQueries({ queryKey });
    }
  });
}
/**
 * Sort into themes on a board: what the stickies picked say goes to confidential compute through the board's document, and
 * nothing of it is kept. A blank sticky has nothing to sort by and stays where it is, and each is cut to what the notes model
 * takes. Fewer than two with words, or more than it takes at once, is refused here in the server's own words, without asking it.
 * `pass`: the call's, in a call, where the server refuses while notes are paused.
 */
export function useSortStickies(pass?: string | undefined) {
  return useMutation({
    mutationFn: async (v: { workspaceId: string; documentId: string; stickies: readonly { id: string; text: string }[] }) => {
      const stickies = v.stickies.flatMap((s) => {
        const text = s.text.trim().slice(0, MAX_SORT_STICKY).trim();
        return text ? [{ id: s.id, text }] : [];
      });
      if (stickies.length < 2) throw new AlcoveApiError('invalid', SORT_TOO_FEW);
      if (stickies.length > MAX_SORT_STICKIES) throw new AlcoveApiError('invalid', SORT_TOO_MANY);
      return (await api.workspaces.sortStickies(v.workspaceId, v.documentId, { stickies }, pass ? { pass } : undefined)).themes;
    }
  });
}
/** A document in a workspace made a moment ago, before anything in it is on screen: a call's new workspace starts with one. `pass`: the call's. */
export function useFirstDocument(pass: string | undefined) {
  return useMutation({ mutationFn: (workspaceId: string) => api.workspaces.items.create(workspaceId, { kind: 'document' }, pass ? { pass } : undefined) });
}
/**
 * Changes to a workspace's tree. Nothing's cached: what changed reaches the list on the workspace's stream. What can be brought
 * to a call is read again after each, as it lists these documents. `pass`: the call's, in a call, where it lets anyone in the
 * call change what's in the workspace it uses; deleting for good is never the pass's.
 */
export function useItemChanges() {
  const qc = useQueryClient();
  const w = api.workspaces;
  type Target = { workspaceId: string; pass: string | undefined };
  const as = (target: Target) => target.pass ? { pass: target.pass } : undefined;
  const library = () => qc.invalidateQueries({ queryKey: qk.documents });
  return {
    create: useMutation({ mutationFn: (v: Target & { input: ItemInput }) => w.items.create(v.workspaceId, v.input, as(v)), onSuccess: library }),
    // The live owner orders work; explicit targets survive an observer's options changing during navigation.
    rename: useMutation({ mutationFn: (v: Target & { id: string; name: string }) => w.items.rename(v.workspaceId, v.id, v.name, as(v)), onSuccess: library }),
    move: useMutation({ mutationFn: (v: Target & { id: string; to: ItemPlace }) => w.items.move(v.workspaceId, v.id, v.to, as(v)), onSuccess: library }),
    duplicate: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.duplicate(v.workspaceId, v.id, as(v)), onSuccess: library }),
    trash: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.trash(v.workspaceId, v.id, as(v)), onSuccess: library }),
    restore: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.restore(v.workspaceId, v.id, as(v)), onSuccess: library }),
    deleteForever: useMutation({ mutationFn: (v: Target & { id: string }) => w.items.deleteForever(v.workspaceId, v.id), onSuccess: library })
  };
}
/** Tells someone they were tagged. `pass`: someone in a call. */
export function useMention(workspaceId: string, pass?: string | undefined) {
  return useMutation({ mutationFn: (v: MentionBody & { document: string }) => api.workspaces.mention(workspaceId, v.document, { to: v.to, block: v.block }, pass ? { pass } : undefined) });
}
/** You've heard about a tag. */
export function useMentionSeen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { workspaceId: string; mention: string }) => api.workspaces.mentionSeen(v.workspaceId, v.mention), onSuccess: () => {
    const owner = qc.getQueryData(q.session().queryKey)?.ownerId;
    if (owner) announceMentionsRead(owner);
    return qc.invalidateQueries({ queryKey: qk.mentions });
  } });
}
/** Keeps your notes beside one frame of a board: what's kept is what the board's notes say from then on. Empty text takes them away. */
export function useSavePresenterFrameNote(workspaceId: string, boardId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ frame, text }: { frame: string; text: string }) => api.workspaces.presenterNotes.setFrame(workspaceId, boardId, frame, text, pass ? { pass } : undefined),
    onSuccess: (_: void, { frame, text }: { frame: string; text: string }) => qc.setQueryData(qk.presenterFrameNotes(workspaceId, boardId), (was: PresenterFrameNotes | undefined) => {
      const { [frame]: _gone, ...rest } = was?.frames ?? {};
      return { frames: text ? { ...rest, [frame]: text } : rest };
    })
  });
}
/** Makes a new document of words that didn't reach the one they were written in (`DocSession.unsentCopy`). */
export function useSaveCopy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; input: ItemInput & { state: Uint8Array } }) => api.workspaces.saveCopy(v.workspaceId, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.documents })
  });
}
/**
 * A workspace's files: reusing one in another document, and deleting one for good, everywhere. Each reads the list of files
 * again after, as uploads do.
 */
export function useMediaChanges(workspaceId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  const reread = () => qc.invalidateQueries({ queryKey: qk.workspaceMedia(workspaceId) });
  const m = api.workspaces.media;
  return {
    attach: useMutation({ mutationFn: (v: { documentId: string; media: string }) => m.attach(workspaceId, v.documentId, v.media, { pass }), onSettled: reread }),
    remove: useMutation({ mutationFn: (v: { documentId: string; media: string }) => m.remove(workspaceId, v.documentId, v.media, { pass }), onSettled: reread })
  };
}

/** Who has a document: adding someone, taking them off, and closing it to the workspace. */
export function useDocumentShare(workspaceId: string, documentId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  const reread = () => qc.invalidateQueries({ queryKey: qk.documentShare(workspaceId, documentId) });
  const s = api.workspaces.share;
  return {
    set: useMutation({ mutationFn: (v: { to: ShareTarget[]; role: DocumentRole }) => s.set(workspaceId, documentId, v.to, v.role, pass ? { pass } : undefined), onSuccess: reread }),
    remove: useMutation({ mutationFn: (entry: string) => s.remove(workspaceId, documentId, entry, pass ? { pass } : undefined), onSuccess: reread }),
    restrict: useMutation({ mutationFn: (restricted: boolean) => s.restrict(workspaceId, documentId, restricted, pass ? { pass } : undefined), onSuccess: reread })
  };
}
/** Putting a document back to a version, for everyone. What it said is kept as a version first, so the list has one more. */
export function useRestoreVersion(workspaceId: string, documentId: string, pass?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (version: string) => {
      await api.workspaces.restoreVersion(workspaceId, documentId, version, pass ? { pass } : undefined);
      return qc.fetchQuery({ ...q.documentVersions(workspaceId, documentId, pass), staleTime: 0 });
    }
  });
}
/** Who's in a workspace: adding someone, changing what they can do, and taking them out, or yourself. */
export function useWorkspacePeople(workspaceId: string) {
  const qc = useQueryClient();
  const reread = () => qc.invalidateQueries({ queryKey: qk.workspacePeople(workspaceId) });
  const w = api.workspaces;
  return {
    add: useMutation({ mutationFn: (v: { email: string; role: WorkspaceRole }) => w.addPerson(workspaceId, v.email, v.role), onSuccess: reread }),
    setRole: useMutation({ mutationFn: (v: { id: string; role: WorkspaceRole }) => w.setRole(workspaceId, v.id, v.role), onSuccess: reread }),
    remove: useMutation({ mutationFn: (id: string) => w.removePerson(workspaceId, id), onSuccess: reread })
  };
}

/** Credentials live in the active form only, never in a query or a persisted mutation. */
/*
 * After a change to the connections, the list alone is read again, and nothing waits for it: what was changed answers at
 * once (a token shows, Saved says so, allowing hands back to the agent) and the list catches up behind it.
 */
const readConnectionsAgain = (qc: QueryClient) => { void qc.invalidateQueries({ queryKey: qk.agents, exact: true }); };
export function useCreateAgentToken() {
  const qc = useQueryClient();
  return useMutation({ gcTime: 0, mutationFn: (input: AgentTokenInput) => api.agents.createToken(input), onSuccess: () => readConnectionsAgain(qc) });
}
/** Disconnecting deletes what the agent did too: it leaves the line at once, and what they did is read again. */
export function useRevokeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agents.revoke(id),
    onSuccess: (_, id) => {
      qc.setQueryData(q.agents().queryKey, (list) => list?.filter((c) => c.id !== id));
      readConnectionsAgain(qc);
      void qc.invalidateQueries({ queryKey: qk.agentActivity });
    }
  });
}
/** Allowing an agent connects it: the list is read again, so it stands on the line. */
export function useAgentDecision(requestId: string) {
  const qc = useQueryClient();
  return useMutation({ gcTime: 0, mutationFn: (decision: AgentDecisionInput) => api.agents.decide(requestId, decision), onSuccess: () => readConnectionsAgain(qc) });
}
/**
 * Changing a connection: what it can do, or 30 more days. One change at a time, in the order they were made (`scope`), so
 * quick presses of its chips land as pressed. What comes back is the connection as it now is, and it shows at once.
 */
export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: 'agent-update' },
    mutationFn: ({ id, ...change }: AgentUpdateInput & { id: string }) => api.agents.update(id, change),
    onSuccess: (connection) => {
      qc.setQueryData(q.agents().queryKey, (list) => list?.map((c) => (c.id === connection.id ? connection : c)));
      readConnectionsAgain(qc);
    }
  });
}

/** Drive credentials stay on the server; the browser receives only a one-time consent destination. */
export function useConnectDrive() {
  return useMutation({ gcTime: 0, mutationFn: () => api.drive.connect() });
}
export function usePickDriveFolder() {
  return useMutation({ gcTime: 0, mutationFn: () => api.drive.pickFolder() });
}
export function useDisconnectDrive() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.drive.disconnect(), onSuccess: async (settings) => {
    qc.setQueryData(qk.drive, settings);
    await qc.invalidateQueries({ queryKey: qk.drive });
  } });
}
export function useUpdateDrive() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: DriveExportInput) => api.drive.update(input), onSuccess: async (settings) => {
    qc.setQueryData(qk.drive, settings);
    await qc.invalidateQueries({ queryKey: qk.drive });
  } });
}
export function useDriveNote(noteId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: DriveExportInput | null) => api.drive.setForNote(noteId, input), onSuccess: async (choice) => {
    qc.setQueryData(qk.driveNote(noteId), choice);
    await qc.invalidateQueries({ queryKey: qk.driveJobs });
  } });
}
export function useRetryDriveExport() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.drive.retry(id), onSuccess: () => qc.invalidateQueries({ queryKey: qk.drive }) });
}

/** You, invited, asking the organizer to move a call to another time: they see it on theirs, and can move it there. */
export function useProposeTime() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; startsAt: ISODate }) => api.meetings.propose(v.id, v.startsAt), onSuccess: (m) => { qc.setQueryData(qk.meeting(m.id), m); callsChanged(qc); } });
}
/** The organizer answering a request to move a call: Move it moves the call there, as changing its time does; Keep lets the request go. */
export function useAnswerProposal() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; email: string; answer: ProposalAnswer }) => api.meetings.answerProposal(v.id, v.email, v.answer), onSuccess: (m) => { qc.setQueryData(qk.meeting(m.id), m); callsChanged(qc); } });
}

/**
 * Gets a call ready before it starts, from its page: its home settled, with an agenda, a board or a document for files (`name`)
 * made there and brought to the call. The call reads again, and so does what you can bring and the workspaces you're in.
 */
export function useReadyCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; make: CallAheadMake; name?: string | undefined }) => api.calls.ready(v.id, v.make, v.name),
    onSuccess: () => { callsChanged(qc); void qc.invalidateQueries({ queryKey: qk.documents }); void qc.invalidateQueries({ queryKey: qk.workspaces }); }
  });
}

/**
 * What the Drive changes in a workspace: making something, renaming it, sending it to Trash and bringing it back. Each reads
 * again what the Drive shows of it: the library Recent is made of, the workspace's tree, and one Trash.
 */
export function useDriveItems() {
  const qc = useQueryClient();
  const w = api.workspaces;
  const reread = (v: { workspaceId: string }) => Promise.all([qk.documents, qk.trashed, qk.workspaceTree(v.workspaceId)].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return {
    create: useMutation({ mutationFn: (v: { workspaceId: string; input: ItemInput }) => w.items.create(v.workspaceId, v.input), onSuccess: (_, v) => reread(v) }),
    rename: useMutation({ mutationFn: (v: { workspaceId: string; id: string; name: string }) => w.items.rename(v.workspaceId, v.id, v.name), onSuccess: (_, v) => reread(v) }),
    trash: useMutation({ mutationFn: (v: { workspaceId: string; id: string }) => w.items.trash(v.workspaceId, v.id), onSuccess: (_, v) => reread(v) }),
    restore: useMutation({ mutationFn: (v: { workspaceId: string; id: string }) => w.items.restore(v.workspaceId, v.id), onSuccess: (_, v) => reread(v) })
  };
}

/** Says what a workspace is for: the line shows at once, and goes back to what it was if Alcove doesn't take it. */
export function useSetWorkspaceAbout(id: string) {
  const qc = useQueryClient();
  const key = q.workspaceAbout(id).queryKey;
  return useMutation({
    mutationFn: (about: string) => api.workspaces.setAbout(id, about),
    onMutate: async (about) => {
      await qc.cancelQueries({ queryKey: key });
      const was = qc.getQueryData(key);
      qc.setQueryData(key, about.replace(/\s+/g, ' ').trim());
      return { was };
    },
    onError: (_e, _about, context) => { if (context) qc.setQueryData(key, context.was); },
    onSettled: () => qc.invalidateQueries({ queryKey: key })
  });
}
