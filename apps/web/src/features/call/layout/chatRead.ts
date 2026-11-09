import { useEffect, useRef, type RefObject } from 'react';

/** Owns only visibility observation. The session remains authoritative for private read receipts. */
export function useReadChatMessages(scroll: RefObject<HTMLDivElement | null>, unread: readonly string[], onRead: (ids: readonly string[]) => void) {
  const latest = useRef(onRead);
  latest.current = onRead;
  const ids = unread.join(' ');
  useEffect(() => {
    const root = scroll.current;
    if (!root || !ids || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<Element>();
    const read = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const messages = [...visible].flatMap((node) => {
        const id = node.closest('[data-chat-message]')?.getAttribute('data-chat-message');
        return id ? [id] : [];
      });
      if (!messages.length) return;
      latest.current(messages);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(entry.target); else visible.delete(entry.target);
      }
      read();
    }, { root, threshold: [0, 0.5] });
    for (const id of ids.split(' ')) {
      const node = root.querySelector(`[data-chat-message="${CSS.escape(id)}"]`);
      if (node && root.contains(node)) observer.observe(node.querySelector('[data-chat-read-end]') ?? node);
    }
    document.addEventListener('visibilitychange', read);
    window.addEventListener('focus', read);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', read); window.removeEventListener('focus', read); };
  }, [scroll, ids]);
}
