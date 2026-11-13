/*
 * The call's workspace: its home, settled the first time Workspace opens (the meeting's own, with the call's folder at
 * its top, or one made for the call), what everyone views and what's brought to the call, who's where in it, and what's
 * played for everyone.
 */
import { AlcoveApiError, type CallPage, type CallWorkspace, type CallWorkspaceSwitch, type Person, type WorkspaceHere, type WorkspaceItem } from '@alcove/api';
import type { Space } from '../../world/world';
import { current, nextId } from '../state';
import { hereIn, peopleIn, tagYou, treeOf } from '../workspaces/workspaces';
import { firstOf } from './base';
import { CallWithStage } from './stage';

/** What a call's new home and its folder are called: the call, and the day it started, 'Design review · 4 Nov'. */
const homeName = (title: string, startedAt: string) =>
  `${title.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled call'} · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(startedAt))}`;

export abstract class CallWithWorkspace extends CallWithStage {
  /** Where everyone else is in the call's workspace, by their connection: what its stream says of them, the call's own pages included. */
  protected where = new Map<string, { document: string | null; typing: boolean; page: CallPage | null }>();
  /** The call's home, once it's settled. */
  protected homeId: string | null = null;

  private organizerOnly(): Promise<void> | null {
    return this.getSnapshot().isOrganizer ? null : Promise.reject(new AlcoveApiError('forbidden', 'Only the organizer chooses the call’s workspace.'));
  }
  /**
   * The first time Workspace opens, the call's home: the meeting's own, with this call's folder put at its top, else a new
   * workspace named after the call and the day, with the folder in it. The organizer is its admin and everyone invited
   * edits; someone who came in with the link isn't in it, and has it, as everyone in the call does, while they're in the call.
   */
  protected settleHome(): void {
    const s = this.getSnapshot();
    if (this.homeId !== null) return;
    const w = current();
    const name = homeName(this.meeting.title, s.startedAt);
    const now = new Date().toISOString();
    const folder: WorkspaceItem = {
      id: nextId('folder').padEnd(22, '0'), kind: 'folder', name, parent: null, by: null, createdAt: now, editedAt: now, trashedAt: null, trashedBy: null,
      restricted: false, role: 'edit', call: { startedAt: s.startedAt, on: true, here: true, noteId: null }
    };
    const chosen = this.meeting.workspaceId ? w.workspaces.find((x) => x.id === this.meeting.workspaceId) : undefined;
    let home: Space;
    if (chosen) {
      chosen.items = [folder, ...chosen.items];
      home = chosen;
    } else {
      home = { id: nextId('home'), name, role: s.isOrganizer ? 'admin' : s.role === 'guest' ? null : 'edit', inCall: false, people: this.meeting.guests.length + 1, teamAccess: null, items: [folder], createdAt: now, call: { title: this.meeting.title, at: s.startedAt } };
      w.workspaces.push(home);
    }
    this.homeId = home.id;
    for (const p of this.script.workspace?.where ?? []) {
      const x = this.find(p.who);
      if (x) this.where.set(x.id, { document: p.document, typing: p.typing ?? false, page: p.page ?? null });
    }
    const brought = (this.script.workspace?.brought ?? []).flatMap((id) => { const item = this.itemIn(home.id, id); return item ? [this.broughtOf(home.id, item)] : []; });
    this.space((x) => ({ ...x, documents: brought }));
    this.view(home.id);
  }
  private broughtOf(workspaceId: string, item: WorkspaceItem): CallWorkspace['documents'][number] {
    return { workspaceId, id: item.id, kind: item.kind, name: item.name, role: item.role };
  }
  /**
   * Everyone views `id`: what was presented, a board or the workspace, ends for good in every part of the call, said there at
   * once; what was played stops; and everyone else is on its list until they open something there. It opens to everyone in the
   * call, to edit what isn't restricted, while they're in it, and the one it used before closes to whoever isn't in it. One
   * someone else pays for opens only to its own people: a guest has nothing of it.
   */
  private view(id: string): void {
    const was = this.getSnapshot().workspace.id;
    const everyone = this.paysFor(id);
    const tree = everyone ? this.openedToCall(id) : treeOf(id);
    if (was !== null && was !== id) {
      treeOf(was).inCall = false;
      hereIn(was, []);
      for (const [k, v] of this.where) this.where.set(k, { ...v, document: v.document !== null && this.itemIn(id, v.document) ? v.document : null });
      for (const [place, p] of [...this.presented]) this.endIt(place, p, false);
    }
    const shut = !everyone && this.getSnapshot().role === 'guest';
    this.space((w) => (shut ? { ...w, id: null, home: this.homeId, name: null, canOpen: false, role: null, everyone: false, play: null }
      : { ...w, id, home: this.homeId, name: tree.name, canOpen: true, role: tree.role, everyone, play: null }));
    this.showBoard();
    this.sayWhere();
  }
  /** Who's where in the workspace everyone views, as its stream says it. */
  protected sayWhere(): void {
    const id = this.getSnapshot().workspace.id;
    if (id === null) return;
    const here = this.getSnapshot().participants.flatMap((p): WorkspaceHere[] => {
      const at = this.where.get(p.id);
      if (p.isMe || !at) return [];
      return [{ person: p.person, connection: `c_${p.id}`, callIdentity: p.id, document: at.document, block: null, typing: at.typing, page: at.page, elsewhere: false, isMe: false }];
    });
    hereIn(id, here);
  }
  /* Someone else playing or tagging you in it has opened Workspace, so the home is settled by then. */
  protected theyPlay(who: Person, documentId: string, mediaId: string): void {
    this.settleHome();
    const p = this.find(who);
    if (!p || this.getSnapshot().workspace.id === null) return;
    const now = Date.now();
    this.space((x) => ({ ...x, play: { mediaId, documentId, by: this.seatOf(p), playing: true, positionMs: 0, atMs: now, nowMs: now, mine: false, canControl: this.getSnapshot().isOrganizer } }));
  }
  protected tagsYou(who: Person, document: string, block: string | null): void {
    this.settleHome();
    const id = this.getSnapshot().workspace.id;
    const item = id === null ? undefined : this.itemIn(id, document);
    if (id === null || !item) return;
    tagYou({ id: nextId('tag'), workspaceId: id, document, name: item.name, block, by: { ...who, email: '' }, at: new Date().toISOString() });
  }
  openWorkspace(): Promise<void> { this.settleHome(); return Promise.resolve(); }
  /**
   * A workspace as someone in a call that uses it has it: everything in it that isn't restricted opens to them, to edit. For
   * someone who isn't in it, a guest say, that's all they have: its name, and no say in who has what. The world is as you see
   * it, so it's written here as you'd see it.
   */
  private openedToCall(id: string): Space {
    const tree = treeOf(id);
    tree.inCall = true;
    // The world is as Art has it: a guest with the link is in none of it.
    if (this.getSnapshot().role === 'guest') tree.role = null;
    if (tree.role !== null) return tree;
    tree.people = null;
    tree.items = tree.items.filter((i) => !i.restricted).map((i) => ({ ...i, role: 'edit' }));
    return tree;
  }
  previewWorkspace(workspaceId: string): Promise<CallWorkspaceSwitch> {
    const no = this.organizerOnly();
    if (no) return no.then(() => ({ name: '', cantOpen: [], everyone: false }));
    const tree = treeOf(workspaceId);
    const members = new Set(peopleIn(workspaceId).map((p) => p.person.email.toLowerCase()));
    const cantOpen = this.getSnapshot().participants.filter((p) => !p.isMe && (this.guests.has(p.id) || !members.has(p.person.email.toLowerCase()))).map((p) => firstOf(p.person));
    return Promise.resolve({ name: tree.name ?? '', cantOpen, everyone: this.paysFor(workspaceId) });
  }
  /**
   * Whether the call's organizer pays for a workspace, as the call opens one to everyone in it only then. One the world says
   * someone pays for (`paidBy`) is theirs; any other is taken to be the organizer's, as a call's home is.
   */
  private paysFor(workspaceId: string): boolean {
    const payer = treeOf(workspaceId).paidBy;
    return !payer || payer.email.toLowerCase() === this.meeting.organizer.email.toLowerCase();
  }
  setWorkspace(workspaceId: string): Promise<void> {
    const no = this.organizerOnly();
    if (no) return no;
    this.view(workspaceId);
    return Promise.resolve();
  }
  newWorkspace(name?: string | undefined): Promise<void> {
    const no = this.organizerOnly();
    if (no) return no;
    const id = nextId('ws');
    // Made for the call, as its home is: the organizer and everyone invited, and no guest.
    current().workspaces.push({
      id, name: name?.trim() || this.meeting.title, role: 'admin', inCall: false, people: this.meeting.guests.length + 1, teamAccess: null, items: [], createdAt: new Date().toISOString(),
      call: { title: this.meeting.title, at: this.getSnapshot().startedAt }
    });
    this.view(id);
    return Promise.resolve();
  }
  bringDocument(documentId: string, brought: boolean): Promise<void> {
    const id = this.getSnapshot().workspace.id;
    const item = id === null ? undefined : this.itemIn(id, documentId);
    if (id === null || !item) return Promise.reject(new AlcoveApiError('not-found', 'That isn’t there, or you can’t open it.'));
    this.space((w) => ({ ...w, documents: [...w.documents.filter((d) => d.id !== documentId), ...(brought ? [this.broughtOf(id, item)] : [])] }));
    return Promise.resolve();
  }
  startPlaying(documentId: string, mediaId: string, positionMs?: number | undefined): Promise<void> {
    const now = Date.now();
    this.space((w) => ({ ...w, play: { mediaId, documentId, by: this.seat, playing: true, positionMs: positionMs ?? 0, atMs: now, nowMs: now, mine: true, canControl: true } }));
    return Promise.resolve();
  }
  /** Where what's playing is now, on the server's clock. */
  private playAt(): number {
    const p = this.getSnapshot().workspace.play;
    return p ? p.positionMs + (p.playing ? Date.now() - p.atMs : 0) : 0;
  }
  pausePlaying(positionMs: number): Promise<void> {
    const now = Date.now();
    this.space((w) => (w.play ? { ...w, play: { ...w.play, playing: false, positionMs, atMs: now, nowMs: now } } : w));
    return Promise.resolve();
  }
  resumePlaying(): Promise<void> {
    const now = Date.now();
    const at = this.playAt();
    this.space((w) => (w.play ? { ...w, play: { ...w.play, playing: true, positionMs: at, atMs: now, nowMs: now } } : w));
    return Promise.resolve();
  }
  seekPlaying(positionMs: number): Promise<void> {
    const now = Date.now();
    this.space((w) => (w.play ? { ...w, play: { ...w.play, positionMs, atMs: now, nowMs: now } } : w));
    return Promise.resolve();
  }
  stopPlaying(): Promise<void> { this.space((w) => ({ ...w, play: null })); return Promise.resolve(); }
}
