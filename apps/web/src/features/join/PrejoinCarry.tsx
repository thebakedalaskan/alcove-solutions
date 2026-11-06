/*
 * Before joining a call in a series, for someone signed in: what carries over from the earlier calls whose notes they
 * have, briefly, with each thing's source. Someone with no earlier notes, and anyone without an account, sees nothing.
 * Sources open in a new tab, so the camera here stays as it is.
 */
import { NotesApart } from '~/features/notes/parts';
import { CarriedGroups, SeriesLink, nothingCarried, nothingYet } from '~/features/series/cards';
import { useCallSeries } from '~/lib/queries';

/** One of each here, with a way to the rest: this page is for getting into the call. */
const SHOWN = 1;

export function PrejoinCarry({ code, me }: { code: string; me: string | undefined }) {
  const s = useCallSeries(code, me !== undefined);
  if (!s) return null;
  return (
    <NotesApart.Provider value={true}>
      {/* The stage is always night, so this part of the page is too, whatever the app's theme. */}
      <section className="pj-carry" aria-label="From last time">
        <div className="pj-carry-h"><h2>From last time</h2>{!nothingCarried(s) && <SeriesLink seriesId={s.id}>All of it</SeriesLink>}</div>
        {nothingCarried(s) ? <p>{nothingYet(s).text}</p> : <CarriedGroups s={s} me={me} shown={SHOWN} open />}
      </section>
    </NotesApart.Provider>
  );
}
