import { type HttpTransport } from '../transport/http';
import { createPersonalApi } from './personal';
import { AiModelsSchema, type AlcoveApi, AlcoveApiError, AnswerPartSchema, InboxSchema, NoteFoundSchema, NoteProgressSchema, NoteSchema, PromotionPreviewSchema, SeriesAnswerPartSchema, SeriesSchema, SharedAudienceSchema } from '@alcove/api';
import { z } from 'zod';

const audioPath = (id: string, segment: number, pieces: number) => `/notes/${encodeURIComponent(id)}/audio/${segment}?pieces=${pieces}`;
export function createNotesApi(t: HttpTransport): Pick<AlcoveApi, 'notes' | 'series' | 'models'> {
  const { base, ndjson, req, send } = t;
  const personal = createPersonalApi(t);
  return {
    notes: {
      // Search terms go in the body so they never appear in URLs or access logs.
      list: (q) => req(z.array(NoteFoundSchema), 'POST', '/notes/search', { ...(q?.kind ? { kind: q.kind } : {}), ...(q?.text ? { text: q.text } : {}) }),
      get: (id) => req(NoteSchema, 'GET', `/notes/${encodeURIComponent(id)}`),
      progress: (id) => ndjson(NoteProgressSchema, `/notes/${encodeURIComponent(id)}/progress`),
      audioUrl: (id, segment, pieces) => `${base}${audioPath(id, segment, pieces)}`,
      audio: async (id, segment, pieces, signal) => {
        const res = await send('GET', audioPath(id, segment, pieces), null, {}, false, signal);
        try {
          return await res.blob();
        } catch (cause) {
          if (signal?.aborted) throw cause;
          throw new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.', { cause });
        }
      },
      screenUrl: (id, frameId) => `${base}/notes/${encodeURIComponent(id)}/screens/${encodeURIComponent(frameId)}`,
      screenVideoUrl: (id, share, segment) => `${base}/notes/${encodeURIComponent(id)}/screen/${encodeURIComponent(share)}/${segment}`,
      proposeDecision: (noteId, proposal) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(noteId)}/decisions`, proposal),
      proposeAction: (noteId, proposal) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(noteId)}/actions`, proposal),
      updateDecision: (noteId, decisionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/decisions/${encodeURIComponent(decisionId)}`, patch),
      reviewAction: (noteId, review) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(noteId)}/actions/review`, review),
      updateAction: (noteId, actionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/actions/${encodeURIComponent(actionId)}`, patch),
      updateQuestion: (noteId, questionId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/questions/${encodeURIComponent(questionId)}`, patch),
      updateRevisit: (noteId, revisitId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/revisits/${encodeURIComponent(revisitId)}`, patch),
      inbox: () => req(InboxSchema, 'GET', '/notes/inbox'),
      correctLine: (noteId, lineId, patch) => req(NoteSchema, 'PATCH', `/notes/${encodeURIComponent(noteId)}/lines/${encodeURIComponent(lineId)}`, patch),
      rewrite: (noteId, o) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(noteId)}/rewrite`, o?.model !== undefined ? { model: o.model } : {}),
      cancelRewrite: (noteId) => req(NoteSchema, 'DELETE', `/notes/${encodeURIComponent(noteId)}/rewrite`),
      ask: async function*(noteId, question) {
        const parts = await req(z.array(AnswerPartSchema), 'POST', `/notes/${encodeURIComponent(noteId)}/ask`, { question });
        yield* parts;
      },
      // The question goes in the body, as every question does, so it never appears in URLs or access logs.
      askAll: async function*(question) {
        const parts = await req(z.array(AnswerPartSchema), 'POST', '/notes/ask', { question });
        yield* parts;
      },
      share: (id, to) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(id)}/share`, { emails: to.emails, ...(to.group !== undefined ? { group: to.group } : {}) }),
      personal: (id) => personal(`/notes/${encodeURIComponent(id)}/personal`),
      previewAddition: (id, entryId) => req(PromotionPreviewSchema, 'POST', `/notes/${encodeURIComponent(id)}/personal/${encodeURIComponent(entryId)}/preview`),
      addToShared: (id, entryId, body) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(id)}/personal/${encodeURIComponent(entryId)}/add`, body),
      sharedAudience: (id) => req(SharedAudienceSchema, 'GET', `/notes/${encodeURIComponent(id)}/additions/audience`),
      // The words go in the body, as everything added to the notes does, never in the URL.
      writeShared: (id, body) => req(NoteSchema, 'POST', `/notes/${encodeURIComponent(id)}/additions`, body),
      takeBack: (id, additionId) => req(NoteSchema, 'DELETE', `/notes/${encodeURIComponent(id)}/additions/${encodeURIComponent(additionId)}`),
      delete: async (id) => { await req(z.unknown(), 'DELETE', `/notes/${encodeURIComponent(id)}`); }
    },
    series: {
      get: (id) => req(SeriesSchema, 'GET', `/series/${encodeURIComponent(id)}`),
      ask: async function*(id, question, timeZone) {
        const parts = await req(z.array(SeriesAnswerPartSchema), 'POST', `/series/${encodeURIComponent(id)}/ask`, { question, timeZone });
        yield* parts;
      }
    },
    models: {
      list: () => req(AiModelsSchema, 'GET', '/models')
    }
  };
}
