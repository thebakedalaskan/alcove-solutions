/** Reversible query writes: requested fields over confirmed reads, owned by the session that asked. */
import { AlcoveApiError, type ActionPatch, type AlcoveApi, type DecisionPatch, type Inbox, type Meeting, type Note, type NoteAction, type Patch, type Preferences, type Rsvp, type Session, type WorkspaceSummary } from '@alcove/api';
import { mutationOptions, type QueryClient, type QueryKey } from '@tanstack/react-query';

/** Explicit offline synchronization belongs to its recorder/document store, never to an arbitrary UI mutation. */
export const interactiveWrites = { networkMode: 'always', retry: false } as const;

interface AccountKeys { session: QueryKey }
interface AnswerKeys extends AccountKeys { meeting: (id: string) => QueryKey; upcoming: QueryKey }
interface PreferenceKeys extends AccountKeys { prefs: QueryKey }
interface WorkspaceKeys extends AccountKeys { workspaces: QueryKey }
interface ActionKeys extends AccountKeys { note: (id: string) => QueryKey; inbox: QueryKey; allSeries: QueryKey }
/** Controls name their intended leaves; the HTTP boundary still receives complete validated groups. */
type FlatPreferences = Omit<Preferences, 'sounds' | 'notifications'>;
export type PreferenceChange = Patch<FlatPreferences> & {
  sounds?: Partial<Preferences['sounds']> | undefined;
  notifications?: Partial<Preferences['notifications']> | undefined;
};
type Put<T> = (current: T) => T;
interface Entry<T> { id: number; pending: boolean; put: Put<T>; copy: (current: T, from: T) => T }

/**
 * Temporary mutation context: QueryClient remains the rendered data. Successful commands stay beside pending ones until
 * a read catches up. Removing a failed command reveals confirmed data, never a failed command's optimistic before-value.
 */
class Projection<T> {
  private base: T | undefined;
  private entries: Entry<T>[] = [];
  private count = 0;
  private reads = 0;
  constructor(private client: QueryClient, private key: QueryKey) { this.base = client.getQueryData<T>(key); }
  add(put: Put<T>, copy: (current: T, from: T) => T) {
    this.adopt();
    const entry = { id: ++this.count, pending: true, put, copy };
    this.entries.push(entry);
    this.show();
    return entry;
  }
  private value() { const base = this.base; return base === undefined ? undefined : this.entries.reduce<T>((value, e) => e.put(value), base); }
  /** Other mutations may refresh unrelated fields while this request is on its way. */
  private adopt() {
    const current = this.client.getQueryData<T>(this.key);
    const base = this.base;
    if (current !== undefined) this.base = base === undefined ? current : this.entries.reduce<T>((value, e) => e.copy(value, base), current);
  }
  private show() { const value = this.value(); if (value !== undefined) this.client.setQueryData(this.key, value); }
  settle(entry: Entry<T>, put?: Put<T>) {
    this.adopt();
    if (put) { entry.pending = false; entry.put = put; }
    else this.entries = this.entries.filter((e) => e !== entry);
    this.show();
    if (!this.entries.some((e) => e.pending)) void this.client.invalidateQueries({ queryKey: this.key, exact: true });
  }
  confirm(put: Put<T>, seed?: T) {
    this.adopt();
    const base = this.base ?? seed;
    if (base !== undefined) this.base = put(base);
    this.show();
  }
  async read(work: () => Promise<T>) {
    const turn = ++this.reads;
    const through = this.entries.some((e) => e.pending) ? 0 : this.count;
    const value = await work();
    // Query cancellation discards its result, but its async work can still finish after a newer read.
    if (turn !== this.reads) return this.value() ?? value;
    this.base = value;
    this.entries = this.entries.filter((e) => e.pending || e.id > through);
    return this.value() ?? value;
  }
}

