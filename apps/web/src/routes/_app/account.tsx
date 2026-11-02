import { errorMessage } from '@alcove/api';
import { Avatar, Button, Card, CardHeader, Chip, CountUp, Icon, Input, Segmented, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useState } from 'react';
import { api } from '~/lib/api';
import { q, qk, usePreferences } from '~/lib/queries';
import { fullDate, hoursOfNotes } from '~/lib/time';

export const Route = createFileRoute('/_app/account')({ component: Account });

function Account() {
  const { data: s } = useQuery(q.session());
  const { data: bal } = useQuery(q.balance());
  const { data: history = [] } = useQuery(q.history());
  const { data: prefs } = useQuery(q.prefs());
  const { data: passkeys = [] } = useQuery(q.passkeys());
  const savePrefs = usePreferences();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rename = async () => {
    if (!name?.trim() || name.trim() === s?.user.name) { setName(null); return; }
    try { qc.setQueryData(qk.session, await api.account.rename(name.trim())); toast('Name updated'); } catch (e) { toast(errorMessage(e), 'x'); }
    setName(null);
  };
  const addPasskey = async () => {
    setAdding(true);
    try { await api.account.addPasskey(); await qc.invalidateQueries({ queryKey: qk.passkeys }); void qc.invalidateQueries({ queryKey: qk.setup }); toast('Passkey added', 'fingerprint'); }
    catch (e) { toast(errorMessage(e), 'x'); }
    setAdding(false);
  };
  // Leave the app first, so mounted screens don't refetch into a locked session.
  const removePasskey = async (id: string, label: string) => {
    try { await api.account.removePasskey(id); await qc.invalidateQueries({ queryKey: qk.passkeys }); toast(`${label} removed`, 'fingerprint'); }
    catch (e) { toast(errorMessage(e), 'x'); }
  };
  const lock = async () => { await api.auth.lock(); qc.setQueryData(qk.session, null); await navigate({ to: '/welcome' }); qc.clear(); };
  return (
    <>
      <h1 className="pb-6 pt-1.5 text-[44px] leading-none">Account</h1>
      <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-5 max-[960px]:grid-cols-1">
        <Card className="sticky top-4 flex flex-col gap-3 p-6">
          <span className="text-[13px] text-ink-3">Credits</span>
          <span className="font-mono text-[56px] font-semibold leading-none tracking-[-.04em]">{bal ? <CountUp value={bal.balance} /> : '—'}</span>
          <span className="text-ink-3">About {hoursOfNotes(bal?.balance ?? 0)} of notes. Calls are always free.</span>
          <span className="h-2 overflow-hidden rounded bg-well"><motion.i className="block h-full rounded bg-gradient-to-r from-lamp to-lamp-hot" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (bal?.balance ?? 0) / 100)}%` }} transition={{ duration: 1 }} /></span>
          <span className="flex items-center gap-2 text-[13px] text-ink-3"><Icon name="clock" className="size-4" />Top-ups with USDC arrive with payments.</span>
          <div className="mt-2 border-t border-hair">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2.5 border-b border-hair py-2.5">
                <span><b className="block text-sm">{h.label}</b><span className="text-[12.5px] text-ink-3">{fullDate(h.at)} · {h.detail}</span></span>
                <span className={h.amount > 0 ? 'font-mono text-[13.5px] text-ok' : 'font-mono text-[13.5px]'}>{h.amount > 0 ? '+' : '−'}{Math.abs(h.amount).toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Profile" />
            {s && (
              <div className="flex items-center gap-3.5">
                <Avatar person={s.user} size={56} ring={false} />
                {name === null ? (
                  <span className="flex-1"><b className="block text-base">{s.user.name}</b><span className="text-[13.5px] text-ink-3">Unlocked with a passkey · {s.rootSource === 'prf' ? 'key from your passkey' : 'key held on this device'}</span></span>
                ) : (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" maxLength={80} /><Button type="submit">Save</Button></form>
                )}
                {name === null && <Button size="sm" variant="ghost" onClick={() => setName(s.user.name)}>Edit</Button>}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Notes defaults" />
            {prefs && <>
              <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[14.5px] font-semibold text-ink-2">When a call starts
                <Segmented label="When a call starts" value={prefs.notesDefault} onChange={(v) => savePrefs.mutate({ notesDefault: v })} options={[{ value: 'ask', label: 'Ask me' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Only when I start' }]} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair py-2.5 text-[14.5px] font-semibold text-ink-2">When notes are on, keep
                <Segmented label="When notes are on, keep" value={prefs.keep} onChange={(v) => savePrefs.mutate({ keep: v })} options={[{ value: 'full', label: 'Notes + transcript' }, { value: 'notes', label: 'Notes only' }]} />
              </div>
            </>}
          </Card>
          <Card>
            <CardHeader title="Passkeys" action={<Button size="sm" variant="ghost" icon="plus" loading={adding} onClick={addPasskey}>Add a passkey</Button>} />
            {passkeys.map((p) => (
              <div key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-b border-hair py-2.5 last:border-0">
                <Icon name="fingerprint" className="text-ink-2" />
                <span><b className="block text-sm">{p.deviceName}</b><span className="text-[12.5px] text-ink-3">Added {fullDate(p.createdAt)}{p.lastUsedAt ? ` · last used ${fullDate(p.lastUsedAt)}` : ''}</span></span>
                <span className="flex items-center gap-2">
                  <Chip tone={p.usesPrf ? 'ok' : 'neutral'}>{p.usesPrf ? 'Key from passkey' : 'Key on this device'}</Chip>
                  {passkeys.length > 1 && <Button size="sm" variant="danger-ghost" onClick={() => void removePasskey(p.id, p.deviceName)}>Remove</Button>}
                </span>
              </div>
            ))}
            {passkeys.length < 2 && <p className="mb-0 mt-2 text-[13px] text-ink-3">Your notes can only be unlocked with a passkey. Add a second one (for example on your phone) so you don’t lose access.</p>}
            <p className="mb-0 mt-2 text-[13px] text-ink-3">Adding or removing a passkey asks you to confirm with one you already have.</p>
            {passkeys.some((p) => !p.usesPrf) && <p className="mb-0 mt-2 text-[13px] text-lamp-ink">A passkey marked “Key on this device” keeps its key in this browser. Clearing site data removes it, so keep a second passkey.</p>}
          </Card>
          <Button variant="ghost" icon="lock" className="self-start" onClick={lock}>Lock Alcove</Button>
        </div>
      </div>
    </>
  );
}
