/*
 * Details: the last step reads like the finished call. The name is ready to type over, When and Who step back, and
 * notes and where they go open in place. The button says what it will do, and the line beside it who will hear about it.
 */
import type { MeetingInput, Person } from '@alcove/api';
import { Button, Faces, FlowBody, FlowFoot, FlowRow, NotesSwitches, Select, Switch, SwitchLine } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { namesIn } from '~/features/workspace/List';
import { callName } from '~/lib/people';
import { q } from '~/lib/queries';
import { timeZone } from '~/lib/time';
import { docNames } from './Documents';
import { BIG_CALL, peopleLine, repeatInput, ruleOf, titleFor, type Draft } from './draft';
import { Failed } from './parts';
import { callCount, invitationLine, notesWord, repeatLine, timeLine } from './words';

/** What Schedule does with this draft, for whoever's on it. Only a calendar that takes the call invites anyone. */
function footLine(draft: Draft, guests: readonly Person[], invites: boolean): string {
  const [guest] = guests;
  if (draft.offer) return guest ? `You get a link to send to ${callName(guest)}.` : 'You get a link to send.';
  if (!guests.length) return 'You get a link to share.';
  return invites ? invitationLine(guests) : 'Nobody’s told until you send them the link.';
}

export function Details({ draft, change, guests, at, invites, back, returning, saving, onWhen, onWho, onDocs, onSchedule }: {
  draft: Draft; change: (d: Partial<Draft>) => void; guests: Person[]; at: Date;
  /** A calendar will take this call and invite everyone: it decides what can be promised. */
  invites: boolean;
  back: boolean;
  /** Came back from the documents: focus goes to their row. */
  returning: boolean;
  /** The call is on its way: the rows that step elsewhere wait for the answer. */
  saving: boolean;
  onWhen: () => void; onWho: () => void; onDocs: () => void;
  /** Sends the call, once. It rejects when the call can't be saved. */
  onSchedule: (input: MeetingInput) => Promise<void>;
}) {
  const [failed, setFailed] = useState<unknown>(null);
  const [open, setOpen] = useState<'notes' | 'big' | 'home' | null>(null);
  /* A call's home can be one of your workspaces you can make things in: the menu reads them again as it opens. */
  const spaces = useQuery({ ...q.workspaces(), enabled: open === 'home' }).data ?? [];
  const named = namesIn(spaces);
  const homes = spaces.flatMap((w) => (w.name !== null && (w.role === 'admin' || w.role === 'edit') ? [{ id: w.id, name: named(w) }] : []));
  const name = useRef<HTMLInputElement>(null);
  const zone = timeZone();
  const series = useMemo(() => (draft.offer ? null : repeatInput(draft.repeat, at, zone)), [draft.offer, draft.repeat, at, zone]);
  const rule = draft.offer ? null : ruleOf(draft.repeat, at, zone);
  const title = draft.titled ? draft.title : titleFor(draft.tokens, guests);
  const people = peopleLine(draft.tokens, guests);
  const big = guests.length > BIG_CALL;
  const muted = big && (draft.joinMuted ?? true);
  const { offer } = draft;

  useEffect(() => {
    if (returning) { document.getElementById('cf-docs-row')?.focus({ preventScroll: true }); return; }
    /* The name is ready to type over, where there's a keyboard that won't cover the page. */
    if (matchMedia('(hover: hover)').matches) { name.current?.focus({ preventScroll: true }); name.current?.select(); }
  }, [returning]);

  const submit = async () => {
    setFailed(null);
    const input: MeetingInput = {
      title: title.trim() || titleFor(draft.tokens, guests), startsAt: at.toISOString(), durationMinutes: draft.minutes, guests: guests.map((g) => g.email), notes: draft.notes,
      ...(draft.notes === 'on' ? { choices: draft.choices } : {}), ...(big ? { joinMuted: muted } : {}),
      ...(draft.documents.length ? { documents: draft.documents.map((d) => d.id) } : {}), ...(draft.home ? { workspaceId: draft.home.id } : {}),
      ...(series ? { repeat: series } : {}), ...(offer ? { offer: offer.map((t) => t.toISOString()) } : {})
    };
    try {
      await onSchedule(input);
    } catch (e) {
      setFailed(e);
    }
  };

  const [guest] = guests;
  return (
    <>
      <FlowBody back={back}>
        <input ref={name} className="cf-title" type="text" aria-label="Name the call" value={title} autoComplete="off" enterKeyHint="done"
          onChange={(e) => change({ title: e.target.value, titled: true })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
        <div className="cf-rows" style={{ marginTop: 14 }}>
          <FlowRow icon="cal" onClick={onWhen} disabled={saving} title={offer ? `${offer.length} times offered` : timeLine(at, draft.minutes)}
            sub={offer ? (guest ? `${callName(guest)} picks one` : 'Your guest picks one') : rule ? repeatLine(rule) : 'Doesn’t repeat'} />
          <FlowRow icon="people" onClick={onWho} disabled={saving} title={people.title} sub={people.sub} end={guests.length > 0 ? <Faces people={guests} size={24} max={4} /> : undefined} />
          {big && (
            <>
              <FlowRow icon="megaphone" title="Set up for a big call" sub={muted ? 'Everyone joins muted.' : 'Everyone joins as they choose.'} expanded={open === 'big'} onClick={() => setOpen((o) => (o === 'big' ? null : 'big'))} />
              {open === 'big' && <div className="cf-more"><SwitchLine title="Everyone joins muted, cameras off" control={<Switch checked={muted} label="Everyone joins muted, cameras off" onChange={(joinMuted) => change({ joinMuted })} />} /></div>}
            </>
          )}
          <FlowRow icon="notes" on={draft.notes === 'on'} title={notesWord(draft)} sub={draft.notes === 'on' ? 'Everyone invited gets them' : 'Nothing is recorded'} expanded={open === 'notes'} onClick={() => setOpen((o) => (o === 'notes' ? null : 'notes'))} />
          {open === 'notes' && <div className="cf-more"><NotesSwitches notes={draft.notes} choices={draft.choices} onNotes={(notes) => change({ notes })} onChoices={(choices) => change({ choices })} /></div>}
          <FlowRow icon="folders" title={draft.home ? draft.home.name : 'New workspace for this call'} sub={draft.home ? 'Its notes and transcript go here, in a folder of their own' : 'Its notes and transcript go there. Everyone invited is in it'}
            expanded={open === 'home'} onClick={() => setOpen((o) => (o === 'home' ? null : 'home'))} disabled={saving} />
          {open === 'home' && (
            <div className="cf-more">
              <SwitchLine title="Where its notes go" control={
                <Select label="Where its notes go" value={draft.home?.id ?? 'new'} align="end"
                  options={[{ value: 'new', label: 'New workspace for this call', icon: 'plus' }, ...homes.map((h) => ({ value: h.id, label: h.name, icon: 'folders' as const }))]}
                  onChange={(id) => change({ home: id === 'new' ? null : homes.find((h) => h.id === id) ?? null })} />
              } />
            </div>
          )}
          <FlowRow id="cf-docs-row" icon="fileText" onClick={onDocs} disabled={saving} title={draft.documents.length ? `${draft.documents.length} ${draft.documents.length === 1 ? 'document' : 'documents'}` : 'Documents'}
            sub={draft.documents.length ? docNames(draft.documents) : 'Add from a workspace'} />
        </div>
      </FlowBody>
      {failed !== null && <Failed error={failed} />}
      <FlowFoot summary={footLine(draft, guests, invites)}>
        <Button variant="primary" loading={saving} onClick={() => void submit()}>
          {offer ? 'Get the link' : series ? `Schedule ${callCount(series.occurrences.length)}` : 'Schedule'}
        </Button>
      </FlowFoot>
    </>
  );
}