interface Account { valid: () => boolean; check: () => Promise<void>; run: <T>(resource: string, work: () => Promise<T>) => Promise<T> }
const accounts = new WeakMap<QueryClient, Account>();
/** A cleared/replaced session query revokes its work even when the same account signs in again. */
function account(api: AlcoveApi, client: QueryClient, keys: AccountKeys): Account {
  const previous = accounts.get(client);
  if (previous?.valid()) return previous;
  answers.delete(client); preferences.delete(client); spaces.delete(client); notes.delete(client); inboxes.delete(client);
  const query = client.getQueryCache().find({ queryKey: keys.session, exact: true });
  const session = client.getQueryData<Session | null>(keys.session);
  const valid = () => !!session && query === client.getQueryCache().find({ queryKey: keys.session, exact: true }) &&
    client.getQueryData<Session | null>(keys.session)?.ownerId === session.ownerId && client.getQueryData<Session | null>(keys.session)?.createdAt === session.createdAt;
  const refused = () => new AlcoveApiError('forbidden', 'Who’s signed in here changed. Reload this page before trying again.');
  if (!valid()) throw refused();
  const check = async () => {
    if (!valid()) throw refused();
    // A queued request must not use a different account's cookie, including a change made in another tab.
    const now = await api.auth.getSession();
    if (!valid() || now?.ownerId !== session?.ownerId || now?.createdAt !== session?.createdAt) throw refused();
  };
  const tails = new Map<string, Promise<void>>();
  const owned: Account = { valid, check, run: async <T,>(resource: string, work: () => Promise<T>): Promise<T> => {
    const before = tails.get(resource);
    let release = () => {};
    const tail = new Promise<void>((resolve) => { release = resolve; });
    tails.set(resource, tail);
    try { await before; await check(); return await work(); }
    finally { release(); if (tails.get(resource) === tail) tails.delete(resource); }
  } };
  accounts.set(client, owned);
  const stop = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed' || event.query !== query) return;
    answers.delete(client); preferences.delete(client); spaces.delete(client); notes.delete(client); inboxes.delete(client); accounts.delete(client); commandSets.delete(client);
    stop();
  });
  return owned;
}

/** Exact variables may be reused by a caller. Dispatch queues preserve each individual mutation's identity. */
function dispatches<V extends object, C>() {
  const queued = new WeakMap<V, C[]>();
  return {
    add: (v: V, c: C) => { queued.set(v, [...(queued.get(v) ?? []), c]); },
    take: (v: V): C => {
      const queue = queued.get(v);
      const command = queue?.shift();
      if (!queue?.length) queued.delete(v);
      if (!command) throw new AlcoveApiError('unknown', 'This change no longer has a signed-in request. Try again.');
      return command;
    }
  };
}

interface AnswerInput { id: string; answer: Rsvp }
interface NameInput { id: string; name: string }
interface ActionInput { noteId: string; actionId: string; patch: ActionPatch }
interface DecisionInput { noteId: string; decisionId: string; patch: DecisionPatch }
/** Hooks replace their options when the optimistic cache re-renders them. Requests outlive those options objects. */
function newCommands() {
  return {
    answers: dispatches<AnswerInput, { account: Account; input: AnswerInput }>(),
    preferences: dispatches<object, { account: Account; fields: PreferenceChange }>(),
    spaces: dispatches<NameInput, { account: Account; input: NameInput }>(),
    actions: dispatches<ActionInput, { owner: Account; input: ActionInput }>(),
    decisions: dispatches<DecisionInput, { owner: Account; input: DecisionInput }>()
  };
}
const commandSets = new WeakMap<QueryClient, ReturnType<typeof newCommands>>();
function commands(client: QueryClient) {
  let pending = commandSets.get(client);
  if (!pending) { pending = newCommands(); commandSets.set(client, pending); }
  return pending;
}

interface Owned<T> { account: Account; projection: Projection<T> }
const answers = new WeakMap<QueryClient, Map<string, Owned<Meeting>>>();
const preferences = new WeakMap<QueryClient, Owned<Preferences>>();
const spaces = new WeakMap<QueryClient, Owned<WorkspaceSummary[]>>();
const notes = new WeakMap<QueryClient, Map<string, Owned<Note>>>();
const inboxes = new WeakMap<QueryClient, Owned<Inbox>>();

