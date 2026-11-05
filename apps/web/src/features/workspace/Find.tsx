/*
 * Find, from the magnifier or ⌘K: any document, or any line in one. It looks through words already in this tab (words.ts),
 * so what's typed never leaves the browser, and results arrive as documents do. Enter lands on the line.
 */
import { WsFind, WsKeysRow } from '@alcove/ui';
import { useEffect, useMemo, useState } from 'react';
import { overlayOpen, typing, withMod } from '~/lib/keys';
import { useLive, useOnline } from '~/lib/live';
import { useWs } from './context';
import { landOn } from './DocumentPane';
import { foundHits, recentHits, type FindHit } from './findHits';
import { placesOf } from './places';
import { documentsIn } from './tree';
import { wordsOf } from './words';

/**
 * ⌘K and ?, while a workspace is on screen. ⌘K is on `document`, so it comes after the editor, which takes it with words
 * selected, and before the app's palette, which listens on `window`. With anything else open over the page, it's left alone.
 */
export function useFindKeys() {
  const [finding, setFinding] = useState(false);
  const [listing, setListing] = useState(false);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (withMod(e) && e.key.toLowerCase() === 'k') {
        if (finding) { e.preventDefault(); setFinding(false); return; }
        if (overlayOpen()) return;
        e.preventDefault();
        setFinding(true);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && !overlayOpen()) {
        e.preventDefault();
        setListing(true);
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [finding]);
  return { finding, setFinding, listing, setListing };
}

export function Find({ open, onOpenChange, onKeys }: { open: boolean; onOpenChange: (open: boolean) => void; onKeys: () => void }) {
  const ws = useWs();
  const { tree, spaceName, workspaceId, pass, owner } = ws;
  const [query, setQuery] = useState('');
  /** What the arrows are on, by what it is: rows move as results arrive. */
  const [on, setOn] = useState<string | null>(null);
  const online = useOnline();
  const store = wordsOf(workspaceId, pass);
  const words = useLive(store);
  const docs = useMemo(() => documentsIn(tree), [tree]);
  const shown = ws.at.kind === 'document' ? ws.at.id : null;

  useEffect(() => {
    if (open) store.refresh(docs);
    else { setQuery(''); setOn(null); }
    /* Only as it opens: what changes while it's open is read the next time. */
  }, [open, store]);

  /* Read as it opens or as the words change: what's on the page is what someone just typed. */
  const live = useMemo(() => (open && ws.openDoc.current?.id === shown ? ws.openDoc.current?.editor?.blockWords() ?? null : null), [open, shown, ws.openDoc]);
  const typed = query.trim();
  const hits = useMemo(() => (typed
    ? foundHits(typed, tree, docs, words.docs, shown, live, spaceName)
    : recentHits(tree, docs, placesOf(owner).recent[workspaceId] ?? [], shown, spaceName)), [typed, tree, docs, words.docs, shown, live, spaceName, owner, workspaceId]);
  const selected = Math.max(0, hits.findIndex((h) => h.id === on));

  const land = (hit: FindHit) => {
    onOpenChange(false);
    const again = ws.at.kind === 'document' && ws.at.id === hit.document && ws.at.block === hit.block;
    const editor = ws.openDoc.current?.editor;
    if (again && hit.block && editor) landOn(editor, hit.block);
    else ws.go({ kind: 'document', id: hit.document, block: hit.block });
  };

  return (
    <WsFind open={open} onOpenChange={onOpenChange} query={query} hits={hits} selected={selected} searching={words.reading} onOpen={land}
      onQuery={(q) => { setQuery(q); setOn(null); }} onSelected={(i) => setOn(hits[i]?.id ?? null)}
      note={words.docs.size === 0 && (words.failed || !online) && typed ? 'This only finds names for now: the words in your documents didn’t load.' : undefined}
      foot={typed ? undefined : <WsKeysRow onOpen={() => { onOpenChange(false); onKeys(); }} />} />
  );
}
