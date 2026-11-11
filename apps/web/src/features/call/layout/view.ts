/*
 * Your view of a call, which changes your screen only and is never sent anywhere.
 *
 * - Where you see yourself (`CallViewPrefs`: in the grid, in a corner and which one, or hidden) is remembered in this
 *   browser for your account, for every call.
 * - Whether the people stand beside what's open on your stage or hide on the horizon (⇧P), and whether the workspace shows
 *   its list (`CallPanels`), are too, so tomorrow's call starts the way you left this one. It names nobody. So is whether
 *   you've been told what a tile does (`tileHintKey`), only once you have.
 * - How you arranged this call (`CallLayout`: who you pinned, the order you dragged people into, who you made bigger, where
 *   you are in the workspace, what your side shows) lasts for this call only: it's kept in this tab, so a reload keeps it,
 *   and it's deleted when you leave. It names people by their seat in the call, which is random and means nothing anywhere
 *   else.
 *
 * Neither holds a name or anything said or shared. The layout engine (stageLayout.ts) turns both into the stage, which
 * otherwise lays itself out.
 */
import {
  CALL_LAYOUT_MAX, CallLayoutSchema, CallPanelsSchema, CallViewPrefsSchema, type CallLayout, type CallPanels, type CallSide, type CallViewPrefs, type SelfView, type StageCorner
} from '@alcove/api';
import { useCallback, useRef, useState } from 'react';
import { log } from '~/lib/log';

const vlog = log.child({ component: 'call-view' });

export const DEFAULT_PREFS: CallViewPrefs = { self: 'grid', corner: 'bottom-right' };
export const EMPTY_LAYOUT: CallLayout = { pins: [], order: [], arrived: [], big: [], workspace: { open: false, document: null } };
/** The people as tiles beside what's open, and the workspace with its list. */
export const DEFAULT_PANELS: CallPanels = { people: 'tiles', list: true };

/* Preferences by account (its opaque owner ID); a browser without an account has one set of its own. */
const prefsKey = (account: string | null) => (account ? `alcove.callView.${account}` : 'alcove.callView');
const panelsKey = (account: string | null) => (account ? `alcove.callPanels.${account}` : 'alcove.callPanels');
const layoutKey = (callId: string) => `alcove.callLayout.${callId}`;
/** Whether you've been told what a tile does (TileHint.tsx), by account: only `1`, once you have. */
export const tileHintKey = (account: string | null) => (account ? `alcove.callTileHint.${account}` : 'alcove.callTileHint');

/** You've been told what a tile does, in this browser. A browser that can't say is taken to have told you. */
export function tileHinted(account: string | null): boolean {
  try { return localStorage.getItem(tileHintKey(account)) === '1'; } catch (e) { vlog.debug('tile hint not readable', { err: e }); return true; }
}
export function keepTileHinted(account: string | null): void {
  try { localStorage.setItem(tileHintKey(account), '1'); } catch (e) { vlog.debug('tile hint not kept', { err: e }); }
}

function readPrefs(account: string | null): CallViewPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(account));
    if (!raw) return DEFAULT_PREFS;
    const r = CallViewPrefsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
