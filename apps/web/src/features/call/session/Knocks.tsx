/*
 * Someone asking to join: a card drops in for whoever hosts and stays until they're answered, wherever that happens (here, in
 * People, or on another device), or they take it back or go. A press that still comes too late lets nobody in, and says why.
 * Two at a time over the stage, with how many more are asking; People has them all. It stays mounted while it's hidden (`show`),
 * so an answer on its way keeps its card busy if the cards come back before it's done.
 */
import { errorMessage, type CallAsker, type CallSession } from '@alcove/api';
import { Icon, KnockCard, useToast } from '@alcove/ui';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';

export function Knocks({ show, waiting, organizer, session, onMore }: {
  /** For whoever hosts, while People, which has them all, isn't open and someone is asking. */
  show: boolean;
  waiting: readonly CallAsker[];
  /** The organizer's invite gets the notes to whoever they let in with an address. */
  organizer: boolean;
  session: CallSession;
  /** More are asking than the cards show: People has them. */
  onMore: () => void;
}) {
  const toast = useToast();
  const [answering, setAnswering] = useState<string | null>(null);
  const answerAsk = (w: CallAsker, decide: (id: string) => Promise<void>) => {
    const now = session.getSnapshot();
    if (!now.waiting.some((x) => x.id === w.id)) {
      toast(now.participants.some((p) => p.id === w.id) ? `${w.person.name} is already in the call.` : `${w.person.name} isn’t asking to join any more.`, { icon: 'people' });
      return;
    }
    setAnswering(w.id);
    decide(w.id).catch((e: unknown) => toast(errorMessage(e), { icon: 'x' })).finally(() => setAnswering(null));
  };
  if (!show) return null;
  return (
    <div className="rg-knocks">
      <AnimatePresence initial={false}>
        {waiting.slice(0, 2).map((w) => (
          <KnockCard key={w.id} person={w.person} title={`${w.person.name} asks to join`} busy={answering === w.id}
            detail={w.person.email ? <>{w.person.email}{organizer && <><br />Gets the notes once let in</>}</> : 'Guest, by name only'}
            onLetIn={() => answerAsk(w, (id) => session.admit(id))} onNotNow={() => answerAsk(w, (id) => session.deny(id))} />
        ))}
      </AnimatePresence>
      {waiting.length > 2 && <button type="button" className="rg-more" onClick={onMore}><Icon name="people" size={15} />{waiting.length - 2} more asking</button>}
    </div>
  );
}
