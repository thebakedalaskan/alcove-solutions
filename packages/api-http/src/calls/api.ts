import { createPersonalApi } from '../notes/personal';
import { createAudioTransport } from '../transport/audio';
import { createHttpTransport, type HttpTransport } from '../transport/http';
import { type HttpOptions } from '../transport/options';
import { MlsKeys, newIdentity } from './mls';
import { HttpMoveIn, type MoveInTransport } from './moves';
import { HttpRings } from './rings';
import { HttpCall } from './session';
import { type AlcoveApi, type ListenerApi, ListenerJoinedSchema, AlcoveApiError, AUDIO_HEADERS, BoardCheckSchema, CALL_PASS_HEADER, CallAnswerSchema, CallCardSchema, CallEndResultSchema, CallFollowUpsSchema, CallMlsSchema, CallMomentSchema, CallRoomTokenSchema, type CallSession, type CallState, CallStateSchema, type CallTicket, CallTicketSchema, CallWorkspaceSwitchSchema, CaptionTranslationSchema, CatchUpSchema, CatchUpWindowSchema, FRAME_HEADERS, HEARD_HEADERS, IdeasWatchedSchema, MoveClaimSchema, MoveCodeSchema, MoveInSchema, MoveOutSchema, NotesWatchedSchema, RingsSnapshotSchema, ScreenFrameReceiptSchema, SeriesAnswerPartSchema, SeriesSchema, type TranscriptClip } from '@alcove/api';
import { z } from 'zod';
export function createCallsApi(t: HttpTransport, o: HttpOptions): Pick<AlcoveApi, 'calls' | 'rings'> {
  return build(t, o).api;
}

/** The API as the listener service (apps/listener) reaches it, with its key (the API's LISTENER_KEY): never the app's. */
export function createListenerApi(o: HttpOptions & { key: string }): ListenerApi {
  return build(createHttpTransport(o), o).listener(o.key);
}