function meetingWrite(api: AlcoveApi, client: QueryClient, keys: AnswerKeys, id: string) {
  const owner = account(api, client, keys);
  let map = answers.get(client);
  if (!map) { map = new Map(); answers.set(client, map); }
  let owned = map.get(id);
  if (!owned?.account.valid()) { owned = { account: owner, projection: new Projection<Meeting>(client, keys.meeting(id)) }; map.set(id, owned); }
  return owned;
}
function preferenceWrite(api: AlcoveApi, client: QueryClient, keys: PreferenceKeys) {
  const owner = account(api, client, keys);
  let owned = preferences.get(client);
  if (!owned?.account.valid()) { owned = { account: owner, projection: new Projection<Preferences>(client, keys.prefs) }; preferences.set(client, owned); }
  return owned;
}
function spaceWrite(api: AlcoveApi, client: QueryClient, keys: WorkspaceKeys) {
  const owner = account(api, client, keys);
  let owned = spaces.get(client);
  if (!owned?.account.valid()) { owned = { account: owner, projection: new Projection<WorkspaceSummary[]>(client, keys.workspaces) }; spaces.set(client, owned); }
  return owned;
}

export function readMeeting(api: AlcoveApi, client: QueryClient, id: string) {
  const owned = answers.get(client)?.get(id);
  return owned?.account.valid() ? owned.projection.read(() => api.meetings.get(id)) : api.meetings.get(id);
}
export function readPreferences(api: AlcoveApi, client: QueryClient) {
  const owned = preferences.get(client);
  return owned?.account.valid() ? owned.projection.read(() => api.account.preferences()) : api.account.preferences();
}
export function readWorkspaces(api: AlcoveApi, client: QueryClient) {
  const owned = spaces.get(client);
  return owned?.account.valid() ? owned.projection.read(() => api.workspaces.list()) : api.workspaces.list();
}
export function readNote(api: AlcoveApi, client: QueryClient, id: string) {
  const owned = notes.get(client)?.get(id);
  return owned?.account.valid() ? owned.projection.read(() => api.notes.get(id)) : api.notes.get(id);
}
export function readInbox(api: AlcoveApi, client: QueryClient) {
  const owned = inboxes.get(client);
  return owned?.account.valid() ? owned.projection.read(() => api.notes.inbox()) : api.notes.inbox();
}

/** The same options are consumed by the screen hook and the real-HTTP integration flows. */
export function answerCallOptions(api: AlcoveApi, client: QueryClient, keys: AnswerKeys) {
  const dispatch = commands(client).answers;
  return mutationOptions({
    mutationKey: ['meetings', 'answer'], ...interactiveWrites,
    mutationFn: (v: AnswerInput) => { const { account, input } = dispatch.take(v); return account.run(`meeting:${input.id}`, () => api.meetings.answer(input.id, input.answer)); },
    onMutate: async (v) => {
      const input = structuredClone(v);
      const owned = meetingWrite(api, client, keys, input.id);
      const entry = owned.projection.add((m) => ({ ...m, rsvp: input.answer }), (m, from) => ({ ...m, rsvp: from.rsvp, rsvps: from.rsvps }));
      dispatch.add(v, { account: owned.account, input });
      await client.cancelQueries({ queryKey: keys.meeting(input.id), exact: true }, { revert: false });
      return { ...owned, entry };
    },
    onError: (_e, _v, ctx) => { if (ctx?.account.valid()) ctx.projection.settle(ctx.entry); },
    onSuccess: (m, _v, ctx) => { if (ctx.account.valid()) {
      ctx.projection.settle(ctx.entry, (current) => ({ ...current, rsvp: m.rsvp, rsvps: m.rsvps }));
      void client.invalidateQueries({ queryKey: keys.upcoming });
    } }
  });
}

