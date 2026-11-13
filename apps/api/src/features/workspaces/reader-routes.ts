import { DocAwarenessBodySchema, ItemInputSchema, ItemPlaceSchema, ItemRenameSchema, MAX_PREVIEWS, PreviewItemsSchema, LIVE_STREAM_HEADER, LiveStreamNameSchema, MediaInputSchema, MAX_DOC_AWARENESS_BYTES, MAX_DOC_BYTES, MAX_DOC_UPDATE_BYTES, MentionBodySchema, PersonIdsBodySchema, PresenceBodySchema, MAX_MEDIA_PREVIEW_BYTES, DocAskBodySchema, BoardSortBodySchema, PresenterFrameNoteBodySchema } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { CALL_PASS_HEADER } from '../../callPass';
import { unb64u } from '../../crypto';
import { TooLargeError, ValidationError } from '../../errors';
import * as access from './access';
import * as drive from './drive';
import * as media from './media';
import * as presenterNotes from './presenter-notes';
import * as workspaceDocuments from './documents';
import * as mentions from './mentions';
import * as workspaces from './service';
import { body, capped } from '../../http/body';
import { clientAddress, type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerWorkspaceReaderRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { liveLimiter, presenceLimiter, mentionLimiter, idsLimiter, documentLiveLimiter, updateLimiter, updateBytesLimiter, awarenessLimiter, versionLimiter, treeLimiter, presenterLimiter, askLimiter, sortLimiter, searchLimiter, previewLimiter, pieceLimiter, mediaLimiter } = runtime.limits;
  const { readerOf, credentials, optionalOwner, COOKIE } = runtime.context;
  /** What the browser calls the stream it's opening, for it to say when it closes it: none from a browser that doesn't. */
  const streamName = (c: Context<Env>): string | null => LiveStreamNameSchema.safeParse(c.req.header(LIVE_STREAM_HEADER)).data ?? null;

  app.use('/v1/workspaces', capped(32 * 1024));

  app.use('/v1/workspaces/:id/items/*', capped(32 * 1024));

  app.use('/v1/workspaces/:id/people/*', capped(32 * 1024));

  app.get('/v1/workspaces/:id', async (c) => c.json(await workspaces.tree(d, await readerOf(c), c.req.param('id'))));

  /* Down: every line a reader may see of the tree, until they can't open it any more. Nothing is written before that's known. */
  app.get('/v1/workspaces/:id/live', async (c) => {
    const r = await readerOf(c);
    liveLimiter(access.limitKey(r), 'workspace stream');
    const run = await workspaces.open(d, credentials(c), r, c.req.param('id'), clientAddress(c), streamName(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });

  /* Where someone is in the workspace, for whoever may know. A guest in a call is here too, in what they've been given. */
  app.use('/v1/workspaces/:id/presence', capped(1024));

  app.post('/v1/workspaces/:id/presence', async (c) => {
    const r = await readerOf(c);
    presenceLimiter(access.limitKey(r), 'presence');
    await workspaces.present(d, r, c.req.param('id'), await body(c, PresenceBodySchema));
    return c.json({ said: true });
  });

  /*
   * Tags: someone told they were tagged, and saying you've heard. No receipts: a retry tells them twice at worst, and a
   * receipt filed under someone in a workspace outlives whatever it was about.
   */
  app.use('/v1/workspaces/:id/documents/:doc/mentions', capped(1024));

  app.post('/v1/workspaces/:id/documents/:doc/mentions', async (c) => {
    const r = await readerOf(c);
    mentionLimiter(access.limitKey(r), 'tagging people');
    await mentions.mention(d, r, c.req.param('id'), c.req.param('doc'), await body(c, MentionBodySchema));
    return c.json({ said: true });
  });

  /* The IDs documents know people by: keyed here, so one in a document says nothing about anyone's address. */
  app.use('/v1/workspaces/:id/ids', capped(64 * 1024));

  app.post('/v1/workspaces/:id/ids', async (c) => {
    const r = await readerOf(c);
    idsLimiter(access.limitKey(r), 'people’s IDs');
    return c.json({ ids: await workspaces.idsOf(d, r, c.req.param('id'), (await body(c, PersonIdsBodySchema)).emails) });
  });

  app.delete('/v1/workspaces/:id/mentions/:mention', async (c) => {
    const r = await readerOf(c);
    mentionLimiter(access.limitKey(r), 'tagging people');
    await mentions.seen(d, r, c.req.param('id'), c.req.param('mention'));
    return c.json({ seen: true });
  });

  /*
   * A document or board: its stream down, its updates and carets up, and its versions. An update that arrives twice changes
   * nothing, and a receipt would hold a copy of it, so none of this keeps one.
   */
  /** What's over a document's own limit is too much, which a browser tells from what can never be. */
  const cappedContent = (maxSize: number) => bodyLimit({ maxSize, onError: () => { throw new TooLargeError('That’s more than a document can hold.', { context: { maxSize } }); } });

  app.use('/v1/workspaces/:id/documents/:doc/updates', cappedContent(MAX_DOC_UPDATE_BYTES));

  app.use('/v1/workspaces/:id/documents/:doc/adopt', cappedContent(MAX_DOC_BYTES));

  app.use('/v1/workspaces/:id/documents/:doc/awareness', capped(Math.ceil((MAX_DOC_AWARENESS_BYTES * 4) / 3) + 1024));

  app.get('/v1/workspaces/:id/documents/:doc/live', async (c) => {
    const r = await readerOf(c);
    documentLiveLimiter(access.limitKey(r), 'document stream');
    const after = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).safeParse(c.req.query('after') ?? '0');
    if (!after.success) throw new ValidationError('Ask from a place in the document.');
    const run = await workspaceDocuments.open(d, credentials(c), r, c.req.param('id'), c.req.param('doc'), after.data, clientAddress(c), streamName(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });

  app.post('/v1/workspaces/:id/documents/:doc/updates', async (c) => {
    const r = await readerOf(c);
    updateLimiter(access.limitKey(r), 'document update');
    const length = Number(c.req.header('content-length') ?? MAX_DOC_UPDATE_BYTES);
    updateBytesLimiter(access.limitKey(r), 'document update bytes', Math.ceil(length / 1024) || 1);
    return c.json(await workspaceDocuments.appendUpdate(d, r, c.req.param('id'), c.req.param('doc'), length, () => c.req.arrayBuffer()));
  });

  app.post('/v1/workspaces/:id/documents/:doc/awareness', async (c) => {
    const r = await readerOf(c);
    awarenessLimiter(access.limitKey(r), 'document awareness');
    await workspaceDocuments.awareness(d, r, c.req.param('id'), c.req.param('doc'), unb64u((await body(c, DocAwarenessBodySchema)).update));
    return c.json({ said: true });
  });

  app.get('/v1/workspaces/:id/documents/:doc/versions', async (c) => {
    const r = await readerOf(c);
    versionLimiter(access.limitKey(r), 'document versions');
    return c.json(await workspaceDocuments.versions(d, r, c.req.param('id'), c.req.param('doc')));
  });

  app.get('/v1/workspaces/:id/documents/:doc/versions/:version', async (c) => {
    const r = await readerOf(c);
    versionLimiter(access.limitKey(r), 'document version');
    const run = await workspaceDocuments.version(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('version'), clientAddress(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });

  app.post('/v1/workspaces/:id/documents/:doc/versions/:version/restore', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaceDocuments.restoreVersion(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('version'));
    return c.json({ restored: true });
  });

  /* What someone keeps beside each frame of a board for presenting it, under their own account: the frame goes in the body, never the path. */
  app.use('/v1/workspaces/:id/documents/:doc/presenter-notes/frames', capped(32 * 1024));

  app.get('/v1/workspaces/:id/documents/:doc/presenter-notes/frames', async (c) => c.json(await presenterNotes.readFrames(d, await readerOf(c), c.req.param('id'), c.req.param('doc'))));

  app.post('/v1/workspaces/:id/documents/:doc/presenter-notes/frames', async (c) => {
    const r = await readerOf(c);
    presenterLimiter(access.limitKey(r), 'presenter notes');
    const { frame, text } = await body(c, PresenterFrameNoteBodySchema);
    await presenterNotes.writeFrame(d, r, c.req.param('id'), c.req.param('doc'), frame, text);
    return c.json({ kept: true });
  });

  /* Asking Alcove about what's selected: what goes to the notes model isn't kept, here or anywhere, and it answers only someone who can edit. */
  app.use('/v1/workspaces/:id/documents/:doc/ask', capped(64 * 1024));

  app.post('/v1/workspaces/:id/documents/:doc/ask', async (c) => {
    const r = await readerOf(c);
    askLimiter(access.limitKey(r), 'ask-selection');
    return c.json(await workspaceDocuments.askAlcove(d, r, c.req.param('id'), c.req.param('doc'), await body(c, DocAskBodySchema)));
  });

  /* Sorting a board's stickies into themes: what goes to the notes model isn't kept, here or anywhere, and it answers only someone who can edit. */
  app.use('/v1/workspaces/:id/documents/:doc/sort', capped(64 * 1024));

  app.post('/v1/workspaces/:id/documents/:doc/sort', async (c) => {
    const r = await readerOf(c);
    sortLimiter(access.limitKey(r), 'board-sort');
    return c.json(await workspaceDocuments.sortStickies(d, r, c.req.param('id'), c.req.param('doc'), await body(c, BoardSortBodySchema)));
  });

  /* The words of everything a reader can open: for searching in the browser, one document a line. */
  app.get('/v1/workspaces/:id/search', async (c) => {
    const r = await readerOf(c);
    searchLimiter(access.limitKey(r), 'workspace search');
    const run = await workspaceDocuments.searchText(d, r, c.req.param('id'), clientAddress(c));
    c.header('content-type', 'application/x-ndjson');
    c.header('cache-control', 'no-store');
    return stream(c, run);
  });

  /*
   * What documents say at the top, for their cards in the Drive: read as they are, for whoever can open each, and kept
   * nowhere, so nothing caches the answer either. The IDs are in the query, which no log line holds.
   */
  app.get('/v1/workspaces/:id/previews', async (c) => {
    const r = await readerOf(c);
    const asked = PreviewItemsSchema.safeParse(c.req.query('items') ?? '');
    if (!asked.success) throw new ValidationError(`Ask for between 1 and ${MAX_PREVIEWS} documents, by their IDs.`, { context: { workspaceId: c.req.param('id') } });
    previewLimiter(access.limitKey(r), 'previews', asked.data.length);
    const found = await drive.previews(d, r, c.req.param('id'), asked.data);
    c.header('cache-control', 'no-store');
    return c.json(found);
  });

  app.get('/v1/workspaces/:id/items/:item', async (c) => c.json(await workspaces.item(d, await readerOf(c), c.req.param('id'), c.req.param('item'))));

  app.patch('/v1/workspaces/:id/items/:item', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaces.renameItem(d, r, c.req.param('id'), c.req.param('item'), (await body(c, ItemRenameSchema)).name);
    return c.json({ renamed: true });
  });

  app.post('/v1/workspaces/:id/items/:item/restore', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaces.restoreItem(d, r, c.req.param('id'), c.req.param('item'));
    return c.json({ restored: true });
  });

  /*
   * Changing the tree for a guest in a call, who has only the call's pass: the workspace the call uses opens to them to edit.
   * Anyone signed in goes on to the same routes in routes.ts, which take the pass too and keep a receipt; a guest has no account
   * to keep one under, and the browser never sends one operation twice.
   */
  const guestInCall = async (c: Context<Env>): Promise<boolean> => c.req.header(CALL_PASS_HEADER) !== undefined && (await optionalOwner(c)) === undefined;
  app.use('/v1/workspaces/:id/items', capped(32 * 1024));

  app.post('/v1/workspaces/:id/items', async (c, next) => {
    if (!(await guestInCall(c))) { await next(); return; }
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    return c.json(await workspaces.createItem(d, r, c.req.param('id'), await body(c, ItemInputSchema)));
  });

  app.post('/v1/workspaces/:id/items/:item/move', async (c, next) => {
    if (!(await guestInCall(c))) { await next(); return; }
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaces.moveItem(d, r, c.req.param('id'), c.req.param('item'), await body(c, ItemPlaceSchema));
    return c.json({ moved: true });
  });

  app.post('/v1/workspaces/:id/items/:item/duplicate', async (c, next) => {
    if (!(await guestInCall(c))) { await next(); return; }
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    return c.json(await workspaces.duplicateItem(d, r, c.req.param('id'), c.req.param('item')));
  });

  app.post('/v1/workspaces/:id/items/:item/trash', async (c, next) => {
    if (!(await guestInCall(c))) { await next(); return; }
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await workspaces.trashItem(d, r, c.req.param('id'), c.req.param('item'));
    return c.json({ trashed: true });
  });

  /*
   * Files in a workspace's documents, by session or call pass like the rest of it: a guest can read what's in a document
   * given to their seat, and add to one they can edit. Each route asks who can before it looks at what it was sent.
   * features/workspaces/media.ts does the rest.
   */
  app.use('/v1/workspaces/:id/documents/:doc/media', capped(32 * 1024));

  app.use('/v1/workspaces/:id/documents/:doc/media/:media/finish', capped(32 * 1024));

  app.use('/v1/workspaces/:id/documents/:doc/media/:media/attach', capped(32 * 1024));

  app.get('/v1/workspaces/:id/media', async (c) => c.json(await media.list(d, await readerOf(c), c.req.param('id'))));

  app.post('/v1/workspaces/:id/documents/:doc/media', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await media.mayAdd(d, r, c.req.param('id'), c.req.param('doc'));
    return c.json(await media.begin(d, r, c.req.param('id'), c.req.param('doc'), await body(c, MediaInputSchema)));
  });

  app.post('/v1/workspaces/:id/documents/:doc/media/:media/pieces/:seq', async (c) => {
    const r = await readerOf(c);
    pieceLimiter(access.limitKey(r), 'media piece');
    const sent = { declared: Number(c.req.header('content-length') ?? 0), body: () => c.req.raw.body };
    await media.storePiece(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'), c.req.param('seq'), sent);
    return c.json({ stored: true });
  });

  app.post('/v1/workspaces/:id/documents/:doc/media/:media/finish', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    return c.json(await media.finish(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media')));
  });

  app.post('/v1/workspaces/:id/documents/:doc/media/:media/attach', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await media.attach(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'));
    return c.json({ attached: true });
  });

  app.delete('/v1/workspaces/:id/documents/:doc/media/:media', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    await media.remove(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'));
    return c.json({ removed: true });
  });

  /* A picture's preview, for a picker: kept once by whoever can edit, and read by whoever can read the picture. None is 204. */
  app.use('/v1/workspaces/:id/documents/:doc/media/:media/preview', capped(MAX_MEDIA_PREVIEW_BYTES));

  app.post('/v1/workspaces/:id/documents/:doc/media/:media/preview', async (c) => {
    const r = await readerOf(c);
    treeLimiter(access.limitKey(r), 'workspace change');
    // Who can, before what was sent: someone who can't edit the document hears what they'd hear for one that isn't there.
    await media.mayAdd(d, r, c.req.param('id'), c.req.param('doc'));
    if ((c.req.header('content-type') ?? '').toLowerCase().split(';')[0]?.trim() !== 'image/jpeg') throw new ValidationError('A preview must be a JPEG image.');
    await media.storePreview(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'), new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ kept: true });
  });

  app.get('/v1/workspaces/:id/documents/:doc/media/:media/preview', async (c) => {
    const r = await readerOf(c);
    mediaLimiter(media.askerOf(r), 'media');
    const jpeg = await media.preview(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media'));
    if (!jpeg) return c.body(null, 204, { 'cache-control': 'no-store' });
    return new Response(jpeg.slice(), { headers: { 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" } });
  });

  app.get('/v1/workspaces/:id/documents/:doc/media/:media/token', async (c) => {
    const r = await readerOf(c);
    mediaLimiter(media.askerOf(r), 'media');
    return c.json({ token: await media.tokenFor(d, r, c.req.param('id'), c.req.param('doc'), c.req.param('media')) });
  });

  /* A file's bytes, for an `<img>` or a player: its token says who's asking, its cookie is all a browser sends, and features/workspaces/access.ts decides, every time. */
  app.get('/v1/media/:token', async (c) => {
    const { outgoing } = c.env;
    const closed = new AbortController();
    if (outgoing.destroyed) closed.abort();
    else outgoing.once('close', () => { closed.abort(); });
    return media.serve(d, media.tokenIn(d, c.req.param('token')), {
      session: getCookie(c, COOKIE), range: c.req.header('range'), ifRange: c.req.header('if-range'), head: c.req.method === 'HEAD', download: c.req.query('download') !== undefined,
      count: (who) => mediaLimiter(who, 'media'),
      closed: closed.signal,
      cut: () => { outgoing.destroy(); }
    });
  });
}