function readPanels(account: string | null): CallPanels {
  try {
    const raw = localStorage.getItem(panelsKey(account));
    if (!raw) return DEFAULT_PANELS;
    const r = CallPanelsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : DEFAULT_PANELS;
  } catch {
    return DEFAULT_PANELS;
  }
}
function readLayout(callId: string): CallLayout {
  try {
    const raw = sessionStorage.getItem(layoutKey(callId));
    if (!raw) return EMPTY_LAYOUT;
    const r = CallLayoutSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}
/** The account is gone: so is how it liked to see calls in this browser. */
export function forgetView(account: string) {
  try { for (const k of [prefsKey(account), panelsKey(account), tileHintKey(account)]) localStorage.removeItem(k); } catch (e) { vlog.debug('view not forgotten', { err: e }); }
}
function keep(store: 'local' | 'session', key: string, value: unknown) {
  try { (store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); } catch (e) { vlog.debug('view not remembered', { store, err: e }); }
}

/**
 * You changed the layout from the one the stage gives itself: More offers Reset layout. Where you see yourself is a standing
 * choice, not part of it.
 */
export const isCustom = (l: CallLayout, panels: CallPanels) => l.pins.length > 0 || l.order.length > 0 || l.big.length > 0
  || panels.people !== DEFAULT_PANELS.people || panels.list !== DEFAULT_PANELS.list;

/** A layout to go back to: Undo after a reset. */
export interface ViewSnapshot { layout: CallLayout; panels: CallPanels }

/**
 * Your view of the call `callId`. `account` is your account's owner ID, null without an account, or undefined while
 * that isn't known yet (nothing is remembered until it is).
 */
export function useCallView(callId: string, account: string | null | undefined) {
  const [prefs, setPrefs] = useState<CallViewPrefs>(() => (account === undefined ? DEFAULT_PREFS : readPrefs(account)));
  const [panels, setPanels] = useState<CallPanels>(() => (account === undefined ? DEFAULT_PANELS : readPanels(account)));
  const [prefsFor, setPrefsFor] = useState(account);
  if (account !== prefsFor) {
    setPrefsFor(account);
    setPrefs(account === undefined ? DEFAULT_PREFS : readPrefs(account));
    setPanels(account === undefined ? DEFAULT_PANELS : readPanels(account));
  }
  const [layout, setLayout] = useState<CallLayout>(() => readLayout(callId));
  const [layoutFor, setLayoutFor] = useState(callId);
  if (callId !== layoutFor) { setLayoutFor(callId); setLayout(readLayout(callId)); }

  const updatePrefs = useCallback((fn: (p: CallViewPrefs) => CallViewPrefs) => {
    setPrefs((p) => { const next = fn(p); if (account !== undefined) keep('local', prefsKey(account), next); return next; });
  }, [account]);
  /** Changes how the people sit beside what's open, or whether the workspace shows its list, and remembers it. */
  const arrange = useCallback((fn: (p: CallPanels) => CallPanels) => {
    setPanels((p) => { const next = fn(p); if (next !== p && account !== undefined) keep('local', panelsKey(account), next); return next; });
  }, [account]);
  // Once you've left the call, nothing writes its arrangement back.
  const forgotten = useRef(false);
  const updateLayout = useCallback((fn: (l: CallLayout) => CallLayout) => {
    setLayout((l) => { const next = fn(l); if (next !== l && !forgotten.current) keep('session', layoutKey(callId), next); return next; });
  }, [callId]);
  /** Leaving the call forgets how you arranged it, for good: later changes on the way out aren't kept either. */
  const forget = useCallback(() => {
    forgotten.current = true;
    try { sessionStorage.removeItem(layoutKey(callId)); } catch (e) { vlog.debug('call layout not forgotten', { err: e }); }
  }, [callId]);
  /** Remembers the order people first came in, by seat, so someone coming back keeps their place. */
  const arrive = useCallback((seats: string[]) => updateLayout((l) => {
    const fresh = seats.filter((s) => !l.arrived.includes(s));
    return fresh.length ? { ...l, arrived: [...l.arrived, ...fresh].slice(-CALL_LAYOUT_MAX.arrived) } : l;
  }), [updateLayout]);

  return {
    arrive, forget,
    prefs, layout, panels, arrange,
    setSelf: (self: SelfView) => updatePrefs((p) => ({ ...p, self })),
    setCorner: (corner: StageCorner) => updatePrefs((p) => ({ ...p, corner })),
    /**
     * Pins someone (by seat), or unpins them. With every pin taken, the oldest pin of someone who isn't in the call
     * (`here`: the seats in the call now) makes room. False when all of them are here.
     */
    togglePin: (seat: string, here: ReadonlySet<string>): boolean => {
      const pins = layout.pins;
      if (pins.includes(seat)) { updateLayout((l) => ({ ...l, pins: l.pins.filter((s) => s !== seat) })); return true; }
      const gone = pins.length >= CALL_LAYOUT_MAX.pins ? pins.find((s) => !here.has(s)) : undefined;
      if (pins.length >= CALL_LAYOUT_MAX.pins && gone === undefined) return false;
      updateLayout((l) => ({ ...l, pins: [...l.pins.filter((s) => s !== gone), seat].slice(-CALL_LAYOUT_MAX.pins) }));
      return true;
    },
    setPins: (pins: string[]) => updateLayout((l) => ({ ...l, pins: pins.slice(0, CALL_LAYOUT_MAX.pins) })),
    setOrder: (order: string[]) => updateLayout((l) => ({ ...l, order: order.slice(0, CALL_LAYOUT_MAX.order) })),
    setBig: (seat: string, big: boolean) => updateLayout((l) => ({ ...l, big: big ? [...new Set([...l.big, seat])].slice(-CALL_LAYOUT_MAX.big) : l.big.filter((s) => s !== seat) })),
    /** Where you are in the workspace, whatever else changes about how you see the call. */
    keepWorkspace: (workspace: CallLayout['workspace']) => updateLayout((l) => (l.workspace.open === workspace.open && l.workspace.document === workspace.document ? l : { ...l, workspace })),
    /** What your side shows, so a reload finds it as it was. */
    keepSide: (side: CallSide | null) => updateLayout((l) => (l.side === side ? l : { ...l, side })),
    /**
     * Back to the layout the stage gives itself: nobody pinned, the call's order and sizes, the people beside what's open and
     * the workspace with its list. Where you see yourself, and your side, stay as they are.
     */
    reset: (): ViewSnapshot => {
      const was = { layout, panels };
      updateLayout((l) => ({ ...EMPTY_LAYOUT, arrived: l.arrived, workspace: l.workspace, side: l.side }));
      arrange(() => DEFAULT_PANELS);
      return was;
    },
    restore: (v: ViewSnapshot) => { updateLayout((l) => ({ ...v.layout, arrived: l.arrived, workspace: l.workspace, side: l.side })); arrange(() => v.panels); }
  };
}
export type CallView = ReturnType<typeof useCallView>;
