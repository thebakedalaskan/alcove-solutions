import { type NotesSetting } from '../calls/notes/settings';
import { type Patch } from '../client';
import { type ID, type ISODate } from '../shared/ids';
import { type Busy, type Calendar } from './calendar';
import { type ChangeScope, type Meeting, type MeetingInput, type ProposalAnswer, type Rsvp } from './schema';
import { type CalendarRange } from './wire';
export interface MeetingsApi {
  /** Your calls still to come, and the calls you're invited to, soonest first. */
  upcoming(): Promise<Meeting[]>;
  past(): Promise<Meeting[]>;
  /** One of your calls, or one you're invited to that hasn't ended. */
  get(id: ID): Promise<Meeting>;
  byCode(code: string): Promise<Meeting | null>;
  /**
   * Schedules a call, or with `repeat` a series of them, with one link. With Google Calendar connected it goes on the
   * calendar, which sends everyone invited one invitation. With `offer` the call goes on no calendar until a time is
   * picked: each time offered is held on yours instead, as an event nobody else is invited to, and the holds clear when
   * someone picks one or the call is cancelled.
   */
  create(input: MeetingInput): Promise<Meeting>;
  /**
   * Changes a call; a connected calendar sends everyone the update. In a series, `scope: 'following'` changes this
   * call and every later one too, and moving them says how with `repeat`, whose occurrences start at this call.
   * `repeat` on a call that doesn't repeat makes it a series.
   */
  update(id: ID, input: Patch<MeetingInput>, opts?: { scope?: ChangeScope | undefined }): Promise<Meeting>;
  /** Cancels a call; a connected calendar tells everyone. In a series, `scope: 'following'` cancels this call and every later one. */
  cancel(id: ID, opts?: { scope?: ChangeScope | undefined }): Promise<void>;
  /** Says whether you're coming to a call you're invited to. Your organizer sees the answer; Google Calendar doesn't hear about it. */
  answer(id: ID, answer: Rsvp): Promise<Meeting>;
  /**
   * Asks the organizer of a call you're invited to to move it to `startsAt`, which must be still to come. They see it
   * with your address and can move it there or keep its time; asking again replaces what you asked. Google Calendar
   * doesn't hear about it, and a call waiting for a guest to pick a time can't be asked.
   */
  propose(id: ID, startsAt: ISODate): Promise<Meeting>;
  /**
   * Answers someone's request to move one of your calls, by their address. `move` moves it there as changing its time
   * does, so a connected calendar tells everyone, and lets go of every other request, which were asked of the time it
   * had; `keep` lets go of this one and changes nothing else.
   */
  answerProposal(id: ID, email: string, answer: ProposalAnswer): Promise<Meeting>;
  /**
   * Schedules the next call in a call's series, starting the series if it isn't in one: the same
   * title, people, length and notes setting, at `startsAt`, which must be still to come and after the
   * call. The app sends the same clock time a week on where the person is (the first such time still
   * to come), so it doesn't move an hour when the clocks change. Not for an occurrence of a recurring
   * Google Calendar event, whose next one is on the calendar already.
   */
  scheduleNext(id: ID, startsAt: ISODate): Promise<Meeting>;
}

export interface CalendarApi {
  /**
   * Your other calendar events, beside Alcove's own calls: the coming week's, or with `range` those between two times,
   * at most 31 days apart, past ones included. Other people's calendars are read only as busy times (`busy`).
   */
  get(range?: CalendarRange | undefined): Promise<Calendar>;
  /** When you and these people are busy between two times, from what's readable: see `Busy`. */
  busy(emails: string[], range: { from: ISODate; to: ISODate }): Promise<Busy>;
  /**
   * Where the browser goes to give Alcove access to the Google Calendar of the account it's signed in with. Google sends
   * the browser back to Settings, or to Home with `{ back: '/home' }`, with how it went in `?calendar=`.
   */
  connectUrl(opts?: { back?: '/home' | undefined }): string;
  /** Forgets the Google connection: Alcove's stored access is deleted and scheduling no longer touches Google. Connect again from `connectUrl()`. */
  disconnect(): Promise<Calendar>;
  /** Makes one of your own calendar events an Alcove call: the event gets the Alcove link, and everyone invited is told. */
  adopt(eventId: ID, notes?: NotesSetting | undefined): Promise<Meeting>;
}
