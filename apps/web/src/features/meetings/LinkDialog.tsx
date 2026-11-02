import type { CallLink, MeetingNotesSetting } from '@alcove/api';
import { Button, Field, Icon, Segmented, Dialog, Spinner, useToast } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api } from '~/lib/api';

export function LinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [link, setLink] = useState<CallLink | null>(null);
  const [notes, setNotes] = useState<MeetingNotesSetting>('ask');
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  // A link is minted once per opening; changing notes below doesn't create a new link.
  useEffect(() => { if (open) { setCopied(false); setLink(null); void api.links.create('ask').then(setLink); } }, [open]);
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); } catch { /* clipboard may be blocked */ }
    setCopied(true); toast('Link copied');
  };
  const [path, frag] = (link?.url.replace('https://', '') ?? '').split('#');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Your call link"
      footer={<><Button variant="secondary" onClick={onClose}>Done</Button><Button disabled={!link} onClick={() => { if (!link) return; onClose(); void navigate({ to: '/join/$code', params: { code: link.code } }); }}>Join now</Button></>}>
      <p className="m-0 text-ink-3">Send it to anyone you want in the call. It works now or later, until you delete it.</p>
      <div className="flex items-center justify-between gap-2.5 overflow-hidden rounded-[14px] bg-raised py-2 pl-3.5 pr-2 text-sm shadow-[inset_0_0_0_1px_var(--hair-2)]">
        {link ? <span className="truncate font-mono">{path}<span className="text-ink-3">#{frag}</span></span> : <Spinner />}
        <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={copy} disabled={!link}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="m-0 flex items-start gap-2 text-[13px] text-ink-3"><Icon name="lock" className="mt-0.5 size-[15px]" />The part after # is the call’s key. Browsers never send it to our servers, so only people with the link can see or hear the call.</p>
      <Field label="Notes for this call">
        <Segmented label="Notes for this call" value={notes} onChange={setNotes} options={[{ value: 'ask', label: 'Ask at start' }, { value: 'full', label: 'Notes + transcript' }, { value: 'notes', label: 'Notes only' }, { value: 'off', label: 'Off' }]} />
      </Field>
    </Dialog>
  );
}
