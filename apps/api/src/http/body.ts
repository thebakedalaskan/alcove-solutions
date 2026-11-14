import { AUDIO_HEADERS, CallIdentity } from '@alcove/api';
import { type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ValidationError } from '../platform/errors';

export const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);

/** The most audio one range carries, under 32 MiB for a reply of a known length, a limit kept from Cloud Run, which refused more. A browser asks again for the rest. */
export const MOST_AUDIO_PER_REPLY = 24 * 1024 * 1024;

/** IDs in paths are 22 characters of base64url; anything else names nothing. */
export const ID128 = /^[A-Za-z0-9_-]{22}$/;

/** A position header: a whole number that fits the integer columns it's stored in. */
export const position = (c: Context, name: string) => z.coerce.number().int().min(0).max(2_147_483_647).parse(c.req.header(name));

/**
 * What a Range header asks for in `size` bytes: one stretch, `null` if it starts past the end, or `undefined` for the
 * whole file, which is the answer to no header and to one this doesn't take, such as several ranges.
 */
export function byteRange(header: string | undefined, size: number): { from: number; to: number } | null | undefined {
  const asked = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!asked) return undefined;
  const [, first = '', last = ''] = asked;
  if (!first && !last) return undefined;
  if (!first) return Number(last) > 0 && size > 0 ? { from: Math.max(0, size - Number(last)), to: size - 1 } : null;
  const from = Number(first);
  if (from >= size) return null;
  const to = last ? Math.min(Number(last), size - 1) : size - 1;
  return to >= from ? { from, to } : undefined;
}

/**
 * How long before this request a call's clip of speech began, in ms (at most ten minutes): the call places the speech
 * where its speaker was then.
 */
export function agoOf(c: Context): number {
  const ago = z.coerce.number().int().min(0).max(600_000).safeParse(c.req.header(AUDIO_HEADERS.ago));
  if (!ago.success) throw new ValidationError('Speech for a call’s transcript must say when it began.', { context: { header: AUDIO_HEADERS.ago } });
  return ago.data;
}

/** Whose speech a call's clip is: a participant ID, which the call checks is someone in it. */
export function speakerOf(c: Context): string {
  const s = CallIdentity.safeParse(c.req.header(AUDIO_HEADERS.speaker));
  if (!s.success) throw new ValidationError('Speech for a call’s transcript must say whose it is.', { context: { header: AUDIO_HEADERS.speaker } });
  return s.data;
}

/** Request bodies are read whole, so each route takes no more than it needs. */
  export const capped = (maxSize: number) => bodyLimit({ maxSize, onError: () => { throw new ValidationError('That request is too large.', { context: { maxSize } }); } });

export const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => schema.parse(await c.req.json().catch(() => { throw new ValidationError('Expected a JSON body.'); }));
