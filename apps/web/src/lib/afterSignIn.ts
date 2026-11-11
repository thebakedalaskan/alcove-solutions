/*
 * Back to a call's join page when Google needs the current tab (a blocked popup or no completion channel). With a
 * popup the join page stays open and clears this on completion. Otherwise Google's way back lands on /ready or /home,
 * so the page to return to waits in this tab's sessionStorage: not in the sign-in URL, because a call's code is its link's
 * secret and the API's request logs keep URLs. It lasts ten minutes, like the sign-in attempt itself, and is used once.
 */
import { AgentReturnStoredSchema, CallReturnStoredSchema, NoteLinkReturnStoredSchema } from '@alcove/api';
import { log } from './log';

const alog = log.child({ component: 'after-sign-in' });
const KEY = 'alcove.after-sign-in';
const AGENT_KEY = 'alcove.agent-after-sign-in';
const LINK_KEY = 'alcove.link-after-sign-in';
const MINUTES = 10;

/** Signing in from this call's join page: come back to it afterwards. */
export function returnToCall(code: string): void {
  try {
    sessionStorage.removeItem(AGENT_KEY);
    sessionStorage.setItem(KEY, JSON.stringify({ code, until: Date.now() + MINUTES * 60_000 }));
  } catch (e) {
    // Private browsing and the like: after signing in this tab lands on Home, and the link still works.
    alog.debug('join page not kept for after sign-in', { err: e });
  }
}

/** No Google sign-in is coming back to a join page (it was left, or the person signed in another way). */
export function clearReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(AGENT_KEY);
  } catch (e) {
    alog.debug('join page to go back to not cleared', { err: e });
  }
}

/** A consent request is a pointer, never a bearer credential; keep it in this tab for one sign-in. */
export function returnToAgent(requestId: string): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.setItem(AGENT_KEY, JSON.stringify({ requestId, until: Date.now() + MINUTES * 60_000 }));
  } catch (e) {
    alog.debug('agent consent not kept for after sign-in', { err: e });
  }
}
export function takeAgentReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(AGENT_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(AGENT_KEY);
    const parsed = AgentReturnStoredSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.until > Date.now() ? parsed.data.requestId : null;
  } catch (e) {
    alog.debug('agent consent to go back to not readable', { err: e });
    return null;
  }
}

/**
 * Signing in to open a link to someone's notes: back to it afterwards. Its secret waits in this tab only, never in a URL,
 * for ten minutes at most.
 */
export function returnToLink(secret: string): void {
  try {
    sessionStorage.setItem(LINK_KEY, JSON.stringify({ secret, until: Date.now() + MINUTES * 60_000 }));
  } catch (e) {
    // Private browsing and the like: after signing in this tab lands on Home, and the link still works.
    alog.debug('link to notes not kept for after sign-in', { err: e });
  }
}
/** Whether a link to notes waits for this sign-in, without taking it. */
export function linkWaiting(): boolean {
  try { return sessionStorage.getItem(LINK_KEY) !== null; } catch { return false; }
}
/** The link's secret to open, once, if signing in started from it in the last ten minutes; an older one is dropped. */
export function takeLinkReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(LINK_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(LINK_KEY);
    const w = NoteLinkReturnStoredSchema.safeParse(JSON.parse(raw));
    return w.success && w.data.until > Date.now() ? w.data.secret : null;
  } catch (e) {
    alog.debug('link to notes to go back to not readable', { err: e });
    return null;
  }
}

/** The call to go back to, once, if signing in started on its join page in the last ten minutes; an older one is dropped. */
export function takeReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const w = CallReturnStoredSchema.safeParse(JSON.parse(raw));
    return w.success && w.data.until > Date.now() ? w.data.code : null;
  } catch (e) {
    alog.debug('join page to go back to not readable', { err: e });
    return null;
  }
}