/** Each request touches just its explicit fields; later commands always project over older answers. */
function withFields(p: Preferences, from: PreferenceChange, fields: PreferenceChange): Preferences {
  const flatFrom: Patch<FlatPreferences> = from;
  const flatFields: Patch<FlatPreferences> = fields;
  const f = <K extends keyof FlatPreferences>(k: K): FlatPreferences[K] => flatFields[k] !== undefined && flatFrom[k] !== undefined ? flatFrom[k] : p[k];
  const sound = <K extends keyof Preferences['sounds']>(k: K): Preferences['sounds'][K] => fields.sounds?.[k] !== undefined ? from.sounds?.[k] ?? p.sounds[k] : p.sounds[k];
  const notify = <K extends keyof Preferences['notifications']>(k: K): Preferences['notifications'][K] => fields.notifications?.[k] !== undefined ? from.notifications?.[k] ?? p.notifications[k] : p.notifications[k];
  return {
    notesDefault: f('notesDefault'), notesLanguage: f('notesLanguage'), summaryLength: f('summaryLength'), addToCalendar: f('addToCalendar'),
    showOtherMeetings: f('showOtherMeetings'), recordOffline: f('recordOffline'), pinned: f('pinned'), groups: f('groups'), model: f('model'),
    sounds: { enabled: sound('enabled'), volume: sound('volume'), quiet: sound('quiet'), mic: sound('mic'), people: sound('people'), hands: sound('hands'), questions: sound('questions'), messages: sound('messages'), replies: sound('replies'), mentions: sound('mentions'), admissions: sound('admissions'), timers: sound('timers'), ringing: sound('ringing') },
    notifications: { enabled: notify('enabled'), privateMessages: notify('privateMessages'), replies: notify('replies'), chatMentions: notify('chatMentions'), hands: notify('hands'), questions: notify('questions'), admissions: notify('admissions'), timers: notify('timers'), replyAlerts: notify('replyAlerts'), mentionAlerts: notify('mentionAlerts'), beforeCall: notify('beforeCall'), notesReady: notify('notesReady'), sharedWithYou: notify('sharedWithYou'), notesRequested: notify('notesRequested'), followUpDue: notify('followUpDue'), tagged: notify('tagged') }
  };
}
export const withPreferenceChange = (current: Preferences, change: PreferenceChange): Preferences => withFields(current, change, change);
export function preferenceOptions<V extends object>(api: AlcoveApi, client: QueryClient, keys: PreferenceKeys, patch: (v: V) => PreferenceChange) {
  const dispatch = commands(client).preferences;
  return mutationOptions({
    mutationKey: ['prefs', 'write'], ...interactiveWrites,
    mutationFn: (v: V) => {
      const { account, fields } = dispatch.take(v);
      return account.run('preferences', async () => {
        const { sounds, notifications, ...flat } = fields;
        if (sounds === undefined && notifications === undefined) return api.account.updatePreferences(flat);
        // The existing wire replaces whole groups. A failed earlier command must not become their baseline.
        const current = await api.account.preferences();
        await account.check();
        return api.account.updatePreferences({ ...flat,
          ...(sounds === undefined ? {} : { sounds: { ...current.sounds, ...sounds } }),
          ...(notifications === undefined ? {} : { notifications: { ...current.notifications, ...notifications } })
        });
      });
    },
    onMutate: async (v) => {
      const owned = preferenceWrite(api, client, keys);
      const fields = structuredClone(patch(v));
      const entry = owned.projection.add((current) => withFields(current, fields, fields), (current, from) => withFields(current, from, fields));
      dispatch.add(v, { account: owned.account, fields });
      await client.cancelQueries({ queryKey: keys.prefs, exact: true }, { revert: false });
      return { ...owned, entry, fields };
    },
    onError: (_e, _v, ctx) => { if (ctx?.account.valid()) ctx.projection.settle(ctx.entry); },
    onSuccess: (p, _v, ctx) => { if (ctx.account.valid()) ctx.projection.settle(ctx.entry, (current) => withFields(current, p, ctx.fields)); }
  });
}

