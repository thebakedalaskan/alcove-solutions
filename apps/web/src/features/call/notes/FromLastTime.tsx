/*
 * What carries over into this call, in the side panel, for you alone: it comes from the earlier notes your own account
 * has now, read again every minute and whenever you come back to the page, so a note you stop having goes from here too.
 * Nothing here is part of the call: everyone sees only what they have, and someone with no earlier notes sees nothing at all.
 */
import type { Series } from '@alcove/api';
import { EmptyState, Fold, Icon } from '@alcove/ui';
import { NotesApart } from '~/features/notes/parts';
import { CarriedGroups, SeriesLink, carriedCount, nothingCarried, nothingYet } from '~/features/notes/series/cards';

/** At most this many of each in the panel; the series has the rest. */
const SHOWN = 3;

/** `open`: unfolded while this call has no notes of its own to read. */
export function FromLastTime({ s, me, open }: { s: Series; me: string | undefined; open: boolean }) {
  const n = carriedCount(s);
  const empty = nothingCarried(s);
  return (
    <NotesApart.Provider value={true}>
      <Fold className="ic-carry" open={open} summary={<span className="ic-carry-h"><Icon name="history" size={15} /><b>From last time</b>{n > 0 && <span className="n">{n}</span>}</span>}>
        {empty ? <EmptyState art={null} title={nothingYet(s).title}>{nothingYet(s).text}</EmptyState> : (
          <>
            <p className="ic-quiet">Only you see this. It comes from the earlier notes you have.</p>
            <CarriedGroups s={s} me={me} shown={SHOWN} open />
            <div className="carry-more ic-carry-all"><SeriesLink seriesId={s.id}>Everything from these calls<Icon name="external" size={13} /></SeriesLink></div>
          </>
        )}
      </Fold>
    </NotesApart.Provider>
  );
}
