/*
 * Getting into a call, the same from the join page, Rejoin and moving devices. Joining comes with this tab's last pass for the
 * call (pass.ts), so someone it let in before comes back without asking. You're in once this browser is in the call's encrypted
 * group and the call names you; turned away, or without the call's keys, it's said plainly, and what to do next is the caller's
 * to say. A join that isn't going in is taken back the way a closing page takes it back, never by leaving. The call screen is
 * handed the session, and the microphone and camera as they were: a fresh LocalMedia with what was off kept off, which the call
 * starts.
 */
import type { CallCrypto, CallSession, CallState } from '@alcove/api';
import { useEffect } from 'react';
import { LocalMedia } from '~/features/call/media/media';
import { api } from '~/lib/api';
import { sessions, useClosingWithPage } from './handoff';
import { lastPass, rememberPass } from './pass';

/** Joins `code` with this tab's last pass for it, if it has one, and keeps the pass this join is given. */
export async function joinWithPass(code: string, o: { mic: boolean; cam: boolean; name?: string | undefined }): Promise<CallSession> {
  const previous = lastPass(code);
  const s = await api.calls.join(code, { mic: o.mic, cam: o.cam, ...(o.name ? { name: o.name } : {}), ...(previous ? { previous } : {}) });
  rememberPass(code, s.ticket.pass);
  return s;
}

/** Where a join stands: in the call, turned away, without the call's keys, or still on its way (asking, or being let in). */
export type Admission = 'in' | 'turned-away' | 'failed' | 'on-its-way';

/** In once this browser is in the call's group and the call (who's here) has come with it. */
export function admissionOf(crypto: Pick<CallCrypto, 'status'>, call: Pick<CallState, 'participants'>): Admission {
  if (crypto.status === 'denied') return 'turned-away';
  if (crypto.status === 'failed') return 'failed';
  return crypto.status === 'in' && call.participants.some((p) => p.isMe) ? 'in' : 'on-its-way';
}

/** Whoever lets people in said no: "Priya didn’t let you in.", "The host didn’t let you in." */
export const turnedAway = (host: string): string => `${host.charAt(0).toUpperCase()}${host.slice(1)} didn’t let you in.`;
/** This browser couldn't get the call's keys. */
export const KEYS_FAILED = 'Alcove couldn’t set up this call’s encryption.';

/**
 * Takes back a join that isn't going in, as a closing page does: this connection stops here, and unless it hosts it says it has
 * gone, so an ask is withdrawn at once. Never by leaving: from a connection that hosts (an organizer's, coming back) that would
 * end the call for everyone, and a leave that didn't get through would keep the connection going.
 */
export function takeBack(s: CallSession): void {
  s.closing();
}

/**
 * An ask on its way into a call (`asked`): taken back once it's let go of before it's in (`entered`), when its page goes or
 * whoever asked stops, and when the tab closes meanwhile.
 */
export function useAsking(asked: CallSession | null, entered: { readonly current: boolean }): void {
  useEffect(() => () => { if (asked && !entered.current) takeBack(asked); }, [asked, entered]);
  useClosingWithPage(asked);
}

/** Your microphone and camera as they were, for the call to start: what was off stays off, and nothing starts here. */
export function mediaAsItWas(was: { mic: boolean; cam: boolean }): LocalMedia {
  const media = new LocalMedia();
  if (!was.mic) void media.setMic(false);
  if (!was.cam) void media.setCam(false);
  return media;
}

/** The call screen takes it from here: the call this tab is in from now on, and the microphone and camera it starts. */
export function handOver(code: string, session: CallSession, media: LocalMedia): void {
  sessions.media = media;
  sessions.call = { code, session };
}
