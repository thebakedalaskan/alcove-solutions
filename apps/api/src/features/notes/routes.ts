import { FollowUpReviewSchema, ActionPatchSchema, ActionProposalSchema, AskBodySchema, DecisionPatchSchema, DecisionProposalSchema, LinePatchSchema, NoteKindSchema, QuestionPatchSchema, RevisitPatchSchema, SeriesAskBodySchema, ShareInputSchema, PersonalEditSchema, PersonalInputSchema, PromoteBodySchema } from '@alcove/api';
import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import * as additions from './additions';
import * as audioMod from '../recordings/audio';
import * as notes from './service';
import * as personal from './personal';
import * as series from './series';
import * as writer from './writer';
import { AUDIO_TYPES, ID128, MOST_AUDIO_PER_REPLY, body, byteRange, capped } from '../../http/body';
import { type Env } from '../../http/context';
import type { HttpRuntime } from '../../http/runtime';



export function registerNoteRoutes(app: Hono<Env>, runtime: HttpRuntime): void {
  const { noteChangeLimiter, askLimiter, personalLimiter } = runtime.limits;

  /* notes */
  // Search terms travel in the body, never the URL, so they can't end up in access logs.
  app.post('/v1/notes/search', async (c) => {
    const q = await body(c, z.object({ kind: NoteKindSchema.optional(), text: z.string().max(200).optional() }));
    return c.json(await notes.list(c.get('owner'), { kind: q.kind, text: q.text }));
  });

  app.get('/v1/notes/inbox', async (c) => c.json(await notes.inbox(c.get('owner'))));

  app.get('/v1/notes/:id', async (c) => c.json(await notes.get(c.get('owner'), c.req.param('id'))));

  app.get('/v1/notes/:id/progress', async (c) => {
    const o = c.get('owner'); const id = c.req.param('id');
    c.header('content-type', 'application/x-ndjson');
    return stream(c, async (s) => {
      for (let i = 0; i < 120; i++) {
        const p = await notes.progress(o, id);
        await s.write(`${JSON.stringify(p)}\n`);
        if (p.ready) return;
        await s.sleep(1000);
      }
    });
  });

  /*
   * The first `pieces` of a segment, which stay the same file however much more is recorded. A range is for the
   * browser's own player; all of it, chunked, is for one that can't seek by range and fetches it whole.
   */
  app.get('/v1/notes/:id/audio/:segment', async (c) => {
    const gone = c.req.raw.signal;
    const o = c.get('owner');
    const segment = z.coerce.number().int().min(0).parse(c.req.param('segment'));
    const pieces = z.coerce.number().int().min(1).parse(c.req.query('pieces'));
    const n = await notes.get(o, c.req.param('id'));
    const seg = n.audio.find((a) => a.index === segment);
    if (!seg) throw new NotFoundError('No audio in that part of the recording.');
    const source = await notes.audioSource(o, n.id);
    const file = await audioMod.file(source.owner, source.recordingId, segment, pieces);
    const mime = seg.mimeType.split(';')[0] ?? '';
    const headers = { 'content-type': AUDIO_TYPES.has(mime) ? mime : 'application/octet-stream', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
    if (c.req.method === 'HEAD') return c.body(null, 200, { ...headers, 'content-length': String(file.bytes) });
    const range = byteRange(c.req.header('range'), file.bytes);
    if (range === null) return c.body(null, 416, { ...headers, 'content-range': `bytes */${file.bytes}` });
    if (!range) return c.body(await audioMod.body(file.read(0, file.bytes - 1), gone), 200, headers);
    const { from } = range;
    const to = Math.min(range.to, from + MOST_AUDIO_PER_REPLY - 1);
    return c.body(await audioMod.body(file.read(from, to), gone), 206, { ...headers, 'content-length': String(to - from + 1), 'content-range': `bytes ${from}-${to}/${file.bytes}` });
  });

  /* A note's shared-screen frame, for anyone who has the note: decrypted here, never cached by the browser. */
  app.get('/v1/notes/:id/screens/:frameId', async (c) => {
    const frameId = c.req.param('frameId');
    if (!ID128.test(frameId)) throw new NotFoundError('That frame doesn’t exist.');
    const jpeg = await notes.screenImage(c.get('owner'), c.req.param('id'), frameId);
    return new Response(jpeg.slice(), { headers: { 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'" } });
  });

  /* Confirming what the notes say, and adding to it: as far as the grants let them (packages/api/src/grants.ts), and everyone sees who did. */
  const changing = (c: Context<Env>) => { const o = c.get('owner'); noteChangeLimiter(o.ownerId, 'note-change'); return o; };

  app.post('/v1/notes/:id/decisions', async (c) => c.json(await notes.proposeDecision(changing(c), c.req.param('id'), await body(c, DecisionProposalSchema))));

  app.post('/v1/notes/:id/actions/review', async (c) => c.json(await notes.reviewAction(changing(c), c.req.param('id'), await body(c, FollowUpReviewSchema))));

  app.post('/v1/notes/:id/actions', async (c) => c.json(await notes.proposeAction(changing(c), c.req.param('id'), await body(c, ActionProposalSchema))));

  app.patch('/v1/notes/:id/decisions/:decisionId', async (c) => c.json(await notes.updateDecision(changing(c), c.req.param('id'), c.req.param('decisionId'), await body(c, DecisionPatchSchema))));

  app.patch('/v1/notes/:id/actions/:actionId', async (c) => c.json(await notes.updateAction(changing(c), c.req.param('id'), c.req.param('actionId'), await body(c, ActionPatchSchema))));

  app.patch('/v1/notes/:id/questions/:questionId', async (c) => c.json(await notes.updateQuestion(changing(c), c.req.param('id'), c.req.param('questionId'), await body(c, QuestionPatchSchema))));

  app.patch('/v1/notes/:id/lines/:lineId', async (c) => c.json(await notes.correctLine(changing(c), c.req.param('id'), c.req.param('lineId'), await body(c, LinePatchSchema))));

  app.patch('/v1/notes/:id/revisits/:revisitId', async (c) => c.json(await notes.updateRevisit(changing(c), c.req.param('id'), c.req.param('revisitId'), await body(c, RevisitPatchSchema))));

  app.post('/v1/notes/:id/rewrite', async (c) => {
    const o = c.get('owner');
    // Writing the notes again costs inference and isn't charged, so it shares the questions' allowance.
    askLimiter(o.ownerId, 'rewrite');
    const note = await notes.rewrite(o, c.req.param('id'));
    writer.kick(o, o.ownerId);
    return c.json(note);
  });

  app.post('/v1/notes/:id/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask');
    return c.json(await notes.ask(c.get('owner'), c.req.param('id'), (await body(c, AskBodySchema)).question));
  });

  /* Asking across every note you have, under the same limit as asking about one. */
  app.post('/v1/notes/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask');
    return c.json(await notes.askAll(c.get('owner'), (await body(c, AskBodySchema)).question));
  });

  app.post('/v1/notes/:id/share', async (c) => c.json(await notes.share(c.get('owner'), c.req.param('id'), await body(c, ShareInputSchema))));

  /*
   * Your own notes on a note you have: only ever your own, so there's nothing here to ask for by anyone else's ID. Adding
   * something to the shared notes takes a preview first, then saying so with the preview's seal.
   */
  app.use('/v1/notes/:id/personal/*', capped(32 * 1024));

  const ownOnNote = (c: Context<Env>) => {
    const o = c.get('owner');
    personalLimiter(o.ownerId, 'personal');
    return personal.ofNote(o, c.req.param('id') ?? '');
  };

  app.get('/v1/notes/:id/personal', async (c) => c.json(await personal.read(await ownOnNote(c))));

  app.post('/v1/notes/:id/personal', async (c) => c.json(await personal.add(await ownOnNote(c), await body(c, PersonalInputSchema))));

  app.patch('/v1/notes/:id/personal/:entryId', async (c) => c.json(await personal.edit(await ownOnNote(c), c.req.param('entryId'), (await body(c, PersonalEditSchema)).text)));

  app.delete('/v1/notes/:id/personal/:entryId', async (c) => c.json(await personal.remove(await ownOnNote(c), c.req.param('entryId'))));

  app.post('/v1/notes/:id/personal/:entryId/preview', async (c) => {
    const o = c.get('owner');
    personalLimiter(o.ownerId, 'personal');
    return c.json(await additions.preview(o, c.req.param('id'), c.req.param('entryId')));
  });

  app.post('/v1/notes/:id/personal/:entryId/add', async (c) => {
    const o = c.get('owner');
    personalLimiter(o.ownerId, 'personal');
    await additions.addToShared(o, c.req.param('id'), c.req.param('entryId'), await body(c, PromoteBodySchema));
    return c.json(await notes.get(o, c.req.param('id')));
  });

  app.delete('/v1/notes/:id/additions/:additionId', async (c) => {
    const o = c.get('owner');
    await additions.takeBack(o, c.req.param('id'), c.req.param('additionId'));
    return c.json(await notes.get(o, c.req.param('id')));
  });

  app.delete('/v1/notes/:id', async (c) => { await notes.remove(c.get('owner'), c.req.param('id')); return c.json({ deleted: true }); });

  /* series: what carries over between calls, from the notes the person asking has */
  app.get('/v1/series/:id', async (c) => c.json(await series.get(c.get('owner'), c.req.param('id'))));

  app.post('/v1/series/:id/ask', async (c) => {
    askLimiter(c.get('owner').ownerId, 'ask-series');
    const { question, timeZone } = await body(c, SeriesAskBodySchema);
    return c.json(await series.ask(c.get('owner'), c.req.param('id'), question, timeZone));
  });
}
