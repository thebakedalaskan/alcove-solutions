/*
 * Renaming the team, for its admin (the design's 4.7): the pen beside its name in the sky opens a popover with the name in
 * its box (the kit's TeamRename), and Rename keeps it for everyone on it. A name it won't take is said in place, in the
 * server's words. One popover at a time on the page, so it takes the filled button while it's open.
 */
import { errorCode, errorMessage, type MyTeam } from '@alcove/api';
import { IconButton, Popover, TeamRename, useToast } from '@alcove/ui';
import { useState } from 'react';
import { log } from '~/lib/log';
import { usePop } from './open';
import { useRenameTeam } from './queries';

const rlog = log.child({ component: 'team' });

export function Rename({ team }: { team: MyTeam }) {
  const pop = usePop('rename');
  const rename = useRenameTeam();
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [refused, setRefused] = useState<string | null>(null);
  const opened = (on: boolean) => {
    if (on) { setName(team.name); setRefused(null); }
    pop.onOpenChange(on);
  };
  const save = () => {
    const next = name.trim();
    if (next === team.name) { opened(false); return; }
    rename.mutate(next, {
      // Named as typed when the answer names nothing (a request answered from Alcove's receipt of it).
      onSuccess: (t) => { opened(false); toast(`Renamed to ${t.name || next}.`, { icon: 'check' }); },
      onError: (e) => { rlog.info('team not renamed', { code: errorCode(e) }); setRefused(errorMessage(e)); }
    });
  };
  return (
    <Popover open={pop.open} onOpenChange={opened} align="center" caret label="Rename team" className="tq-rename-pop"
      anchor={<IconButton icon="pen" size={17} label="Rename team" />}>
      <TeamRename value={name} onChange={(v) => { setName(v); setRefused(null); }} busy={rename.isPending} error={refused} onSave={save} onCancel={() => opened(false)} />
    </Popover>
  );
}
