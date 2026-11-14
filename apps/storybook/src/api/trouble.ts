/*
 * What goes wrong in a story: a part of Alcove that answers with an error, that can't be reached, or that hasn't answered
 * yet and won't while the story is open, by its place in AlcoveApi ('people.team'). The world says which (`trouble`), so a
 * story sets it as it opens, and the app gets the stand-in through this: a page shows its error, its offline look or its
 * loading look exactly as it would with the real API behind it. An address the browser reads by itself (a note's
 * recording, a frame, a share's video) is one that won't load. With no trouble, every call goes straight through.
 *
 *   w.trouble = { 'people.team': 'hold', 'notes.list': (query) => (hasText(query) ? 'failed' : null) };
 */
import { AlcoveApiError, type AlcoveApi } from '@alcove/api';
import { pause } from './live';
import { current, nextId, openedAs } from './state';

/**
 * failed: Alcove answered with an error. network: it couldn't be reached. gone: what was asked for isn't there for this person
 * (`not-found`), as when they were taken out of a workspace. hold: it hasn't answered, and won't while the story is open.
 */
export type Trouble = 'failed' | 'network' | 'gone' | 'hold';
type Calls<T> = { [K in keyof T & string]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T & string];
/** One of the API's calls, as `part.call`: 'people.team', 'notes.list'. */
export type ApiCall = { [N in keyof AlcoveApi & string]: `${N}.${Calls<AlcoveApi[N]>}` }[keyof AlcoveApi & string];
/** What goes wrong, by call: every time, or only when what's asked says so (null: it answers as ever). */
export type Troubles = { readonly [C in ApiCall]?: Trouble | ((...args: unknown[]) => Trouble | null) };

/** The calls that answer a part at a time: what goes wrong goes wrong before the first part. */
const STREAMS: ReadonlySet<string> = new Set(['notes.progress', 'notes.ask', 'notes.askAll', 'series.ask']);
/** The calls that answer with an address the browser reads by itself: whatever goes wrong, it's an address that won't load. */
const ADDRESSES: ReadonlySet<string> = new Set(['notes.audioUrl', 'notes.screenUrl', 'notes.screenVideoUrl']);

/** What's typed into a search, from the query `notes.list` was asked with. */
export const searched = (query: unknown): string => {
  if (typeof query !== 'object' || query === null || !('text' in query)) return '';
  return typeof query.text === 'string' ? query.text.trim() : '';
};

function failure(t: 'failed' | 'network' | 'gone'): AlcoveApiError {
  if (t === 'network') return new AlcoveApiError('network', 'Can’t reach Alcove. Check your connection.');
  if (t === 'gone') return new AlcoveApiError('not-found', 'That doesn’t exist, or you don’t have access to it.', { requestId: nextId('sb-req'), status: 404 });
  return new AlcoveApiError('unavailable', 'Alcove couldn’t answer just now. Try again in a moment.', { requestId: nextId('sb-req'), status: 503 });
}
/** The trouble, after the moment any answer takes: an error, or a wait with no end. */
async function troubled(t: Trouble): Promise<never> {
  await pause(openedAs().latency);
  if (t === 'hold') return new Promise<never>(() => undefined);
  throw failure(t);
}
async function* troubledParts(t: Trouble): AsyncGenerator<never> {
  await troubled(t);
}

/** What goes wrong with this call now, if anything. */
function troubleWith(call: string, args: unknown[]): Trouble | null {
  const how = Object.entries(current().trouble ?? {}).find(([k]) => k === call)?.[1];
  return typeof how === 'function' ? how(...args) : how ?? null;
}

/** One part of the API (`auth`, `notes`...): each call goes through, unless the world says it goes wrong. */
function part<T extends object>(name: string, target: T): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      const v: unknown = Reflect.get(t, key, receiver);
      if (typeof key !== 'string' || typeof v !== 'function') return v;
      const call = `${name}.${key}`;
      return (...args: unknown[]): unknown => {
        const how = troubleWith(call, args);
        if (!how) return Reflect.apply(v, t, args);
        if (ADDRESSES.has(call)) return `/storybook-${how}/${call}`;
        return STREAMS.has(call) ? troubledParts(how) : troubled(how);
      };
    }
  });
}

/** The stand-in as the app gets it: every call goes through to it, unless the story's world says it goes wrong. */
export function withTrouble(api: AlcoveApi): AlcoveApi {
  const parts = new Map<string, object>();
  return new Proxy(api, {
    get(t, key, receiver) {
      const v: unknown = Reflect.get(t, key, receiver);
      if (typeof key !== 'string' || typeof v !== 'object' || v === null) return v;
      const known = parts.get(key);
      if (known) return known;
      const made = part(key, v);
      parts.set(key, made);
      return made;
    }
  });
}