function build(t: HttpTransport, o: HttpOptions): { api: Pick<AlcoveApi, 'calls' | 'rings'>; listener: (key: string) => ListenerApi } {
  const { emit, ndjson, parse, req, send } = t;
  const { audio, clip } = createAudioTransport(t);
  const personal = createPersonalApi(t);

  /** Every stream of rings this client has open, so an answer leaves them all at once. */
  const ringing = new Set<HttpRings>();

  /**
   * How long ago a call's clip of speech began, as it's sent (it may have waited behind others): the server places it
   * where its speaker was then. A clip that doesn't say when it began counts as said just now.
   */
  const ago = (c: TranscriptClip) => String(Math.max(0, Math.round(c.heardAt === undefined ? 0 : performance.now() - c.heardAt)));

  /** How often a move to another device is checked on while it's open, in ms. */
  const movePollMs = Math.min(1000, o.callPollMs ?? 1000);

  /** The new device's side of a move: everything by its claim, in the body. */
  const moving: MoveInTransport = {
    status: (claim) => req(MoveInSchema, 'POST', '/moves/status', { claim }),
    ready: (b) => req(MoveInSchema, 'POST', '/moves/ready', b),
    arrive: (claim) => req(MoveInSchema, 'POST', '/moves/arrive', { claim }),
    cancel: async (claim) => { await req(z.object({ cancelled: z.literal(true) }), 'POST', '/moves/cancel', { claim }); }
  };

  /** A call session for a ticket, with the MLS keys made in this browser for it: by joining, or by moving here. */
  const connect = async (joined: { ticket: CallTicket; state: CallState }, mls: MlsKeys): Promise<CallSession> => {
    // Every request about the call carries its pass; guests have no session, so this is all they have.
    const p = { [CALL_PASS_HEADER]: joined.ticket.pass };
    const live = (id: string) => `/live/calls/${id}`;
    const call = new HttpCall(joined.state, joined.ticket, mls, { pollMs: o.callPollMs ?? 1500, notesMs: o.callNotesMs ?? 5000, ideasMs: o.callIdeasMs ?? 15_000, switchMs: o.callKeySwitchMs ?? 2000, rekeyMs: o.callRekeyMs ?? 10 * 60_000, movePollMs }, {
      get: (id) => req(CallStateSchema, 'GET', live(id), undefined, p),
      act: (id, a) => req(CallStateSchema, 'POST', `${live(id)}/actions`, a, p),
      audio: async (id, piece) => parse(CallStateSchema, await audio(`${live(id)}/audio`, piece, p), 'call state'),
      transcribe: async (id, c, speaker) => parse(CallStateSchema, await clip(`${live(id)}/transcribe`, c, { ...p, [AUDIO_HEADERS.speaker]: speaker, [AUDIO_HEADERS.ago]: ago(c) }), 'call state'),
      // A frame of this browser's own share: JPEG bytes, which share, and how long ago it was taken.
      frame: async (id, f) => parse(ScreenFrameReceiptSchema, await (await send('POST', `${live(id)}/frames`, f.data, {
        ...p, 'content-type': 'image/jpeg', [FRAME_HEADERS.share]: f.share, [FRAME_HEADERS.age]: String(Math.max(0, Math.round(Date.now() - f.takenAt)))
      })).json(), 'frame receipt'),
      shareEnded: async (id, share) => { await req(z.object({ ended: z.literal(true) }), 'POST', `${live(id)}/frames/ended`, { share }, p); },
      watchNotes: async (id) => (await req(NotesWatchedSchema, 'POST', `${live(id)}/notes/watch`, {}, p)).refreshed,
      watchIdeas: async (id) => (await req(IdeasWatchedSchema, 'POST', `${live(id)}/ideas/watch`, {}, p)).found,
      followUps: (id) => req(CallFollowUpsSchema, 'GET', `${live(id)}/follow-ups`, undefined, p),
      tickDocument: (id, t) => req(CallFollowUpsSchema, 'POST', `${live(id)}/follow-ups`, t, p),
      previewWorkspace: (id, workspaceId) => req(CallWorkspaceSwitchSchema, 'GET', `${live(id)}/workspace/${encodeURIComponent(workspaceId)}`, undefined, p),
      boardCheck: (id, workspaceId, documentId) => req(BoardCheckSchema, 'GET', `${live(id)}/boards/${encodeURIComponent(workspaceId)}/${encodeURIComponent(documentId)}`, undefined, p),
      catchUp: (id, range) => req(CatchUpSchema, 'POST', `${live(id)}/catch-up`, { range }, p),
      askSoFar: (id, question, range) => req(CallAnswerSchema, 'POST', `${live(id)}/ask`, { question, range }, p),
      catchUpWindow: (id) => req(CatchUpWindowSchema, 'GET', `${live(id)}/catch-up`, undefined, p),
      moment: (id, lineId) => req(CallMomentSchema, 'GET', `${live(id)}/transcript/${encodeURIComponent(lineId)}`, undefined, p),
      hear: async (id, note, line) => {
        const res = await send('GET', `${live(id)}/hear/${encodeURIComponent(note)}/${encodeURIComponent(line)}`, null, p);
        const where = z.object({ from: z.coerce.number().min(0), seconds: z.coerce.number().min(0) }).parse({ from: res.headers.get(HEARD_HEADERS.from), seconds: res.headers.get(HEARD_HEADERS.seconds) });
        const audio = await res.blob().catch((cause: unknown) => { throw new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.', { cause }); });
        return { audio, ...where };
      },
      personal: (id) => personal(`${live(id)}/personal`, p),
      askEarlier: (id, question, timeZone) => req(z.array(SeriesAnswerPartSchema), 'POST', `${live(id)}/series/ask`, { question, timeZone }, p),
      translate: (id, lines, language) => req(z.array(CaptionTranslationSchema), 'POST', `${live(id)}/translate`, { language, lines }, p),
      leave: async (id, o) => (await req(z.object({ ended: CallEndResultSchema.nullable() }), 'POST', `${live(id)}/leave`, { end: o.end, onPurpose: o.onPurpose ?? false }, p, o.keepalive ?? false)).ended,
      handOff: async (id, to) => { await req(z.object({ left: z.literal(true) }), 'POST', `${live(id)}/hand-off`, { to }, p); },
      mls: (id, after) => req(CallMlsSchema, 'GET', `${live(id)}/mls?after=${after}`, undefined, p),
      commit: (id, c) => req(z.object({ epoch: z.number() }), 'POST', `${live(id)}/mls/commits`, c, p),
      message: async (id, m) => { await req(z.object({ sent: z.literal(true) }), 'POST', `${live(id)}/mls/messages`, m, p); },
      keyPackage: async (id, k) => { await req(z.object({ sent: z.literal(true) }), 'POST', `${live(id)}/mls/keypackages`, k, p); },
      back: async (id, k) => { await req(z.object({ sent: z.literal(true) }), 'POST', `${live(id)}/mls/back`, k, p); },
      room: (id) => req(CallRoomTokenSchema, 'GET', `${live(id)}/room`, undefined, p),
      moveStart: (id, media) => req(MoveCodeSchema, 'POST', `${live(id)}/moves`, { media }, p),
      moveCurrent: async (id) => (await req(z.object({ move: MoveOutSchema.nullable() }), 'GET', `${live(id)}/moves`, undefined, p)).move,
      moveConfirm: async (id, media) => { await req(z.object({ released: z.literal(true) }), 'POST', `${live(id)}/moves/confirm`, { media }, p); },
      moveCancel: async (id) => { await req(z.object({ cancelled: z.literal(true) }), 'DELETE', `${live(id)}/moves`, undefined, p); }
    }, (level, msg, context) => emit(level, msg, context));
    await call.start();
    return call;
  };
  /** The listener service's side: everything it sends carries its key. */
  const listener = (key: string): ListenerApi => {
    const asListener = { authorization: `Bearer ${key}` };
    return {
      join: async (invite) => {
        // Like a browser joining: this connection's identity and MLS keys are made here, and only its key package goes.
        const identity = newIdentity();
        const mls = await MlsKeys.make(identity);
        const joined = await req(ListenerJoinedSchema, 'POST', '/listeners/join', { invite, identity, keyPackage: mls.keyPackage() }, asListener);
        return { place: joined.place, session: await connect(joined, mls) };
      }
    };
  };

  const api: Pick<AlcoveApi, 'calls' | 'rings'> = {
    calls: {
      startNow: (input) => req(z.object({ code: z.string() }), 'POST', '/calls', input ?? {}),
      card: (code) => req(CallCardSchema, 'GET', `/calls/${encodeURIComponent(code)}/card`),
      pick: (code, at) => req(CallCardSchema, 'POST', `/calls/${encodeURIComponent(code)}/pick`, { at }),
      series: (code) => req(SeriesSchema.nullable(), 'GET', `/calls/${encodeURIComponent(code)}/series`),
      join: async (code, opts) => {
        // This connection's identity and MLS keys are made here; key packages are all the API gets.
        const identity = newIdentity();
        const mls = await MlsKeys.make(identity);
        const body = { mic: opts.mic, cam: opts.cam, identity, keyPackage: mls.keyPackage(), ...(opts.name ? { name: opts.name } : {}), ...(opts.previous ? { previous: opts.previous } : {}) };
        return connect(await req(z.object({ ticket: CallTicketSchema, state: CallStateSchema }), 'POST', `/calls/${encodeURIComponent(code)}/join`, body), mls);
      },
      openMove: async (code) => {
        // The code goes in the body, once: from here on this device holds the claim that replaced it.
        const opened = await req(MoveClaimSchema, 'POST', '/moves/claim', { code });
        return new HttpMoveIn(opened.claim, opened.move, moving, connect, { pollMs: movePollMs }, (level, msg, context) => emit(level, msg, context));
      },
      resumeMove: async (claim) => new HttpMoveIn(claim, await moving.status(claim), moving, connect, { pollMs: movePollMs }, (level, msg, context) => emit(level, msg, context))
    },
    rings: {
      live: () => {
        const rings: HttpRings = new HttpRings((signal) => ndjson(RingsSnapshotSchema, '/rings', signal), o.ringSilenceMs ?? 50_000, emit, () => { ringing.delete(rings); });
        ringing.add(rings);
        return rings;
      },
      answer: async (id, reply) => {
        await req(z.object({ answered: z.literal(true) }), 'POST', `/rings/${encodeURIComponent(id)}/answer`, { reply });
        for (const r of ringing) r.answeredHere(id);
      }
    }
  };
  return { api, listener };
}