export function renameWorkspaceOptions(api: AlcoveApi, client: QueryClient, keys: WorkspaceKeys) {
  const dispatch = commands(client).spaces;
  return mutationOptions({
    mutationKey: ['workspaces', 'rename'], ...interactiveWrites,
    mutationFn: (v: NameInput) => { const { account, input } = dispatch.take(v); return account.run(`workspace:${input.id}`, () => api.workspaces.rename(input.id, input.name)); },
    onMutate: async (v) => {
      const owned = spaceWrite(api, client, keys);
      const input = structuredClone(v);
      const put = (list: WorkspaceSummary[]) => list.map((w) => w.id === input.id ? { ...w, name: input.name } : w);
      const entry = owned.projection.add(put, (list, from) => list.map((w) => w.id === input.id ? { ...w, name: from.find((s) => s.id === input.id)?.name ?? w.name } : w));
      dispatch.add(v, { account: owned.account, input });
      await client.cancelQueries({ queryKey: keys.workspaces, exact: true }, { revert: false });
      return { ...owned, entry, put };
    },
    onError: (_e, _v, ctx) => { if (ctx?.account.valid()) ctx.projection.settle(ctx.entry); },
    onSuccess: (_d, _v, ctx) => { if (ctx.account.valid()) ctx.projection.settle(ctx.entry, ctx.put); }
  });
}

