/*
 * Who to ring, in the organizer's lobby: arches of people on Alcove, free ones first and busy ones dimmed, and Add for
 * anyone else. The people picked stay here, in the page, until the organizer joins: they're never in an address or
 * stored. Anyone the call was started with comes already picked.
 */
import type { Person } from '@alcove/api';
import { RingAddArch, RingArch } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { PeoplePicker } from '~/features/team/PeoplePicker';
import { callName, listNames, sameEmail, someNames } from '~/lib/people';
import { busyNow } from '~/features/calls/scheduling/queries';

/** How many arches fit beside Add. Anyone picked past that still shows. */
const ARCHES = 4;
/** The most addresses read for who's busy. */
const BUSY_READ = 50;
const has = (people: Person[], p: Person) => people.some((x) => sameEmail(x, p));

export function ringLine(picked: Person[]): string {
  if (!picked.length) return 'Pick who to ring, or join and share the link.';
  return `${picked.length > 4 ? someNames(picked) : listNames(picked)} ${picked.length === 1 ? 'hears' : 'hear'} a ring when you join.`;
}

export function LobbyRing({ people, picked, onChange }: { people: Person[]; picked: Person[]; onChange: (picked: Person[]) => void }) {
  const reduce = useReducedMotion() ?? false;
  const [adding, setAdding] = useState(false);
  // Who comes first stays first: taking someone off leaves their arch where it is.
  const [front, setFront] = useState(picked);
  const emails = useMemo(() => people.slice(0, BUSY_READ).map((p) => p.email), [people]);
  const busy = useQuery(busyNow(emails)).data;
  const isBusy = (p: Person) => busy?.has(p.email.toLowerCase()) ?? false;
  const rest = people.filter((p) => !has(front, p));
  const shown = [...front, ...rest.filter((p) => !isBusy(p)), ...rest.filter(isBusy)].slice(0, Math.max(ARCHES, front.length));
  const toggle = (p: Person) => onChange(has(picked, p) ? picked.filter((x) => !sameEmail(x, p)) : [...picked, p]);
  return (
    <div>
      <div className="rg-k">Ring</div>
      <div className="rg-arches">
        {shown.map((p) => (
          <motion.div key={p.email} layout={reduce ? false : 'position'} transition={{ duration: 0.24, ease: [0.22, 0.8, 0.24, 1] }}>
            <RingArch person={p} name={callName(p)} picked={has(picked, p)} busy={isBusy(p)} onToggle={() => toggle(p)} />
          </motion.div>
        ))}
        {people.length > shown.length && (
          <PeoplePicker stage open={adding} onOpenChange={setAdding} side="top" title="Ring someone else" cta="Add" note="Only people on Alcove can be rung."
            skip={shown.map((p) => p.email)} from={people.map((person) => ({ person, source: 'team', onAlcove: true }))}
            anchor={<RingAddArch aria-label="Add someone else to ring" />}
            onDone={(more) => { setFront((f) => [...f, ...more]); onChange([...picked, ...more]); }} />
        )}
      </div>
      <p className="rg-line" aria-live="polite">{ringLine(picked)}</p>
    </div>
  );
}
