/*
 * Workspaces, as the stand-in answers for them (packages/api-http/src/workspaces/api.ts is the real client's): a
 * workspace's tree and who's in it, its documents and boards, their files, sharing and versions, tags, what the Drive
 * shows of them, and asking about what's in one. What the world keeps of them, and how a document is a real Y.Doc, is
 * workspaces.ts.
 */
import type { AlcoveApi, BoardSortBody, DocAskBody, DocAskPart, ID, TeamAccess, WorkspaceReadOptions } from '@alcove/api';
import { canvasTheme } from '../../world/boards';
import { licensed, licensedCount } from '../account/teams';
import { answer, refused } from '../answer';
import { nextId } from '../state';
import { previewsIn, trashIn } from './previews';
import * as spaces from './workspaces';

/** With a call's pass, anyone in the call asks, a guest too, as the API reads it with the pass; without one, an account. */
const asWho = (o?: WorkspaceReadOptions | undefined): 'anyone' | 'signed-in' => (o?.pass ? 'anyone' : 'signed-in');
/**
 * Changing what's in a workspace's tree: someone in it who can edit, or with a call's pass, anyone in a call that uses it.
 * Deleting for good is never a pass's (`alone`).
 */
function mayChange(id: string, o?: WorkspaceReadOptions | undefined, alone = false): void {
  const tree = spaces.treeOf(id);
  if (tree.role === 'admin' || tree.role === 'edit' || (!alone && o?.pass !== undefined && tree.inCall)) return;
  throw refused('forbidden', 'You can read this workspace, but not change it.');
}