function doneIn(note: Note, id: string) {
  return [...note.actions, ...note.rooms.flatMap((room) => room.actions)].find((action) => action.id === id)?.done;
}
function withDone(note: Note, id: string, done: boolean | undefined): Note {
  if (done === undefined) return note;
  const change = <T extends { id: string; done: boolean }>(actions: T[]) => actions.map((a) => a.id === id ? { ...a, done } : a);
  return { ...note, actions: change(note.actions), rooms: note.rooms.map((room) => ({ ...room, actions: change(room.actions) })) };
}
/** Install only the confirmed command's fields; a newer history already read from another actor wins. */
function confirmedAction<T extends NoteAction>(current: T, answer: NoteAction, patch: ActionPatch): T {
  const last = answer.changes.at(-1);
  const currentLast = current.changes.at(-1);
  if (last && currentLast && (currentLast.at > last.at || current.changes.slice(0, -1).some((change) => JSON.stringify(change) === JSON.stringify(last)))) return current;
  const consent = patch.takeOn !== undefined || patch.owner !== undefined || patch.text !== undefined || patch.due !== undefined;
  return {
    ...current, revision: answer.revision, changes: answer.changes,
    ...(patch.done === undefined ? {} : { done: answer.done }),
    ...(patch.text === undefined ? {} : { text: answer.text }),
    ...(patch.owner === undefined ? {} : { owner: answer.owner }),
    ...(patch.due === undefined ? {} : { due: answer.due }),
    ...(consent ? { takenOn: answer.takenOn } : {})
  };
}
function confirmedIn(note: Note, answer: NoteAction, patch: ActionPatch): Note {
  const change = (actions: NoteAction[]) => actions.map((a) => a.id === answer.id ? confirmedAction(a, answer, patch) : a);
  return { ...note, actions: change(note.actions), rooms: note.rooms.map((room) => ({ ...room, actions: change(room.actions) })) };
}
/** A delayed protected write returns a historical snapshot. Confirm with a new read under any pending commands. */
export async function refreshChangedNote(api: AlcoveApi, client: QueryClient, keys: ActionKeys, id: string): Promise<void> {
  try {
    await client.cancelQueries({ queryKey: keys.note(id), exact: true }, { revert: false });
    await client.fetchQuery({ queryKey: keys.note(id), queryFn: () => readNote(api, client, id), staleTime: 0 });
  } finally {
    for (const queryKey of [['notes', 'list'], keys.allSeries, keys.inbox]) void client.invalidateQueries({ queryKey });
  }
}
/** Protected decision changes remain pending through their authoritative confirmation read. */
export function updateDecisionOptions(api: AlcoveApi, client: QueryClient, keys: ActionKeys) {
  const dispatch = commands(client).decisions;
  return mutationOptions({
    ...interactiveWrites,
    mutationFn: (v: DecisionInput) => { const { owner, input } = dispatch.take(v); return owner.run(`decision:${input.noteId}:${input.decisionId}`, () => api.notes.updateDecision(input.noteId, input.decisionId, input.patch)); },
    onMutate: (v) => {
      const owner = account(api, client, keys);
      dispatch.add(v, { owner, input: structuredClone(v) });
      return { owner };
    },
    onSuccess: (note, _v, ctx) => ctx.owner.valid() ? refreshChangedNote(api, client, keys, note.id) : undefined
  });
}
/** Only a personal reversible completion checkbox is projected. Taking on/reassigning/agreeing stays confirmed. */
export function updateActionOptions(api: AlcoveApi, client: QueryClient, keys: ActionKeys) {
  const dispatch = commands(client).actions;
  return mutationOptions({
    mutationKey: ['notes', 'action'], ...interactiveWrites,
    mutationFn: (v: ActionInput) => { const { owner, input } = dispatch.take(v); return owner.run(`note:${input.noteId}`, () => api.notes.updateAction(input.noteId, input.actionId, input.patch)); },
    onMutate: async (v) => {
      const owner = account(api, client, keys);
      const input = structuredClone(v);
      dispatch.add(v, { owner, input });
      const reversible = input.patch.done !== undefined && Object.keys(input.patch).every((key) => key === 'done');
      let map = notes.get(client);
      if (!map) { map = new Map(); notes.set(client, map); }
      let owned = map.get(input.noteId);
      if (!owned) { owned = { account: owner, projection: new Projection<Note>(client, keys.note(input.noteId)) }; map.set(input.noteId, owned); }
      let inbox = inboxes.get(client);
      if (!inbox) { inbox = { account: owner, projection: new Projection<Inbox>(client, keys.inbox) }; inboxes.set(client, inbox); }
      const target = (list: Inbox, done: boolean | undefined): Inbox => ({ ...list, followUps: list.followUps.map((a) => a.noteId === input.noteId && a.id === input.actionId && done !== undefined ? { ...a, done } : a) });
      const entry = reversible ? owned.projection.add((n) => withDone(n, input.actionId, input.patch.done), (n, from) => withDone(n, input.actionId, doneIn(from, input.actionId))) : null;
      const inboxEntry = reversible ? inbox.projection.add((n) => target(n, input.patch.done), (n, from) => target(n, from.followUps.find((a) => a.noteId === input.noteId && a.id === input.actionId)?.done)) : null;
      await Promise.all([keys.note(input.noteId), keys.inbox].map((queryKey) => client.cancelQueries({ queryKey, exact: true }, { revert: false })));
      return { owner, owned, inbox, entry, inboxEntry, target, input };
    },
    onError: (_e, _v, ctx) => { if (ctx?.owner.valid()) {
      if (ctx.entry) ctx.owned.projection.settle(ctx.entry);
      if (ctx.inboxEntry) ctx.inbox.projection.settle(ctx.inboxEntry);
    } },
    onSuccess: (note, _v, ctx) => { if (ctx.owner.valid()) {
      const answer = [...note.actions, ...note.rooms.flatMap((room) => room.actions)].find((a) => a.id === ctx.input.actionId);
      if (!answer) return;
      if (ctx.entry) ctx.owned.projection.settle(ctx.entry, (n) => confirmedIn(n, answer, ctx.input.patch));
      else ctx.owned.projection.confirm((n) => confirmedIn(n, answer, ctx.input.patch), note);
      if (ctx.inboxEntry) ctx.inbox.projection.settle(ctx.inboxEntry, (n) => ctx.target(n, answer.done));
      else ctx.inbox.projection.confirm((inbox) => {
        const mine = answer.owner?.person?.email === client.getQueryData<Session | null>(keys.session)?.user.email;
        const existing = inbox.followUps.some((a) => a.id === answer.id && a.noteId === note.id);
        const followUps = inbox.followUps.flatMap((a) => a.id !== answer.id || a.noteId !== note.id ? [a] : mine && !answer.done ? [confirmedAction(a, answer, ctx.input.patch)] : []);
        if (mine && !answer.done && !existing) followUps.push({ ...answer, noteId: note.id, noteTitle: note.title, noteStartedAt: note.startedAt, role: note.received?.role ?? 'organizer' });
        return { ...inbox, followUps };
      });
    } },
    onSettled: (_n, _e, _v, ctx) => { if (ctx?.owner.valid()) for (const queryKey of [keys.note(ctx.input.noteId), keys.inbox, ['notes', 'list'], keys.allSeries]) void client.invalidateQueries({ queryKey }); }
  });
}
