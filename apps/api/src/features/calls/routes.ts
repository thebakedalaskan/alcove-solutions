import { registerLiveTimerRoutes } from './timer-routes';
import { registerDirectMessageRoutes } from './direct-message-routes';
import { AskSoFarBodySchema, CallActionSchema, CallCommitBodySchema, CallJoinBodySchema, CallKeyPackageBodySchema, CallBackBodySchema, CallMessageBodySchema, CatchUpBodySchema, TranslateBodySchema, MAX_VIDEO_PIECE_BYTES, HEARD_HEADERS, CallHandOffBodySchema, CallLeaveBodySchema, DocFollowUpTickSchema, PickTimeBodySchema, SeriesAskBodySchema, PersonalEditSchema, PersonalInputSchema, ShareStartBodySchema, MoveByClaimBodySchema, MoveClaimBodySchema, MoveConfirmBodySchema, MoveReadyBodySchema, MoveStartBodySchema, type CallAction } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Owner } from '../../context';
import { AuthError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import { addLogContext } from '../../log';
import { CALL_PASS_HEADER, readPass } from '../../callPass';
import * as callsParticipants from './participants';
import * as callsLifecycle from './lifecycle';
import * as callsJoining from './joining';
import * as callsService from './service';
import * as callsWorkspaceActions from './workspace-actions';
import * as callsBoardActions from './board-actions';
import * as callsInsights from './insights';
import * as callsPermissions from './permissions';
import * as callsMls from './mls';
import * as callsRecording from './recording';
import * as moves from './moves';
import * as personal from '../notes/personal';
import * as series from '../notes/series';
import { clientAddress, type Env } from '../../http/context';
import { AUDIO_TYPES, ID128, agoOf, body, capped, clip, piece, speakerOf, videoPiece } from '../../http/body';
import { VIDEO } from '../../http/middleware';
import type { HttpRuntime } from '../../http/runtime';



export function registerCallRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;
  const { cardLimiter, pickLimiter, carryLimiter, callLimiter, moveOpenLimiter, moveSecretChangeLimiter, moveCheckLimiter, moveSecretCheckLimiter, spaceLimiter, followUpsLimiter, followUpLimiter, askNotesLimiter, othersPointLimiter, nudgeLimiter, statusLimiter, ringLimiter, chatLimiter, rejoinLimiter, moveLimiter, voiceLimiter, speechLimiter, videoLimiter, shareLimiter, askLimiter, guestAskLimiter, notesWatchLimiter, ideasWatchLimiter, momentLimiter, personalLimiter, captionLimiter } = runtime.limits;
  const { optionalOwner, signedIn } = runtime.context;
  /**
   * A question or catch-up in a call, limited for whoever asks: someone signed in by their account, which pays; a guest, whom
   * the organizer pays for, by the call and the person their pass names, which a reload or a pass from an earlier connection
   * keeps (a new connection is a new identity, never a new person: joining.ts), and a few a minute, below what someone
   * signed in gets.
   */
  const asking = async (v: callsParticipants.Viewer, what: string) => {
    const account = await v.session();
    if (account) { askLimiter(account.ownerId, what); return; }
    const guest = `${v.pass.callId}:${v.pass.person}`;
    askLimiter(guest, what);
    guestAskLimiter(guest, `guest ${what}`);
  };

  /* LiveKit's webhooks: outside /v1 (no Origin, no session); trusted only by their signature. */
  app.post('/hooks/livekit', async (c) => {
    await callsLifecycle.onRoomEvent(d, await d.livekit.verifyWebhook(await c.req.text(), c.req.header('authorization')));
    return c.json({ ok: true });
  });

  app.get('/v1/calls/:code/card', async (c) => { cardLimiter(clientAddress(c), 'call card'); return c.json(await callsJoining.card(d, c.req.param('code'), await optionalOwner(c))); });

  app.use('/v1/calls/:code/pick', capped(1024));

  app.post('/v1/calls/:code/pick', async (c) => {
    pickLimiter(clientAddress(c), 'call pick');
    return c.json(await callsJoining.pick(d, c.req.param('code'), (await body(c, PickTimeBodySchema)).at, await optionalOwner(c)));
  });

  app.get('/v1/calls/:code/series', async (c) => {
    const o = await signedIn(c);
    carryLimiter(o.ownerId, 'carry-over');
    const seriesId = await callsJoining.seriesOf(d, c.req.param('code'));
    return c.json(seriesId ? await series.read(o, seriesId) : null);
  });

  app.post('/v1/calls/:code/join', async (c) => {
    callLimiter(clientAddress(c), 'call join');
    const b = await body(c, CallJoinBodySchema);
    return c.json(await callsJoining.join(d, c.req.param('code'), { owner: await optionalOwner(c), name: b.name, mic: b.mic, cam: b.cam, identity: b.identity, keyPackage: b.keyPackage, previous: b.previous, address: clientAddress(c) }));
  });

  /*
   * Moving to another device, from the new device's side: no account or pass yet, only the code from its link and
   * then its claim, both in the body (never the path or query, so never in a log). Signed-in devices send their
   * session, which the organizer and invited people need on the device they move to.
   */
  app.use('/v1/moves/*', capped(32 * 1024));

  app.post('/v1/moves/claim', async (c) => {
    moveOpenLimiter(clientAddress(c), 'move open');
    const { code } = await body(c, MoveClaimBodySchema);
    moveSecretChangeLimiter(moves.limitKey(code), 'move change');
    return c.json(await moves.claim(d, code, await optionalOwner(c)));
  });

  app.post('/v1/moves/status', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const { claim } = await body(c, MoveByClaimBodySchema);
    moveSecretCheckLimiter(moves.limitKey(claim), 'move check');
    return c.json(await moves.status(d, claim, await optionalOwner(c)));
  });

  app.post('/v1/moves/ready', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const b = await body(c, MoveReadyBodySchema);
    moveSecretChangeLimiter(moves.limitKey(b.claim), 'move change');
    return c.json(await moves.ready(d, b, await optionalOwner(c)));
  });

  app.post('/v1/moves/arrive', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const { claim } = await body(c, MoveByClaimBodySchema);
    moveSecretChangeLimiter(moves.limitKey(claim), 'move change');
    return c.json(await moves.arrive(d, claim, await optionalOwner(c)));
  });

  app.post('/v1/moves/cancel', async (c) => {
    moveCheckLimiter(clientAddress(c), 'move');
    const { claim } = await body(c, MoveByClaimBodySchema);
    moveSecretChangeLimiter(moves.limitKey(claim), 'move change');
    await moves.cancelIn(d, claim);
    return c.json({ cancelled: true });
  });

  /* Everything about a live call needs that call's pass; the organizer's keys are opened for the request. */
  const viewerFor = async (c: Context<Env>, next: () => Promise<void>) => {
    const pass = readPass(d.cfg, c.req.header(CALL_PASS_HEADER));
    if (!pass || pass.callId !== c.req.param('id')) throw new AuthError('Join the call again to carry on.', { context: { hasPass: Boolean(pass) } });
    // The organizer's pass, and the pass of whoever hosts, count as theirs only together with the same account's session,
    // opened only for them.
    addLogContext({ callId: pass.callId, role: pass.role });
    let session: Promise<Owner | undefined> | undefined;
    // A presenter's last piece of their shared screen can arrive just after the call ends (callsRecording.appendScreen).
    const lastPiece = c.req.method === 'POST' && VIDEO.test(c.req.path);
    c.set('viewer', await callsParticipants.viewerOf(d, pass, () => { session ??= optionalOwner(c); return session; }, lastPiece));
    await next();
  };

  // Also matches the call itself (/v1/live/calls/:id): the pass is checked once per request.
  app.use('/v1/live/calls/:id/*', viewerFor);

  app.use('/v1/calls/:code/join', capped(64 * 1024));

  app.use('/v1/live/calls/:id/mls/commits', capped(3 * 1024 * 1024));

  app.use('/v1/live/calls/:id/mls/messages', capped(128 * 1024));

  app.use('/v1/live/calls/:id/mls/keypackages', capped(32 * 1024));

  app.use('/v1/live/calls/:id/shares/:share/video', capped(MAX_VIDEO_PIECE_BYTES + 1024));

  /*
   * What only the organizer may do (what the notes capture, and planning breakout rooms), and what whoever hosts may do
   * (the organizer, or someone standing in for them). A connection that hosted before, which the call has gone on from
   * (another tab or device, or someone else hosting), is told it's out of date (409, as for audio after a pause), so
   * its last audio, speech and changes stop there quietly rather than retry a refusal; anyone else is refused (403).
   */
  const refused = (v: callsParticipants.Viewer, only: string) => (v.stale
    ? new ConflictError('You’re not hosting this call from here any more.', { context: { callId: v.pass.callId, role: v.pass.role, only } })
    : new ForbiddenError(only === 'host' ? 'Only the host can do that.' : 'Only the organizer can do that.', { context: { callId: v.pass.callId, role: v.pass.role, only } }));

  const organizerOnly = (c: Context<Env>) => {
    const v = c.get('viewer');
    if (!v.isOrganizer) throw refused(v, 'organizer');
    return v;
  };

  const hostOnly = (c: Context<Env>) => {
    const v = c.get('viewer');
    if (!v.isHost) throw refused(v, 'host');
    return v;
  };

  /** What whoever hosts may do while standing in for the organizer: keep the call running, but not change its notes or rooms' plan. */
  const HOST_ACTIONS: ReadonlySet<CallAction['type']> = new Set(['deny', 'mute', 'remove', 'lock', 'spotlight', 'rooms-close', 'unavailable', 'hand-lower', 'question-resolve', 'question-pin']);

  app.get('/v1/live/calls/:id', async (c) => c.json(await callsService.state(c.get('viewer'), c.req.param('id'))));

  registerLiveTimerRoutes(app, runtime);
  registerDirectMessageRoutes(app, runtime);

  /*
   * The workspace a call uses, beyond what the call's actions do: what changing it would mean, for the organizer to decide,
   * and the call's follow-ups, which read documents and so aren't part of reading the call.
   */
  app.get('/v1/live/calls/:id/workspace/:workspace', async (c) => {
    const v = organizerOnly(c);
    spaceLimiter(v.pass.person, 'workspace');
    return c.json(await callsWorkspaceActions.previewWorkspace(v, c.req.param('id'), c.req.param('workspace')));
  });

  /* What opening a saved board would mean, for the menu to ask before anything opens. */
  app.get('/v1/live/calls/:id/boards/:workspace/:document', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'board-check');
    spaceLimiter(v.pass.person, 'workspace');
    return c.json(await callsBoardActions.boardCheck(v, c.req.param('id'), c.req.param('workspace'), c.req.param('document')));
  });

  app.use('/v1/live/calls/:id/follow-ups', capped(1024));

  app.get('/v1/live/calls/:id/follow-ups', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'follow-ups');
    followUpsLimiter(v.pass.identity, 'follow-ups');
    return c.json(await callsInsights.followUpsIn(v, c.req.param('id')));
  });

  app.post('/v1/live/calls/:id/follow-ups', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'follow-ups');
    followUpLimiter(v.pass.person, 'follow-up');
    return c.json(await callsInsights.tickDocumentFollowUp(v, c.req.param('id'), await body(c, DocFollowUpTickSchema)));
  });

  app.post('/v1/live/calls/:id/actions', async (c) => {
    const a = await body(c, CallActionSchema);
    // A raised hand, an ask for notes, whether others may point at your share, ticking a follow-up, what goes by what you
    // can open in the workspace and a board are anyone's in the call (calls.act says who gets what); keeping the call running
    // is whoever hosts'; the rest is the organizer's.
    if (callsPermissions.anyone(a)) callsParticipants.requireIn(c.get('viewer'), a.type);
    else if (HOST_ACTIONS.has(a.type)) hostOnly(c);
    else organizerOnly(c);
    // Each ask reaches the organizer, so nobody can keep asking.
    if (a.type === 'request-notes') askNotesLimiter(c.get('viewer').pass.person, 'request-notes');
    if (a.type === 'others-point') othersPointLimiter(c.get('viewer').pass.person, 'others-point');
    // A nudge reaches the person nudged, and a status every browser in the call, so nobody can keep sending either.
    if (a.type === 'nudge') nudgeLimiter(c.get('viewer').pass.person, 'nudge');
    if (a.type === 'status') statusLimiter(c.get('viewer').pass.person, 'status');
    if (a.type === 'ring') ringLimiter(c.get('viewer').organizer.ownerId, 'ring');
    if (a.type === 'follow-up' || a.type === 'follow-up-add' || a.type === 'follow-up-edit' || a.type === 'follow-up-review') followUpLimiter(c.get('viewer').pass.person, 'follow-up');
    if (a.type.startsWith('workspace-') || a.type.startsWith('present-') || a.type.startsWith('play-') || a.type.startsWith('board-')) spaceLimiter(c.get('viewer').pass.person, 'workspace');
    return c.json(await callsService.act(c.get('viewer'), c.req.param('id'), a));
  });

  /*
   * End-to-end encryption: the call's MLS log, which the API orders and relays and can't read. Everyone keeps
   * up with it; only the host's browser commits (adds and removes people); anyone in the group can chat.
   */
  app.get('/v1/live/calls/:id/mls', async (c) => {
    const after = z.coerce.number().int().nonnegative().safeParse(c.req.query('after') ?? '0');
    if (!after.success) throw new ValidationError('Ask from a position in the log.');
    return c.json(await callsMls.mlsSync(c.get('viewer'), c.req.param('id'), after.data));
  });

  app.post('/v1/live/calls/:id/mls/commits', async (c) => c.json(await callsMls.mlsCommit(hostOnly(c), c.req.param('id'), await body(c, CallCommitBodySchema))));

  app.post('/v1/live/calls/:id/mls/messages', async (c) => {
    const v = c.get('viewer');
    chatLimiter(v.pass.identity, 'chat');
    return c.json(await callsMls.mlsMessage(v, c.req.param('id'), await body(c, CallMessageBodySchema)));
  });

  app.post('/v1/live/calls/:id/mls/keypackages', async (c) => {
    rejoinLimiter(c.get('viewer').pass.identity, 'rejoin');
    await callsMls.mlsKeyPackage(c.get('viewer'), c.req.param('id'), await body(c, CallKeyPackageBodySchema));
    return c.json({ sent: true });
  });

  /* Back in after this connection was taken out while it was away (its connection dropped, or its tab slept). */
  app.post('/v1/live/calls/:id/mls/back', async (c) => {
    rejoinLimiter(c.get('viewer').pass.identity, 'rejoin');
    await callsMls.mlsBack(c.get('viewer'), c.req.param('id'), await body(c, CallBackBodySchema));
    return c.json({ sent: true });
  });

  /*
   * Moving to another device, from the device being left: by its pass, and for invited people their session too: by
   * the role the call has for them, which can be more than their pass says (someone signed in let in from the link).
   */
  app.post('/v1/live/calls/:id/moves', async (c) => {
    const v = c.get('viewer');
    moveLimiter(v.pass.identity, 'move');
    return c.json(await moves.start(v, c.req.param('id'), (await body(c, MoveStartBodySchema)).media, v.role === 'invited' ? await optionalOwner(c) : undefined));
  });

  app.get('/v1/live/calls/:id/moves', async (c) => c.json({ move: await moves.current(c.get('viewer'), c.req.param('id')) }));

  app.post('/v1/live/calls/:id/moves/confirm', async (c) => { await moves.confirm(d, c.get('viewer'), c.req.param('id'), (await body(c, MoveConfirmBodySchema)).media); return c.json({ released: true }); });

  app.delete('/v1/live/calls/:id/moves', async (c) => { await moves.cancelOut(c.get('viewer'), c.req.param('id')); return c.json({ cancelled: true }); });

  app.get('/v1/live/calls/:id/room', async (c) => c.json(await callsMls.roomToken(c.get('viewer'), c.req.param('id'))));

  /* The notes, from the browser of whoever hosts: the recording and the speech it hears. */
  app.post('/v1/live/calls/:id/audio', async (c) => c.json(await callsRecording.audio(hostOnly(c), c.req.param('id'), await piece(c))));

  /*
   * Speech for a call's transcript: from the browser of whoever hosts for the main room, or from a breakout room's scribe
   * for its room, someone invited who was sent there. A guest with the link is never either; the call takes the rest only
   * from whoever hears the part of the call it was said in.
   */
  app.post('/v1/live/calls/:id/transcribe', async (c) => {
    const v = c.get('viewer');
    if (!v.inCall || v.role === 'guest') throw refused(v, 'host');
    const speaker = speakerOf(c);
    // When the speech began, on this server's clock: measured as the request arrives, before its audio is read.
    const began = Date.now() - agoOf(c);
    // Counted once the call has said it's this browser's to send: speech it refuses can't use up the organizer's allowance.
    const count = () => { voiceLimiter(`${v.pass.callId}:${speaker}`, 'transcribe'); speechLimiter(v.organizer.ownerId, 'transcribe'); };
    return c.json(await callsRecording.transcribe(v, c.req.param('id'), await clip(c), speaker, began, count));
  });

  /*
   * Shared screens: anyone let in can share, and says whether each share goes in the notes; while one that does is
   * going, their own browser sends its video in pieces. Only their own share, checked by the call.
   */
  app.post('/v1/live/calls/:id/shares', async (c) => {
    const v = c.get('viewer');
    shareLimiter(v.pass.identity, 'share');
    return c.json(await callsRecording.startShare(v, c.req.param('id'), (await body(c, ShareStartBodySchema)).notes));
  });

  app.post('/v1/live/calls/:id/shares/:share/video', async (c) => {
    const v = c.get('viewer');
    // Not only while they're in: someone who just left still sends their share's last piece, which the call checks.
    videoLimiter(v.pass.identity, 'screen-video');
    const share = c.req.param('share');
    if (!ID128.test(share)) throw new NotFoundError('That share doesn’t exist.');
    return c.json(await callsRecording.appendScreen(v, c.req.param('id'), share, await videoPiece(c)));
  });

  app.post('/v1/live/calls/:id/shares/:share/ended', async (c) => {
    const v = c.get('viewer');
    shareLimiter(v.pass.identity, 'share-ended');
    const share = c.req.param('share');
    if (!ID128.test(share)) throw new NotFoundError('That share doesn’t exist.');
    return c.json(await callsRecording.shareEnded(v, c.req.param('id'), share));
  });

  /*
   * Catching up and asking during a call: answers go to the person who asked, from what they may read, and nothing
   * is kept. GET says what they can catch up on; a moment of the transcript is opened with their access checked again.
   */
  app.get('/v1/live/calls/:id/catch-up', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'catch-up');
    return c.json(await callsInsights.catchUpWindow(v, c.req.param('id')));
  });

  app.post('/v1/live/calls/:id/catch-up', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'catch-up');
    await asking(v, 'catch-up');
    return c.json(await callsInsights.catchUp(v, c.req.param('id'), (await body(c, CatchUpBodySchema)).range));
  });

  app.post('/v1/live/calls/:id/ask', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'ask');
    await asking(v, 'ask');
    const { question, range } = await body(c, AskSoFarBodySchema);
    return c.json(await callsInsights.askSoFar(v, c.req.param('id'), question, range));
  });

  /* Asking across the calls before this one, during it: from the asker's own notes, so it takes their session as well as their pass. */
  app.post('/v1/live/calls/:id/series/ask', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'ask-earlier');
    const o = await signedIn(c);
    askLimiter(o.ownerId, 'ask-earlier');
    const { question, timeZone } = await body(c, SeriesAskBodySchema);
    return c.json(await callsInsights.askEarlier(v, c.req.param('id'), o, question, timeZone));
  });

  /*
   * The call's shared live notes: they come with the call. This says someone is looking at them, which is what keeps
   * them up to date: a look that finds them due refreshes them and answers once that's done, for everyone in that part
   * of the call, and any other look at the same time answers at once.
   */
  app.post('/v1/live/calls/:id/notes/watch', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'live-notes');
    notesWatchLimiter(v.pass.identity, 'live-notes');
    return c.json({ refreshed: await callsInsights.watchNotes(v, c.req.param('id')) });
  });

  /**
   * Ideas from the call: they come with the call (`board.ideas`). This says someone has its board open, which is what has them
   * looked for: a look that finds it's time reads what was said lately, and answers once that's done, for everyone in that part
   * of the call; any other look answers at once.
   */
  app.post('/v1/live/calls/:id/ideas/watch', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'board-ideas');
    ideasWatchLimiter(v.pass.identity, 'board-ideas');
    return c.json({ found: await callsInsights.watchIdeas(v, c.req.param('id')) });
  });

  app.get('/v1/live/calls/:id/transcript/:line', async (c) => {
    const v = c.get('viewer');
    callsParticipants.requireIn(v, 'moment');
    momentLimiter(v.pass.identity, 'moment');
    const line = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).safeParse(c.req.param('line'));
    if (!line.success) throw new ValidationError('That isn’t a moment of this call.');
    return c.json(await callsInsights.moment(v, c.req.param('id'), line.data));
  });

  /* Hear it, during the call: one line's recording, for anyone in it who may hear it (calls.hear says who). */
  app.get('/v1/live/calls/:id/hear/:note/:line', async (c) => {
    const v = c.get('viewer');
    momentLimiter(v.pass.identity, 'hear');
    const ids = z.object({ note: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), line: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).safeParse({ note: c.req.param('note'), line: c.req.param('line') });
    if (!ids.success) throw new ValidationError('That isn’t a moment of this call.');
    const heard = await callsInsights.hear(v, c.req.param('id'), ids.data.note, ids.data.line);
    const mime = heard.audio.mimeType.split(';')[0]?.trim() ?? '';
    return new Response(heard.audio.bytes.slice(), { headers: {
      'content-type': AUDIO_TYPES.has(mime) ? heard.audio.mimeType : 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
      [HEARD_HEADERS.from]: String(heard.from), [HEARD_HEADERS.seconds]: String(heard.seconds)
    } });
  });

  /*
   * Your own notes from inside a call: your account's, with your session, on the call's note. Nothing here goes into the
   * call's state or tells anyone else's browser.
   */
  app.use('/v1/live/calls/:id/personal/*', capped(32 * 1024));

  const ownInCall = (c: Context<Env>) => {
    const v = c.get('viewer');
    personalLimiter(v.pass.identity, 'personal');
    return callsInsights.personalIn(v, c.req.param('id') ?? '', () => optionalOwner(c));
  };

  app.get('/v1/live/calls/:id/personal', async (c) => c.json(await personal.read(await ownInCall(c))));

  app.post('/v1/live/calls/:id/personal', async (c) => c.json(await personal.add(await ownInCall(c), await body(c, PersonalInputSchema))));

  app.patch('/v1/live/calls/:id/personal/:entryId', async (c) => c.json(await personal.edit(await ownInCall(c), c.req.param('entryId'), (await body(c, PersonalEditSchema)).text)));

  app.delete('/v1/live/calls/:id/personal/:entryId', async (c) => c.json(await personal.remove(await ownInCall(c), c.req.param('entryId'))));

  /* Captions in someone's own language: translated for them alone, so no receipt keeps a copy. */
  app.post('/v1/live/calls/:id/translate', async (c) => {
    const v = c.get('viewer');
    const { language, lines } = await body(c, TranslateBodySchema);
    captionLimiter(v.pass.identity, 'translate');
    return c.json(await callsInsights.translate(v, c.req.param('id'), language, lines));
  });

  /* Whoever hosts leaving ends the call for everyone, unless they hand it to someone; anyone else leaving is taken out of the call's group. */
  app.post('/v1/live/calls/:id/leave', async (c) => {
    const { end, onPurpose } = await body(c, CallLeaveBodySchema);
    return c.json({ ended: await callsLifecycle.leave(c.get('viewer'), c.req.param('id'), end, onPurpose) });
  });

  app.post('/v1/live/calls/:id/hand-off', async (c) => {
    const v = hostOnly(c);
    await callsLifecycle.handOff(v, c.req.param('id'), (await body(c, CallHandOffBodySchema)).to);
    return c.json({ left: true });
  });
}
