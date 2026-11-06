/*
 * What this person has just put on the board, kept apart from what someone else puts in the same place at the same moment:
 * ideas from the call, a phone's + and a mind map's branches, each worked out from what this browser had heard as it was put
 * there. Each is watched for half a minute, for as long as it stays where it was put. Whenever the board is read again,
 * `apart` in `@alcove/board` says which of them now has something else exactly on it, drawn under it, or has had its frame
 * moved from under it, and the board moves those as if they'd been put there in the first place (`Board.moveAsPut`), so
 * undoing what put one there still takes it away, from where it is now.
 */
import { apart, putOf, stillPut, type BoardView, type Put } from '@alcove/board';

/**
 * How long something just put on the board is watched: long enough for what someone else put there at the same moment to
 * arrive, through a slow connection or a moment offline.
 */
const WATCH_MS = 30_000;

/** What the watching needs of the board. */
export interface PutOn {
  /** The doc as last read. */
  readonly written: BoardView;
  moveAsPut(id: string, to: { x: number; y: number }): void;
}

export class JustPut {
  private readonly board: PutOn;
  private readonly watched = new Map<string, { put: Put; until: number }>();
  private looking = false;

  constructor(board: PutOn) {
    this.board = board;
  }

  /** Watches what this person has just put on the board, by ID, from where it is now. */
  watch(ids: readonly string[]): void {
    const until = Date.now() + WATCH_MS;
    for (const id of ids) {
      const put = putOf(this.board.written, id);
      if (put) this.watched.set(id, { put, until });
    }
  }

  /** The board has been read again: what's watched is looked at once whatever is under way has finished. */
  heard(): void {
    if (!this.watched.size || this.looking) return;
    this.looking = true;
    queueMicrotask(this.look);
  }

  /** Lets go of everything watched, as the board closes here. */
  stop(): void {
    this.watched.clear();
  }

  private readonly look = (): void => {
    this.looking = false;
    const now = Date.now();
    // Moved by anyone, this person included, or taken away: it's where someone wanted it, or gone.
    for (const [id, w] of this.watched) if (w.until < now || !stillPut(this.board.written, w.put)) this.watched.delete(id);
    for (const { id, x, y } of apart(this.board.written, [...this.watched.values()].map((w) => w.put))) {
      this.board.moveAsPut(id, { x, y });
      const w = this.watched.get(id), put = putOf(this.board.written, id);
      if (w && put) w.put = put;
      else this.watched.delete(id);
    }
  };
}
