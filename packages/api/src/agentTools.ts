/* Remote agent inputs compose the same domain contracts used by the browser. */
import { z } from './zod';
import { ChangeScopeSchema, InstantCallInputSchema, ISODateSchema, MeetingInputSchema, NoteKindSchema } from './types';
import { PersonalEditSchema, PersonalInputSchema } from './personal';
import { ActionPatchSchema, ActionProposalSchema, AskBodySchema, BusyBodySchema, DecisionPatchSchema, DecisionProposalSchema, LinePatchSchema, PeopleSearchBodySchema, QuestionPatchSchema, RsvpBodySchema, ShareInputSchema } from './wire';

export const AgentResourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const AgentOperationIdSchema = AgentResourceIdSchema.describe('A fresh random 22-character base64url ID. Reuse it only to retry exactly the same operation.');
export const AgentPageSchema = z.object({ limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).max(10000).default(0) });
export const AgentNoteIdSchema = z.object({ noteId: AgentResourceIdSchema });
export const AgentMeetingIdSchema = z.object({ meetingId: AgentResourceIdSchema });
export const AgentListNotesSchema = AgentPageSchema.extend({ kind: NoteKindSchema.optional(), text: z.string().max(200).optional() });
export const AgentListMeetingsSchema = AgentPageSchema.extend({ view: z.enum(['upcoming', 'past']).default('upcoming') });
export const AgentAskNoteSchema = AgentNoteIdSchema.extend({ question: AskBodySchema.shape.question });
export const AgentAskNotesSchema = AskBodySchema;
export const AgentDecisionProposalSchema = AgentNoteIdSchema.extend({ proposal: DecisionProposalSchema });
export const AgentActionProposalSchema = AgentNoteIdSchema.extend({ proposal: ActionProposalSchema });
export const AgentDecisionPatchSchema = AgentNoteIdSchema.extend({ decisionId: z.string().min(1).max(64), patch: DecisionPatchSchema });
export const AgentActionPatchSchema = AgentNoteIdSchema.extend({ actionId: z.string().min(1).max(64), patch: ActionPatchSchema });
export const AgentQuestionPatchSchema = AgentNoteIdSchema.extend({ questionId: z.string().min(1).max(64), patch: QuestionPatchSchema });
export const AgentTranscriptPatchSchema = AgentNoteIdSchema.extend({ lineId: z.string().min(1).max(64), patch: LinePatchSchema });
export const AgentShareNoteSchema = AgentNoteIdSchema.extend({ share: ShareInputSchema });
export const AgentPersonalAddSchema = AgentNoteIdSchema.extend({ operationId: AgentOperationIdSchema, input: PersonalInputSchema });
export const AgentPersonalEntrySchema = AgentNoteIdSchema.extend({ entryId: AgentResourceIdSchema });
export const AgentPersonalEditSchema = AgentPersonalEntrySchema.extend({ text: PersonalEditSchema.shape.text });
// Keep bounds visible to MCP clients while preserving the browser's field names and domain validation.
export const AgentMeetingInputSchema = MeetingInputSchema.extend({ title: z.string().trim().min(1).max(160), durationMinutes: z.number().int().min(5).max(600), guests: z.array(z.string().trim().max(254)).max(300) });
export const AgentScheduleSchema = z.object({ operationId: AgentOperationIdSchema, input: AgentMeetingInputSchema });
export const AgentUpdateCallSchema = AgentMeetingIdSchema.extend({ patch: AgentMeetingInputSchema.partial(), scope: ChangeScopeSchema.optional() });
export const AgentCancelCallSchema = AgentMeetingIdSchema.extend({ scope: ChangeScopeSchema.optional() });
export const AgentAnswerCallSchema = AgentMeetingIdSchema.extend({ answer: RsvpBodySchema.shape.answer });
export const AgentNextCallSchema = AgentMeetingIdSchema.extend({ operationId: AgentOperationIdSchema, startsAt: ISODateSchema });
export const AgentStartCallSchema = z.object({ operationId: AgentOperationIdSchema, input: InstantCallInputSchema.extend({ title: z.string().trim().min(1).max(160).optional(), guests: z.array(z.string().trim().max(254)).max(300).optional() }).default({}) });
export const AgentPeopleSchema = AgentPageSchema.extend({ query: PeopleSearchBodySchema.shape.query });
export const AgentAvailabilitySchema = BusyBodySchema;
export const AgentWriteResultSchema = z.object({ ok: z.literal(true), noteId: AgentResourceIdSchema.optional(), meetingId: AgentResourceIdSchema.optional(), entryId: AgentResourceIdSchema.optional(), url: z.url().optional() });
