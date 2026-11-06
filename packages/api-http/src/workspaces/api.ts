import { type HttpTransport } from '../transport/http';
import { type HttpOptions } from '../transport/options';
import { HttpWorkspaceLive, PRESENCE_BEAT_MS, QUIET_MS } from './live';
import { pictureReader, sendFile } from './media';
import { type AlcoveApi, AlcoveApiError, BoardThemesSchema, CALL_PASS_HEADER, CreatedSchema, DOC_UPDATE_TYPE, DocAppendedSchema, DocAskPartSchema, DocLiveEventSchema, DocumentLibrarySchema, DocumentShareSchema, DocVersionLineSchema, type DocVersionSummary, DocVersionSummarySchema, fromBase64Url, MediaTokenAnswerSchema, MentionNoticeSchema, PersonIdsSchema, PresenterFrameNotesSchema, PresenterNotesSchema, SearchDocSchema, WorkspaceItemSchema, WorkspaceLiveEventSchema, WorkspaceMediaSchema, WorkspacePersonSchema, type WorkspaceReadOptions, WorkspaceSummarySchema, WorkspaceTreeSchema } from '@alcove/api';
import { z } from 'zod';

export function createWorkspacesApi(t: HttpTransport, o: HttpOptions): Pick<AlcoveApi, 'documents' | 'workspaces'> {
  const { base, emit, ndjson, parse, req, send } = t;

  /** What reads a workspace with a call pass sends, for someone who has one. */
  const withPass = (w?: WorkspaceReadOptions | undefined): Record<string, string> => (w?.pass ? { [CALL_PASS_HEADER]: w.pass } : {});

  const space = (id: string) => `/workspaces/${encodeURIComponent(id)}`;

  const itemIn = (id: string, itemId: string) => `${space(id)}/items/${encodeURIComponent(itemId)}`;

  const mediaToken = async (id: string, documentId: string, mediaId: string, w: WorkspaceReadOptions | undefined) => (await req(MediaTokenAnswerSchema, 'GET', `${mediaIn(id, documentId, mediaId)}/token`, undefined, withPass(w))).token;

  const pictures = pictureReader((level, msg, context) => emit(level, msg, context), o.mediaPatienceMs);

  /** Where a document's files are; with `mediaId`, one of them. */
  const mediaIn = (id: string, documentId: string, mediaId?: string | undefined) => `${space(id)}/documents/${encodeURIComponent(documentId)}/media${mediaId === undefined ? '' : `/${encodeURIComponent(mediaId)}`}`;
  return {
    documents: {
      list: () => req(DocumentLibrarySchema, 'GET', '/documents')
    },
    workspaces: {
      list: () => req(z.array(WorkspaceSummarySchema), 'GET', '/workspaces'),
      create: (name) => req(CreatedSchema, 'POST', '/workspaces', { name }),
      get: (id, w) => req(WorkspaceTreeSchema, 'GET', space(id), undefined, withPass(w)),
      rename: async (id, name) => { await req(z.unknown(), 'PATCH', space(id), { name }); },
      remove: async (id) => { await req(z.unknown(), 'DELETE', space(id)); },
      people: (id) => req(z.array(WorkspacePersonSchema), 'GET', `${space(id)}/people`),
      addPerson: (id, email, role) => req(CreatedSchema, 'POST', `${space(id)}/people`, { email, role }),
      setRole: async (id, personId, role) => { await req(z.unknown(), 'PATCH', `${space(id)}/people/${encodeURIComponent(personId)}`, { role }); },
      removePerson: async (id, personId) => { await req(z.unknown(), 'DELETE', `${space(id)}/people/${encodeURIComponent(personId)}`); },
      items: {
        get: (id, itemId, w) => req(WorkspaceItemSchema, 'GET', itemIn(id, itemId), undefined, withPass(w)),
        create: (id, input) => req(CreatedSchema, 'POST', `${space(id)}/items`, input),
        rename: async (id, itemId, name, w) => { await req(z.unknown(), 'PATCH', itemIn(id, itemId), { name }, withPass(w)); },
        move: async (id, itemId, to) => { await req(z.unknown(), 'POST', `${itemIn(id, itemId)}/move`, to); },
        duplicate: (id, itemId) => req(CreatedSchema, 'POST', `${itemIn(id, itemId)}/duplicate`, {}),
        trash: async (id, itemId) => { await req(z.unknown(), 'POST', `${itemIn(id, itemId)}/trash`, {}); },
        restore: async (id, itemId, w) => { await req(z.unknown(), 'POST', `${itemIn(id, itemId)}/restore`, {}, withPass(w)); },
        deleteForever: async (id, itemId) => { await req(z.unknown(), 'DELETE', itemIn(id, itemId)); }
      },
      share: {
        list: (id, documentId, w) => req(DocumentShareSchema, 'GET', `${itemIn(id, documentId)}/share`, undefined, withPass(w)),
        set: async (id, documentId, to, role, w) => { await req(z.unknown(), 'POST', `${itemIn(id, documentId)}/share`, { to, role }, withPass(w)); },
        remove: async (id, documentId, entryId, w) => { await req(z.unknown(), 'DELETE', `${itemIn(id, documentId)}/share/${encodeURIComponent(entryId)}`, undefined, withPass(w)); },
        restrict: async (id, documentId, restricted, w) => { await req(z.unknown(), 'POST', `${itemIn(id, documentId)}/restrict`, { restricted }, withPass(w)); }
      },
      mention: async (id, documentId, tag, w) => { await req(z.unknown(), 'POST', `${space(id)}/documents/${encodeURIComponent(documentId)}/mentions`, tag, withPass(w)); },
      ids: async (id, emails, w) => (await req(PersonIdsSchema, 'POST', `${space(id)}/ids`, { emails }, withPass(w))).ids,
      mentions: () => req(z.array(MentionNoticeSchema), 'GET', '/mentions'),
      mentionSeen: async (id, mentionId, w) => { await req(z.unknown(), 'DELETE', `${space(id)}/mentions/${encodeURIComponent(mentionId)}`, undefined, withPass(w)); },
      live: (id, w) => new HttpWorkspaceLive(
        (signal) => ndjson(WorkspaceLiveEventSchema, `${space(id)}/live`, signal, withPass(w)), o.liveQuietMs ?? QUIET_MS,
        (body, keepalive) => req(z.unknown(), 'POST', `${space(id)}/presence`, body, withPass(w), keepalive), o.livePresenceMs ?? PRESENCE_BEAT_MS,
        (mention) => req(z.unknown(), 'DELETE', `${space(id)}/mentions/${encodeURIComponent(mention)}`, undefined, withPass(w))
      ),
      // Yjs comes with the first document anyone opens, and stays out of everything else.
      document: async (id, documentId, opts) => {
        const at = `${space(id)}/documents/${encodeURIComponent(documentId)}`;
        const headers = withPass(opts);
        const { HttpDocSession } = await import('./documents');
        return new HttpDocSession({
          open: (after, signal) => ndjson(DocLiveEventSchema, `${at}/live?after=${after}`, signal, headers),
          update: async (update) => parse(DocAppendedSchema, await (await send('POST', `${at}/updates`, new Uint8Array(update), { 'content-type': DOC_UPDATE_TYPE, ...headers })).json(), `response from POST ${at}/updates`),
          awareness: (update, keepalive) => req(z.unknown(), 'POST', `${at}/awareness`, { update }, headers, keepalive)
        }, opts?.keep, o.liveQuietMs ?? QUIET_MS);
      },
      // Nothing's left of it if its words don't go in: a blank document would look like the copy someone asked for.
      saveCopy: async (id, { state, ...input }) => {
        const made = await req(CreatedSchema, 'POST', `${space(id)}/items`, input);
        try {
          await send('POST', `${space(id)}/documents/${encodeURIComponent(made.id)}/adopt`, new Uint8Array(state), { 'content-type': DOC_UPDATE_TYPE });
        } catch (e) {
          await req(z.unknown(), 'POST', `${itemIn(id, made.id)}/trash`, {}).then(() => req(z.unknown(), 'DELETE', itemIn(id, made.id))).catch(() => undefined);
          throw e;
        }
        return made;
      },
      versions: (id, documentId, w) => req(z.array(DocVersionSummarySchema), 'GET', `${space(id)}/documents/${encodeURIComponent(documentId)}/versions`, undefined, withPass(w)),
      version: async (id, documentId, versionId, w) => {
        const parts: Uint8Array[] = [];
        let about: DocVersionSummary | null = null;
        let expected = 0;
        for await (const line of ndjson(DocVersionLineSchema, `${space(id)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`, undefined, withPass(w))) {
          if (line.type === 'part') { parts.push(fromBase64Url(line.update)); continue; }
          const { type: _, parts: count, ...summary } = line;
          about = summary;
          expected = count;
        }
        if (!about || parts.length !== expected) throw new AlcoveApiError('network', 'That version didn’t arrive whole. Try again.');
        const update = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) { update.set(p, at); at += p.length; }
        return { ...about, update };
      },
      restoreVersion: async (id, documentId, versionId, w) => { await req(z.unknown(), 'POST', `${space(id)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/restore`, {}, withPass(w)); },
      searchText: (id, w) => ndjson(SearchDocSchema, `${space(id)}/search`, undefined, withPass(w)),
      presenterNotes: {
        get: (id, documentId, w) => req(PresenterNotesSchema, 'GET', `${space(id)}/documents/${encodeURIComponent(documentId)}/presenter-notes`, undefined, withPass(w)),
        set: async (id, documentId, text, w) => { await req(z.unknown(), 'POST', `${space(id)}/documents/${encodeURIComponent(documentId)}/presenter-notes`, { text }, withPass(w)); },
        frames: (id, boardId, w) => req(PresenterFrameNotesSchema, 'GET', `${space(id)}/documents/${encodeURIComponent(boardId)}/presenter-notes/frames`, undefined, withPass(w)),
        setFrame: async (id, boardId, frame, text, w) => { await req(z.unknown(), 'POST', `${space(id)}/documents/${encodeURIComponent(boardId)}/presenter-notes/frames`, { frame, text }, withPass(w)); }
      },
      // What's selected goes in the body, so it's never in a URL or an access log.
      ask: async function*(id, documentId, body, w) {
        yield* await req(z.array(DocAskPartSchema), 'POST', `${space(id)}/documents/${encodeURIComponent(documentId)}/ask`, body, withPass(w));
      },
      // The stickies' words go in the body, so they're never in a URL or an access log.
      sortStickies: (id, documentId, body, w) => req(BoardThemesSchema, 'POST', `${space(id)}/documents/${encodeURIComponent(documentId)}/sort`, body, withPass(w)),
      media: {
        upload: (id, documentId, file, w) => sendFile({
          begin: (input) => req(CreatedSchema, 'POST', mediaIn(id, documentId), input, withPass(w)),
          piece: async (mediaId, seq, bytes) => { parse(z.object({ stored: z.literal(true) }), await (await send('POST', `${mediaIn(id, documentId, mediaId)}/pieces/${seq}`, bytes, { ...withPass(w), 'content-type': 'application/octet-stream' }, false, w?.signal)).json(), 'piece receipt'); },
          finish: (mediaId) => req(WorkspaceMediaSchema, 'POST', `${mediaIn(id, documentId, mediaId)}/finish`, {}, withPass(w)),
          preview: async (mediaId, jpeg) => { parse(z.object({ kept: z.literal(true) }), await (await send('POST', `${mediaIn(id, documentId, mediaId)}/preview`, jpeg, { ...withPass(w), 'content-type': 'image/jpeg' }, false, w?.signal)).json(), 'preview receipt'); },
          abandon: async (mediaId) => { await req(z.object({ removed: z.literal(true) }), 'DELETE', mediaIn(id, documentId, mediaId), undefined, withPass(w)); }
        }, file, w, (level, msg, context) => emit(level, msg, context), o.mediaPatienceMs),
        // The token comes in an answer and goes in a URL: this is the only place the two meet, and neither is logged.
        url: async (id, documentId, mediaId, w) => `${base}/media/${await mediaToken(id, documentId, mediaId, w)}`,
        picture: (id, documentId, mediaId, w) => pictures({ token: () => mediaToken(id, documentId, mediaId, w), read: (token) => send('GET', `/media/${token}`, null, {}, false, w?.signal) }, w?.signal),
        preview: async (id, documentId, mediaId, w) => {
          const res = await send('GET', `${mediaIn(id, documentId, mediaId)}/preview`, null, withPass(w), false, w?.signal);
          if (res.status === 204) return null;
          const bytes = await res.blob().catch((cause: unknown) => { throw new AlcoveApiError('network', 'That preview didn’t arrive.', { cause }); });
          return URL.createObjectURL(bytes);
        },
        attach: async (id, documentId, mediaId, w) => { await req(z.object({ attached: z.literal(true) }), 'POST', `${mediaIn(id, documentId, mediaId)}/attach`, {}, withPass(w)); },
        list: (id, w) => req(z.array(WorkspaceMediaSchema), 'GET', `${space(id)}/media`, undefined, withPass(w)),
        remove: async (id, documentId, mediaId, w) => { await req(z.object({ removed: z.literal(true) }), 'DELETE', mediaIn(id, documentId, mediaId), undefined, withPass(w)); }
      }
    }
  };
}