export const workspacesApi: Pick<AlcoveApi, 'documents' | 'workspaces'> = {
  documents: { list: () => answer((w) => w.documents) },
  workspaces: {
    list: () => answer(spaces.workspaceList),
    // On a team, while licensed, it's the team's: the whole team's unless only the people added are asked for.
    create: (name: string, opts?: { access?: TeamAccess | undefined }) => answer((w) => {
      const id = nextId('ws');
      const teamAccess = licensed(w) ? opts?.access ?? 'team' : null;
      w.workspaces.push({ id, name, role: 'admin', inCall: false, people: teamAccess === 'team' ? licensedCount(w) : 1, teamAccess, items: [], createdAt: new Date().toISOString(), call: null });
      return { id };
    }),
    setTeamAccess: (id: ID, access: TeamAccess) => answer((w) => {
      const space = spaces.treeOf(id);
      if (space.role !== 'admin') throw refused('forbidden', 'Only an admin can do that.');
      if (space.teamAccess === null) throw refused('conflict', 'This workspace isn’t a team’s, so there’s no team to open it to.');
      space.teamAccess = access;
      space.people = access === 'team' ? Math.max(space.people ?? 1, licensedCount(w)) : space.people;
    }),
    get: (id: ID, o) => answer(() => spaces.treeFor(id), asWho(o)),
    presenterNotes: {
      frames: (_id: ID, boardId: ID) => answer(() => ({ frames: spaces.presenterFrameNotes(boardId) })),
      setFrame: (_id: ID, boardId: ID, frame: string, text: string) => answer(() => { spaces.keepFrameNotes(boardId, frame, text); })
    },
    media: {
      upload: async (id: ID, documentId: ID, file: File, o) => { await answer(() => null, asWho(o)); return spaces.upload(id, documentId, file, o); },
      // A `download` needs nothing more here: the URL is this page's own, so the link the app follows saves it under its name.
      url: async (id: ID, documentId: ID, mediaId: ID, o) => { await answer(() => null, asWho(o)); return spaces.urlOf(id, documentId, mediaId); },
      picture: async (id: ID, documentId: ID, mediaId: ID, o) => { await answer(() => null, asWho(o)); return spaces.pictureOf(id, documentId, mediaId, o); },
      preview: async (id: ID, documentId: ID, mediaId: ID, o) => { await answer(() => null, asWho(o)); return spaces.previewOf(id, documentId, mediaId, o); },
      attach: (id: ID, documentId: ID, mediaId: ID, o) => answer(() => spaces.attach(id, documentId, mediaId), asWho(o)),
      list: (id: ID, o) => answer(() => spaces.mediaIn(id), asWho(o)),
      remove: (id: ID, documentId: ID, mediaId: ID, o) => answer(() => spaces.removeMedia(id, documentId, mediaId, o), asWho(o))
    },
    ask: (_id: ID, _documentId: ID, body: DocAskBody) => (async function* (): AsyncIterable<DocAskPart> {
      if (body.action === 'checklist') { for (const line of body.text.split(/[.\n]+/).map((x) => x.trim()).filter(Boolean)) yield { type: 'todo', text: line }; return; }
      yield { type: 'text', text: body.text.split(/(?<=\.)\s/)[0] ?? body.text };
    })(),
    /**
     * Sorts stickies the way the notes model might: the canvas's ideas into the canvas's three themes, and anything else by its
     * first word, those that start with the same word one theme, named for it.
     */
    sortStickies: (_id: ID, _documentId: ID, body: BoardSortBody) => answer(() => {
      const themes = new Map<string, string[]>();
      for (const s of body.stickies) {
        const word = s.text.trim().split(/\s+/)[0] ?? '';
        const name = canvasTheme(s.text) ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        themes.set(name, [...(themes.get(name) ?? []), s.id]);
      }
      return { themes: [...themes].map(([name, ids]) => ({ name, ids })) };
    }),
    rename: (id: ID, name: string) => answer(() => { spaces.treeOf(id).name = name; }),
    remove: (id: ID) => answer(() => spaces.removeWorkspace(id)),
    people: (id: ID) => answer(() => spaces.peopleIn(id)),
    addPerson: (id: ID, email: string, role) => answer(() => spaces.addPerson(id, email, role)),
    setRole: (id: ID) => answer(() => { spaces.treeOf(id); }),
    removePerson: (id: ID) => answer(() => { spaces.treeOf(id); }),
    items: {
      get: (id: ID, itemId: ID, o) => answer(() => {
        const item = spaces.treeOf(id).items.find((i) => i.id === itemId);
        if (!item) throw refused('not-found', 'That isn’t there, or you can’t open it.');
        return item;
      }, asWho(o)),
      create: (id: ID, input, o) => answer(() => { mayChange(id, o); return spaces.createItem(id, input); }, asWho(o)),
      rename: (id: ID, itemId: ID, name: string, o) => answer(() => spaces.renameItem(id, itemId, name), asWho(o)),
      move: (id: ID, itemId: ID, to, o) => answer(() => { mayChange(id, o); spaces.moveItem(id, itemId, to); }, asWho(o)),
      duplicate: (id: ID, itemId: ID, o) => answer(() => { mayChange(id, o); return spaces.duplicateItem(id, itemId); }, asWho(o)),
      trash: (id: ID, itemId: ID, o) => answer(() => { mayChange(id, o); spaces.trashItem(id, itemId); }, asWho(o)),
      restore: (id: ID, itemId: ID, o) => answer(() => spaces.restoreItem(id, itemId), asWho(o)),
      deleteForever: (id: ID, itemId: ID) => answer(() => { mayChange(id, undefined, true); spaces.deleteItem(id, itemId); })
    },
    share: {
      list: (id: ID, documentId: ID) => answer(() => spaces.shareOf(id, documentId)),
      set: (_id: ID, documentId: ID, to, role) => answer(() => spaces.shareWith(documentId, to, role)),
      remove: (_id: ID, documentId: ID, entryId: ID) => answer(() => spaces.unshare(documentId, entryId)),
      restrict: (id: ID, documentId: ID, restricted: boolean) => answer(() => spaces.restrict(id, documentId, restricted))
    },
    mention: (id: ID, documentId: ID, tag, o) => answer(() => spaces.mention(id, documentId, tag), asWho(o)),
    ids: (id: ID, emails: string[], o) => answer(() => spaces.idsIn(id, emails), asWho(o)),
    mentions: () => answer(() => spaces.mentionsEverywhere()),
    mentionSeen: (_id: ID, mentionId: ID, o) => answer(() => spaces.seeMention(mentionId), asWho(o)),
    live: (id: ID) => spaces.liveWorkspace(id),
    document: async (id: ID, documentId: ID, o) => { await answer(() => null, asWho(o)); return spaces.openDocument(id, documentId); },
    saveCopy: (id: ID, input) => answer(() => spaces.saveCopy(id, input)),
    versions: (id: ID, documentId: ID, o) => answer(() => spaces.versionsOf(id, documentId), asWho(o)),
    version: (id: ID, documentId: ID, versionId: ID, o) => answer(() => spaces.versionOf(id, documentId, versionId), asWho(o)),
    restoreVersion: (id: ID, _documentId: ID, _versionId: ID, o) => answer(() => { spaces.treeOf(id); }, asWho(o)),
    searchText: (id: ID) => spaces.searchText(id),

    previews: (id: ID, items: ID[]) => answer((w) => previewsIn(w, id, items)),
    trashed: () => answer(trashIn),

    about: (id: ID) => answer((w) => { spaces.treeOf(id); return w.workspaces.find((x) => x.id === id)?.about ?? ''; }),
    setAbout: (id: ID, about: string) => answer((w) => {
      spaces.treeOf(id);
      const space = w.workspaces.find((x) => x.id === id);
      if (space) space.about = about.replace(/\s+/g, ' ').trim();
    }),
  }
};
