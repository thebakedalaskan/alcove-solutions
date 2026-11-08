import { TabAttentionIcon, useTheme, type TabAttentionColors } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { q, qk } from '~/lib/queries';
import { onSignedOutElsewhere, signedOut } from '~/lib/signedOut';
import { log } from '~/lib/log';
import { attentionCounts, attentionVersion, onMentionsRead, serverAttentionVersion, subscribeAttention } from './attentionChannel';

const alog = log.child({ component: 'tab-attention' });

/** Owns the tab icon, including PNG rendering for browsers that do not use SVG favicons. No notification permission. */
export function TabAttention() {
  const qc = useQueryClient();
  const session = useQuery({ ...q.session(), refetchInterval: 15_000, refetchIntervalInBackground: true });
  const owner = session.data?.ownerId ?? null;
  const [revoked, setRevoked] = useState<string | null>(null);
  const permitted = !session.isError && (owner === null || (revoked !== owner && !signedOut(owner)));
  const tags = useQuery({ ...q.attentionMentions(owner ?? ''), enabled: permitted && owner !== null });
  const version = useSyncExternalStore(subscribeAttention, attentionVersion, serverAttentionVersion);
  const call = attentionCounts(permitted ? owner : '');
  const information = call.mentions + (permitted && !tags.isError && !tags.isPlaceholderData ? tags.data?.length ?? 0 : 0);
  const actions = call.actions;
  const kind = actions ? 'action' : 'information';
  const count = permitted ? Math.min(99, actions || information) : 0;
  const { resolved } = useTheme();
  const [colors, setColors] = useState<TabAttentionColors | null>(null);
  const art = useRef<HTMLDivElement>(null);

  useEffect(() => onSignedOutElsewhere((who) => {
    if (who !== owner) return;
    setRevoked(who);
    qc.removeQueries({ queryKey: qk.mentions });
    void qc.invalidateQueries({ queryKey: qk.session });
  }), [owner, qc]);
  useEffect(() => onMentionsRead((who) => { if (who === owner) void qc.invalidateQueries({ queryKey: qk.mentions }); }), [owner, qc]);
  useEffect(() => { if (owner !== null && !signedOut(owner) && session.isSuccess) setRevoked(null); }, [owner, session.dataUpdatedAt, session.isSuccess]);
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      setColors({ badge: style.getPropertyValue(kind === 'action' ? '--rose' : '--horizon').trim(), ink: style.getPropertyValue('--surface').trim(), rim: style.getPropertyValue('--surface').trim() });
    };
    read();
    const changes = new MutationObserver(read);
    changes.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => changes.disconnect();
  }, [kind, resolved]);
  useEffect(() => {
    if (!count || !colors) return;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const source = art.current?.querySelector('svg');
    if (!icon || !source) return;
    const original = { href: icon.href, type: icon.type, sizes: icon.sizes.value };
    const clone = source.cloneNode(true);
    if (!(clone instanceof SVGSVGElement)) return;
    // Mark's rim normally gets this from the stylesheet; an exported image is self-contained.
    for (const rim of clone.querySelectorAll('.m-rim')) { rim.setAttribute('fill', 'none'); rim.setAttribute('stroke', colors.rim); }
    const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, 64, 64);
      icon.type = 'image/png'; icon.sizes.value = '64x64'; icon.href = canvas.toDataURL('image/png');
    };
    image.onerror = () => { if (active) alog.warn('tab icon could not be rendered'); };
    image.src = svg;
    return () => { active = false; image.onload = null; image.onerror = null; icon.href = original.href; icon.type = original.type; icon.sizes.value = original.sizes; };
  }, [count, kind, colors]);
  // Reading the version keeps this projection current without persisting another counter.
  void version;
  return <div hidden aria-hidden="true" ref={art}>{count > 0 && colors && <TabAttentionIcon kind={kind} count={count} colors={colors} />}</div>;
}
