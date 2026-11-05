/* Small pieces the call modal and the call card share. */
import { errorMessage, errorRequestId, type ChangeScope, type NotesChoices, type NotesSetting } from '@alcove/api';
import { Flood, FlowNote, Icon, RequestRef, Segmented, Switch, SwitchLine } from '@alcove/ui';
import { useNavigate } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

/** How long night takes to flood out. */
const FLOOD_MS = 560;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Night floods out from what was pressed while `open` (which says where to go) gets ready, then the page goes there.
 * If it can't, night draws back and the error goes to whoever asked. With reduced motion there's no flood.
 */
export function useFloodToCall() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [flood, setFlood] = useState<{ at: { x: number; y: number }; back: boolean } | null>(null);
  const go = useCallback(async (from: Element | null, open: () => Promise<string>) => {
    const box = from?.getBoundingClientRect();
    if (box && !reduce) setFlood({ at: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, back: false });
    try {
      const [code] = await Promise.all([open(), reduce ? undefined : sleep(FLOOD_MS)]);
      await navigate({ to: '/join/$code', params: { code } });
    } catch (e) {
      setFlood((f) => f && { ...f, back: true });
      throw e;
    }
  }, [navigate, reduce]);
  /* Night that drew back has nothing left to show. */
  useEffect(() => {
    if (!flood?.back) return undefined;
    const t = setTimeout(() => setFlood(null), 240);
    return () => clearTimeout(t);
  }, [flood]);
  return { go, flood: flood && <Flood at={flood.at} back={flood.back} /> };
}

/** Whether a call writes notes, and what they keep. Off, nothing else matters. */
export function NotesSwitches({ notes, choices, onNotes, onChoices }: { notes: NotesSetting; choices: NotesChoices; onNotes: (n: NotesSetting) => void; onChoices: (c: NotesChoices) => void }) {
  const on = notes === 'on';
  return (
    <>
      <SwitchLine title="Write notes" sub={on ? 'Everyone invited gets them' : 'Nothing is recorded. You can turn them on during the call.'}
        control={<Switch checked={on} label="Write notes" onChange={(o) => onNotes(o ? 'on' : 'off')} />} />
      {on && (
        <>
          <SwitchLine title="Keep the transcript" sub={choices.keepTranscript ? 'Who said what, and anyone invited can correct it' : 'Used to write the notes, then deleted'}
            control={<Switch checked={choices.keepTranscript} label="Keep the transcript" onChange={(keepTranscript) => onChoices({ ...choices, keepTranscript })} />} />
          <SwitchLine title="Keep the recording" sub={choices.keepRecording ? 'Play back any moment from the notes' : 'Deleted when the call ends'}
            control={<Switch checked={choices.keepRecording} label="Keep the recording" onChange={(keepRecording) => onChoices({ ...choices, keepRecording })} />} />
          <SwitchLine title="Read shared screens" sub="Slides and demos go into the notes"
            control={<Switch checked={choices.readScreens} label="Read shared screens" onChange={(readScreens) => onChoices({ ...choices, readScreens })} />} />
          <p className="cf-sealed"><Icon name="sealed" size={14} />Written in confidential compute. Alcove can’t read them.</p>
        </>
      )}
    </>
  );
}

/** A save that didn't go through, in place, with what to quote when reporting it. What was being changed stays as it was. */
export function Failed({ error }: { error: unknown }) {
  const ref = errorRequestId(error);
  return <FlowNote icon="alert" className="cf-fail" actions={ref ? <RequestRef id={ref} /> : undefined}>{errorMessage(error)}</FlowNote>;
}

/** In a series: which calls a change is for. */
export function ScopeBar({ value, onChange, label = 'Change' }: { value: ChangeScope; onChange: (s: ChangeScope) => void; label?: string | undefined }) {
  return (
    <div className="cf-scope">
      <b>{label}</b>
      <Segmented value={value} onChange={onChange} label="Which calls" options={[{ value: 'this', label: 'This call' }, { value: 'following', label: 'This and later calls' }]} />
    </div>
  );
}
