import { type HttpTransport } from '../transport/http';
import { type PersonalApi, PersonalNotesSchema } from '@alcove/api';

export function createPersonalApi(t: HttpTransport) {
  const { req } = t;


  /** Your own notes on a call, at `path`: by the note, or from inside the call with its pass. */
  const personal = (path: string, extra: Record<string, string> = {}): PersonalApi => ({
    get: () => req(PersonalNotesSchema, 'GET', path, undefined, extra),
    add: (input) => req(PersonalNotesSchema, 'POST', path, input, extra),
    edit: (entryId, text) => req(PersonalNotesSchema, 'PATCH', `${path}/${encodeURIComponent(entryId)}`, { text }, extra),
    remove: (entryId) => req(PersonalNotesSchema, 'DELETE', `${path}/${encodeURIComponent(entryId)}`, undefined, extra)
  });
  return personal;
}
