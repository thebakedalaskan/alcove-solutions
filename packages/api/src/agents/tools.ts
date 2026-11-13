/* Remote agent inputs compose the same domain contracts used by the browser. */
import { z } from '../shared/zod';
import { ChangeScopeSchema, MeetingInputSchema } from '../meetings/schema';
import { InstantCallInputSchema } from '../calls/entry';
import { ISODateSchema } from '../shared/ids';
import { NoteKindSchema } from '../notes/schema';
import { PersonalEditSchema, PersonalInputSchema } from '../notes/personal';
import { ActionPatchSchema, ActionProposalSchema, AskBodySchema, DecisionPatchSchema, DecisionProposalSchema, LinePatchSchema, MAX_SEARCH_TEXT, QuestionPatchSchema, QuestionProposalSchema, ShareInputSchema } from '../notes/wire';
import { BusyBodySchema, RsvpBodySchema } from '../meetings/wire';
import { PeopleSearchBodySchema } from '../identity/wire';

export const AgentResourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const AgentOperationIdSchema = AgentResourceIdSchema.describe('A fresh random 22-character base64url ID. Reuse it only to retry exactly the same operation.');
export const AgentPageSchema = z.object({ limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).max(10000).default(0) });
export const AgentNoteIdSchema = z.object({ noteId: AgentResourceIdSchema });
export const AgentMeetingIdSchema = z.object({ meetingId: AgentResourceIdSchema });
export const AgentListNotesSchema = AgentPageSchema.extend({ kind: NoteKindSchema.optional(), text: z.string().max(MAX_SEARCH_TEXT).optional() });
export const AgentListMeetingsSchema = AgentPageSchema.extend({
  view: z.enum(['upcoming', 'past']).default('upcoming').describe('upcoming: calls you organize and calls you are invited to that have not ended, soonest first. past: calls that happened, newest first: the ones you organized, and the ones you were invited to that kept notes.')
});
export const AgentAskNoteSchema = AgentNoteIdSchema.extend({ question: AskBodySchema.shape.question });
export const AgentAskNotesSchema = AskBodySchema;
export const AgentDecisionProposalSchema = AgentNoteIdSchema.extend({ proposal: DecisionProposalSchema });
export const AgentFollowUpAddSchema = AgentNoteIdSchema.extend({ followUp: ActionProposalSchema });
export const AgentDecisionPatchSchema = AgentNoteIdSchema.extend({ decisionId: z.string().min(1).max(64), patch: DecisionPatchSchema });
export const AgentFollowUpPatchSchema = AgentNoteIdSchema.extend({
  followUpId: z.string().min(1).max(64).describe('The id of one of the note’s followUps, as get_note returns them.'),
  patch: ActionPatchSchema.describe('What to change. done ticks it. owner gives it to someone who has the notes, by email, or null to nobody. takeOn: true says you will do it, for one that is yours. Taking it on, or giving it to yourself, also needs seen: the text and due you read.')
});
export const AgentQuestionAddSchema = AgentNoteIdSchema.extend({ question: QuestionProposalSchema });
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
export const AgentInviteResponseSchema = AgentMeetingIdSchema.extend({ answer: RsvpBodySchema.shape.answer });
export const AgentNextCallSchema = AgentMeetingIdSchema.extend({ operationId: AgentOperationIdSchema, startsAt: ISODateSchema });
export const AgentStartCallSchema = z.object({ operationId: AgentOperationIdSchema, input: InstantCallInputSchema.extend({ title: z.string().trim().min(1).max(160).optional(), guests: z.array(z.string().trim().max(254)).max(300).optional() }).default({}) });
export const AgentPeopleSchema = AgentPageSchema.extend({ query: PeopleSearchBodySchema.shape.query });
export const AgentAvailabilitySchema = BusyBodySchema;
export const AgentWriteResultSchema = z.object({ ok: z.literal(true), noteId: AgentResourceIdSchema.optional(), meetingId: AgentResourceIdSchema.optional(), entryId: AgentResourceIdSchema.optional(), url: z.url().optional() });
