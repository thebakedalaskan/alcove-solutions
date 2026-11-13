/*
 * Storage full (docs/product/user-flows.md 16.11): an upload the server refused
 * because the storage it counts against is full (`plan-limit`, docs: Plans and usage › Storage), said the way the doors say
 * it, wherever files go in (a document, Upload files in the Drive, a picture on a board). A file bigger than its plan takes
 * is refused before any of it is sent, in the server's own words with its limit, and offers nothing: Pro's largest file is
 * Free's today.
 */
import { errorCode, errorMessage, type Plan } from '@alcove/api';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { log } from '~/lib/log';
import { planQueries } from './queries';
import { roomLabel } from '~/lib/words';
import { useCheckout } from './checkout';

const slog = log.child({ component: 'storage-door' });

/** What's said about a refused upload, and the one thing that helps (null: nothing to do here). */
export interface StorageRefused { text: string; action: { label: string; onClick: () => void } | null }
/** Turns an upload's error into what the doors say about it, or null when it wasn't storage (the server's words stand). */
export type StorageRefusal = (error: unknown, bytes: number) => Promise<StorageRefused | null>;

/** An upload refused with its words and its way on, for whatever shows its errors by their message (a board's toast). */
export class StorageFullError extends Error {
  constructor(readonly said: StorageRefused) {
    super(said.text);
    this.name = 'StorageFullError';
  }
}

/**
 * Whether a refusal was your own storage: the server doesn't say whose storage a workspace counts against, so it's read from
 * your plan. With room in yours for this upload, it was someone else's: whoever pays for the workspace.
 */
const yours = (plan: Plan, bytes: number): boolean => plan.over.storage || plan.storage.usedBytes + bytes > plan.storage.limitBytes;

/**
 * What a storage refusal says, from your plan as it is now and the offers: on Free, "Your storage is full. Pro has 100 GB."
 * with Get Pro; on a paid plan, "Your storage is full." with Make room, which opens the Drive (in a new tab from a call, so the
 * call goes on); someone else's, in the server's words, that the workspace can't take more (its storage is full, or what's
 * left is kept for its payer's notes and recordings), with nothing to buy. `signedIn`: a guest in a call has
 * no plan, and hears the server's words. The plan is read only when an upload is refused, never kept up to date meanwhile.
 */
export function useStorageRefusal(signedIn: boolean, from: 'page' | 'call'): StorageRefusal {
  const checkout = useCheckout();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const open = checkout.open;
  return useCallback(async (error, bytes) => {
    if (errorCode(error) !== 'plan-limit' || !signedIn) return null;
    let plan: Plan;
    let pro: number | null;
    try {
      [plan, pro] = await Promise.all([
        qc.fetchQuery({ ...planQueries.plan(), staleTime: 0 }),
        qc.fetchQuery(planQueries.offers()).then((o) => o.pro.storageBytes, () => null)
      ]);
    } catch (e) {
      slog.info('the plan wasn’t read for a storage refusal; the server’s words stand', { err: e });
      return null;
    }
    // Someone else's: the server's words say which (it's full, or what's left is kept for its payer's notes), never whose.
    if (!yours(plan, bytes)) return { text: errorMessage(error), action: null };
    if (plan.kind === 'free' && pro !== null && pro > plan.storage.limitBytes) {
      return { text: `Your storage is full. Pro has ${roomLabel(pro)}.`, action: { label: 'Get Pro', onClick: () => open({ plan: 'pro' }, from === 'call' ? 'call' : 'door') } };
    }
    const room = from === 'call' ? () => { window.open('/drive', '_blank', 'noopener'); } : () => { void navigate({ to: '/drive' }); };
    return { text: 'Your storage is full.', action: { label: 'Make room', onClick: room } };
  }, [signedIn, qc, open, from, navigate]);
}
