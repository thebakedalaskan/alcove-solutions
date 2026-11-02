import type { CalendarProvider } from '@alcove/api';
import { Avatar, Button, Card, CardHeader, Chip, CountUp, Icon, Segmented, Switch, useToast } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useDialogs } from '~/features/shell/dialogs';
import { api } from '~/lib/api';
import { q, qk, usePreferences, useResetCache } from '~/lib/queries';
import { fullDate, hoursOfNotes } from '~/lib/time';

export const Route = createFileRoute('/_app/account')({ component: Account });

const CAL: Record<CalendarProvider, { name: string; glyph: string; tile: string }> = {
  google: { name: 'Google Calendar', glyph: 'G', tile: 'bg-[#3B6FE0] text-white' },
  microsoft: { name: 'Outlook', glyph: 'M', tile: 'bg-[#2F2F2F] text-white dark:bg-[#F5F1EA] dark:text-[#111]' },
  apple: { name: 'iCloud Calendar', glyph: 'A', tile: 'bg-[#111] text-white dark:bg-[#F5F1EA] dark:text-[#111]' }
};

function Account() {
  const { data: s } = useQuery(q.session());
  const { data: bal } = useQuery(q.balance());
  const { data: history = [] } = useQuery(q.history());
  const { data: cals = [] } = useQuery(q.calendars());
  const { data: prefs } = useQuery(q.prefs());
  const { data: passkeys = [] } = useQuery(q.passkeys());
  const savePrefs = usePreferences();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const toast = useToast();
  const reset = useResetCache();
  const navigate = useNavigate();
  const providerName = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple', email: 'email' }[s?.provider ?? 'google'];
  return (
    <>
      <h1 className="pb-6 pt-1.5 text-[44px] leading-none">Account</h1>
      <div className="grid grid-cols-[400px_minmax(0,1fr)] items-start gap-5 max-[960px]:grid-cols-1">
        <Card className="sticky top-4 flex flex-col gap-3 p-6">
          <span className="text-[13px] text-ink-3">Credits</span>
          <span className="font-mono text-[56px] font-semibold leading-none tracking-[-.04em]">{bal ? <CountUp value={bal.balance} /> : '—'}</span>
          <span className="text-ink-3">About {hoursOfNotes(bal?.balance ?? 0)} of notes left. Calls are always free.</span>
          <span className="h-2 overflow-hidden rounded bg-well"><motion.i className="block h-full rounded bg-gradient-to-r from-lamp to-lamp-hot" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (bal?.balance ?? 0) / 100)}%` }} transition={{ duration: 1 }} /></span>
          <Button icon="plus" className="self-start" onClick={() => dialogs.open({ kind: 'topup' })}>Add credits</Button>
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
            {s && <div className="flex items-center gap-3.5"><Avatar person={s.user} size={56} ring={false} /><span><b className="block text-base">{s.user.name}</b><span className="text-[13.5px] text-ink-3">{s.user.email} · signed in with {providerName}</span></span></div>}
          </Card>
          <Card>
            <CardHeader title="Calendars" action={<span className="text-[13px] text-ink-3">Invites go out from these</span>} />
            <div className="-mx-2.5">
              {cals.map((c) => (
                <div key={c.provider} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-hair px-2.5 py-3.5 last:border-0">
                  <span className={`grid size-[26px] place-items-center rounded-lg font-display text-sm font-extrabold ${CAL[c.provider].tile}`}>{CAL[c.provider].glyph}</span>
                  <span><b className="block text-[14.5px]">{CAL[c.provider].name}</b><span className="text-[13px] text-ink-3">{c.connected ? (c.viaSignIn ? 'Connected when you signed in' : 'Connected') : 'Not connected'}</span></span>
                  <Switch label={CAL[c.provider].name} checked={c.connected} onCheckedChange={async (v) => { const next = await api.account.setCalendar(c.provider, v); qc.setQueryData(qk.calendars, next); void qc.invalidateQueries({ queryKey: qk.setup }); if (v) toast(`${CAL[c.provider].name} connected`, 'cal'); }} />
                </div>
              ))}
            </div>
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
            <CardHeader title="Passkeys" action={<Button size="sm" variant="ghost" icon="plus" onClick={async () => { await api.account.addPasskey(); void qc.invalidateQueries({ queryKey: qk.passkeys }); void qc.invalidateQueries({ queryKey: qk.setup }); toast('Passkey added', 'fingerprint'); }}>Add a device</Button>} />
            {passkeys.map((p) => (
              <div key={p.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-b border-hair py-2 last:border-0">
                <Icon name="fingerprint" className="text-ink-2" /><span><b className="block text-sm">{p.deviceName}</b><span className="text-[12.5px] text-ink-3">{p.thisDevice ? 'This device · ' : ''}created {fullDate(p.createdAt)}</span></span><Chip tone="ok">Active</Chip>
              </div>
            ))}
            {passkeys.length < 2 && <p className="mb-0 mt-2 text-[13px] text-ink-3">Your notes can only be unlocked with a passkey. Add a second device so you don’t lose access.</p>}
          </Card>
          <Button variant="ghost" icon="signOut" className="self-start" onClick={async () => { await api.auth.signOut(); await reset(); await navigate({ to: '/welcome' }); }}>Sign out</Button>
        </div>
      </div>
    </>
  );
}
